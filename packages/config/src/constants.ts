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

/**
 * ═══════════════ SANAL DENEME KATEGORİ YETENEĞİ ═══════════════════════════
 *
 * Katalogdaki her kategori denenebilir DEĞİLDİR ve bunun sebebi bizim
 * tercihimiz değil, SAĞLAYICININ YAPABİLDİĞİdir.
 *
 * ⚠️ AŞAĞIDAKİ LİSTE ELLE YAZILMAZ — matristen TÜRETİLİR. Elle yazılsaydı iki
 *    ayrı gerçek olurdu: sağlayıcının gerçekten giydirebildiği ve listenin
 *    iddia ettiği. İkisi ayrıştığı gün arada kalan kişi, düğmeye basıp PARA
 *    HARCAYAN ama sonuç alamayan kullanıcıdır.
 *
 * Gerekçe ve araştırma bulgusu: docs/tryon-kategori-destegi.md
 */

/**
 * Şemadaki `TryOnCategory` enum'ının TS karşılığı.
 *
 * ⚠️ Bu paket `@vt/db`ye BAĞIMLI DEĞİL (config en alt katmandır), bu yüzden
 *    liste elle aynalanır. Sapma sessiz kalmasın diye
 *    `apps/api/src/modules/ai/tryon-category.drift.test.ts` içinde DERLEME
 *    ZAMANINDA karşılaştırılır — iki liste ayrışırsa tsc kırılır.
 */
export type TryOnCategoryName =
  'UPPER_BODY' | 'LOWER_BODY' | 'DRESS' | 'OUTERWEAR' | 'SHOES' | 'JEWELRY' | 'BAG' | 'ACCESSORY';

export type TryOnProviderName = 'fal' | 'gemini';

/**
 * HANGİ SAĞLAYICI HANGİ KATEGORİYİ GİYDİREBİLİR.
 *
 * ⚠️ Boş liste "henüz yapamıyor" demektir, "yapmak istemiyoruz" değil.
 *
 * Bugün fal.ai üzerindeki try-on modelleri (FASHN v1.6, Kling Kolors) yalnızca
 * GİYSİ için eğitilmiştir. Ayakkabı, takı ve çanta ayrı problemlerdir:
 * ayakkabı ayağın açısını ve zemin gölgesini, takı milimetrik ölçeği, çanta
 * ise giyilen değil TUTULAN bir nesnenin el pozunu gerektirir.
 *
 * ⚠️ Bir kategoriyi buraya eklemeden önce üçü birden sağlanmalı:
 *      1. sağlayıcının o kategori için gerçek bir API ucu olmalı
 *         (pazarlama sayfası değil),
 *      2. birim maliyet ölçülüp komisyon marjıyla karşılaştırılmalı,
 *      3. kalite ölçülmeli (30 ürün × 10 kişi, ort. ≥ 3,5/5).
 *    Video try-on kararındaki sıranın aynısı: "istiyorum" bir açma gerekçesi
 *    değildir.
 */
export const TRYON_PROVIDER_CAPABILITIES = {
  fal: ['UPPER_BODY', 'LOWER_BODY', 'DRESS', 'OUTERWEAR'],
  gemini: ['UPPER_BODY', 'LOWER_BODY', 'DRESS', 'OUTERWEAR'],
} as const satisfies Record<TryOnProviderName, readonly TryOnCategoryName[]>;

/**
 * Try-on desteklenen kategoriler — sağlayıcıların BİRLEŞİMİ.
 *
 * Birleşim alınır, kesişim değil: fallback zinciri kategoriyi destekleyen ilk
 * sağlayıcıyı seçer, dolayısıyla TEK bir sağlayıcının yapabilmesi yeterlidir.
 * Kesişim alınsaydı, yeni ve dar kapsamlı bir sağlayıcı eklemek var olan
 * kategorileri KAPATIRDI.
 *
 * ⚠️ Sıra deterministik tutulur (aşağıdaki referans sıraya göre): bu değer
 *    API yanıtlarında ve testlerde görünür; `Set` yineleme sırasına bırakmak,
 *    bir gün sebepsiz görünen bir test kırılması demektir.
 */
/**
 * Katalogdaki TÜM try-on kategorileri — denenebilir olanlar değil, hepsi.
 *
 * ⚠️ Dışa açık olması şart: `TryOnCategoryName` bir TİPtir ve çalışma zamanında
 *    yoktur, dolayısıyla Prisma enum'ıyla karşılaştırılamaz. Sapma testi
 *    (`tryon-category.drift.test.ts`) bu diziyi okur. Yalnızca tip bırakılsaydı
 *    config'e şemada olmayan bir değer eklendiği HİÇBİR yerde görünmezdi.
 */
export const ALL_TRYON_CATEGORIES: readonly TryOnCategoryName[] = [
  'UPPER_BODY',
  'LOWER_BODY',
  'DRESS',
  'OUTERWEAR',
  'SHOES',
  'JEWELRY',
  'BAG',
  'ACCESSORY',
];

export const TRYONABLE_CATEGORIES: readonly TryOnCategoryName[] = ALL_TRYON_CATEGORIES.filter(
  (category) =>
    Object.values(TRYON_PROVIDER_CAPABILITIES).some((supported) =>
      (supported as readonly TryOnCategoryName[]).includes(category),
    ),
);

/** Bu kategoriyi giydirebilen sağlayıcılar — fallback zinciri sırasını daraltır. */
export function providersForCategory(category: TryOnCategoryName): readonly TryOnProviderName[] {
  return (Object.keys(TRYON_PROVIDER_CAPABILITIES) as TryOnProviderName[]).filter((provider) =>
    (TRYON_PROVIDER_CAPABILITIES[provider] as readonly TryOnCategoryName[]).includes(category),
  );
}

/**
 * SAĞLAYICIYA GÖNDERİLEBİLEN KATEGORİ.
 *
 * ⚠️ Matristen TÜRETİLİR, elle yazılmaz. `TryOnRequest.category` bu tiptedir
 *    (bkz. @vt/adapters → TryOnGarmentCategory), dolayısıyla desteklenmeyen bir
 *    kategoriyi sağlayıcıya göndermek DERLENMİYOR. Kapı çalışma zamanında bir
 *    `if` ile korunsaydı, o `if`i atlayan yeni bir çağrı yolu eklemek sessizce
 *    mümkün olurdu ve fatura sağlayıcıdan dönerdi.
 *
 * Matrise yeni kategori eklendiğinde bu tip kendiliğinden genişler.
 */
export type SupportedTryOnCategory =
  (typeof TRYON_PROVIDER_CAPABILITIES)[TryOnProviderName][number];

/**
 * Kategori bugün gerçekten denenebiliyor mu?
 *
 * ⚠️ Tip daraltıcıdır (`is`): çağıran taraf bu kapıdan geçmeden sağlayıcıya
 *    istek kuramaz. `null` da reddedilir — kategorisi olmayan ürün (parfüm,
 *    hediye kartı) zaten denenemez.
 */
export function isTryOnSupported(
  category: TryOnCategoryName | null | undefined,
): category is SupportedTryOnCategory {
  return category != null && TRYONABLE_CATEGORIES.includes(category);
}

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
