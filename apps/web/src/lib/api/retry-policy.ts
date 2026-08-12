import { isApiFailure, type ErrorCode } from '@vt/contracts';

/**
 * HATA KODU → YENİDEN DENEME DAVRANIŞI.
 *
 * ⚠️ `retryable === true` "Tekrar dene düğmesi" DEMEK DEĞİLDİR. Katalogda 19 kod
 *    `retryable: true` taşıyor; bunların arasında `AUTH_ACCOUNT_LOCKED`
 *    (423, Retry-After: 900) ve `TRYON_QUOTA_EXCEEDED` ("yarın tekrar deneyin")
 *    de var. Bunlara düğme koymak kullanıcıyı 900 saniye boyunca aynı hataya
 *    çarptırır. `retryable` sunucunun "bu istek tekrarlanabilir" bilgisidir,
 *    arayüz kararı değil.
 *
 * ⚠️ `satisfies Record<ErrorCode, RetryBehaviour>` — katalogda yeni bir kod
 *    açıldığı gün BU DOSYA DERLENMEZ. Varsayılan bir dala düşseydi yeni kod
 *    sessizce yanlış gruba girer ve kimse fark etmezdi.
 */
export type RetryBehaviour =
  /**
   * Kullanıcı hiçbir şey görmez; istek arka planda tekrarlanır.
   * ⚠️ YALNIZCA GET ve AYNI Idempotency-Key ile atılan POST için. Anahtarsız
   *    bir POST'u otomatik tekrarlamak ikinci bir sipariş/üretim yaratır.
   */
  | { kind: 'otomatik'; maxAttempts: number }
  /** "Tekrar dene" düğmesi gösterilir — kararı kullanıcı verir. */
  | { kind: 'dugme' }
  /** Düğme YOK; `retryAfterSeconds` varsa geri sayım gösterilir. */
  | { kind: 'geri-sayim' }
  /**
   * Hata ekranı değil, ÇIKIŞ. Mesaj kullanıcıya nereye bakması gerektiğini
   * söylüyorsa (PAYMENT_TIMEOUT: "siparişlerinizi kontrol edin") o yeri
   * gösteren bir bağlantı ZORUNLUDUR.
   *
   * ⚠️ `etiket` de burada duruyor, çağıran tarafta değil: bağlantının nereye
   *    gittiğini bilen tek yer bu dosya. Metin `HataGosterimi`de yazılsaydı
   *    ikinci bir `yonlendir` kodu açıldığı gün ya jenerik ("Devam et") bir
   *    etiket doğardı ya da o bileşen kod kod dallanmaya başlardı.
   */
  | { kind: 'yonlendir'; href: string; etiket: string }
  /** Yalnızca mesaj. Tekrarlamak durumu değiştirmez. */
  | { kind: 'yok' };

/** `RESILIENCE.retryBaseDelayMs` tabanlı üstel geri çekilme, en fazla 3 deneme. */
const OTOMATIK: RetryBehaviour = { kind: 'otomatik', maxAttempts: 3 };
const DUGME: RetryBehaviour = { kind: 'dugme' };
const GERI_SAYIM: RetryBehaviour = { kind: 'geri-sayim' };
const YOK: RetryBehaviour = { kind: 'yok' };

