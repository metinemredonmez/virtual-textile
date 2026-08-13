// DEPOLAMA SAĞLAYICISI PORT OLARAK TANIMLANIR.
//
// Buradaki tipler `packages/adapters/src/storage/storage.provider.ts` ile
// YAPISAL olarak birebir aynıdır; `R2StorageProvider` hiçbir uyarlama katmanı
// olmadan bu porta bağlanır — bağlama `index.ts` içinde yapılır.
//
// ⚠️ Port bir EKSİKLİK değil, TASARIM: medya servisi somut sağlayıcıyı değil
//    bu arayüzü görür. R2 anahtarı yokken `UnconfiguredStorageProvider`a
//    fail-closed düşebilmemiz (bkz. index.ts) buna bağlıdır. Tipleri
//    `import type` ile @vt/adapters'a bağlamak bu ayrımı kaybettirir.

import type { ImageAngle, PhotoPurpose } from '@vt/db';
import type { TryOnReadinessIssue } from './tryon-readiness.js';

// ══════════════════════════ DEPOLAMA ═══════════════════════════════════════

export const MEDIA_STORAGE = 'MEDIA_STORAGE_PORT';

export type StorageVisibility = 'public' | 'private';

export interface PutObjectInput {
  key: string;
  visibility: StorageVisibility;
  body: Buffer;
  contentType: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
}

export interface SignedUrlInput {
  key: string;
  visibility: StorageVisibility;
  expiresInSeconds: number;
  operation: 'get' | 'put';
  contentType?: string;
  maxSizeBytes?: number;
}

export interface MediaStoragePort {
  readonly name: string;
  put(input: PutObjectInput): Promise<{ key: string; etag: string }>;
  get(key: string, visibility: StorageVisibility): Promise<Buffer>;
  delete(key: string, visibility: StorageVisibility): Promise<void>;
  deleteMany(keys: string[], visibility: StorageVisibility): Promise<void>;
  exists(key: string, visibility: StorageVisibility): Promise<boolean>;
  signedUrl(input: SignedUrlInput): Promise<string>;
  publicUrl(key: string): string;
}

// ══════════════════════════ ANAHTAR ŞEMASI ══════════════════════════════════

/**
 * Depolama anahtarları — `@vt/adapters/storage.provider.ts` içindeki
 * `storageKeys` ile AYNI şema. Bağımlılık eklendiğinde bu nesne silinip
 * oradan `import` edilmeli (aksi hâlde iki şema zamanla ayrışır).
 *
 * ⚠️ `staging/` YENİ bir ön ektir ve bilinçlidir; gerekçesi:
 *
 *    İmzalı yükleme URL'i ile gelen dosya HAM dosyadır: EXIF'i, dolayısıyla
 *    çekildiği yerin GPS koordinatı içindedir. Ürün görselleri public kovada
 *    durur; ham dosya doğrudan oraya yazılsaydı, biz onu işleyene kadar (ya da
 *    işleme hiç çalışmazsa sonsuza kadar) satıcının atölye/ev konumu CDN'den
 *    indirilebilir olurdu. Bu yüzden ham yükleme HER ZAMAN private kovadaki
 *    `staging/` alanına iner; public kovaya yalnızca EXIF'i temizlenmiş türev
 *    yazılır ve staging nesnesi silinir.
 *
 *    Kullanıcı fotoğrafında staging gerekmez: nihai adresi zaten private
 *    kovadadır, temizlenmiş sürüm aynı anahtarın üzerine yazılır.
 *
 * ⚠️ YUKARIDAKİ NOT BAYATLAMIŞTI, DÜZELTİLDİ. Eski hâli "`visibilityForKey()`
 *    `staging/` ön ekini bilmiyor" diyordu; ÖLÇTÜM — artık biliyor:
 *    `storage.provider.ts` → `privatePrefixes` ve `r2.config.ts` →
 *    `KNOWN_KEY_PREFIXES` listelerinin ikisinde de var. Yani `staging/…`
 *    anahtarına yanlışlıkla `visibility: 'public'` verilirse çağrı artık
 *    SESSİZCE çalışmaz, `assertVisibilityMatchesKey` fırlatır. Not olduğu gibi
 *    bırakılsaydı bir sonraki okuyucu var olmayan bir açığı kapatmaya çalışır
 *    ya da daha kötüsü, "bu liste güncellenmiyor" diye kendi önekini yazmazdı.
 */
