/**
 * HATA KODU KATALOĞU — tek doğruluk kaynağı.
 *
 * Buradaki her kayıt hem HTTP davranışını hem kullanıcıya gösterilecek
 * Türkçe mesajı hem de "bu hata Sentry'ye gitmeli mi" kararını belirler.
 *
 * Kural: yeni bir hata durumu eklerken ÖNCE buraya kod eklenir, sonra fırlatılır.
 * `throw new Error('...')` kullanılmaz.
 *
 * `message` içinde `{param}` yer tutucuları kullanılabilir; `appError()` çağrısında
 * `params` ile doldurulur.
 */

/**
 * Hata aileleri — loglama ve raporlama davranışını belirler.
 *
 * - `validation` : girdi şeması tutmadı. Beklenen. Sentry'ye GİTMEZ.
 * - `domain`     : iş kuralı reddetti (stok yok, kupon geçersiz). Beklenen. Sentry'ye GİTMEZ.
 * - `integration`: dış servis hatası. Sentry'ye ÖRNEKLENEREK gider.
 * - `system`     : bizim hatamız. Sentry'ye gider + alarm.
 *
 * "Stok yetersiz" bir hata değil, bir iş sonucudur. Sentry'ye gönderilirse
 * gerçek hatalar gürültü içinde kaybolur.
 */
export type ErrorFamily = 'validation' | 'domain' | 'integration' | 'system';

export interface ErrorDefinition {
  /** HTTP durum kodu */
  readonly status: number;
  readonly family: ErrorFamily;
  /** İstemci aynı isteği tekrar deneyebilir mi? */
  readonly retryable: boolean;
  /** Kullanıcıya gösterilebilir Türkçe mesaj. İç detay/teknik terim içermez. */
  readonly message: string;
}

const define = <T extends Record<string, ErrorDefinition>>(catalog: T): T => catalog;

