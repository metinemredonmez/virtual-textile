import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { INVENTORY, ORDER, env } from '@vt/config';
import { AppError, isErrorCode, type ErrorCode } from '@vt/contracts';
import { PRISMA_ERROR, isPrismaKnownError, serializeBigInts, type Prisma } from '@vt/db';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import type { Logger } from '../../common/logger.js';
import { CartService, type CartOwner, type CartView } from '../cart/index.js';
import { OrderService, buildSaleLedgerEntries, type LedgerEntryDraft } from '../order/index.js';
import {
  ADDRESS_READER,
  CATALOG_READER,
  PAYMENT_PROVIDER,
  type AddressReaderPort,
  type CatalogReaderPort,
  type CheckoutAddress,
  type CheckoutPaymentResult,
  type CheckoutPaymentSplitItem,
  type CheckoutVariant,
  type CheckoutVerifiedWebhook,
  type PaymentProviderPort,
  type Tx,
} from './checkout.ports.js';
import { ORDER_NUMBER_MAX_ATTEMPTS } from './checkout.constants.js';
import {
  assertLedgerBalanced,
  calculateCommission,
  estimatedPayoutAvailableAt,
  foldShippingIntoFirstItem,
  packageShippingMinor,
  preparationDeadline,
  summarizeOrder,
  type CommissionRuleSnapshot,
} from './commission.js';
import type {
  AddressRef,
  CheckoutInitInput,
  CheckoutPayInput,
  ThreeDsCallbackInput,
} from './checkout.schema.js';

/** İsteği yapan taraf — misafir de olabilir. */
export interface CheckoutActor {
  userId?: string | undefined;
  /** Misafir sepetinin tarayıcı oturumu (X-Session-Id). */
  sessionId?: string | undefined;
  /** ⚠️ Sağlayıcı fraud kontrolü için zorunlu; ters ibrazda kanıt niteliğindedir. */
  ipAddress: string;
}

export interface CheckoutInitResult {
  orderId: string;
  orderNumber: string;
  itemsTotalMinor: bigint;
  shippingTotalMinor: bigint;
  discountMinor: bigint;
  grandTotalMinor: bigint;
  reservationExpiresAt: Date;
  packages: Array<{ sellerId: string; itemsTotalMinor: bigint; shippingMinor: bigint }>;
}

export interface ThreeDsCallbackResult {
  orderId: string;
  orderNumber: string;
  status: 'PAID' | 'FAILED' | 'PENDING';
  /** Kullanıcıya gösterilebilir Türkçe açıklama — ham banka kodu ASLA içermez. */
  message?: string;
  redirectUrl: string;
}

/** Siparişe yazılmaya hazır kalem. */
interface CheckoutLine {
  variant: CheckoutVariant;
  quantity: number;
  unitPriceMinor: bigint;
  lineTotalMinor: bigint;
  commission: ReturnType<typeof calculateCommission>;
}

interface CheckoutPackage {
  sellerId: string;
  lines: CheckoutLine[];
  itemsTotalMinor: bigint;
  shippingMinor: bigint;
  discountShareMinor: bigint;
}