export const mediaKeys = {
  /** ⚠️ private kova — ham, EXIF'li yükleme. İşlendikten sonra SİLİNİR. */
  productImageStaging: (productId: string, imageId: string): string =>
    `staging/products/${productId}/${imageId}`,

  /** public kova — EXIF'i temizlenmiş asıl görsel. */
  productImageOriginal: (productId: string, imageId: string): string =>
    `products/${productId}/${imageId}/original`,

  /** public kova — türev genişlikler. */
  productImage: (productId: string, imageId: string, width: number): string =>
    `products/${productId}/${imageId}/${width}.webp`,

  /**
   * ⚠️ private kova.
   *
   * Anahtar `userId` İÇERİR ve oturumdaki kullanıcıdan üretilir; istemciden
   * gelen bir anahtar ASLA kullanılmaz. Böylece "başkasının fotoğrafını
   * onayla/sil" saldırısı için istemcinin elinde çevirebileceği bir alan
   * kalmaz — yanlış kimlik, var olmayan bir anahtara işaret eder.
   */
  userPhoto: (userId: string, photoId: string): string => `user-photos/${userId}/${photoId}`,

  // ── Site görselleri (adminden yönetilen afiş / kapak) ────────────────────
  //
  // ⚠️ Görev metnindeki "GENEL kovaya yazılır" ifadesi İKİYE AYRILIR, çünkü
  //    olduğu gibi uygulanırsa ürün görselinde bilerek kapatılmış bir açığı
  //    afiş yolundan geri açar:
  //
  //      NİHAİ NESNE için DOĞRU  → `site/banner/<id>/…` = PUBLIC kova.
  //                                Afiş sır değildir, CDN'den imzasız gider.
  //      İMZALI PUT HEDEFİ için YANLIŞ → ham dosya ASLA public kovaya inmez.
  //
  //    Gerekçe ürün görselindekiyle birebir aynı (bkz. yukarısı): imzalı URL
  //    ile gelen dosya EXIF taşır. Afişi çeken de bir insandır; doğrudan
  //    public kovaya yazsaydık, biz işleyene kadar — işleme hiç çalışmazsa
  //    sonsuza kadar — çekim konumu CDN'den indirilebilir olurdu.
  //
  //    Ham yükleme bu yüzden `staging/site/<siteImageId>` altına iner. Önek
  //    `staging/` olduğu için iki gizlilik listesi de onu ZATEN tanıyor; yeni
  //    bir private önek açılmıyor, yani unutulacak bir satır da yok.

  /** ⚠️ private kova — ham, EXIF'li afiş yüklemesi. İşlenince SİLİNİR. */
  siteImageStaging: (siteImageId: string): string => `staging/site/${siteImageId}`,

  /** public kova — EXIF'i temizlenmiş asıl afiş. */
  siteImageOriginal: (siteImageId: string): string => `site/banner/${siteImageId}/original`,

  /** public kova — afiş türevleri. Genişlikler `SITE_BANNER_WIDTHS`ten. */
  siteImage: (siteImageId: string, width: number): string =>
    `site/banner/${siteImageId}/${width}.webp`,
} as const;

// ══════════════════════════ KATALOG (ÜRÜN GÖRSELİ) ══════════════════════════

export const MEDIA_CATALOG = 'MEDIA_CATALOG_PORT';

