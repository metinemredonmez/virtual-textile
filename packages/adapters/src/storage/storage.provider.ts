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

  /**
   * SİTE GÖRSELİ — vitrin afişi, kategori/koleksiyon kapağı.
   *
   * ⚠️ ÜRÜN GÖRSELİ DEĞİL ve `products/` altına YAZILMAZ: sahibi satıcı değil
   *    platformdur, silinmesi satıcı verisiyle birlikte olmamalıdır.
   *
   * public kova — site afişi sır değildir, CDN'den imzasız servis edilir.
   * Ham yükleme yine de `staging/site/<id>` altına iner (bkz. mediaKeys).
   */
  siteImage: (siteImageId: string, width: number): string =>
    `site/banner/${siteImageId}/${width}.webp`,

  siteImageOriginal: (siteImageId: string): string => `site/banner/${siteImageId}/original`,
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
 *
 * ⚠️ `site/` ÖNEKİ PUBLIC'TİR VE LİSTEYE GİRMEZ — ama bu satır yine de
 *    YAZILIR, çünkü "listede yok" iki ayrı şey demek olabiliyor: (a) düşünüldü,
 *    public olduğuna karar verildi, (b) eklemek UNUTULDU. İkisi kodda
 *    birbirinden ayırt edilemez ve (b) sessiz bir sızıntıdır. Buradaki not, bir
 *    sonraki okuyucuya kararın (a) olduğunu söyler:
 *
 *      site/ → adminden yönetilen vitrin afişi ve kategori/koleksiyon kapağı.
 *              Herkese gösterilmek ÜZERE yüklenir; imzalı okuma anlamsız
 *              olurdu (afişi görmek için oturum gerekmez) ve her görüntülemede
 *              imza üretmek vitrini yavaşlatırdı. Kişisel veri taşımaz: EXIF
 *              onay adımında temizlenir, ham dosya `staging/site/…` altında
 *              private kalır ve işlem biter bitmez silinir.
 *
 *    Karar `r2.config.ts` → `KNOWN_KEY_PREFIXES` içinde de görünür olmalıdır;
 *    orada olmasaydı `put({ key: 'site/…', visibility: 'private' })` sessizce
 *    kabul edilir, nesne private kovaya iner ve `publicUrl()` yine de geçerli
 *    görünen ama 404 dönen bir adres üretirdi.
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
