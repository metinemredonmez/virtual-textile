import type { BasisPoints } from '@vt/contracts';

/**
 * ÖDEME SAĞLAYICISI ARAYÜZÜ
 *
 * Uygulama kodu YALNIZCA bu arayüzü konuşur. iyzico'ya (veya başka bir
 * sağlayıcıya) özgü hiçbir tip `apps/api` içine sızmaz — sağlayıcı
 * değiştirmek adapter'ı değiştirmek demektir, uygulamayı değil.
 *
 * ⚠️ Türkiye'de pazaryeri tahsilat + TL payout için "alt üye işyeri"
 * (submerchant) modeli gerekir. Stripe Connect bu modeli TR'de desteklemez.
 *
 * ⚠️ KART VERİSİ BU ARAYÜZDEN GEÇMEZ. Kart bilgisi tarayıcıdan doğrudan
 * sağlayıcının 3DS sayfasına gider; biz yalnızca maskeli gösterim ve token
 * görürüz. Böylece PCI-DSS kapsamı dışında kalırız.
 */

export interface SubmerchantInput {
  sellerId: string;
  legalName: string;
  taxNumber: string;
  taxOffice: string;
  iban: string;
  email: string;
  phone: string;
  address: string;
  /** 'PERSONAL' = şahıs, 'PRIVATE_COMPANY' / 'LIMITED_COMPANY' = tüzel */
  type: 'PERSONAL' | 'PRIVATE_COMPANY' | 'LIMITED_COMPANY';
}

/** Siparişin satıcı bazında dağılımı — sağlayıcı hakedişi buna göre böler. */
export interface PaymentSplitItem {
  orderItemId: string;
  submerchantKey: string;
  /** Kalem tutarı (kuruş) */
  amountMinor: bigint;
  /** Platform komisyonu (kuruş) — sağlayıcı bunu platformda tutar. */
  commissionMinor: bigint;
  commissionRateBps: BasisPoints;
}

export interface PaymentInput {
  /**
   * ⚠️ IDEMPOTENCY ANAHTARI. Retry'da AYNI değer gönderilir.
   * Değişirse sağlayıcı ikinci bir işlem açar ve müşteriden iki kez çekilir.
   */
  conversationId: string;
  orderId: string;
  amountMinor: bigint;
  currency: 'TRY';
  installment: number;
  buyer: {
    id: string;
    name: string;
    surname: string;
    email: string;
    phone: string;
    /** Sağlayıcı fraud kontrolü için ister. */
    ipAddress: string;
    registrationDate?: Date;
  };
  shippingAddress: { contactName: string; city: string; country: string; address: string };
  billingAddress: { contactName: string; city: string; country: string; address: string };
  items: PaymentSplitItem[];
  /** 3DS tamamlandığında sağlayıcının döneceği adres. */
  callbackUrl: string;
}

export interface ThreeDsInitResult {
  providerRef: string;
  /** Tarayıcıda iframe içinde gösterilecek banka formu. */
  htmlContent: string;
}

export interface PaymentResult {
  providerRef: string;
  status: 'CAPTURED' | 'FAILED';
  paidAmountMinor: bigint;
  cardMask?: string;
  cardBrand?: string;
  cardToken?: string;
  /** Sağlayıcının ham hata kodu — LOGLANIR, kullanıcıya gösterilmez. */
  failureCode?: string;
  failureMessage?: string;
  raw: unknown;
}

export interface RefundInput {
  providerRef: string;
  /** ⚠️ Idempotency anahtarı — retry'da aynı değer. */
  refundRef: string;
  amountMinor: bigint;
  /** Kısmi iadede hangi kalem iade ediliyor. */
  orderItemId?: string;
  ipAddress: string;
}

export interface RefundResult {
  providerRef: string;
  status: 'SUCCEEDED' | 'FAILED';
  refundedAmountMinor: bigint;
  failureCode?: string;
  raw: unknown;
}

export interface PayoutInput {
  /** ⚠️ Idempotency anahtarı. */
  payoutRef: string;
  submerchantKey: string;
  amountMinor: bigint;
  iban: string;
}

export interface PayoutResult {
  providerRef: string;
  status: 'SENT' | 'FAILED';
  failureReason?: string;
}

export interface VerifiedWebhook {
  /** Sağlayıcının olay kimliği — çift işlemeyi engelleyen birincil anahtar. */
  eventId: string;
  type: string;
  providerRef: string;
  status: string;
  payload: unknown;
}

export interface PaymentProvider {
  readonly name: string;

  createSubmerchant(input: SubmerchantInput): Promise<{ submerchantKey: string }>;
  updateSubmerchant(submerchantKey: string, input: Partial<SubmerchantInput>): Promise<void>;

  initiate3ds(input: PaymentInput): Promise<ThreeDsInitResult>;
  /**
   * 3DS dönüşünü tamamlar.
   * ⚠️ RETRY EDİLMEZ. Tekrar çağrılırsa ikinci çekim riski vardır;
   * hata durumunda sağlayıcıdan durum SORGULANIR (`inquire`).
   */
  complete3ds(input: { providerRef: string; conversationData?: string }): Promise<PaymentResult>;

  /** Mutabakat ve zaman aşımı sonrası durum tespiti için — idempotent. */
  inquire(conversationId: string): Promise<PaymentResult | null>;

  refund(input: RefundInput): Promise<RefundResult>;
  payout(input: PayoutInput): Promise<PayoutResult>;

  /**
   * Webhook imzasını doğrular.
   * ⚠️ HAM gövde ile çağrılır — JSON.parse'tan ÖNCE. Parse edilmiş gövdeden
   * yeniden serileştirme imzayı bozar.
   */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): VerifiedWebhook;
}

/**
 * Sağlayıcı hata kodu → uygulama hata kodu eşlemesi.
 *
 * Kullanıcıya "Bankanız 51 hatası döndü" denmez. Her sağlayıcı adapter'ı
 * kendi kodlarını bu ortak kümeye çevirir.
 */
export type MappedPaymentFailure =
  | 'PAYMENT_INSUFFICIENT_FUNDS'
  | 'PAYMENT_LIMIT_EXCEEDED'
  | 'PAYMENT_CARD_INVALID'
  | 'PAYMENT_BANK_REJECTED'
  | 'PAYMENT_3DS_FAILED'
  | 'PAYMENT_3DS_CANCELLED'
  | 'PAYMENT_DECLINED';