export const RETRY_POLICY = {
  AUTH_INVALID_CREDENTIALS: YOK,
  AUTH_TOKEN_MISSING: YOK,
  AUTH_TOKEN_INVALID: YOK,
  // Kullanıcıya HİÇBİR ŞEY gösterilmez: vekil tek uçuşla yeniler ve orijinal
  // isteği BİR KEZ tekrarlar. Buraya 'dugme' yazmak o akışı görünür kılardı.
  AUTH_TOKEN_EXPIRED: YOK,
  // Yenileme DENENMEZ; oturum silinir, /giris?sebep=guvenlik. Katalog mesajı aynen gösterilir.
  AUTH_REFRESH_REUSED: YOK,
  AUTH_OTP_INVALID: YOK,
  AUTH_OTP_EXPIRED: YOK,
  AUTH_ACCOUNT_LOCKED: GERI_SAYIM,
  AUTH_ACCOUNT_SUSPENDED: YOK,
  AUTH_EMAIL_NOT_VERIFIED: YOK,
  AUTH_FORBIDDEN: YOK,
  AUTH_EMAIL_TAKEN: YOK,
  AUTH_PHONE_TAKEN: YOK,
  PRODUCT_NOT_FOUND: YOK,
  VARIANT_NOT_FOUND: YOK,
  VARIANT_UNAVAILABLE: YOK,
  CATEGORY_NOT_FOUND: YOK,
  SELLER_ON_VACATION: YOK,
  CART_NOT_FOUND: YOK,
  CART_EMPTY: YOK,
  CART_EXPIRED: YOK,
  CART_PRICE_CHANGED: YOK,
  INSUFFICIENT_STOCK: YOK,
  MAX_QUANTITY_EXCEEDED: YOK,
  CART_TOO_MANY_ITEMS: YOK,
  COUPON_INVALID: YOK,
  COUPON_EXPIRED: YOK,
  COUPON_MIN_AMOUNT: YOK,
  COUPON_ALREADY_USED: YOK,
  COUPON_USAGE_LIMIT_REACHED: YOK,
  COUPON_NOT_APPLICABLE: YOK,
  SHIPPING_UNAVAILABLE: YOK,
  ADDRESS_NOT_FOUND: YOK,
  PAYMENT_DECLINED: YOK,
  PAYMENT_INSUFFICIENT_FUNDS: YOK,
  PAYMENT_LIMIT_EXCEEDED: YOK,
  PAYMENT_CARD_INVALID: YOK,
  PAYMENT_3DS_FAILED: DUGME,
  PAYMENT_3DS_CANCELLED: DUGME,
  PAYMENT_BANK_REJECTED: YOK,
  // ⚠️ `retryable: true` AMA ASLA otomatik tekrarlanmaz: mesaj "siparişlerinizi
  //    kontrol edin" diyor, yani ödeme geçmiş OLABİLİR. Tekrar denemek ikinci
  //    kez para çekilmesi riskidir.
  PAYMENT_TIMEOUT: {
    kind: 'yonlendir',
    href: '/hesabim/siparisler',
    etiket: 'Siparişlerime git',
  },
  PAYMENT_ALREADY_CAPTURED: YOK,
  PAYMENT_PROVIDER_DOWN: DUGME,
  PAYMENT_AMOUNT_MISMATCH: YOK,
  REFUND_EXCEEDS_PAYMENT: YOK,
  REFUND_NO_CAPTURED_PAYMENT: YOK,
  WEBHOOK_SIGNATURE_INVALID: YOK,
  REFUND_WINDOW_CLOSED: YOK,
  ORDER_NOT_FOUND: YOK,
  ORDER_NOT_CANCELLABLE: YOK,
  ORDER_INVALID_TRANSITION: YOK,
  PACKAGE_NOT_FOUND: YOK,
  PACKAGE_ALREADY_SHIPPED: YOK,
  RETURN_NOT_ALLOWED: YOK,
  RETURN_ALREADY_EXISTS: YOK,
  ORDER_RESERVATION_EXPIRED: YOK,
  LEDGER_INCONSISTENT: YOK,
  // Hata GÖSTERİLMEZ: PHOTO_PROCESSING rıza akışı açılır, onay sonrası orijinal
  // istek AYNI Idempotency-Key ile tekrarlanır.
  CONSENT_REQUIRED: YOK,
  // ⚠️ AYRI kod, AYRI onay ekranı. KVKK'da yurt dışı aktarım ayrı açık rıza
  //    ister; tek modalda toplanamaz. Yalnız CONSENT_REQUIRED'ı ele alan istemci
  //    kullanıcıyı sonsuz döngüde bırakır.
  CONSENT_CROSS_BORDER_REQUIRED: YOK,
  PHOTO_NOT_FOUND: YOK,
  PHOTO_TOO_LARGE: YOK,
  PHOTO_INVALID_FORMAT: YOK,
  PHOTO_QUALITY_LOW: YOK,
  PHOTO_NO_PERSON: YOK,
  PHOTO_MULTIPLE_PERSONS: YOK,
  PRODUCT_NOT_TRYONABLE: YOK,
  OUTFIT_LAYER_CONFLICT: YOK,
  OUTFIT_PIECE_COUNT_INVALID: YOK,
  OUTFIT_DUPLICATE_PIECE: YOK,
  // ⚠️ Bu kodda `retryAfterSeconds` GELMEZ (mesaj "yarın" diyor) → geri sayım
  //    da çıkmaz, yalnızca mesaj kalır. Düğme koymak kotayı değiştirmezdi.
  TRYON_QUOTA_EXCEEDED: GERI_SAYIM,
  TRYON_JOB_NOT_FOUND: YOK,
  TRYON_PROVIDER_ERROR: DUGME,
  TRYON_TIMEOUT: DUGME,
  TRYON_CONTENT_BLOCKED: YOK,
  AI_BUDGET_EXCEEDED: DUGME,
  STYLIST_UNAVAILABLE: DUGME,
  STYLIST_RATE_LIMITED: GERI_SAYIM,
  STYLIST_TIMEOUT: DUGME,
  AI_PROVIDER_MISCONFIGURED: YOK,
  TRYON_PROVIDER_MISCONFIGURED: YOK,
  EMBEDDING_DIMENSION_MISMATCH: YOK,
  EMBEDDING_PROVIDER_ERROR: OTOMATIK,
  SELLER_NOT_FOUND: YOK,
  SELLER_NOT_APPROVED: YOK,
  SELLER_SUSPENDED: YOK,
  SELLER_APPLICATION_EXISTS: YOK,
  SELLER_STORE_SLUG_TAKEN: YOK,
  COUPON_CODE_TAKEN: YOK,
  STOCK_BELOW_RESERVED: YOK,
  FIELD_DECRYPT_FAILED: YOK,
  PAYOUT_INVALID_STATE: YOK,
  COMMISSION_RATE_ABOVE_CAP: YOK,
  COMMISSION_VERSION_OVERLAP: YOK,
  BULK_UPLOAD_INVALID: YOK,
  PAYOUT_INSUFFICIENT_BALANCE: YOK,
  PAYOUT_PENDING_EXISTS: YOK,
  PAYOUT_BELOW_MINIMUM: YOK,
  COMMISSION_RULE_NOT_FOUND: YOK,
  VALIDATION_FAILED: YOK,
  NOT_FOUND: YOK,
  DUPLICATE_RESOURCE: YOK,
  INVALID_REFERENCE: YOK,
  RATE_LIMITED: GERI_SAYIM,
  IDEMPOTENCY_CONFLICT: YOK,
  // Kombin yoklaması çakışırsa buraya düşülür; sunucu retryAfterSeconds:2 veriyor.
  IDEMPOTENCY_IN_PROGRESS: OTOMATIK,
  CONCURRENCY_CONFLICT: OTOMATIK,
  PAYLOAD_TOO_LARGE: YOK,
  UPSTREAM_UNAVAILABLE: OTOMATIK,
  UPSTREAM_TIMEOUT: OTOMATIK,
  SERVICE_UNAVAILABLE: OTOMATIK,
  INTERNAL_ERROR: YOK,
} satisfies Record<ErrorCode, RetryBehaviour>;