@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProviderPort,
    /** ⚠️ Sepet tablolarına DOKUNULMAZ; sepet modülünün servisi çağrılır. */
    private readonly cart: CartService,
    /** Sipariş numarası serisinin sahibi sipariş modülüdür. */
    private readonly orders: OrderService,
    @Inject(CATALOG_READER) private readonly catalog: CatalogReaderPort,
    @Inject(ADDRESS_READER) private readonly addresses: AddressReaderPort,
  ) {}

  // ══════════════════════════ CHECKOUT BAŞLATMA ═══════════════════════════

  /**
   * Sepeti siparişe çevirir ve stoğu REZERVE eder.
   *
   * Sipariş burada oluşur, ödemeden ÖNCE. Nedeni: sağlayıcıya gitmeden önce
   * stok, fiyat ve komisyonun sabitlenmiş olması gerekir. Ters sırada (önce
   * çek, sonra sipariş yaz) para çekildikten sonra stok yetmediğinde elde
   * iade edilmesi gereken bir tahsilat kalır.
   */
  async init(input: CheckoutInitInput, actor: CheckoutActor): Promise<CheckoutInitResult> {
    const view = await this.cart.view(cartOwnerOf(actor));
    if (!view.id || view.packages.length === 0) throw new AppError('CART_EMPTY');

    // Sepet görüntüleme satın alınamayan kalemleri toplamdan çıkarır ama
    // silmez. Checkout bunları SESSİZCE ATLAYAMAZ: kullanıcı sepetinde
    // gördüğü ürünün siparişte olmadığını fark etmeden ödeme yapardı.
    if (view.unavailableItems.length > 0) {
      throw new AppError('VARIANT_UNAVAILABLE', {
        details: {
          items: view.unavailableItems.map((item) => ({
            variantId: item.variantId,
            reason: item.issue,
          })),
        },
      });
    }

    // ⚠️ Bağlayıcı fiyat sepete eklendiği andaki fiyattır (sepet modülünün
    //    sözleşmesi). Katalog fiyatı değiştiyse tahsil edilecek tutar DEĞİŞMEZ,
    //    ama kullanıcı farkı onaylamadan devam edilmez — aksi hâlde vitrinde
    //    gördüğünden başka bir tutarla karşılaşır.
    if (view.hasPriceChange && !input.acceptPriceChange) {
      throw new AppError('CART_PRICE_CHANGED', { details: { items: priceChangeDetails(view) } });
    }

    const shippingAddress = await this.resolveAddress(input.shipping, actor);
    const billingAddress = input.billing
      ? await this.resolveAddress(input.billing, actor)
      : shippingAddress;

    // ── Ürün anlık görüntüsü (sipariş kalemine kopyalanacak) ──────────────
    const variantIds = view.packages.flatMap((pkg) => pkg.items.map((item) => item.variantId));
    const variants = await this.catalog.loadVariantsForCheckout(variantIds);
    const variantById = new Map(variants.map((variant) => [variant.variantId, variant]));

    // ── Komisyon: O ANKİ kural versiyonu, kaleme SNAPSHOT'lanır ───────────
    const rules = await this.resolveCommissionRules(
      variants.map((v) => ({ sellerId: v.sellerId, categoryId: v.categoryId })),
    );

    const packages: CheckoutPackage[] = view.packages.map((pkg) => {
      const lines = pkg.items.map((item): CheckoutLine => {
        const variant = variantById.get(item.variantId);
        if (!variant) throw new AppError('VARIANT_NOT_FOUND');
        if (!variant.isActive) throw new AppError('VARIANT_UNAVAILABLE');
        if (!variant.sellerApproved || variant.sellerVacationMode) {
          throw new AppError('SELLER_ON_VACATION');
        }
        // ⚠️ Alt üye işyeri yoksa bu sipariş ÖDENEMEZ. Kontrol ödeme anına
        //    bırakılırsa stok rezerve edilmiş, sipariş yazılmış ve kullanıcı
        //    ödeme ekranına gelmişken çıkmaza girer.
        if (!variant.sellerSubmerchantKey) {
          throw new AppError('SELLER_NOT_APPROVED', {
            internalMessage: `Satıcı ${variant.sellerId} için alt üye işyeri kimliği yok`,
          });
        }
        // Sepetin ve katalogun satıcı görüşü ayrışırsa paketleme yanlış olur
        // ve hakediş BAŞKA bir satıcının defterine yazılır.
        if (variant.sellerId !== pkg.sellerId) {
          throw new AppError('CONCURRENCY_CONFLICT', {
            internalMessage: `Varyant ${item.variantId} satıcısı değişmiş`,
          });
        }

        const lineTotalMinor = item.unitPriceMinor * BigInt(item.quantity);
        return {
          variant,
          quantity: item.quantity,
          unitPriceMinor: item.unitPriceMinor,
          lineTotalMinor,
          commission: calculateCommission(
            lineTotalMinor,
            rules(variant.sellerId, variant.categoryId),
          ),
        };
      });

      return {
        sellerId: pkg.sellerId,
        lines,
        itemsTotalMinor: pkg.subtotalMinor,
        // FREE_SHIPPING kuponu kargoyu sıfırlar; eşik kontrolü paket bazındadır.
        shippingMinor: view.freeShipping ? 0n : packageShippingMinor(pkg.subtotalMinor),
        // İndirim payı sepet modülünde kuruş kaybı olmadan dağıtıldı; burada
        // yeniden hesaplamak iki farklı sonuç riski demektir.
        discountShareMinor: pkg.discountMinor,
      };
    });

    const totals = summarizeOrder(packages);
    const now = new Date();
    const reservationExpiresAt = new Date(
      now.getTime() + INVENTORY.reservationTtlMinutes * 60 * 1000,
    );

    const created = await this.createOrderWithReservation({
      actor,
      input,
      packages,
      totals,
      shippingAddress,
      billingAddress,
      reservationExpiresAt,
      now,
    });

    return {
      orderId: created.orderId,
      orderNumber: created.orderNumber,
      itemsTotalMinor: totals.itemsTotalMinor,
      shippingTotalMinor: totals.shippingTotalMinor,
      discountMinor: totals.discountMinor,
      grandTotalMinor: totals.grandTotalMinor,
      reservationExpiresAt,
      packages: packages.map((p) => ({
        sellerId: p.sellerId,
        itemsTotalMinor: p.itemsTotalMinor,
        shippingMinor: p.shippingMinor,
      })),
    };
  }

  /**
   * Rezervasyon + sipariş yazımı TEK TRANSACTION.
   *
   * ⚠️ Ayrılırlarsa: rezervasyon başarılı olup sipariş yazımı patlarsa stok
   *    kimseye ait olmadan 15 dakika kilitli kalır. Yoğun bir kampanyada bu,
   *    tükendi görünen ama aslında satılmamış ürün demektir.
   */
  private async createOrderWithReservation(context: {
    actor: CheckoutActor;
    input: CheckoutInitInput;
    packages: CheckoutPackage[];
    totals: ReturnType<typeof summarizeOrder>;
    shippingAddress: CheckoutAddress;
    billingAddress: CheckoutAddress;
    reservationExpiresAt: Date;
    now: Date;
  }): Promise<{ orderId: string; orderNumber: string }> {
    let lastConflict: unknown;

    for (let attempt = 1; attempt <= ORDER_NUMBER_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            for (const pkg of context.packages) {
              for (const line of pkg.lines) {
                await reserveStock(tx, line.variant.variantId, line.quantity);
              }
            }

            // ⚠️ Numara üretimi AYNI transaction içinde: advisory lock
            //    transaction sonunda düşer ve numara serisinde boşluk oluşmaz.
            const orderNumber = await this.orders.allocateOrderNumber(tx, context.now);

            const order = await tx.order.create({
              data: {
                orderNumber,
                userId: context.actor.userId ?? null,
                email: context.input.email,
                phone: context.input.phone ?? context.shippingAddress.phone,
                status: 'PENDING_PAYMENT',
                itemsTotalMinor: context.totals.itemsTotalMinor,
                shippingTotalMinor: context.totals.shippingTotalMinor,
                discountMinor: context.totals.discountMinor,
                grandTotalMinor: context.totals.grandTotalMinor,
                currency: 'TRY',
                // Adres SNAPSHOT'lanır: kullanıcı adresini silse/değiştirse
                // bile siparişin nereye gittiği kayıtta kalır.
                shippingAddress: context.shippingAddress as unknown as Prisma.InputJsonValue,
                billingAddress: context.billingAddress as unknown as Prisma.InputJsonValue,
                reservationExpiresAt: context.reservationExpiresAt,
              },
              select: { id: true, orderNumber: true },
            });

            for (const pkg of context.packages) {
              const created = await tx.orderPackage.create({
                data: {
                  orderId: order.id,
                  sellerId: pkg.sellerId,
                  status: 'AWAITING_APPROVAL',
                  itemsTotalMinor: pkg.itemsTotalMinor,
                  shippingMinor: pkg.shippingMinor,
                  discountShareMinor: pkg.discountShareMinor,
                  // Ödeme tamamlandığında ödeme anına göre yeniden hesaplanır.
                  slaDeadline: preparationDeadline(context.now),
                },
                select: { id: true },
              });

              await tx.orderItem.createMany({
                data: pkg.lines.map((line) => ({
                  orderId: order.id,
                  packageId: created.id,
                  variantId: line.variant.variantId,
                  productId: line.variant.productId,
                  productTitle: line.variant.productTitle,
                  brandName: line.variant.brandName,
                  variantLabel: line.variant.variantLabel,
                  sku: line.variant.sku,
                  imageKey: line.variant.imageKey,
                  unitPriceMinor: line.unitPriceMinor,
                  quantity: line.quantity,
                  lineTotalMinor: line.lineTotalMinor,
                  // ⚠️ KOMİSYON SNAPSHOT'I. Kural yarın değişse bile bu
                  //    siparişin muhasebesi bugünün oranıyla kapanır.
                  commissionRuleVersionId: line.commission.commissionRuleVersionId,
                  commissionRateBps: line.commission.commissionRateBps,
                  commissionAmountMinor: line.commission.commissionAmountMinor,
                  sellerNetMinor: line.commission.sellerNetMinor,
                })),
              });
            }

            await tx.paymentIntent.create({
              data: {
                orderId: order.id,
                provider: this.payments.name,
                // ⚠️ Sağlayıcı idempotency anahtarı. Sipariş başına BİR kez
                //    üretilir; ödeme tekrar denendiğinde AYNI değer gider ve
                //    sağlayıcı ikinci bir tahsilat açmaz.
                conversationId: randomUUID(),
                status: 'CREATED',
                amountMinor: context.totals.grandTotalMinor,
                currency: 'TRY',
              },
            });

            await tx.orderEvent.create({
              data: {
                orderId: order.id,
                type: 'order.created',
                actorType: context.actor.userId ? 'CUSTOMER' : 'SYSTEM',
                actorId: context.actor.userId ?? null,
                payload: jsonPayload({
                  grandTotalMinor: context.totals.grandTotalMinor,
                  packageCount: context.packages.length,
                }),
              },
            });

            return { orderId: order.id, orderNumber: order.orderNumber };
          },
          { timeout: 20_000 },
        );
      } catch (error) {
        // Numara serisi advisory lock ile korunuyor ama UNIQUE indeks son
        // savunmadır: çakışırsa yeni numarayla tekrar denenir.
        if (
          isPrismaKnownError(error) &&
          error.code === PRISMA_ERROR.UNIQUE_VIOLATION &&
          String(error.meta?.['target'] ?? '').includes('orderNumber')
        ) {
          lastConflict = error;
          continue;
        }
        throw error;
      }
    }

    throw new AppError('INTERNAL_ERROR', {
      cause: lastConflict,
      internalMessage: 'Benzersiz sipariş numarası üretilemedi',
    });
  }

  // ═══════════════════════════════ ÖDEME ══════════════════════════════════

  /**
   * 3DS akışını başlatır ve banka formunu döndürür.
   *
   * ⚠️ Kart verisi bu uçtan GEÇMEZ. Kullanıcı kart bilgisini doğrudan
   *    sağlayıcının formuna girer; biz PCI-DSS kapsamı dışında kalırız.
   */
  async pay(
    input: CheckoutPayInput,
    actor: CheckoutActor,
  ): Promise<{ orderId: string; providerRef: string; htmlContent: string }> {
    const order = await this.prisma.order.findUnique({
      where: { id: input.orderId },
      include: {
        items: {
          include: { package: { select: { id: true, sellerId: true, shippingMinor: true } } },
        },
        payment: true,
      },
    });

    if (!order) throw new AppError('ORDER_NOT_FOUND');
    this.assertOrderAccess(order, input, actor);

    if (order.status === 'PAID') throw new AppError('PAYMENT_ALREADY_CAPTURED');
    if (order.status !== 'PENDING_PAYMENT') throw new AppError('ORDER_INVALID_TRANSITION');

    if (!order.reservationExpiresAt || order.reservationExpiresAt.getTime() <= Date.now()) {
      // Rezervasyon düştüyse stoğun hâlâ orada olduğunu garanti edemeyiz.
      await this.failPayment(order.id, { internalReason: 'Rezervasyon süresi doldu' });
      throw new AppError('CART_EXPIRED');
    }

    const intent = order.payment;
    if (!intent) {
      throw new AppError('ORDER_NOT_FOUND', {
        internalMessage: `Sipariş ${order.id} için ödeme kaydı yok`,
      });
    }

    const attempts = await this.prisma.paymentAttempt.count({ where: { intentId: intent.id } });
    if (attempts >= ORDER.maxPaymentAttempts) {
      // Sınırsız deneme, kart deneme (carding) saldırısına açık kapı bırakır.
      throw new AppError('PAYMENT_DECLINED', {
        internalMessage: `Sipariş ${order.id} için deneme sınırı aşıldı (${attempts})`,
      });
    }

    const splitItems = await this.buildPaymentSplit(order.items);
    const shippingAddress = order.shippingAddress as unknown as CheckoutAddress;
    const billingAddress = order.billingAddress as unknown as CheckoutAddress;
    const buyerName = splitName(shippingAddress.contactName);

    const init = await this.payments.initiate3ds({
      // ⚠️ AYNI conversationId. Değişirse sağlayıcı ikinci bir işlem açar ve
      //    müşteriden iki kez para çekilir.
      conversationId: intent.conversationId,
      orderId: order.id,
      amountMinor: order.grandTotalMinor,
      currency: 'TRY',
      installment: input.installment,
      buyer: {
        id: order.userId ?? `guest-${order.id}`,
        name: buyerName.first,
        surname: buyerName.last,
        email: order.email,
        phone: order.phone,
        ipAddress: actor.ipAddress,
      },
      shippingAddress: toProviderAddress(shippingAddress),
      billingAddress: toProviderAddress(billingAddress),
      items: splitItems,
      callbackUrl: `${env().API_URL}/v1/payments/3ds/callback`,
    });

    await this.prisma.$transaction([
      this.prisma.paymentIntent.update({
        where: { id: intent.id },
        data: {
          status: 'THREEDS_PENDING',
          providerRef: init.providerRef,
          installment: input.installment,
        },
      }),
      this.prisma.paymentAttempt.create({
        data: { intentId: intent.id, attemptNo: attempts + 1, status: 'THREEDS_PENDING' },
      }),
    ]);

    return { orderId: order.id, providerRef: init.providerRef, htmlContent: init.htmlContent };
  }

  /**
   * Bankadan dönen 3DS sonucunu işler.
   *
   * ⚠️ Bu uç kimlik doğrulaması İSTEMEZ (tarayıcı bankadan yönlendiriliyor);
   *    güvenlik `conversationId` + sağlayıcıya SORULAN durumdan gelir, gövdeye
   *    GÜVENİLMEZ. Gövdedeki "status=success" tek başına hiçbir şey ifade etmez.
   */
  async threeDsCallback(body: ThreeDsCallbackInput): Promise<ThreeDsCallbackResult> {
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { conversationId: body.conversationId },
      include: { order: { select: { id: true, orderNumber: true, status: true } } },
    });

    if (!intent) throw new AppError('ORDER_NOT_FOUND');
    const order = intent.order;

    // Banka formu aynı sonucu iki kez POST edebilir; ikinci kez işlem yapılmaz.
    if (order.status === 'PAID') {
      return this.callbackResult(order.id, order.orderNumber, 'PAID');
    }

    const mdStatus = body.mdStatus === undefined ? undefined : String(body.mdStatus);
    if (mdStatus !== '1') {
      // ⚠️ '1' dışındaki her mdStatus başarısızlıktır. Buna bakmadan yalnızca
      //    `status` alanına güvenmek, doğrulanmamış bir işlemi kabul etmek ve
      //    ters ibraz riskini tamamen üstlenmek demektir.
      const failure = mdStatus === undefined ? 'PAYMENT_3DS_CANCELLED' : 'PAYMENT_3DS_FAILED';
      await this.failPayment(order.id, {
        mappedFailure: failure,
        internalReason: `mdStatus=${mdStatus ?? 'yok'}`,
      });
      return this.callbackResult(order.id, order.orderNumber, 'FAILED', failure);
    }

    let result: CheckoutPaymentResult;
    try {
      result = await this.payments.complete3ds({
        providerRef: body.paymentId ?? intent.providerRef ?? '',
        ...(body.conversationData ? { conversationData: body.conversationData } : {}),
      });
    } catch (error) {
      // ⚠️ BURADA REZERVASYON SERBEST BIRAKILMAZ VE SİPARİŞ BAŞARISIZ
      //    SAYILMAZ. `complete3ds` retry edilmeyen bir çekim çağrısıdır; hata
      //    almak "para çekilmedi" anlamına GELMEZ. Sipariş PENDING_PAYMENT
      //    kalır; webhook veya mutabakat işi `inquire()` ile gerçek durumu
      //    öğrenip kapatır.
      this.logger.error(
        { err: error, orderId: order.id, conversationId: intent.conversationId },
        '3DS tamamlama yanıtsız — sipariş mutabakata bırakıldı',
      );
      return this.callbackResult(order.id, order.orderNumber, 'PENDING', 'PAYMENT_TIMEOUT');
    }

    if (result.status === 'CAPTURED') {
      await this.confirmPaid(order.id, result);
      return this.callbackResult(order.id, order.orderNumber, 'PAID');
    }

    await this.failPayment(order.id, {
      providerCode: result.failureCode,
      providerMessage: result.failureMessage,
      mappedFailure: result.mappedFailure,
      internalReason: '3DS auth başarısız',
    });
    return this.callbackResult(order.id, order.orderNumber, 'FAILED', result.mappedFailure);
  }

  // ════════════════════════ ÖDEME BAŞARILI — TEK TX ═══════════════════════

  /**
   * ⚠️ TEK TRANSACTION. Buradaki altı işlemin biri yazılıp diğeri yazılmazsa
   *    sistem tutarsız kalır: stok düşmüş ama defter boş, ya da sipariş ödendi
   *    görünüp satıcıya hakediş yazılmamış olur.
   *
   *  1. Order.status = PAID
   *  2. Inventory: reserved −= n VE onHand −= n (rezervasyon gerçek satışa döner)
   *  3. Her kalem için LedgerEntry SALE(+) ve COMMISSION(−)
   *  4. PaymentIntent = CAPTURED
   *  5. OrderEvent (append-only geçmiş)
   *  6. OutboxEvent('order.paid') — ⚠️ kuyruğa DOĞRUDAN yazılmaz; transaction
   *     geri alınırsa yayınlanmış bir olay geri alınamaz.
   */
  async confirmPaid(orderId: string, payment: CheckoutPaymentResult): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: orderId },
          include: {
            items: { include: { package: { select: { id: true, sellerId: true } } } },
            payment: true,
          },
        });

        if (!order) throw new AppError('ORDER_NOT_FOUND');

        // Aynı ödeme hem callback hem webhook üzerinden gelebilir: ikinci
        // çağrı sessizce çıkar, defter iki kez yazılmaz.
        if (order.status === 'PAID') return;
        if (order.status !== 'PENDING_PAYMENT') throw new AppError('ORDER_INVALID_TRANSITION');

        // ⚠️ Sağlayıcıdan gelen tutar sipariş tutarıyla BİREBİR tutmalı.
        //    Tutmuyorsa işlem durdurulur ve elle incelenir; eksik tahsilatı
        //    "ödendi" saymak doğrudan gelir kaybıdır.
        if (payment.paidAmountMinor !== order.grandTotalMinor) {
          throw new AppError('PAYMENT_AMOUNT_MISMATCH', {
            internalMessage: `Sipariş ${order.orderNumber}: beklenen ${order.grandTotalMinor}, çekilen ${payment.paidAmountMinor}`,
          });
        }

        const paidAt = new Date();
        const availableAt = estimatedPayoutAvailableAt(paidAt);

        // 2. Rezervasyon gerçek satışa dönüşür.
        for (const item of order.items) {
          await commitStock(tx, item.variantId, item.quantity);
        }

        // 3. Defter — satırları SİPARİŞ MODÜLÜ üretir (iade ters kayıtlarıyla
        //    aynı kaynak); checkout yalnızca dengeyi doğrular.
        const entries: LedgerEntryDraft[] = [];
        let expectedNet = 0n;
        for (const item of order.items) {
          expectedNet += item.sellerNetMinor;
          entries.push(
            ...buildSaleLedgerEntries(
              {
                orderItemId: item.id,
                sellerId: item.package.sellerId,
                quantity: item.quantity,
                lineTotalMinor: item.lineTotalMinor,
                commissionAmountMinor: item.commissionAmountMinor,
                sellerNetMinor: item.sellerNetMinor,
                label: `${order.orderNumber} · ${item.productTitle}`,
              },
              { availableAt },
            ),
          );
        }
        assertLedgerBalanced(entries, expectedNet);

        await tx.ledgerEntry.createMany({
          data: entries.map((entry) => ({
            sellerId: entry.sellerId,
            type: entry.type,
            amountMinor: entry.amountMinor,
            currency: 'TRY',
            orderItemId: entry.orderItemId,
            description: entry.description,
            // ⚠️ Hakediş iade penceresi kapanmadan ödenebilir olmaz.
            availableAt: entry.availableAt ?? null,
          })),
        });

        // 1. Sipariş
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'PAID', paidAt, reservationExpiresAt: null },
        });

        // Satıcının hazırlık süresi ödeme anından işlemeye başlar.
        await tx.orderPackage.updateMany({
          where: { orderId: order.id },
          data: { slaDeadline: preparationDeadline(paidAt) },
        });

        // 4. Ödeme kaydı
        if (order.payment) {
          await tx.paymentIntent.update({
            where: { id: order.payment.id },
            data: {
              status: 'CAPTURED',
              providerRef: payment.providerRef,
              capturedAt: paidAt,
              authorizedAt: order.payment.authorizedAt ?? paidAt,
              // ⚠️ Yalnızca MASKELİ gösterim saklanır; tam kart verisi asla.
              cardMask: payment.cardMask ?? null,
              cardBrand: payment.cardBrand ?? null,
              cardToken: payment.cardToken ?? null,
              rawResponse: jsonPayload(payment.raw),
            },
          });
        }

        // 5. Geçmiş
        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            type: 'payment.captured',
            actorType: 'SYSTEM',
            payload: jsonPayload({
              providerRef: payment.providerRef,
              paidAmountMinor: payment.paidAmountMinor,
            }),
          },
        });

        // 6. Yan etkiler (bildirim, satıcıya haber, sepeti temizleme) OUTBOX ile.
        await tx.outboxEvent.create({
          data: {
            aggregate: 'order',
            aggregateId: order.id,
            type: 'order.paid',
            payload: jsonPayload({
              orderId: order.id,
              orderNumber: order.orderNumber,
              userId: order.userId,
              email: order.email,
              grandTotalMinor: order.grandTotalMinor,
              paidAt: paidAt.toISOString(),
              sellerIds: [...new Set(order.items.map((item) => item.package.sellerId))],
            }),
          },
        });
      },
      { timeout: 20_000 },
    );

    this.logger.info({ orderId }, 'Sipariş ödendi');
  }

  /**
   * Ödeme başarısız — REZERVASYON SERBEST BIRAKILIR.
   *
   * ⚠️ Yalnızca ödemenin gerçekten olmadığı KESİN olduğunda çağrılır. Zaman
   *    aşımında çağrılmaz: para çekilmiş olabilir ve stok serbest bırakılırsa
   *    aynı ürün ikinci kez satılır.
   */
  async failPayment(
    orderId: string,
    reason: {
      providerCode?: string | undefined;
      providerMessage?: string | undefined;
      mappedFailure?: string | undefined;
      internalReason?: string | undefined;
    },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true, payment: { include: { attempts: true } } },
      });
      if (!order) return;
      // Ödenmiş siparişe dokunulmaz — geç gelen bir başarısızlık bildirimi
      // tamamlanmış bir siparişi bozamaz.
      if (order.status !== 'PENDING_PAYMENT') return;

      for (const item of order.items) {
        await releaseStock(tx, item.variantId, item.quantity);
      }

      await tx.order.update({
        where: { id: order.id },
        data: { status: 'PAYMENT_FAILED', reservationExpiresAt: null },
      });

      if (order.payment) {
        await tx.paymentIntent.update({
          where: { id: order.payment.id },
          data: {
            status: 'FAILED',
            // ⚠️ Ham sağlayıcı kodu yalnızca burada ve logda durur.
            failureCode: reason.providerCode ?? null,
            failureMessage: reason.providerMessage ?? null,
          },
        });

        const latest = order.payment.attempts.at(-1);
        if (latest) {
          await tx.paymentAttempt.update({
            where: { id: latest.id },
            data: {
              status: 'FAILED',
              providerCode: reason.providerCode ?? null,
              providerMessage: reason.providerMessage ?? null,
              mappedErrorCode: reason.mappedFailure ?? null,
            },
          });
        }
      }

      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: 'payment.failed',
          actorType: 'SYSTEM',
          payload: jsonPayload({
            mappedErrorCode: reason.mappedFailure ?? null,
            reason: reason.internalReason ?? null,
          }),
        },
      });
    });

    this.logger.warn({ orderId, reason: reason.internalReason }, 'Ödeme başarısız');
  }

  // ══════════════════════════════ WEBHOOK ═════════════════════════════════

  /**
   * Sağlayıcı bildirimi.
   *
   * Sıra ÖNEMLİ:
   *  1. İmza doğrula — doğrulanmamış gövde HİÇ işlenmez.
   *  2. WebhookEvent'e id = sağlayıcı olay kimliği ile INSERT. Unique ihlali
   *     "zaten işlendi" demektir; veritabanı burada dağıtık kilit görevi görür.
   *     "Önce SELECT sonra INSERT" yarış durumuna açıktır.
   *  3. Durumu SAĞLAYICIYA SOR — gövdedeki tutara/duruma güvenilmez.
   */
  async handleWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<{ received: true }> {
    let verified: CheckoutVerifiedWebhook;
    try {
      verified = this.payments.verifyWebhook(rawBody, headers);
    } catch (error) {
      // ⚠️ Sahte istek İŞLENMEZ ama yine de 200 döneriz: 4xx dönmek
      //    sağlayıcının bizi sonsuz retry kuyruğuna almasına yol açar ve
      //    saldırgana "imza kontrolü var" sinyali verir.
      this.logger.warn({ err: error }, 'Webhook imzası doğrulanamadı — istek yok sayıldı');
      return { received: true };
    }

    try {
      await this.prisma.webhookEvent.create({
        data: {
          id: verified.eventId,
          provider: this.payments.name,
          type: verified.type,
          payload: jsonPayload(verified.payload),
          signatureOk: true,
        },
      });
    } catch (error) {
      if (isPrismaKnownError(error) && error.code === PRISMA_ERROR.UNIQUE_VIOLATION) {
        this.logger.debug({ eventId: verified.eventId }, 'Webhook zaten işlenmiş');
        return { received: true };
      }
      throw error;
    }

    try {
      await this.processWebhook(verified);
      await this.prisma.webhookEvent.update({
        where: { id: verified.eventId },
        data: { processedAt: new Date(), attempts: { increment: 1 } },
      });
    } catch (error) {
      // Hata YUTULMAZ, kaydedilir. `processedAt` boş bırakılır ki mutabakat
      // işi `processedAt IS NULL` kayıtlarını yeniden denesin.
      await this.prisma.webhookEvent.update({
        where: { id: verified.eventId },
        data: {
          attempts: { increment: 1 },
          lastError: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        },
      });
      this.logger.error({ err: error, eventId: verified.eventId }, 'Webhook işlenemedi');
    }

    return { received: true };
  }

  private async processWebhook(verified: CheckoutVerifiedWebhook): Promise<void> {
    const intent = await this.findIntentForWebhook(verified);
    if (!intent) {
      this.logger.warn({ eventId: verified.eventId }, 'Webhook eşleşen ödeme kaydı bulunamadı');
      return;
    }
    if (intent.status === 'CAPTURED') return;

    // ⚠️ Gövdedeki tutar ve durum DEĞİL, sağlayıcının kendi kaydı esastır.
    //    Gövdeye güvenmek, imza sızsa bile tutarın uydurulabilmesi demektir.
    const result = await this.payments.inquire(intent.conversationId);
    if (!result) {
      this.logger.warn(
        { eventId: verified.eventId, conversationId: intent.conversationId },
        'Sağlayıcıda işlem bulunamadı',
      );
      return;
    }

    if (result.status === 'CAPTURED') {
      await this.confirmPaid(intent.orderId, result);
      return;
    }

    await this.failPayment(intent.orderId, {
      providerCode: result.failureCode,
      providerMessage: result.failureMessage,
      mappedFailure: result.mappedFailure,
      internalReason: `webhook:${verified.type}`,
    });
  }

  private async findIntentForWebhook(
    verified: CheckoutVerifiedWebhook,
  ): Promise<{ id: string; orderId: string; conversationId: string; status: string } | null> {
    const payload = (verified.payload ?? {}) as Record<string, unknown>;
    const conversationId =
      typeof payload['paymentConversationId'] === 'string'
        ? payload['paymentConversationId']
        : typeof payload['conversationId'] === 'string'
          ? payload['conversationId']
          : undefined;

    if (conversationId) {
      const byConversation = await this.prisma.paymentIntent.findUnique({
        where: { conversationId },
        select: { id: true, orderId: true, conversationId: true, status: true },
      });
      if (byConversation) return byConversation;
    }

    if (verified.providerRef) {
      return this.prisma.paymentIntent.findFirst({
        where: { providerRef: verified.providerRef },
        select: { id: true, orderId: true, conversationId: true, status: true },
      });
    }

    return null;
  }

  // ═══════════════════════════ İÇ YARDIMCILAR ═════════════════════════════

  /**
   * Sipariş sahipliği.
   *
   * ⚠️ Üye siparişini yalnızca sahibi ödeyebilir. Misafir siparişinde kimlik
   *    yoktur; bu yüzden e-posta eşleşmesi istenir. Aksi hâlde sipariş
   *    kimliğini ele geçiren biri başkasının siparişi için ödeme başlatabilir.
   */
  private assertOrderAccess(
    order: { userId: string | null; email: string },
    input: CheckoutPayInput,
    actor: CheckoutActor,
  ): void {
    if (order.userId) {
      if (order.userId !== actor.userId) throw new AppError('AUTH_FORBIDDEN');
      return;
    }
    const provided = input.email?.trim().toLowerCase();
    if (!provided || provided !== order.email.trim().toLowerCase()) {
      throw new AppError('AUTH_FORBIDDEN', {
        internalMessage: 'Misafir siparişinde e-posta eşleşmedi',
      });
    }
  }

  private async resolveAddress(ref: AddressRef, actor: CheckoutActor): Promise<CheckoutAddress> {
    if ('addressId' in ref) {
      if (!actor.userId) throw new AppError('ADDRESS_NOT_FOUND');
      // ⚠️ Sahiplik kontrolü port'un İÇİNDE: kullanıcı kimliği sorguya
      //    dahildir, "önce oku sonra sahibini kontrol et" yapılmaz.
      const address = await this.addresses.loadUserAddress(actor.userId, ref.addressId);
      if (!address) throw new AppError('ADDRESS_NOT_FOUND');
      return address;
    }

    return {
      contactName: `${ref.address.firstName} ${ref.address.lastName}`,
      phone: ref.address.phone,
      city: ref.address.city,
      district: ref.address.district,
      neighbourhood: ref.address.neighbourhood,
      line1: ref.address.line1,
      postalCode: ref.address.postalCode,
      companyName: ref.address.companyName,
      taxOffice: ref.address.taxOffice,
      country: 'Türkiye',
    };
  }

  /**
   * O ANKİ komisyon kural versiyonunu bulur.
   *
   * Öncelik (en özelden en genele): satıcı+kategori → satıcı → kategori →
   * platform geneli. Belirsizlik bırakılmaz; iki kural aynı anda eşleşirse
   * hangisinin uygulandığı tahmin edilemez ve bu bir para hatasıdır.
   *
   * ⚠️ Kural bulunamazsa `FINANCE.defaultCommissionBps`e DÜŞÜLMEZ:
   *    `OrderItem.commissionRuleVersionId` zorunlu bir yabancı anahtardır ve
   *    uydurulmuş bir oranın denetlenebilir bir kaynağı olmaz.
   */
  private async resolveCommissionRules(
    pairs: Array<{ sellerId: string; categoryId: string }>,
  ): Promise<(sellerId: string, categoryId: string) => CommissionRuleSnapshot> {
    const sellerIds = [...new Set(pairs.map((p) => p.sellerId))];
    const categoryIds = [...new Set(pairs.map((p) => p.categoryId))];
    const now = new Date();

    const rules = await this.prisma.commissionRule.findMany({
      where: {
        OR: [
          { sellerId: { in: sellerIds } },
          { categoryId: { in: categoryIds } },
          { AND: [{ sellerId: null }, { categoryId: null }] },
        ],
      },
      select: {
        sellerId: true,
        categoryId: true,
        versions: {
          where: {
            validFrom: { lte: now },
            OR: [{ validTo: null }, { validTo: { gt: now } }],
          },
          orderBy: { validFrom: 'desc' },
          take: 1,
          select: { id: true, rateBps: true, fixedFeeMinor: true },
        },
      },
    });

    const index = new Map<string, CommissionRuleSnapshot>();
    for (const rule of rules) {
      const version = rule.versions[0];
      if (!version) continue;
      index.set(`${rule.sellerId ?? '*'}:${rule.categoryId ?? '*'}`, {
        versionId: version.id,
        rateBps: version.rateBps,
        fixedFeeMinor: version.fixedFeeMinor,
      });
    }

    return (sellerId, categoryId) => {
      const found =
        index.get(`${sellerId}:${categoryId}`) ??
        index.get(`${sellerId}:*`) ??
        index.get(`*:${categoryId}`) ??
        index.get('*:*');

      if (!found) {
        throw new AppError('COMMISSION_RULE_NOT_FOUND', {
          internalMessage: `Satıcı ${sellerId} / kategori ${categoryId} için geçerli komisyon kuralı yok`,
        });
      }
      return found;
    };
  }

  /**
   * Sağlayıcıya gönderilecek satıcı bazlı dağılım.
   *
   * ⚠️ Kalem toplamı sipariş tutarına EŞİT olmalı; kargo ayrı kalem olarak
   *    gönderilemediği için paketin ilk kalemine eklenir ve aynı tutar o
   *    kalemin komisyonuna da eklenir (bkz. foldShippingIntoFirstItem).
   */
  private async buildPaymentSplit(
    items: Array<{
      id: string;
      commissionAmountMinor: bigint;
      commissionRateBps: number;
      lineTotalMinor: bigint;
      package: { id: string; sellerId: string; shippingMinor: bigint };
    }>,
  ): Promise<CheckoutPaymentSplitItem[]> {
    const sellerIds = [...new Set(items.map((item) => item.package.sellerId))];
    const sellers = await this.prisma.seller.findMany({
      where: { id: { in: sellerIds } },
      select: { id: true, status: true, submerchantKey: true },
    });
    const sellerById = new Map(sellers.map((seller) => [seller.id, seller]));

    const byPackage = new Map<string, typeof items>();
    for (const item of items) {
      const bucket = byPackage.get(item.package.id) ?? [];
      bucket.push(item);
      byPackage.set(item.package.id, bucket);
    }

    const split: CheckoutPaymentSplitItem[] = [];
    for (const [, packageItems] of byPackage) {
      const first = packageItems[0]!;
      const seller = sellerById.get(first.package.sellerId);

      if (!seller || seller.status !== 'APPROVED') throw new AppError('SELLER_NOT_APPROVED');
      if (!seller.submerchantKey) {
        // Alt üye işyeri yoksa sağlayıcı hakedişi satıcıya aktaramaz; para
        // platformda sıkışır ve elle çözülmesi gerekir.
        throw new AppError('SELLER_NOT_APPROVED', {
          internalMessage: `Satıcı ${seller.id} için alt üye işyeri kimliği yok`,
        });
      }

      const submerchantKey = seller.submerchantKey;
      const rows = packageItems.map((item) => ({
        orderItemId: item.id,
        submerchantKey,
        amountMinor: item.lineTotalMinor,
        commissionMinor: item.commissionAmountMinor,
        commissionRateBps: item.commissionRateBps,
      }));

      split.push(...foldShippingIntoFirstItem(rows, first.package.shippingMinor));
    }

    return split;
  }

  private callbackResult(
    orderId: string,
    orderNumber: string,
    status: ThreeDsCallbackResult['status'],
    failureCode?: string,
  ): ThreeDsCallbackResult {
    // ⚠️ Kullanıcıya gösterilen metin KATALOGDAN gelir; sağlayıcının ham
    //    mesajı buraya asla sızmaz.
    const message =
      failureCode && isErrorCode(failureCode)
        ? new AppError(failureCode as ErrorCode).userMessage
        : undefined;

    const query = new URLSearchParams({ siparis: orderNumber, durum: status.toLowerCase() });
    return {
      orderId,
      orderNumber,
      status,
      ...(message ? { message } : {}),
      redirectUrl: `${env().APP_URL}/checkout/sonuc?${query.toString()}`,
    };
  }
}