export interface MediaProductImage {
  id: string;
  productId: string;
  storageKey: string;
  angle: ImageAngle;
  isPrimary: boolean;
  blurhash: string | null;
  widthPx: number;
  heightPx: number;
  sortOrder: number;
}

export interface AddProductImageCommand {
  imageId: string;
  storageKey: string;
  angle: ImageAngle;
  isPrimary: boolean;
  blurhash: string | null;
  widthPx: number;
  heightPx: number;
}

/**
 * ÜRÜN GÖRSELİ YAZMA YÜZEYİ.
 *
 * Kural 3: `ProductImage` ve `Product` KATALOG modülünün tablolarıdır; medya
 * modülü onlara doğrudan dokunmaz. Katalog modülü henüz satıcı tarafı bir
 * yazma yüzeyi yayımlamadığı için geçici köprü kullanılıyor (media.bridges.ts).
 *
 * `sellerId` her metoda geçiriliyor ve porta SORGU KOŞULU olarak giriyor —
 * "önce oku, sonra sahibini kontrol et" yazılsaydı o kontrolün bir gün
 * düşmesiyle başka mağazanın ürününe görsel eklenebilirdi.
 */
export interface MediaCatalogPort {
  /** Ürün bu satıcıya mı ait? Değilse null. */
  findProduct(sellerId: string, productId: string): Promise<{ id: string } | null>;

  listImages(productId: string): Promise<MediaProductImage[]>;

  /**
   * Görseli ekler ve ürünün GÜNCEL görsel listesini döndürür.
   *
   * ⚠️ Ekleme + listeleme TEK transaction: skor hesabı eklenen görseli de
   *    içermeli. Ayrı okunsaydı araya giren ikinci bir yükleme skoru eksik
   *    veriyle hesaplatabilirdi.
   *
   * ⚠️ Aynı `storageKey` ile ikinci çağrı yeni satır AÇMAZ, var olanı döndürür:
   *    yükleme onayı ağ zaman aşımında tekrarlanabilir ve ürün aynı görseli
   *    iki kez göstermemelidir.
   */
  addImage(
    sellerId: string,
    productId: string,
    input: AddProductImageCommand,
  ): Promise<{ image: MediaProductImage; images: MediaProductImage[] }>;

  /** Try-On Uygunluk Skoru ve sorun listesi — ürün satırına yazılır. */
  saveReadiness(
    sellerId: string,
    productId: string,
    score: number,
    issues: readonly TryOnReadinessIssue[],
  ): Promise<void>;
}

// ══════════════════════════ RIZA (KVKK) ═════════════════════════════════════

export const MEDIA_CONSENT = 'MEDIA_CONSENT_PORT';

/**
 * Bu modülün ilgilendiği rıza türleri (`ConsentType` enum'ının alt kümesi).
 *
 * PHOTO_PROCESSING → fotoğrafın işlenmesi (her yükleme için gerekli)
 * PHOTO_STORAGE    → profilde SAKLANMASI (yalnızca SAVED_PROFILE için gerekli)
 */
export type MediaConsentType = 'PHOTO_PROCESSING' | 'PHOTO_STORAGE';

/**
 * ⚠️ `ConsentRecord` kullanıcı/kimlik modülünün tablosudur (kural 3).
 *
 * Rıza kaydı GEÇMİŞTİR: aynı tür için birden çok satır olur ve kullanıcı
 * rızasını geri çekince `granted: false` yeni bir satır yazılır. Bu yüzden
 * "granted true kaydı var mı" değil, "EN SON kayıt granted mı" sorulur —
 * ilki, rızasını geri çekmiş kullanıcının fotoğrafını işlemeye devam etmek
 * demektir.
 */
export interface MediaConsentPort {
  hasActiveConsent(userId: string, type: MediaConsentType): Promise<boolean>;
}

// ══════════════════════════ SAKLAMA SÜRESİ ══════════════════════════════════

export type MediaPhotoPurpose = PhotoPurpose;
