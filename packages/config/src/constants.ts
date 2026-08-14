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

/**
 * 3DS DÖNÜŞ ADRESİ — İKİ DEPONUN PAYLAŞTIĞI TEK YOL.
 *
 * ⚠️ BİR URL'İN İŞ SABİTLERİ ARASINDA İŞİ NE: bu adresi backend YAZIYOR
 *    (`checkout.service.ts` → `callbackResult().redirectUrl`), frontend
 *    SERVİS EDİYOR (`app/(magaza)/checkout/result/page.tsx`). İki ayrı pakette
 *    ayrı ayrı yazıldığı sürece ayrışması ancak GERÇEK bir 3DS ödemesinde,
 *    yani parası çekilmiş kullanıcıda görünür. Diğer her ölü bağlantının
 *    bedeli bir 404; bunun bedeli bir SİPARİŞTİR. Bu yüzden teknik detay
 *    değil, ürün kararı sayılıp buraya kondu.
 *
 * ⚠️ ROTA GÖÇÜNDE BU YOL TÜRKÇEYDİ (`/checkout/sonuc`). Göç bir 301 haritası
 *    KURMADI — bayat adres yüksek sesle 404 vermeli. Bu adres tek istisna:
 *    aşağıdaki eski hâli, uçuştaki 3DS ödemeleri için `next.config.ts`te bir
 *    308 köprüsü olarak duruyor.
 */
export const CHECKOUT_RESULT_PATH = '/checkout/result';

/**
 * ⚠️ ESKİ (TÜRKÇE) DÖNÜŞ ADRESİ — SİLİNMEZ, EMEKLİYE AYRILIR. Göç anında
 *    3DS'e gitmiş bir ödemenin sağlayıcıda tutulan `redirectUrl`ı hâlâ bu
 *    adresi taşıyor; köprü kaldırılırsa o kullanıcı 404 görür. Kaldırma şartı
 *    ZAMANDIR: son bu adresi yazan sürümün dağıtımından sonra bir ödeme zaman
 *    aşımı penceresi (`INVENTORY.reservationTtlMinutes` + sağlayıcı payı)
 *    geçmesi. `next.config.ts` köprüsüyle birlikte kaldırılır.
 */
export const CHECKOUT_RESULT_LEGACY_PATH = '/checkout/sonuc';

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

// ── Site görselleri (adminden yönetilen afiş / kapak) ──────────────────────

/**
 * YÖNETİLEN SİTE GÖRSELİ YÜZEYLERİ.
 *
 * ⚠️ POSTGRESQL ENUM'I DEĞİL, BİLİNÇLİ OLARAK. `ALTER TYPE ... ADD VALUE`
 *    GERİ ALINAMAZ (ölçüldü: `20260812150000_tryon_category_accessories`) ve
 *    bu, sıradan bir ürün kararı için fazla ağır bir taahhüt: dördüncü yüzeyi
 *    eklemek ikinci bir geri alınamaz migration demek olurdu.
 *
 * ⚠️ SERBEST METİN DE DEĞİL. Uç `slot: string` kabul etseydi `home.her0` yazan
 *    bir istek 201 döner, satır yazılır ve vitrinde HİÇBİR ŞEY değişmezdi —
 *    bu depoda altı kez yaşanan "yazıldı ama hiçbir yere bağlanmadı"
 *    arızasının tam biçimi.
 *
 * Üçüncü yol: geçerli değerler BURADA, tek kaynakta; Zod enum'ı buradan
 * TÜRETİLİR (`siteImageSlotSchema`) ve bir test ucun kabul ettiği her değerin
 * bu listede olduğunu ölçer. O test olmadan serbest listenin bütün dezavantajı
 * geri gelir.
 *
 * Emsal: `MEDIA.productImageWidths`, `TRYON_PROVIDER_CAPABILITIES`.
 */
export const SITE_IMAGE_SLOTS = ['HERO', 'CATEGORY_COVER', 'COLLECTION_COVER'] as const;
export type SiteImageSlot = (typeof SITE_IMAGE_SLOTS)[number];

/**
 * Afiş türev genişlikleri — `MEDIA.productImageWidths` DEĞİL.
 *
 * Ürün görseli 4:5 dikey ve bir ızgara hücresinde 320px'e kadar küçülür. Afiş
 * 16/7 yatay ve ekranın tamamını kaplar; 320px'lik bir türev hiçbir kırılma
 * noktasında seçilmez, yalnızca her yüklemede boşuna üretilip depolanır.
 */
export const SITE_BANNER_WIDTHS = [640, 1024, 1600, 2048] as const;