// ══════════════════════════ STOK (OPTIMISTIC LOCK) ═══════════════════════════
//
// ⚠️ Kural 3 istisnası — GEREKÇE: rezervasyon ve stok düşümü, sipariş ve defter
// yazımıyla AYNI transaction içinde olmak ZORUNDA. Ayrı bir modül servisine
// taşınırsa çağrı kendi bağlantısını/transaction'ını kullanır, atomiklik
// kaybolur ve "para alındı ama stok düşmedi" durumu mümkün hâle gelir.
// Katalog modülü `tx` kabul eden bir envanter servisi açtığında bu üç fonksiyon
// oraya taşınır; imzaları buna göre yazıldı.

/**
 * Rezervasyon.
 *
 * ⚠️ `updateMany` + `version` koşulu bilinçli: `update` çakışmayı sessizce
 *    ezerdi. Koşul tutmazsa `count === 0` döner ve bunu ÇAKIŞMA olarak okuruz —
 *    aksi hâlde iki eşzamanlı checkout aynı son ürünü satar.
 */
async function reserveStock(tx: Tx, variantId: string, quantity: number): Promise<void> {
  const inventory = await tx.inventory.findUnique({
    where: { variantId },
    select: { onHand: true, reserved: true, version: true },
  });
  if (!inventory) throw new AppError('VARIANT_UNAVAILABLE');

  const available = inventory.onHand - inventory.reserved;
  if (available < quantity) {
    throw new AppError('INSUFFICIENT_STOCK', { params: { available: Math.max(available, 0) } });
  }

  const updated = await tx.inventory.updateMany({
    where: { variantId, version: inventory.version },
    data: { reserved: { increment: quantity }, version: { increment: 1 } },
  });

  if (updated.count === 0) {
    // Okuduğumuzdan bu yana başkası güncelledi. İstemci tekrar dener.
    throw new AppError('CONCURRENCY_CONFLICT');
  }
}

