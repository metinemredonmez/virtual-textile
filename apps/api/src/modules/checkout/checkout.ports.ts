// NEEDS-DEP: @vt/adapters
//
// `apps/api/package.json` içinde `@vt/adapters` bağımlılığı YOK ve package.json
// dosyalarına dokunmak bu ajanın yetkisi dışında. Bu yüzden ödeme sağlayıcısı
// bu modülde bir PORT olarak tanımlanıyor: tipler `packages/adapters/src/payment/
// payment.provider.ts` ile YAPISAL olarak birebir aynıdır, dolayısıyla
// `IyzicoPaymentProvider` hiçbir uyarlama katmanı olmadan bu porta bağlanabilir.
//
// Entegrasyon ajanı yapması gereken:
//   1. apps/api/package.json'a "@vt/adapters": "workspace:*" ekle
//   2. CheckoutModule'e PAYMENT_PROVIDER token'ını IyzicoPaymentProvider ile bağla
// Bağımlılık eklendiğinde bu dosyadaki tipler `import type` ile değiştirilebilir.

import type { Prisma } from '@vt/db';

// ══════════════════════════ ÖDEME SAĞLAYICISI ═══════════════════════════════

export interface CheckoutPaymentSplitItem {
  orderItemId: string;
  submerchantKey: string;
  /** Kalem tutarı (kuruş) */
  amountMinor: bigint;
  /** Platform komisyonu (kuruş) — sağlayıcı bunu platformda tutar. */
  commissionMinor: bigint;
  commissionRateBps: number;
}

export interface CheckoutPaymentInput {
  /** ⚠️ Idempotency anahtarı. Retry'da AYNI değer gönderilir. */
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
    ipAddress: string;
    registrationDate?: Date;
  };
  shippingAddress: { contactName: string; city: string; country: string; address: string };
  billingAddress: { contactName: string; city: string; country: string; address: string };
  items: CheckoutPaymentSplitItem[];
  callbackUrl: string;
}

export interface CheckoutPaymentResult {
  providerRef: string;
  status: 'CAPTURED' | 'FAILED';
  paidAmountMinor: bigint;
  cardMask?: string;
  cardBrand?: string;
  cardToken?: string;
  /** Sağlayıcının HAM hata kodu — loglanır, kullanıcıya ASLA gösterilmez. */
  failureCode?: string;
  failureMessage?: string;
  /** Adapter'ın çevirdiği uygulama hata kodu — kullanıcı mesajı bundan üretilir. */
  mappedFailure?: string;
  raw: unknown;
}

export interface CheckoutVerifiedWebhook {
  /** Sağlayıcının olay kimliği — çift işlemeyi engelleyen birincil anahtar. */
  eventId: string;
  type: string;
  providerRef: string;
  status: string;
  payload: unknown;
}

/**
 * Checkout'un ödeme sağlayıcısından ihtiyaç duyduğu YÜZEY.
 * Tam `PaymentProvider` arayüzünün alt kümesidir; submerchant ve payout
 * işlemleri satıcı/finans modüllerine aittir ve buraya sızmaz.
 */
export interface PaymentProviderPort {
  readonly name: string;
  initiate3ds(input: CheckoutPaymentInput): Promise<{ providerRef: string; htmlContent: string }>;
  /** ⚠️ RETRY EDİLMEZ — adapter bunu garanti eder. */
  complete3ds(input: {
    providerRef: string;
    conversationData?: string;
  }): Promise<CheckoutPaymentResult>;
  inquire(conversationId: string): Promise<CheckoutPaymentResult | null>;
  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): CheckoutVerifiedWebhook;
}

export const PAYMENT_PROVIDER = 'CHECKOUT_PAYMENT_PROVIDER';

// ═════════════════════════ DİĞER MODÜLLERİN VERİSİ ══════════════════════════
//
// Kural 3: bir modül başka modülün Prisma modeline dokunmaz.
//
// SEPET ve SİPARİŞ NUMARASI için port YOK: `CartService` ve `OrderService`
// zaten yayımlanmış servislerdir ve doğrudan enjekte edilir (bkz. index.ts).
// Katalog anlık görüntüsü ve adres için karşılık gelen servis henüz yok;
// bunlar dar okuma portlarının arkasında duruyor ve `checkout.bridges.ts`
// içindeki geçici Prisma köprüleriyle karşılanıyor.

/** Sipariş kalemine SNAPSHOT'lanacak ürün bilgisi + satıcı durumu. */
export interface CheckoutVariant {
  variantId: string;
  isActive: boolean;
  /** GÜNCEL fiyat — sepetteki fiyat değil. */
  priceMinor: bigint;
  productId: string;
  productTitle: string;
  brandName: string;
  /** "Siyah / M" */
  variantLabel: string;
  sku: string;
  imageKey: string;
  categoryId: string;
  sellerId: string;
  sellerApproved: boolean;
  sellerVacationMode: boolean;
  /** Alt üye işyeri kimliği — yoksa satıcıya hakediş aktarılamaz. */
  sellerSubmerchantKey: string | null;
}

export interface CatalogReaderPort {
  loadVariantsForCheckout(variantIds: string[]): Promise<CheckoutVariant[]>;
}

export const CATALOG_READER = 'CHECKOUT_CATALOG_READER';

/** Siparişe JSON olarak kopyalanacak adres. */
export interface CheckoutAddress {
  contactName: string;
  phone: string;
  city: string;
  district: string;
  neighbourhood?: string | undefined;
  line1: string;
  postalCode?: string | undefined;
  companyName?: string | undefined;
  taxOffice?: string | undefined;
  country: string;
}

export interface AddressReaderPort {
  loadUserAddress(userId: string, addressId: string): Promise<CheckoutAddress | null>;
}

export const ADDRESS_READER = 'CHECKOUT_ADDRESS_READER';

/** Prisma transaction istemcisi — servis içinde tekrar tekrar yazmamak için. */
export type Tx = Prisma.TransactionClient;