/**
 * Afişin üzerinde duran ürün kartı sayısı tavanı.
 *
 * ⚠️ Bu bir YERLEŞİM ÖLÇÜMÜdür, keyfi bir sayı değil: 1280px ekranda kap
 *    1248px, afişin alt kenarına yaslanan şeritte kart 240px + 16px boşluk.
 *    Dördüncü kart 1024px'te taşar. Tavanı SUNUCU da uygular; "istemci zaten
 *    üç gösteriyor" demek, 400 dönmesi gereken bir isteği kabul etmektir.
 */
export const SITE_IMAGE_MAX_CARDS = 3;

/**
 * Koleksiyon iniş sayfalarının slug listesi.
 *
 * ⚠️ BURADA OLMASININ SEBEBİ ÖLÇÜLDÜ. Metin `apps/web/app/(magaza)/collection/
 *    koleksiyonlar.ts` içinde ve orada KALIR (başlık, SSS, kategori adayları —
 *    hepsi ekran metni). Ama `COLLECTION_COVER` kapağının `targetKey`'ini
 *    API'nin doğrulaması gerekiyor ve `apps/api` o dosyayı GÖREMİYOR:
 *    `apps/api/tsconfig.json`'da yol eşlemesi yok, `apps/api` ve `packages`
 *    içinde tek bir `koleksiyonlar` referansı yok. Doğrulama olmasaydı
 *    yönetici `spor-gıyım` yazar, satır yazılır, kapak hiçbir sayfada
 *    görünmezdi.
 *
 *    Paylaşılan şey YALNIZCA slug listesi. `koleksiyonlar.ts` kendini buna
 *    `satisfies Record<(typeof KOLEKSIYON_SLUGLARI)[number], Koleksiyon>` ile
 *    bağlar → iki tarafın ayrışması DERLEMEYİ KIRAR, sessizce sapmaz.
 */
export const KOLEKSIYON_SLUGLARI = ['denim', 'gelinlik', 'spor-giyim', 'elbise'] as const;
export type KoleksiyonSlug = (typeof KOLEKSIYON_SLUGLARI)[number];

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
  /**
   * ÜRÜN GÖRSELLERİNİN denemeye hazırlık skoru eşiği (0-100). Altında kalan
   * üründe satıcıya iyileştirme önerisi gösterilir, yönetim kuyruğunda uyarı
   * rozeti çıkar.
   *
   * ⚠️ `lowConfidenceThreshold` İLE AYNI ŞEY DEĞİL; bugün yalnızca aynı sayıyı
   *    taşıyorlar. O, ÜRETİLMİŞ görselin güven skoru; bu, ürünün KAYNAK
   *    fotoğraflarının hazırlık skoru. Birini diğerinin yerine kullanmak bugün
   *    doğru sonuç verir, biri değiştiği gün sessizce yanlış olur.
   *
   * ⚠️ Buraya taşındı çünkü ÜÇ kopyası vardı: `apps/api`de sabitin kendisi
   *    (`MIN_TRYON_READINESS_SCORE`), satıcı ürün ekranında `TRYON_ESIK`,
   *    yönetim moderasyonunda `TRYON_UYGUNLUK_ESIGI`. Ayrıştıkları gün satıcı,
   *    backend'in "iyileştirme gerekli" dediği üründe uyarı GÖRMEZ.
   */
  minProductReadinessScore: 60,
  /**
   * ═══════════════════════════════════════════════════════════════════════
   *  SAĞLAYICI ÇAĞRISI İÇİN SÜRE SINIRI.
   *
   *  ⚠️ FAST 25 sn İDİ VE ÇOK KISAYDI — canlıda ölçüldü (2026-08-14):
   *
   *      zincir: [{ saglayici: "fal", sebep: "TIMEOUT", ms: 25001 },
   *               { saglayici: "gemini", sebep: "QUOTA_EXCEEDED", ms: 1334 }]
   *
   *     `fal-ai/idm-vton` tipik olarak 15–45 saniye sürüyor. 25 saniyelik
   *     sınır, üretimin ORTASINDA bağlantıyı kesiyordu: model işi yapıyor,
   *     biz beklemeyi bırakıyoruz. Aynı gün 12:57'de başaran tek deneme,
   *     tesadüfen 25 saniyenin altında bitendi.
   *
   *  ⚠️ BU HATA UZUN SÜRE GÖRÜNMEDİ çünkü zincir fal'dan sonra gemini'yi
   *     deniyor ve kullanıcıya giden kod SON halkadan geliyordu. Ekranda hep
   *     "yapay zekâ bütçesi doldu" yazıyordu — oysa gerçek sebep bizim
   *     koyduğumuz süre sınırıydı.
   *
   *  ⚠️ SÜREYİ UZATMAK KULLANICIYI BEKLETMEZ: üretim BullMQ kuyruğunda,
   *     tarayıcı yoklama yapıyor. Uzun sınırın tek bedeli, gerçekten kopmuş
   *     bir çağrının daha geç fark edilmesi — buna karşılık kesilen her
   *     çağrı ÖDENMİŞ ama alınmamış bir üretimdir.
   *
   *  ⚠️ `apps/worker` tarafındaki BullMQ `lockDuration` bu değerden BÜYÜK
   *     olmalı, yoksa iş "takıldı" sayılıp yeniden çalıştırılır ve aynı
   *     üretim iki kez ödenir. (bkz. tryon.processor.ts → new Worker)
   * ═══════════════════════════════════════════════════════════════════════
   */
  timeoutMs: { FAST: 60_000, QUALITY: 120_000 },
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
    /** Pencereli eşik — ANİ kesinti için. 60 sn içinde 5 hata. */
    failureThreshold: 5,
    /**
     * ⚠️ ARDIŞIK EŞİK — SÜRE SINIRI YOK. Üst üste 3 hata devreyi açar.
     *
     *    Kalıcı olarak ölü bir sağlayıcıyı yakalayan tek eşik budur. Canlıda
     *    ölçüldü: %100 başarısız bir yedek sağlayıcı için devre HİÇ açılmadı,
     *    çünkü pencereli eşik dakikada 5 hata istiyor ve gerçek trafik
     *    dakikada bir denemeye bile ulaşmıyordu.
     *
     *    3 seçildi çünkü 2 fazla hassas (art arda iki ağ hatası olağan),
     *    5 ise düşük trafikte saatler sürerdi.
     */
    consecutiveThreshold: 3,
    windowMs: 60_000,
    resetAfterMs: 30_000,
  },
} as const;

