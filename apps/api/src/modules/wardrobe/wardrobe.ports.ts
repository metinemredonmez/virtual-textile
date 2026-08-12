/**
 * DİJİTAL GARDIROP MODÜLÜNÜN DIŞARIYA BAĞIMLILIKLARI
 *
 * Bu modül tek bir tabloya sahiptir: `DigitalWardrobeItem`.
 *
 * ✅ Tablo AÇILDI (`user_wardrobe_items`, migration
 *    `20260812131500_digital_wardrobe`) ve portların arkasına gerçek
 *    adaptörler bağlandı (`wardrobe.gateway.ts`). Bu başlık daha önce "tablo
 *    şemada yok" diyordu.
 *
 * ⚠️ Servis yine de `PrismaService`e DEĞİL, aşağıdaki `WardrobeRepositoryPort`a
 *    bağlıdır ve bu kalıcıdır. Sebep hiçbir zaman "tablo yok" değildi: aynı
 *    kalıp katalog, sepet ve medya modüllerinde de kullanılıyor
 *    (bkz. cart.ports.ts, media.ports.ts, stylist.ports.ts). Depo değişirse
 *    `index.ts` içindeki TEK provider satırı değişir; servis ve iş kuralı kodu
 *    dokunulmadan kalır.
 *
 * Diğer modüllerin verisine (katalog, stil danışmanı, sanal deneme) doğrudan
 * Prisma ile erişilmez; her biri burada dar bir arayüzün arkasındadır.
 */

import type { TryOnCategory } from '@vt/db';

export const WARDROBE_REPOSITORY = 'WARDROBE_REPOSITORY_PORT';
export const WARDROBE_PHOTO_STORAGE = 'WARDROBE_PHOTO_STORAGE_PORT';
export const WARDROBE_STYLIST = 'WARDROBE_STYLIST_PORT';
export const WARDROBE_TRYON = 'WARDROBE_TRYON_PORT';

/** Gardıroptaki parçanın nereden geldiği. */
export type WardrobeSource =
  /** Satın alındı — `package.delivered` olayı ekledi. */
  | 'PURCHASE'
  /** Kullanıcı kendi dolabındaki parçayı fotoğrafıyla ekledi. */
  | 'MANUAL';

// ══════════════════════════ DEPO (kendi tablomuz) ══════════════════════════

export interface WardrobeItem {
  id: string;
  userId: string;
  source: WardrobeSource;
  /**
   * Platformda satılan bir varyanta karşılık geliyorsa dolu.
   *
   * ⚠️ MANUAL kayıtlarda null'dır ve bu bir eksiklik değil, gereksinimdir:
   *    kullanıcı bizden almadığı kotu da gardırobuna koyabilmelidir, yoksa
   *    kombin önerisi kullanıcının gerçek dolabını değil yalnızca bizden
   *    aldıklarını görür.
   */
  variantId: string | null;
  category: TryOnCategory;
  /** Serbest metin renk — katalogdaki varyant rengiyle aynı sözlük. */
  color: string;
  label: string | null;
  /**
   * ⚠️ ÖZEL NİTELİKLİ VERİ. private kovadaki anahtar. MANUAL kayıtlarda dolu,
   *    PURCHASE kayıtlarında null (orada ürünün public görseli kullanılır).
   */
  photoKey: string | null;
  /** PURCHASE kayıtlarında ürünün public görsel anahtarı. */
  productImageKey: string | null;
  /** ⚠️ Mükerrer eklemeyi engelleyen doğal anahtar. Bkz. `wardrobe.auto-add.ts`. */
  sourceOrderItemId: string | null;
  createdAt: Date;
}

/** Otomatik eklemede kullanılan yazma komutu. */
export interface WardrobeAutoAddCommand {
  userId: string;
  variantId: string;
  category: TryOnCategory;
  color: string;
  label: string;
  productImageKey: string;
  /** ⚠️ UNIQUE(userId, sourceOrderItemId) — idempotentliğin dayanağı. */
  sourceOrderItemId: string;
}

/** Kullanıcının kendi eklediği parça. */
export interface WardrobeManualAddCommand {
  userId: string;
  category: TryOnCategory;
  color: string;
  label: string | null;
  /** private kovadaki anahtar; servis üretir, istemciden ASLA alınmaz. */
  photoKey: string;
}

export interface WardrobeRepositoryPort {
  listByUser(userId: string): Promise<WardrobeItem[]>;

  findOwned(userId: string, itemId: string): Promise<WardrobeItem | null>;