/** Rezervasyon gerçek satışa dönüşür: reserved −= n VE onHand −= n. */
async function commitStock(tx: Tx, variantId: string, quantity: number): Promise<void> {
  const inventory = await tx.inventory.findUnique({
    where: { variantId },
    select: { onHand: true, reserved: true, version: true },
  });
  if (!inventory) throw new AppError('VARIANT_UNAVAILABLE');

  const updated = await tx.inventory.updateMany({
    where: {
      variantId,
      version: inventory.version,
      // Negatif stok yazmaktansa çakışma dönmek yeğdir: eksi stok raporları,
      // yeniden sipariş kararlarını ve satıcı panelini birden bozar.
      reserved: { gte: quantity },
      onHand: { gte: quantity },
    },
    data: {
      reserved: { decrement: quantity },
      onHand: { decrement: quantity },
      version: { increment: 1 },
    },
  });

  if (updated.count === 0) throw new AppError('CONCURRENCY_CONFLICT');
}

/** Ödeme başarısız/süresi doldu: rezervasyon serbest bırakılır, onHand'e dokunulmaz. */
async function releaseStock(tx: Tx, variantId: string, quantity: number): Promise<void> {
  const inventory = await tx.inventory.findUnique({
    where: { variantId },
    select: { reserved: true, version: true },
  });
  if (!inventory) return;

  const updated = await tx.inventory.updateMany({
    where: { variantId, version: inventory.version, reserved: { gte: quantity } },
    data: { reserved: { decrement: quantity }, version: { increment: 1 } },
  });

  if (updated.count === 0) throw new AppError('CONCURRENCY_CONFLICT');
}