/** Bilinmeyen kod (sürüm sapması) → mesaj gösterilir, davranış eklenmez. */
export function retryBehaviourFor(code: string): RetryBehaviour {
  return (RETRY_POLICY as Record<string, RetryBehaviour>)[code] ?? YOK;
}

/**
 * Otomatik tekrarda bekleme süresi.
 * Sunucu `retryAfterSeconds` verdiyse O KULLANILIR — tahmin etmek, sunucunun
 * bildiği pencereyi görmezden gelmektir.
 */
export function retryDelayMs(attempt: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds !== undefined) return retryAfterSeconds * 1000;
  return 500 * 2 ** (attempt - 1);
}

/**
 * `kind: 'otomatik'` DALININ TEK UYGULAMASI.
 *
 * ⚠️ NEDEN `HataGosterimi`DE DEĞİL: o bileşen bir GÖSTERİCİ, isteğin ne olduğunu
 *    bilmiyor. Otomatik tekrar isteği YENİDEN ATMAK demektir ve bunu yalnızca
 *    isteği kuran yer güvenle yapabilir — çünkü güvenliğin şartı ÇAĞIRANDA:
 *    aynı `Idempotency-Key`. Bu yüzden sarmalayıcı çağrı yerinde kullanılır.
 *
 * ⚠️ `islem` AYNI ANAHTARLA çağrılabilir olmalı. Her denemede `newIdempotencyKey()`
 *    üreten bir kapanış buraya verilirse `IDEMPOTENCY_IN_PROGRESS` üzerine
 *    üç ayrı iade/sipariş açılır — kapatmaya çalıştığımız delikten daha
 *    büyük bir delik. Kural: anahtar sarmalayıcının DIŞINDA üretilir.
 *
 * ⚠️ Tükenen denemeden sonra hata AYNEN fırlatılır; yutulmaz. Kullanıcı yine
 *    `HataGosterimi` görür, orada `onRetry` düğmesi son çıkıştır.
 */
export async function otomatikTekrarla<T>(islem: () => Promise<T>): Promise<T> {
  for (let deneme = 1; ; deneme += 1) {
    try {
      return await islem();
    } catch (error) {
      if (!isApiFailure(error)) throw error;
      const davranis = retryBehaviourFor(error.code);
      if (davranis.kind !== 'otomatik' || deneme >= davranis.maxAttempts) throw error;
      await new Promise((cozumle) =>
        setTimeout(cozumle, retryDelayMs(deneme, error.retryAfterSeconds)),
      );
    }
  }
}