export const ERROR_CATALOG = define({
  // ── KİMLİK & YETKİ ────────────────────────────────────────────────────
  AUTH_INVALID_CREDENTIALS: {
    status: 401,
    family: 'domain',
    retryable: false,
    message: 'E-posta veya şifre hatalı.',
  },
  AUTH_TOKEN_MISSING: {
    status: 401,
    family: 'domain',
    retryable: false,
    message: 'Bu işlem için giriş yapmalısınız.',
  },
  AUTH_TOKEN_INVALID: {
    status: 401,
    family: 'domain',
    retryable: false,
    message: 'Oturum bilgisi geçersiz, tekrar giriş yapın.',
  },
  AUTH_TOKEN_EXPIRED: {
    status: 401,
    family: 'domain',
    retryable: false,
    message: 'Oturumunuz sona erdi, tekrar giriş yapın.',
  },
  /** Refresh token yeniden kullanıldı → token hırsızlığı şüphesi, tüm oturumlar düşürülür. */
  AUTH_REFRESH_REUSED: {
    status: 401,
    family: 'domain',
    retryable: false,
    message: 'Güvenlik nedeniyle tüm oturumlarınız kapatıldı. Lütfen tekrar giriş yapın.',
  },
  AUTH_OTP_INVALID: {
    status: 400,
    family: 'domain',
    retryable: false,
    message: 'Doğrulama kodu hatalı.',
  },
  AUTH_OTP_EXPIRED: {
    status: 400,
    family: 'domain',
    retryable: false,
    message: 'Kodun süresi doldu, yeni kod isteyin.',
  },
  AUTH_ACCOUNT_LOCKED: {
    status: 423,
    family: 'domain',
    retryable: true,
    message: 'Çok fazla hatalı deneme yapıldı. {minutes} dakika sonra tekrar deneyin.',
  },
  AUTH_ACCOUNT_SUSPENDED: {
    status: 403,
    family: 'domain',
    retryable: false,
    message: 'Hesabınız askıya alınmış. Destek ile iletişime geçin.',
  },
  AUTH_EMAIL_NOT_VERIFIED: {
    status: 403,
    family: 'domain',
    retryable: false,
    message: 'Devam etmek için e-posta adresinizi doğrulayın.',
  },
  AUTH_FORBIDDEN: {
    status: 403,
    family: 'domain',
    retryable: false,
    message: 'Bu işlem için yetkiniz yok.',
  },
  AUTH_EMAIL_TAKEN: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Bu e-posta adresi zaten kayıtlı.',
  },
  AUTH_PHONE_TAKEN: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Bu telefon numarası zaten kayıtlı.',
  },

  // ── KATALOG ───────────────────────────────────────────────────────────
  PRODUCT_NOT_FOUND: {
    status: 404,
    family: 'domain',
    retryable: false,
    message: 'Ürün bulunamadı veya yayından kaldırıldı.',
  },
  VARIANT_NOT_FOUND: {
    status: 404,
    family: 'domain',
    retryable: false,
    message: 'Seçtiğiniz renk/beden bulunamadı.',
  },
  VARIANT_UNAVAILABLE: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Seçtiğiniz renk/beden şu an satışta değil.',
  },
  CATEGORY_NOT_FOUND: {
    status: 404,
    family: 'domain',
    retryable: false,
    message: 'Kategori bulunamadı.',
  },
  SELLER_ON_VACATION: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Bu mağaza geçici olarak siparişe kapalı.',
  },

  // ── SEPET & STOK ──────────────────────────────────────────────────────
  CART_NOT_FOUND: {
    status: 404,
    family: 'domain',
    retryable: false,
    message: 'Sepet bulunamadı.',
  },
  CART_EMPTY: {
    status: 422,
    family: 'domain',
    retryable: false,
    message: 'Sepetiniz boş.',
  },
  CART_EXPIRED: {
    status: 410,
    family: 'domain',
    retryable: false,
    message: 'Sepetinizin süresi doldu, ürünleri tekrar ekleyin.',
  },
  CART_PRICE_CHANGED: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Sepetinizdeki bir ürünün fiyatı güncellendi. Yeni tutarı onaylayın.',
  },
  INSUFFICIENT_STOCK: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Yeterli stok kalmadı. Bu üründen en fazla {available} adet alabilirsiniz.',
  },
  MAX_QUANTITY_EXCEEDED: {
    status: 422,
    family: 'domain',
    retryable: false,
    message: 'Bu üründen tek siparişte en fazla {max} adet alabilirsiniz.',
  },
  COUPON_INVALID: {
    status: 400,
    family: 'domain',
    retryable: false,
    message: 'Kupon kodu geçersiz.',
  },
  COUPON_EXPIRED: {
    status: 400,
    family: 'domain',
    retryable: false,
    message: 'Kuponun süresi dolmuş.',
  },
  COUPON_MIN_AMOUNT: {
    status: 400,
    family: 'domain',
    retryable: false,
    message: 'Bu kupon için en az {minAmount} tutarında alışveriş yapmalısınız.',
  },
  COUPON_ALREADY_USED: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Bu kuponu daha önce kullandınız.',
  },
  COUPON_NOT_APPLICABLE: {
    status: 422,
    family: 'domain',
    retryable: false,
    message: 'Kupon sepetinizdeki ürünler için geçerli değil.',
  },
  SHIPPING_UNAVAILABLE: {
    status: 422,
    family: 'domain',
    retryable: false,
    message: 'Bu adrese kargo gönderimi yapılamıyor.',
  },
  ADDRESS_NOT_FOUND: {
    status: 404,
    family: 'domain',
    retryable: false,
    message: 'Adres bulunamadı.',
  },

  // ── ÖDEME ─────────────────────────────────────────────────────────────
  PAYMENT_DECLINED: {
    status: 402,
    family: 'domain',
    retryable: false,
    message: 'Ödeme tamamlanamadı. Lütfen kart bilgilerinizi kontrol edin.',
  },
  PAYMENT_INSUFFICIENT_FUNDS: {
    status: 402,
    family: 'domain',
    retryable: false,
    message: 'Kartınızda yeterli bakiye yok.',
  },
  PAYMENT_LIMIT_EXCEEDED: {
    status: 402,
    family: 'domain',
    retryable: false,
    message: 'Kart limitiniz yetersiz. Taksitli ödemeyi deneyebilirsiniz.',
  },
  PAYMENT_CARD_INVALID: {
    status: 402,
    family: 'domain',
    retryable: false,
    message: 'Kart bilgileri geçersiz veya kartın süresi dolmuş.',
  },
  PAYMENT_3DS_FAILED: {
    status: 402,
    family: 'domain',
    retryable: true,
    message: '3D Secure doğrulaması tamamlanamadı.',
  },
  PAYMENT_3DS_CANCELLED: {
    status: 402,
    family: 'domain',
    retryable: true,
    message: '3D Secure doğrulaması iptal edildi.',
  },
  PAYMENT_BANK_REJECTED: {
    status: 402,
    family: 'domain',
    retryable: false,
    message: 'Bankanız işlemi onaylamadı. Bankanızla görüşün veya başka bir kart deneyin.',
  },
  PAYMENT_TIMEOUT: {
    status: 504,
    family: 'integration',
    retryable: true,
    message:
      'Ödeme yanıtı alınamadı. Siparişlerinizi kontrol edin, tutar çekildiyse siparişiniz oluşmuştur.',
  },
  PAYMENT_ALREADY_CAPTURED: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Bu sipariş zaten ödendi.',
  },
  PAYMENT_PROVIDER_DOWN: {
    status: 503,
    family: 'integration',
    retryable: true,
    message: 'Ödeme sistemi geçici olarak kullanılamıyor. Kısa süre sonra tekrar deneyin.',
  },
  PAYMENT_AMOUNT_MISMATCH: {
    status: 409,
    family: 'system',
    retryable: false,
    message: 'Ödeme tutarında uyuşmazlık var. İşlem güvenlik nedeniyle durduruldu.',
  },
  REFUND_EXCEEDS_PAYMENT: {
    status: 422,
    family: 'domain',
    retryable: false,
    message: 'İade tutarı ödeme tutarını aşamaz.',
  },
  REFUND_WINDOW_CLOSED: {
    status: 422,
    family: 'domain',
    retryable: false,
    message: 'İade süresi ({days} gün) dolmuş.',
  },

  // ── SİPARİŞ & İADE ────────────────────────────────────────────────────
  ORDER_NOT_FOUND: {
    status: 404,
    family: 'domain',
    retryable: false,
    message: 'Sipariş bulunamadı.',
  },
  ORDER_NOT_CANCELLABLE: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Kargoya verilmiş sipariş iptal edilemez. İade talebi oluşturabilirsiniz.',
  },
  ORDER_INVALID_TRANSITION: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Bu durum değişikliği yapılamaz.',
  },
  PACKAGE_NOT_FOUND: {
    status: 404,
    family: 'domain',
    retryable: false,
    message: 'Paket bulunamadı.',
  },
  PACKAGE_ALREADY_SHIPPED: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Paket zaten kargolandı.',
  },
  RETURN_NOT_ALLOWED: {
    status: 422,
    family: 'domain',
    retryable: false,
    message: 'Bu ürün için iade talebi oluşturulamaz.',
  },
  RETURN_ALREADY_EXISTS: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Bu ürün için zaten açık bir iade talebiniz var.',
  },

  // ── AI / SANAL DENEME ─────────────────────────────────────────────────
  CONSENT_REQUIRED: {
    status: 403,
    family: 'domain',
    retryable: false,
    message: 'Devam etmek için fotoğraf işleme izni vermeniz gerekiyor.',
  },
  CONSENT_CROSS_BORDER_REQUIRED: {
    status: 403,
    family: 'domain',
    retryable: false,
    message:
      'Sanal deneme için fotoğrafınızın yurt dışındaki hizmet sağlayıcısına aktarılmasına izin vermelisiniz.',
  },
  PHOTO_NOT_FOUND: {
    status: 404,
    family: 'domain',
    retryable: false,
    message: 'Fotoğraf bulunamadı veya süresi dolmuş.',
  },
  PHOTO_TOO_LARGE: {
    status: 413,
    family: 'validation',
    retryable: false,
    message: 'Fotoğraf boyutu {maxMb} MB’ı aşamaz.',
  },
  PHOTO_INVALID_FORMAT: {
    status: 422,
    family: 'validation',
    retryable: false,
    message: 'Yalnızca JPG, PNG veya WebP formatında fotoğraf yükleyebilirsiniz.',
  },
  PHOTO_QUALITY_LOW: {
    status: 422,
    family: 'domain',
    retryable: false,
    message: 'Fotoğraf kalitesi yetersiz: {reason}',
  },
  PHOTO_NO_PERSON: {
    status: 422,
    family: 'domain',
    retryable: false,
    message: 'Fotoğrafta kişi tespit edilemedi. Tam boy bir fotoğraf ile tekrar deneyin.',
  },
  PHOTO_MULTIPLE_PERSONS: {
    status: 422,
    family: 'domain',
    retryable: false,
    message: 'Fotoğrafta birden fazla kişi var. Yalnız olduğunuz bir fotoğraf yükleyin.',
  },
  PRODUCT_NOT_TRYONABLE: {
    status: 422,
    family: 'domain',
    retryable: false,
    message: 'Bu ürün için sanal deneme desteklenmiyor.',
  },
  TRYON_QUOTA_EXCEEDED: {
    status: 429,
    family: 'domain',
    retryable: true,
    message: 'Günlük sanal deneme hakkınız doldu ({used}/{limit}). Yarın tekrar deneyebilirsiniz.',
  },
  TRYON_JOB_NOT_FOUND: {
    status: 404,
    family: 'domain',
    retryable: false,
    message: 'Deneme kaydı bulunamadı.',
  },
  TRYON_PROVIDER_ERROR: {
    status: 503,
    family: 'integration',
    retryable: true,
    message: 'Sanal deneme oluşturulamadı. Birazdan tekrar deneyin.',
  },
  TRYON_TIMEOUT: {
    status: 504,
    family: 'integration',
    retryable: true,
    message: 'Sanal deneme çok uzun sürdü. Tekrar deneyebilirsiniz.',
  },
  TRYON_CONTENT_BLOCKED: {
    status: 422,
    family: 'domain',
    retryable: false,
    message: 'Fotoğrafınız işlenemedi. Lütfen farklı bir fotoğraf deneyin.',
  },
  AI_BUDGET_EXCEEDED: {
    status: 503,
    family: 'domain',
    retryable: true,
    message: 'Sanal deneme geçici olarak kullanılamıyor. Kısa süre sonra tekrar deneyin.',
  },
  STYLIST_UNAVAILABLE: {
    status: 503,
    family: 'integration',
    retryable: true,
    message: 'Stil danışmanı şu an yanıt veremiyor. Birazdan tekrar deneyin.',
  },
  STYLIST_RATE_LIMITED: {
    status: 429,
    family: 'domain',
    retryable: true,
    message: 'Çok hızlı mesaj gönderiyorsunuz. Biraz bekleyip tekrar deneyin.',
  },

  // ── SATICI ────────────────────────────────────────────────────────────
  SELLER_NOT_FOUND: {
    status: 404,
    family: 'domain',
    retryable: false,
    message: 'Mağaza bulunamadı.',
  },
  SELLER_NOT_APPROVED: {
    status: 403,
    family: 'domain',
    retryable: false,
    message: 'Mağazanız henüz onaylanmadı. Onay sonrası bilgilendirileceksiniz.',
  },
  SELLER_SUSPENDED: {
    status: 403,
    family: 'domain',
    retryable: false,
    message: 'Mağazanız askıya alındı. Destek ile iletişime geçin.',
  },
  SELLER_APPLICATION_EXISTS: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Zaten bekleyen bir başvurunuz var.',
  },
  BULK_UPLOAD_INVALID: {
    status: 422,
    family: 'validation',
    retryable: false,
    message: 'Yüklediğiniz dosyada {count} satırda hata var. Detayları inceleyip tekrar deneyin.',
  },
  PAYOUT_INSUFFICIENT_BALANCE: {
    status: 422,
    family: 'domain',
    retryable: false,
    message: 'Çekilebilir bakiyeniz yetersiz.',
  },
  PAYOUT_PENDING_EXISTS: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Bekleyen bir ödeme talebiniz var. Sonuçlanmasını bekleyin.',
  },
  PAYOUT_BELOW_MINIMUM: {
    status: 422,
    family: 'domain',
    retryable: false,
    message: 'Ödeme talebi en az {minAmount} tutarında olmalıdır.',
  },
  COMMISSION_RULE_NOT_FOUND: {
    status: 404,
    family: 'system',
    retryable: false,
    message: 'Komisyon kuralı bulunamadı. İşlem tamamlanamadı.',
  },

  // ── SİSTEM & ALTYAPI ──────────────────────────────────────────────────
  VALIDATION_FAILED: {
    status: 400,
    family: 'validation',
    retryable: false,
    message: 'Gönderilen bilgilerde hata var.',
  },
  NOT_FOUND: {
    status: 404,
    family: 'domain',
    retryable: false,
    message: 'Kayıt bulunamadı.',
  },
  DUPLICATE_RESOURCE: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Bu kayıt zaten mevcut.',
  },
  INVALID_REFERENCE: {
    status: 400,
    family: 'domain',
    retryable: false,
    message: 'Geçersiz bir kayda referans verildi.',
  },
  RATE_LIMITED: {
    status: 429,
    family: 'domain',
    retryable: true,
    message: 'Çok fazla istek gönderdiniz. {retryAfter} saniye sonra tekrar deneyin.',
  },
  IDEMPOTENCY_CONFLICT: {
    status: 409,
    family: 'domain',
    retryable: false,
    message: 'Aynı işlem anahtarı farklı bir istekle kullanıldı.',
  },
  IDEMPOTENCY_IN_PROGRESS: {
    status: 409,
    family: 'domain',
    retryable: true,
    message: 'İsteğiniz işleniyor, lütfen bekleyin.',
  },
  CONCURRENCY_CONFLICT: {
    status: 409,
    family: 'domain',
    retryable: true,
    message: 'Kayıt başka bir işlem tarafından güncellendi. Lütfen tekrar deneyin.',
  },
  PAYLOAD_TOO_LARGE: {
    status: 413,
    family: 'validation',
    retryable: false,
    message: 'Gönderilen veri çok büyük.',
  },
  UPSTREAM_UNAVAILABLE: {
    status: 503,
    family: 'integration',
    retryable: true,
    message: 'Servis geçici olarak kullanılamıyor. Kısa süre sonra tekrar deneyin.',
  },
  UPSTREAM_TIMEOUT: {
    status: 504,
    family: 'integration',
    retryable: true,
    message: 'İşlem zaman aşımına uğradı. Tekrar deneyin.',
  },
  SERVICE_UNAVAILABLE: {
    status: 503,
    family: 'system',
    retryable: true,
    message: 'Sistem bakımda. Kısa süre sonra tekrar deneyin.',
  },
  INTERNAL_ERROR: {
    status: 500,
    family: 'system',
    retryable: false,
    message:
      'Beklenmeyen bir hata oluştu. Sorun devam ederse destek ekibine şu kodu iletin: {requestId}',
  },
});

export type ErrorCode = keyof typeof ERROR_CATALOG;

export const ERROR_CODES = Object.keys(ERROR_CATALOG) as ErrorCode[];

export function getErrorDefinition(code: ErrorCode): ErrorDefinition {
  return ERROR_CATALOG[code];
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && value in ERROR_CATALOG;
}

/**
 * Bu aile Sentry'ye raporlanmalı mı?
 * `integration` ailesi çağrı tarafında örneklenerek raporlanır (bkz. apps/api filter).
 */
export function shouldReport(family: ErrorFamily): boolean {
  return family === 'system' || family === 'integration';
}

/** `{param}` yer tutucularını doldurur. Eksik parametre yer tutucuyu olduğu gibi bırakır. */
export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}