// ── Saf yardımcılar ───────────────────────────────────────────────────────

/**
 * Json kolonuna yazılacak yük.
 *
 * ⚠️ bigint JSON'da serileşmez ve Number'a çevrilirse 2^53 üstü kuruş
 *    tutarları SESSİZCE bozulur. Bu yüzden string'e çevriliyor.
 */
function jsonPayload(value: unknown): Prisma.InputJsonValue {
  return serializeBigInts(value) as Prisma.InputJsonValue;
}

/**
 * ⚠️ Token varsa oturum başlığı YOK SAYILIR (sepet modülünün kuralı): aksi
 * hâlde bir üye, başkasının misafir oturum kimliğiyle o sepeti sipariş edebilir.
 */
function cartOwnerOf(actor: CheckoutActor): CartOwner {
  if (actor.userId) return { kind: 'user', userId: actor.userId };
  if (actor.sessionId) return { kind: 'guest', sessionId: actor.sessionId };
  throw new AppError('CART_NOT_FOUND', {
    internalMessage: 'Misafir checkout için X-Session-Id başlığı gerekli',
  });
}

function priceChangeDetails(
  view: CartView,
): Array<{ variantId: string; oldPriceMinor: string; newPriceMinor: string }> {
  return view.packages
    .flatMap((pkg) => pkg.items)
    .filter((item) => item.priceChanged)
    .map((item) => ({
      variantId: item.variantId,
      oldPriceMinor: item.unitPriceMinor.toString(),
      newPriceMinor: item.currentUnitPriceMinor.toString(),
    }));
}

function splitName(contactName: string): { first: string; last: string } {
  const parts = contactName.trim().split(/\s+/);
  if (parts.length <= 1) return { first: contactName.trim() || '-', last: '-' };
  return { first: parts.slice(0, -1).join(' '), last: parts.at(-1)! };
}

function toProviderAddress(address: CheckoutAddress): {
  contactName: string;
  city: string;
  country: string;
  address: string;
} {
  return {
    contactName: address.contactName,
    city: address.city,
    country: address.country || 'Türkiye',
    address: [address.line1, address.neighbourhood, address.district].filter(Boolean).join(', '),
  };
}

// TODO(kod-gerekli): ORDER_RESERVATION_EXPIRED (410, domain) — rezervasyon
// süresi dolduğunda şu an CART_EXPIRED kullanılıyor; kullanıcı mesajı doğru
// ama kod semantiği sipariş değil sepet ima ediyor.
