import { AppError, type ErrorCode } from '@vt/contracts';
import { resilient, defaultIsRetryable } from '../../resilience/resilient.js';
import type {
  PaymentInput,
  PaymentProvider,
  PaymentResult,
  PayoutInput,
  PayoutResult,
  RefundInput,
  RefundResult,
  SubmerchantInput,
  ThreeDsInitResult,
  VerifiedWebhook,
  MappedPaymentFailure,
} from '../payment.provider.js';
import {
  IYZICO_LOCALE,
  IYZICO_PATH,
  type IyzicoConfig,
  type IyzicoEnvelope,
} from './iyzico.config.js';
import { isNotFoundCode, mapProviderErrorCode, mapThreeDsStatus } from './iyzico.error-map.js';
import { buildAuthHeaders, verifyWebhookSignature } from './iyzico.signature.js';

/**
 * PaymentResult'ın iyzico'ya özgü genişlemesi.
 *
 * `failureCode` arayüz gereği HAM sağlayıcı kodudur ve kullanıcıya gösterilmez.
 * Uygulama katmanının kullanıcıya bir şey söyleyebilmesi için eşlenmiş kodu da
 * taşıyoruz — böylece `apps/api` iyzico'nun kod tablosunu bilmek zorunda kalmaz.
 */
export interface IyzicoPaymentResult extends PaymentResult {
  mappedFailure?: MappedPaymentFailure;
}

/** HTTP seviyesinde hata. `status` alanı `defaultIsRetryable` tarafından okunur. */
class IyzicoHttpError extends Error {
  constructor(
    readonly status: number,
    readonly bodyPreview: string,
  ) {
    super(`iyzico HTTP ${status}`);
    this.name = 'IyzicoHttpError';
  }
}

interface CallOptions {
  operation: string;
  errorCode: ErrorCode;
  /**
   * ⚠️ Verilmezse `resilient()` RETRY'I KAPATIR. Bu bir kaza değil,
   * sözleşmedir: idempotent olmayan çağrı tekrar edilmez.
   */
  idempotencyKey?: string;
  retryAttempts?: number;
  timeoutMs?: number;
  method?: 'POST' | 'PUT';
}

/** 1234n → "12.34". Float'a çevrilmeden, bigint aritmetiğiyle. */
export function minorToDecimalString(amountMinor: bigint): string {
  if (amountMinor < 0n) {
    throw new AppError('PAYMENT_AMOUNT_MISMATCH', {
      internalMessage: `Negatif tutar sağlayıcıya gönderilemez: ${amountMinor}`,
    });
  }
  const lira = amountMinor / 100n;
  const kurus = amountMinor % 100n;
  return `${lira.toString()}.${kurus.toString().padStart(2, '0')}`;
}

/** "12.34" → 1234n. Sağlayıcı yanıtındaki tutarı okurken kullanılır. */
export function decimalStringToMinor(value: string | number | undefined): bigint {
  if (value === undefined || value === null) return 0n;
  const text = String(value).trim();
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(text);
  if (!match) {
    throw new AppError('PAYMENT_AMOUNT_MISMATCH', {
      internalMessage: `Sağlayıcıdan çözümlenemeyen tutar: ${text}`,
    });
  }
  // ⚠️ parseFloat KULLANILMAZ. "0.1 + 0.2" problemi burada kuruş kaybı demektir.
  const fraction = (match[2] ?? '').padEnd(2, '0');
  return BigInt(match[1]!) * 100n + BigInt(fraction);
}

/**
 * iyzico PAZARYERİ ADAPTER'I
 *
 * ⚠️ KART VERİSİ BURADAN GEÇMEZ. Kart bilgisi tarayıcıdan doğrudan iyzico'nun
 *    3DS formuna gider; biz yalnızca maskeli gösterim ve token görürüz.
 *    Bu sayede PCI-DSS kapsamı dışında kalıyoruz — bu adapter'a bir gün
 *    `cardNumber` alanı eklenirse tüm sistem kapsam içine girer.
 */