  /**
   * Satın alınan kalemleri ekler.
   *
   * ⚠️ SÖZLEŞME: aynı `sourceOrderItemId` ile ikinci çağrı YENİ SATIR AÇMAZ.
   *    Uygulaması `ON CONFLICT DO NOTHING` (UNIQUE(userId, sourceOrderItemId))
   *    olmalıdır — "önce var mı diye bak, yoksa yaz" YAZILMAMALIDIR: iki
   *    worker aynı olayı aynı anda işlerse ikisi de "yok" görür ve iki satır
   *    yazılır. Tekilliği veritabanı garanti etmelidir, uygulama değil.
   *
   * Dönen sayı GERÇEKTEN eklenen satır sayısıdır (çakışanlar sayılmaz).
   */
  insertPurchasedIgnoringDuplicates(commands: readonly WardrobeAutoAddCommand[]): Promise<number>;

  insertManual(command: WardrobeManualAddCommand): Promise<WardrobeItem>;

  /** Sahiplik koşulu SORGUYA girer; "önce oku sonra kontrol et" değil. */
  deleteOwned(userId: string, itemId: string): Promise<WardrobeItem | null>;
}

// ══════════════════════════ FOTOĞRAF DEPOSU ════════════════════════════════

/**
 * ⚠️ KVKK — GARDIROP FOTOĞRAFI ÜRÜN GÖRSELİ DEĞİLDİR.
 *
 * Kullanıcının kendi dolabından çektiği fotoğraf onun evinin içini, bazen
 * kendisini gösterir; ürün görseli ise satıcının yayımladığı pazarlama
 * materyalidir. İkisi aynı muameleyi göremez:
 *
 *   ürün görseli   → public kova, kalıcı CDN adresi, herkese açık
 *   gardırop fotoğrafı → private kova, KISA ÖMÜRLÜ İMZALI URL, yalnızca sahibi
 *
 * Bu port bilinçli olarak `publicUrl()` YAYIMLAMAZ. Yayımlasaydı bir gün
 * birisi listeleme ucunda onu çağırır ve fotoğraflar imzasız, süresiz
 * adreslerle dışarı açılırdı. Var olmayan metot yanlış kullanılamaz.
 */
export interface WardrobePhotoStoragePort {
  /** Yükleme için kısa ömürlü imzalı PUT adresi — private kovaya. */
  signedUploadUrl(input: {
    key: string;
    expiresInSeconds: number;
    contentType: string;
    maxSizeBytes: number;
  }): Promise<string>;

  /** Okuma için kısa ömürlü imzalı GET adresi — private kovadan. */
  signedReadUrl(input: { key: string; expiresInSeconds: number }): Promise<string>;

  exists(key: string): Promise<boolean>;

  delete(key: string): Promise<void>;
}

// ══════════════════════════ STİL DANIŞMANI ═════════════════════════════════

/** Kombin önerisi — parça kimlikleri gardıroptan gelir. */
export interface WardrobeOutfitSuggestion {
  /** Bu kombine giren gardırop parçalarının kimlikleri. */
  itemIds: string[];
  title: string;
  rationale: string;
  /** Renk uyumu kural motorunun kararı. */
  harmony: 'HARMONIOUS' | 'ACCEPTABLE' | 'CLASHING' | 'UNKNOWN';
}

/** Kombin önerisi için danışmana verilen dar parça görünümü. */
export interface WardrobeSuggestionInput {
  itemId: string;
  category: TryOnCategory;
  color: string;
  label: string | null;
}

/**
 * ⚠️ MODÜL SINIRI: KOMBİN MANTIĞI BURADA YAZILMAZ.
 *
 * Renk uyumu kural motoru ve öneri üretimi stil danışmanı modülünün işidir
 * (bkz. `modules/stylist/tools/color-harmony.ts`). Gardırop modülü kendi
 * LLM çağrısını veya kendi "bu ikisi yakışır" tablosunu YAZMAZ; yazsaydı iki
 * ayrı yerde iki farklı moda kuralı olur ve kullanıcı sohbet ekranında başka,
 * gardırop ekranında başka cevap alırdı.
 */
export interface WardrobeStylistPort {
  suggestOutfits(input: {
    userId: string;
    items: readonly WardrobeSuggestionInput[];
    limit: number;
  }): Promise<WardrobeOutfitSuggestion[]>;
}

// ══════════════════════════ SANAL DENEME ═══════════════════════════════════

/**
 * ⚠️ MODÜL SINIRI: try-on mantığı burada yazılmaz, `MultiTryOnService` çağrılır.
 *
 * Deneme için rıza, kota, bütçe ve katman sırası kapıları vardır ve hepsi AI
 * modülündedir (bkz. multi-tryon.service.ts). Buradan doğrudan sağlayıcıya
 * gidilseydi o kapıların hepsi atlanmış olurdu.
 *
 * ⚠️ Yalnızca `variantId` DOLU parçalar denenebilir: sanal deneme katalogdaki
 *    ürün görselinden giydirir, kullanıcının kendi fotoğrafından değil.
 *    MANUAL parçalar öneriye girer ama denemeye giremez.
 */
export interface WardrobeTryOnPort {
  prepareOutfit(input: {
    userId: string;
    variantIds: readonly string[];
  }): Promise<{ available: boolean; reason?: string }>;
}
