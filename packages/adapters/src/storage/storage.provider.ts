/**
 * NESNE DEPOLAMA ARAYÜZÜ (S3 uyumlu)
 *
 * İki ayrı kova (bucket) vardır ve KARIŞTIRILMAZ:
 *  - public  : ürün görselleri. CDN'den servis edilir, imza gerektirmez.
 *  - private : kullanıcı fotoğrafları, try-on sonuçları, satıcı belgeleri,
 *              iade fotoğrafları. Yalnızca kısa ömürlü imzalı URL ile erişilir.
 *
 * ⚠️ Kullanıcı fotoğrafı public kovaya yazılırsa bu bir KVKK ihlalidir.
 *    Bu yüzden bucket seçimi çağıran tarafa bırakılmaz; `visibility` alanı
 *    zorunludur ve @vt/config üretimde iki kovanın aynı olmasını engeller.
 */

export type StorageVisibility = 'public' | 'private';

export interface PutObjectInput {
  key: string;
  visibility: StorageVisibility;
  body: Buffer;
  contentType: string;
  /** Tarayıcı önbelleği. Ürün görselleri uzun, imzalı içerik kısa tutulur. */
  cacheControl?: string;
  metadata?: Record<string, string>;
}

export interface SignedUrlInput {
  key: string;
  visibility: StorageVisibility;
  expiresInSeconds: number;
  /** Yükleme için imzalı PUT URL'i üretilir. */
  operation: 'get' | 'put';
  contentType?: string;
  /** Yükleme boyutunu sınırla — istemci sözünü tutmayabilir. */
  maxSizeBytes?: number;
}

export interface StorageProvider {
  readonly name: string;

  put(input: PutObjectInput): Promise<{ key: string; etag: string }>;
  get(key: string, visibility: StorageVisibility): Promise<Buffer>;
  /**
   * ⚠️ KVKK silme akışında gerçekten siler.
   * Kovada sürüm (versioning) AÇIK OLMAMALIDIR — açıksa "sildim" dediğin
   * fotoğraf sürüm geçmişinde kalır ve silme talebi yerine getirilmemiş olur.
   */
  delete(key: string, visibility: StorageVisibility): Promise<void>;
  deleteMany(keys: string[], visibility: StorageVisibility): Promise<void>;
  exists(key: string, visibility: StorageVisibility): Promise<boolean>;
  signedUrl(input: SignedUrlInput): Promise<string>;
  /** Public kovadaki nesnenin CDN adresi. */
  publicUrl(key: string): string;
}

/** Anahtar şeması — tek yerden üretilir ki kova/klasör karışmasın. */
export const storageKeys = {
  productImage: (productId: string, imageId: string, width: number): string =>
    `products/${productId}/${imageId}/${width}.webp`,

  productImageOriginal: (productId: string, imageId: string): string =>
    `products/${productId}/${imageId}/original`,

  /** ⚠️ private kova */
  userPhoto: (userId: string, photoId: string): string => `user-photos/${userId}/${photoId}`,

  /** ⚠️ private kova */
  tryOnResult: (jobId: string): string => `tryon/${jobId}.webp`,

  /** ⚠️ private kova */
  sellerDocument: (sellerId: string, documentId: string): string =>
    `seller-docs/${sellerId}/${documentId}`,

  /** ⚠️ private kova */
  returnPhoto: (returnId: string, index: number): string => `returns/${returnId}/${index}.webp`,

  storeLogo: (storeId: string): string => `stores/${storeId}/logo.webp`,
} as const;

/**
 * Bir anahtarın hangi kovaya ait olduğunu tek yerden belirler.
 *
 * ⚠️ FONKSİYON BİLİNMEYEN HER ÖNEKİ 'public' SAYAR. Yani bu listeye
 *    eklenmeyen private bir alan, `publicUrl()` çağrısında hata vermek yerine
 *    KALICI ve İMZASIZ bir CDN adresi üretir. Yeni bir private ön ek açan
 *    herkes onu buraya da yazmak zorundadır; unutmanın belirtisi yoktur.
 *
 * Aşağıdaki üç ön ek bu turda eklendi:
 *   wardrobe/ → kullanıcının kendi dolabından çektiği fotoğraf. Ürün görseli
 *               değildir; evinin içini, bazen kendisini gösterir.
 *   exports/  → KVKK veri indirme arşivi. Kullanıcının TÜM kişisel verisinin
 *               tek dosyada toplanmış hâli — public kovaya düşerse tek bir
 *               adres bütün profili açar.
 *   staging/  → işlenmemiş HAM yükleme. EXIF'i, dolayısıyla çekildiği yerin
 *               GPS koordinatını hâlâ taşır (bkz. media.ports.ts → mediaKeys).
 */
export function visibilityForKey(key: string): StorageVisibility {
  const privatePrefixes = [
    'user-photos/',
    'tryon/',
    'seller-docs/',
    'returns/',
    'wardrobe/',
    'exports/',
    'staging/',
  ];
  return privatePrefixes.some((prefix) => key.startsWith(prefix)) ? 'private' : 'public';
}
