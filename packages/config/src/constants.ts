/**
 * İŞ SABİTLERİ
 *
 * Buradaki değerler ürün kararıdır, teknik detay değil. Kod içine gömülmez ki
 * değiştirmek gerektiğinde tek yerden değişsin ve testler aynı değeri görsün.
 */

// ── Sepet & stok ──────────────────────────────────────────────────────────
export const CART = {
  /** Misafir sepeti bu süre sonunda düşer. */
  guestTtlDays: 30,
  userTtlDays: 90,
  /** Tek üründen tek siparişte alınabilecek azami adet. */
  maxQuantityPerVariant: 10,
  maxDistinctItems: 50,
} as const;

export const INVENTORY = {
  /**
   * Checkout başlatıldığında stok bu süre için rezerve edilir.
   * Süre dolarsa serbest bırakılır — kullanıcı ödeme ekranında takılırsa
   * stok sonsuza kadar kilitli kalmasın.
   */
  reservationTtlMinutes: 15,
  /** Bu adedin altına düşünce satıcıya uyarı gider. */
  lowStockThreshold: 3,
} as const;

// ── Sipariş & iade ────────────────────────────────────────────────────────
export const ORDER = {
  /** Satıcının kargoya verme süresi (SLA). Aşılırsa admin paneline alarm düşer. */
  sellerPreparationSlaHours: 48,
  /** Teslimden sonra iade talebi açılabilecek süre. */
  returnWindowDays: 14,
  /** Teslimden bu kadar gün sonra sipariş COMPLETED'a geçer. */
  autoCompleteAfterDays: 14,
  /** Ödeme başarısız olduğunda kaç kez yeniden denenebilir. */
  maxPaymentAttempts: 3,
} as const;

// ── Finans ────────────────────────────────────────────────────────────────
export const FINANCE = {
  /**
   * Hakediş, iade penceresi kapandıktan sonra ödenebilir hale gelir.
   * Erken ödeme yapılırsa iade durumunda satıcıdan geri tahsilat gerekir.
   */
  payoutEligibleAfterDays: 14,
  /** Asgari payout tutarı (kuruş) — 100,00 ₺ */
  minPayoutMinor: 10_000n,
  /** Varsayılan komisyon (basis point) — kategori kuralı yoksa bu uygulanır. */
  defaultCommissionBps: 1200, // %12,00
  maxCommissionBps: 3500, // %35,00 — admin bu üstünde kural tanımlayamaz
} as const;

// ── Medya ─────────────────────────────────────────────────────────────────
export const MEDIA = {
  maxUploadBytes: 10 * 1024 * 1024, // 10 MB
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] as const,
  /** Yükleme için imzalı URL geçerlilik süresi. */
  uploadUrlTtlSeconds: 300,
  productImageWidths: [320, 640, 1024, 2048] as const,
  minProductImageWidth: 1024,
  minUserPhotoWidth: 512,
  minUserPhotoHeight: 768,
} as const;

/** İmzalı okuma URL'lerinin ömrü — nesne hassasiyetine göre. */
export const SIGNED_URL_TTL_SECONDS = {
  /** Ürün görselleri public CDN'den servis edilir, imza gerekmez. */
  userPhoto: 300, // 5 dk
  tryOnResult: 900, // 15 dk
  sellerDocument: 300,
  returnPhoto: 900,
  /** AI sağlayıcısına verilen tek kullanımlık URL. */
  aiProviderInput: 600,
} as const;

// ── Kullanıcı fotoğrafı saklama (KVKK) ────────────────────────────────────
export const PHOTO_RETENTION = {
  /** "Yalnızca bu işlem için kullan" seçilirse. */
  oneTimeHours: 24,
  /** "Profilimde sakla" seçilirse — her kullanımda yenilenir. */
  savedProfileDays: 90,
  /** Silme cron'unun çalışma aralığı. Çalışmazsa alarm üretir. */
  cleanupIntervalMinutes: 60,
  /** Hesap silme talebinden sonra geri alma penceresi. */
  accountDeletionGraceDays: 30,
} as const;

// ── Sanal deneme ──────────────────────────────────────────────────────────
export const TRYON = {
  /** Bu skorun altındaki fotoğraf reddedilir. */
  minPhotoQualityScore: 40,
  /** Bu skorun altındaki güven sonucu kullanıcıya uyarı ile gösterilir. */
  lowConfidenceThreshold: 60,
  timeoutMs: { FAST: 25_000, QUALITY: 60_000 },
  /** Kuyruk önceliği — küçük sayı önce işlenir. */
  priority: { QUALITY: 1, FAST: 5, GUEST: 10 },
  maxAttempts: 3,
  /** Zorunlu uyarı — üretilen her görsele gömülür (yasal gereklilik). */
  watermarkText: 'Yapay zekâ ile oluşturulmuştur; ürünün gerçek kalıbı farklılık gösterebilir.',
} as const;

/** Try-on desteklenen kategoriler. Listede olmayan ürünlerde buton gösterilmez. */
export const TRYONABLE_CATEGORIES = [
  'UPPER_BODY',
  'LOWER_BODY',
  'DRESS',
  'OUTERWEAR',
] as const;

// ── Beden önerisi (MVP: kural motoru) ─────────────────────────────────────
export const SIZE_ENGINE = {
  /** Bu güvenin altında öneri gösterilmez, sadece ölçü tablosu gösterilir. */
  minConfidenceToShow: 50,
  /** Kalıp düzeltmesi: dar kalıpta bir beden büyük öner. */
  fitAdjustment: { SLIM: 1, REGULAR: 0, OVERSIZE: -1 } as const,
  /** İade geri bildirimi bu adede ulaşınca öneriye dahil edilir. */
  minFeedbackCountToUse: 5,
} as const;

// ── Hız limitleri ─────────────────────────────────────────────────────────
export const RATE_LIMITS = {
  login: { points: 5, durationSeconds: 900, blockSeconds: 900 },
  otpSend: { points: 3, durationSeconds: 3600, blockSeconds: 3600 },
  register: { points: 3, durationSeconds: 3600, blockSeconds: 0 },
  search: { points: 60, durationSeconds: 60, blockSeconds: 0 },
  checkout: { points: 10, durationSeconds: 300, blockSeconds: 0 },
  global: { points: 300, durationSeconds: 60, blockSeconds: 0 },
} as const;

// ── Arama ─────────────────────────────────────────────────────────────────
export const SEARCH = {
  defaultPageSize: 24,
  maxPageSize: 100,
  suggestLimit: 8,
  /** Sıralama ağırlıkları — toplamı 1,0 olmalı. */
  rankingWeights: {
    textRelevance: 0.4,
    popularity: 0.3,
    recency: 0.2,
    sellerQuality: 0.1,
  },
  /** pgvector benzerlik eşiği (kosinüs mesafesi) — üstü "benzer değil". */
  maxVectorDistance: 0.35,
} as const;

// ── Dış servis dayanıklılığı ──────────────────────────────────────────────
export const RESILIENCE = {
  defaultTimeoutMs: 15_000,
  defaultRetryAttempts: 3,
  retryBaseDelayMs: 500,
  circuitBreaker: {
    failureThreshold: 5,
    windowMs: 60_000,
    resetAfterMs: 30_000,
  },
} as const;