export class IyzicoPaymentProvider implements PaymentProvider {
  readonly name = 'iyzico';

  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly config: IyzicoConfig) {
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    this.now = config.now ?? Date.now;
  }

  // ── Alt üye işyeri (submerchant) ────────────────────────────────────────

  /**
   * ⚠️ Türkiye'de pazaryeri tahsilatı için satıcının alt üye işyeri olması
   * ZORUNLUDUR. Onaysız satıcıya hakediş aktarılamaz; sipariş alınırsa para
   * platformda sıkışır.
   */
  async createSubmerchant(input: SubmerchantInput): Promise<{ submerchantKey: string }> {
    const response = await this.call(
      IYZICO_PATH.submerchant,
      {
        locale: IYZICO_LOCALE,
        // Aynı satıcı için tekrar denendiğinde iyzico aynı kaydı görür.
        conversationId: `submerchant-${input.sellerId}`,
        subMerchantExternalId: input.sellerId,
        subMerchantType: input.type,
        address: input.address,
        taxOffice: input.taxOffice,
        legalCompanyTitle: input.legalName,
        email: input.email,
        gsmNumber: input.phone,
        name: input.legalName,
        iban: input.iban,
        identityNumber: input.type === 'PERSONAL' ? input.taxNumber : undefined,
        taxNumber: input.type === 'PERSONAL' ? undefined : input.taxNumber,
        currency: 'TRY',
      },
      {
        operation: 'createSubmerchant',
        errorCode: 'UPSTREAM_UNAVAILABLE',
        idempotencyKey: `submerchant-${input.sellerId}`,
      },
    );

    const key = typeof response['subMerchantKey'] === 'string' ? response['subMerchantKey'] : '';
    if (response.status !== 'success' || key === '') {
      throw new AppError('UPSTREAM_UNAVAILABLE', {
        internalMessage: `iyzico alt üye işyeri açılamadı (kod: ${response.errorCode ?? '-'})`,
      });
    }
    return { submerchantKey: key };
  }

  async updateSubmerchant(submerchantKey: string, input: Partial<SubmerchantInput>): Promise<void> {
    const response = await this.call(
      IYZICO_PATH.submerchant,
      {
        locale: IYZICO_LOCALE,
        conversationId: `submerchant-update-${submerchantKey}`,
        subMerchantKey: submerchantKey,
        address: input.address,
        taxOffice: input.taxOffice,
        legalCompanyTitle: input.legalName,
        email: input.email,
        gsmNumber: input.phone,
        name: input.legalName,
        iban: input.iban,
        currency: 'TRY',
      },
      {
        operation: 'updateSubmerchant',
        errorCode: 'UPSTREAM_UNAVAILABLE',
        idempotencyKey: `submerchant-update-${submerchantKey}`,
        method: 'PUT',
      },
    );

    if (response.status !== 'success') {
      throw new AppError('UPSTREAM_UNAVAILABLE', {
        internalMessage: `iyzico alt üye işyeri güncellenemedi (kod: ${response.errorCode ?? '-'})`,
      });
    }
  }

  // ── 3D Secure ───────────────────────────────────────────────────────────

  /**
   * 3DS başlatma — RETRY EDİLEBİLİR.
   *
   * Güvenli olmasının nedeni `conversationId`: iyzico aynı conversationId ile
   * gelen ikinci isteği ayrı bir işlem olarak AÇMAZ. Bu yüzden idempotency
   * anahtarı olarak onu veriyoruz. Anahtar verilmezse `resilient()` retry'ı
   * kapatır; sessizce çifte işlem yapmaktansa hata dönmek her zaman ucuzdur.
   */
  async initiate3ds(input: PaymentInput): Promise<ThreeDsInitResult> {
    const totalMinor = input.items.reduce((sum, item) => sum + item.amountMinor, 0n);
    if (totalMinor !== input.amountMinor) {
      // Kalem toplamı sipariş tutarını tutmuyorsa sağlayıcıya HİÇ gitmeyiz:
      // iyzico bunu kabul edip parayı çekerse mutabakat kalıcı olarak bozulur.
      throw new AppError('PAYMENT_AMOUNT_MISMATCH', {
        internalMessage: `Kalem toplamı ${totalMinor}, sipariş tutarı ${input.amountMinor}`,
      });
    }

    const response = await this.call(
      IYZICO_PATH.threeDsInitialize,
      {
        locale: IYZICO_LOCALE,
        conversationId: input.conversationId,
        price: minorToDecimalString(input.amountMinor),
        paidPrice: minorToDecimalString(input.amountMinor),
        currency: input.currency,
        installment: input.installment,
        basketId: input.orderId,
        paymentChannel: 'WEB',
        paymentGroup: 'PRODUCT',
        callbackUrl: input.callbackUrl,
        buyer: {
          id: input.buyer.id,
          name: input.buyer.name,
          surname: input.buyer.surname,
          email: input.buyer.email,
          gsmNumber: input.buyer.phone,
          // ⚠️ Fraud skorlaması için zorunlu. Ters ibrazda "gerekli özeni
          // gösterdik" savunmasının kanıtı da budur.
          ip: input.buyer.ipAddress,
          identityNumber: '11111111111',
          registrationDate: input.buyer.registrationDate
            ? formatIyzicoDate(input.buyer.registrationDate)
            : undefined,
          registrationAddress: input.billingAddress.address,
          city: input.billingAddress.city,
          country: input.billingAddress.country,
        },
        shippingAddress: {
          contactName: input.shippingAddress.contactName,
          city: input.shippingAddress.city,
          country: input.shippingAddress.country,
          address: input.shippingAddress.address,
        },
        billingAddress: {
          contactName: input.billingAddress.contactName,
          city: input.billingAddress.city,
          country: input.billingAddress.country,
          address: input.billingAddress.address,
        },
        basketItems: input.items.map((item) => ({
          id: item.orderItemId,
          itemType: 'PHYSICAL',
          price: minorToDecimalString(item.amountMinor),
          name: item.orderItemId,
          category1: 'Giyim',
          subMerchantKey: item.submerchantKey,
          // ⚠️ subMerchantPrice = satıcıya kalan. Komisyon platformda kalır.
          //    Bu alan yanlış hesaplanırsa fark satıcıya fazladan ödenir ve
          //    geri tahsilat gerekir.
          subMerchantPrice: minorToDecimalString(item.amountMinor - item.commissionMinor),
        })),
      },
      {
        operation: 'initiate3ds',
        errorCode: 'PAYMENT_PROVIDER_DOWN',
        idempotencyKey: input.conversationId,
      },
    );

    if (response.status !== 'success') {
      const mapped = mapProviderErrorCode(response.errorCode);
      throw new AppError(mapped, {
        internalMessage: `iyzico 3DS başlatılamadı (kod: ${response.errorCode ?? '-'}, mesaj: ${response.errorMessage ?? '-'})`,
      });
    }

    const encoded = response['threeDSHtmlContent'];
    if (typeof encoded !== 'string' || encoded === '') {
      throw new AppError('PAYMENT_PROVIDER_DOWN', {
        internalMessage: 'iyzico 3DS formu boş döndü',
      });
    }

    return {
      providerRef: readString(response, 'paymentId') ?? input.conversationId,
      // iyzico formu base64 gönderir; tarayıcıya HTML olarak verilmesi gerekir.
      htmlContent: Buffer.from(encoded, 'base64').toString('utf8'),
    };
  }

  /**
   * ⚠️⚠️ RETRY EDİLMEZ.
   *
   * Bu çağrı parayı ÇEKER. Zaman aşımında isteğin bankaya ulaşıp ulaşmadığını
   * bilemeyiz; tekrar denemek müşteriden ikinci kez para çekme riskidir.
   * `resilient()`e bilerek `idempotencyKey` VERİLMİYOR — sarmalayıcı bu
   * durumda retry'ı kendisi kapatır. `retryAttempts: 0` ikinci bir emniyet
   * kemeridir: biri gelip anahtar eklerse bile retry açılmasın.
   *
   * Hata hâlinde doğru davranış tekrar denemek değil, `inquire()` ile
   * sağlayıcıdan DURUMU SORMAKTIR.
   */
  async complete3ds(input: {
    providerRef: string;
    conversationData?: string;
  }): Promise<IyzicoPaymentResult> {
    const response = await this.call(
      IYZICO_PATH.threeDsAuth,
      {
        locale: IYZICO_LOCALE,
        paymentId: input.providerRef,
        conversationData: input.conversationData,
      },
      {
        operation: 'complete3ds',
        errorCode: 'PAYMENT_TIMEOUT',
        retryAttempts: 0,
        timeoutMs: 25_000,
      },
    );

    return this.toPaymentResult(response, input.providerRef);
  }

  /**
   * Durum sorgulama — idempotent, güvenle retry edilir.
   * `complete3ds` zaman aşımına uğradığında paranın çekilip çekilmediğini
   * ÖĞRENMENİN tek doğru yolu budur.
   */
  async inquire(conversationId: string): Promise<IyzicoPaymentResult | null> {
    const response = await this.call(
      IYZICO_PATH.paymentDetail,
      {
        locale: IYZICO_LOCALE,
        conversationId,
        paymentConversationId: conversationId,
      },
      {
        operation: 'inquire',
        errorCode: 'PAYMENT_PROVIDER_DOWN',
        idempotencyKey: conversationId,
      },
    );

    if (response.status !== 'success' && isNotFoundCode(response.errorCode)) return null;
    return this.toPaymentResult(response, readString(response, 'paymentId') ?? conversationId);
  }

  // ── İade ────────────────────────────────────────────────────────────────

  /** `refundRef` idempotency anahtarıdır: retry aynı iadeyi ikinci kez yapmaz. */
  async refund(input: RefundInput): Promise<RefundResult> {
    const response = await this.call(
      IYZICO_PATH.refund,
      {
        locale: IYZICO_LOCALE,
        conversationId: input.refundRef,
        paymentTransactionId: input.providerRef,
        price: minorToDecimalString(input.amountMinor),
        ip: input.ipAddress,
        currency: 'TRY',
      },
      {
        operation: 'refund',
        errorCode: 'PAYMENT_PROVIDER_DOWN',
        idempotencyKey: input.refundRef,
      },
    );

    const succeeded = response.status === 'success';
    return {
      providerRef: readString(response, 'paymentTransactionId') ?? input.providerRef,
      status: succeeded ? 'SUCCEEDED' : 'FAILED',
      refundedAmountMinor: succeeded ? decimalStringToMinor(readScalar(response, 'price')) : 0n,
      failureCode: response.errorCode,
      raw: response,
    };
  }

  // ── Hakediş aktarımı ────────────────────────────────────────────────────

  /** `payoutRef` idempotency anahtarıdır. */
  async payout(input: PayoutInput): Promise<PayoutResult> {
    const response = await this.call(
      IYZICO_PATH.settlementApprove,
      {
        locale: IYZICO_LOCALE,
        conversationId: input.payoutRef,
        subMerchantKey: input.submerchantKey,
        price: minorToDecimalString(input.amountMinor),
      },
      {
        operation: 'payout',
        errorCode: 'PAYMENT_PROVIDER_DOWN',
        idempotencyKey: input.payoutRef,
      },
    );

    return {
      providerRef: readString(response, 'paymentTransactionId') ?? input.payoutRef,
      status: response.status === 'success' ? 'SENT' : 'FAILED',
      // ⚠️ Ham sağlayıcı mesajı yalnızca admin panelinde görünür; satıcıya
      //    gösterilecek metin uygulama katmanında üretilir.
      failureReason: response.status === 'success' ? undefined : response.errorCode,
    };
  }

  // ── Webhook ─────────────────────────────────────────────────────────────

  /**
   * ⚠️ HAM Buffer ile çağrılır — JSON.parse'tan ÖNCE.
   * İmza doğrulanmadan gövde İŞLENMEZ; doğrulanmamış bir "ödeme başarılı"
   * bildirimi bedava sipariş demektir.
   */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): VerifiedWebhook {
    const check = verifyWebhookSignature({
      rawBody,
      headers,
      webhookSecret: this.config.webhookSecret,
      now: this.now,
    });

    if (!check.ok) {
      // ⚠️ AUTH_FORBIDDEN değil: o kod "giriş yapmış ama yetkisiz kullanıcı"
      //    anlamına gelir ve bu uç noktada hiç kullanıcı yok. Ayrı kod, imza
      //    reddi oranını yetki hatalarından ayrı izlemeyi de mümkün kılar.
      throw new AppError('WEBHOOK_SIGNATURE_INVALID', {
        internalMessage: `iyzico webhook imzası reddedildi: ${check.reason ?? 'bilinmiyor'}`,
      });
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new AppError('VALIDATION_FAILED', {
        internalMessage: 'iyzico webhook gövdesi JSON değil',
      });
    }

    // Olay kimliği çift işlemeyi engelleyen BİRİNCİL anahtardır; yoksa
    // aynı bildirim iki kez işlenebilir. iyzico alan adını sürümler arasında
    // değiştirdiği için birkaç aday sırayla denenir.
    const eventId =
      readString(payload, 'iyziEventId') ??
      readString(payload, 'eventId') ??
      readString(payload, 'paymentConversationId') ??
      readString(payload, 'token');

    if (!eventId) {
      throw new AppError('VALIDATION_FAILED', {
        internalMessage: 'iyzico webhook olay kimliği içermiyor',
      });
    }

    return {
      eventId,
      type: readString(payload, 'iyziEventType') ?? readString(payload, 'eventType') ?? 'unknown',
      providerRef:
        readString(payload, 'paymentId') ?? readString(payload, 'paymentConversationId') ?? '',
      status: readString(payload, 'status') ?? readString(payload, 'paymentStatus') ?? 'unknown',
      payload,
    };
  }

  // ── İç yardımcılar ──────────────────────────────────────────────────────

  private toPaymentResult(response: IyzicoEnvelope, fallbackRef: string): IyzicoPaymentResult {
    const providerRef = readString(response, 'paymentId') ?? fallbackRef;
    const threeDs = mapThreeDsStatus(readScalar(response, 'mdStatus'));
    const captured =
      response.status === 'success' &&
      threeDs.authenticated &&
      readString(response, 'paymentStatus') !== 'FAILURE';

    if (captured) {
      return {
        providerRef,
        status: 'CAPTURED',
        paidAmountMinor: decimalStringToMinor(readScalar(response, 'paidPrice')),
        cardMask: buildCardMask(response),
        cardBrand: readString(response, 'cardAssociation'),
        cardToken: readString(response, 'cardToken'),
        raw: response,
      };
    }

    // 3DS doğrulanmadıysa banka kodundan bağımsız olarak 3DS hatası döneriz —
    // kullanıcıya "kartınız reddedildi" demek yanlış yönlendirme olurdu.
    const mapped = threeDs.authenticated
      ? mapProviderErrorCode(response.errorCode)
      : (threeDs.failure ?? 'PAYMENT_3DS_FAILED');

    return {
      providerRef,
      status: 'FAILED',
      paidAmountMinor: 0n,
      // ⚠️ Ham kod ve mesaj yalnızca LOG ve `PaymentAttempt` içindir.
      failureCode: response.errorCode,
      failureMessage: response.errorMessage,
      mappedFailure: mapped,
      raw: response,
    };
  }

  private async call(
    path: string,
    payload: Record<string, unknown>,
    options: CallOptions,
  ): Promise<IyzicoEnvelope> {
    // `undefined` alanlar gönderilmez: iyzico bazı alanlarda boş string'i
    // "geçersiz değer" sayar ve isteği tümden reddeder.
    const body = JSON.stringify(payload, (_key, value: unknown) =>
      value === undefined ? undefined : value,
    );

    return resilient<IyzicoEnvelope>(
      {
        provider: this.name,
        operation: options.operation,
        errorCode: options.errorCode,
        ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        ...(options.retryAttempts !== undefined ? { retryAttempts: options.retryAttempts } : {}),
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        ...(this.config.circuitBreaker ? { circuitBreaker: this.config.circuitBreaker } : {}),
        isRetryable: defaultIsRetryable,
        extractProviderCode: (error) =>
          error instanceof IyzicoHttpError ? String(error.status) : undefined,
      },
      async () => {
        // ⚠️ İmza HER denemede yeniden üretilir (randomKey değişir) ama
        //    `conversationId` AYNI kalır: idempotency iş seviyesindedir,
        //    taşıma seviyesinde değil.
        const headers = buildAuthHeaders({
          apiKey: this.config.apiKey,
          secretKey: this.config.secretKey,
          uriPath: path,
          body,
        });

        const response = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
          method: options.method ?? 'POST',
          headers,
          body,
        });

        const text = await response.text();

        if (!response.ok) {
          // 5xx/429 → retry edilebilir (idempotency anahtarı varsa).
          // 4xx → aynı istek aynı sonucu verir, tekrar denemek kota yakar.
          throw new IyzicoHttpError(response.status, text.slice(0, 300));
        }

        try {
          return JSON.parse(text) as IyzicoEnvelope;
        } catch {
          // Gövde JSON değilse sağlayıcı bakımda/proxy araya girmiş demektir;
          // bu geçici bir durumdur ve retry edilebilir sayılır.
          throw new IyzicoHttpError(502, text.slice(0, 300));
        }
      },
    );
  }
}

// ── Saf yardımcılar ───────────────────────────────────────────────────────

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function readScalar(source: Record<string, unknown>, key: string): string | number | undefined {
  const value = source[key];
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

/** iyzico BIN + son 4 hane döner; tam kart numarası ASLA saklanmaz. */
function buildCardMask(response: IyzicoEnvelope): string | undefined {
  const bin = readString(response, 'binNumber');
  const last4 = readString(response, 'lastFourDigits');
  if (!bin || !last4) return undefined;
  return `${bin}******${last4}`;
}

/** iyzico "2024-01-31 12:00:00" biçimini ister. */
function formatIyzicoDate(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}