// ── Doğal dilde arama ─────────────────────────────────────────────────────
/**
 * DOĞAL DİLDE ARAMA — EŞİKLER, KOTA VE SINIRLAR
 *
 * Buradaki her sayı bir ÜRÜN kararıdır ve gerekçesi yanındadır.
 *
 * ⚠️ BU BLOK `apps/api/.../natural-search.constants.ts` İÇİNDEN BURAYA TAŞINDI
 *    ve taşınmasının sebebi ölçülmüş bir sapma riski: `arama-kutusu.tsx`
 *    `minWordsForLlm` / `minWordsWithNumericHint` değerlerini ELLE KOPYALAMIŞTI
 *    (istemci "bu cümle yorumlanmaya değer mi" kararını sunucuya gitmeden
 *    veriyor). İki kopya ayrıştığında kullanıcı yanlış sonuç almaz — bazı
 *    cümleler yorumlanmadan düz kelime aramasına düşer, yani hata SESSİZDİR.
 *    Bu dosya hem sunucunun hem tarayıcının okuyabildiği tek yer.
 *
 * ⚠️ `@vt/config/constants` ALT YOLU tarayıcıda çalışmak zorunda: burada
 *    `process.env`, `zod` şeması ya da başka bir yan etki OLMAMALI. Kökten
 *    (`@vt/config`) import edildiğinde `env.ts` istemci paketine giriyor ve
 *    `pnpm --filter @vt/web verify:bundle` derlemeyi kırıyor.
 */
export const NATURAL_SEARCH = {
  /**
   * KELİME EŞİĞİ — LLM'e gitmenin alt sınırı.
   *
   * Bir sorgu, ancak ANAHTAR KELİME İNDEKSİNİN KULLANAMAYACAĞI bir bilgi
   * taşıyorsa LLM'e değer: bütçe ("5000 TL altı"), kullanım amacı ("iş
   * görüşmesi için"), cinsiyet ("erkeğe"), olumsuzlama ("desensiz").
   * Bu bilgiler Türkçe'de CÜMLE olarak yazılır; ürün adı ise 1-3 kelimedir.
   *
   * "siyah keten gömlek" (3 kelime) zaten mükemmel bir tsquery'dir: üç terim
   * de searchVector'da A/B ağırlıklı alanlarda karşılık bulur. Buna LLM
   * eklemek ~1 sn gecikme ve ~0,001 $ maliyet ekler, FİLTREYİ DEĞİŞTİRMEZ.
   *
   * Ölçüt "kaç kelime" değil aslında "cümle mi"; 4 kelime bunun ucuz ve
   * yanılması ucuz olan yaklaşık karşılığıdır. Yanlış tarafa düşerse ne olur:
   *   - Gereksiz LLM  → para ve gecikme (kötü)
   *   - Kaçırılan LLM → normal arama çalışır, kullanıcı sonuç alır (kabul)
   * Bu asimetri eşiğin YÜKSEK tutulmasını gerektirir.
   */
  minWordsForLlm: 4,

  /**
   * RAKAM İSTİSNASI — eşiğin altına inen tek durum.
   *
   * "5000 altı elbise" 3 kelimedir ama anahtar kelime aramasında SIFIR sonuç
   * verir: `websearch_to_tsquery` terimleri VE ile bağlar ve hiçbir ürün
   * başlığında "5000" geçmez. Rakam içeren kısa sorgu, tam da anahtar kelime
   * aramasının çuvalladığı yerdir; LLM burada sorunu çözer (fiyat → filtre).
   */
  minWordsWithNumericHint: 2,

  /**
   * ANAHTAR KELİME TAVANI.
   *
   * ⚠️ `websearch_to_tsquery` boşlukla ayrılmış terimleri VE'ler, VEYA'lamaz.
   *    Her ek kelime sonuç kümesini DARALTIR. Modele "cümledeki her şeyi
   *    keywords'e koy" dedirtmek, aramayı sıfır sonuca kilitlemenin en hızlı
   *    yoludur. Bu yüzden model yalnızca ÜRÜN ADINI yazar (en fazla 3 terim),
   *    geri kalan her şey yapılandırılmış alanlara gider.
   */
  maxKeywords: 3,

  /** Sorgu üst sınırı — bundan uzunu cümle değil, yapıştırılmış metindir. */
  maxQueryChars: 200,

  /**
   * GÜNLÜK KOTA — stil danışmanından AYRI (gerekçe: natural-search.service.ts).
   *
   * ⚠️ NEEDS-CONFIG: `AI_NL_SEARCH_DAILY_PER_USER` / `..._PER_GUEST` olarak
   *    `packages/config/src/env.ts` içine taşınmalı. Ortamdan okunamadığı
   *    sürece kota yalnızca yeni sürümle değiştirilebilir; bu bir olay anında
   *    (maliyet fırlaması) müdahale hızını düşürür.
   *
   * Sayıların gerekçesi: doğal dilde arama bir KEŞİF aracıdır, sohbet değil.
   * Aktif bir kullanıcı günde birkaç kez cümle kurar, onlarca kez değil;
   * 20 sınırı gerçek kullanımın çok üstünde, otomatik kazımanın çok altındadır.
   */
  dailyPerUser: 20,

  /**
   * Misafir sınırı daha düşük: kimliksiz istek IP başına sayılır ve IP
   * paylaşılabilir (kurumsal NAT, mobil operatör). Düşük tavan hem kötüye
   * kullanımı hem de masum paylaşımın faturasını sınırlar. Kota dolunca
   * misafir HATA GÖRMEZ; anahtar kelime aramasına düşer.
   */
  dailyPerGuest: 5,

  /**
   * Katalog söz varlığı (kategori/renk/marka) önbellek ömrü.
   *
   * Bu liste her aramada iki toplu sorgu demektir; arama sıcak yoldur.
   * Kategori ve renk kümesi günde birkaç kez değişir, saniyede değil.
   * 10 dakikalık bayatlık, yeni eklenen bir kategorinin en fazla 10 dakika
   * boyunca cümleden çıkarılamaması demektir — o sorgu yine sonuç döner.
   */
  vocabularyTtlMs: 10 * 60_000,

  /**
   * Bütçe anlık görüntüsü ömrü.
   *
   * ⚠️ Stil danışmanı bütçeyi HER mesajda sorar; mesaj seyrektir, sorgu ise
   *    `ai_usage_logs` üzerinde iki toplama (aggregate) yapar. Arama sıcak
   *    yolda aynı şeyi yaparsa tablo büyüdükçe aramayı bu sorgu yavaşlatır.
   *    60 saniyelik bayatlık, tavan aşıldıktan sonra en fazla 60 saniyelik
   *    harcamanın kaçması demektir — iki toplamanın her aramada ödenmesinden
   *    kat kat ucuz. Gerçek fren zaten katmanlı: kota → bütçe → sağlayıcı.
   */
  budgetSnapshotTtlMs: 60_000,

  /**
   * Modelin üretebileceği azami token. Çıktı tek bir küçük JSON nesnesidir;
   * bu sınır aynı zamanda "model cevap yazmaya kalkarsa" maliyet frenidir.
   */
  maxOutputTokens: 400,

  /** Söz varlığı istem içinde kaç değere kadar taşınır — bağlam maliyeti. */
  vocabularyLimits: {
    categories: 80,
    colors: 40,
    brands: 60,
  },

  /** Yorumlanmış aramada sayfa boyu. Sayfalama için bkz. natural-search.service.ts */
  pageSize: 24,
} as const;
