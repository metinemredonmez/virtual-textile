import { MEDIA, SIGNED_URL_TTL_SECONDS } from '@vt/config';
import { appError } from '@vt/contracts';
import { visibilityForKey, type StorageVisibility } from '../storage.provider.js';

/**
 * R2 (S3 uyumlu) YAPILANDIRMASI
 *
 * ⚠️ İKİ KOVA, İKİ AYRI GÜVENLİK SINIFI. Bu ayrım yapılandırma seviyesinde
 *    tutuluyor ki çağıran taraf "hangi kovaya yazayım" sorusunu hiç sormasın:
 *    `visibility` verilir, kova buradan çözülür. Kova adı parametre olsaydı
 *    bir gün bir çağrı `bucketPublic` yazar ve kullanıcı fotoğrafı CDN'e düşerdi.
 */
export interface R2Config {
  /** https://<account-id>.r2.cloudflarestorage.com */
  readonly endpoint: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Ürün görselleri, mağaza logoları — CDN'den servis edilir. */
  readonly bucketPublic: string;
  /** ⚠️ Kullanıcı fotoğrafları, try-on çıktıları, satıcı belgeleri, iade fotoğrafları. */
  readonly bucketPrivate: string;
  /** Public kovanın önündeki CDN kökü, ör. https://cdn.example.com */
  readonly publicUrl: string;
  /** R2'de bölge kavramı yok; SigV4 imzası yine de bir değer ister. */
  readonly region?: string;
  /**
   * R2 sanal-host stilini destekler; yerel MinIO/testte yol stili gerekir.
   * Varsayılan olarak KAPALI bırakılır — R2 üretimi sanal-host ile çalışır.
   */
  readonly forcePathStyle?: boolean;
  /** Sunucu tarafı yükleme boyutu tavanı. Varsayılan: MEDIA.maxUploadBytes. */
  readonly maxUploadBytes?: number;
}

/**
 * SigV4'ün imzalayabileceği en uzun ömür. Üstünde imza üretilse bile S3
 * tarafında reddedilir; sessiz "çalışmayan URL" yerine burada patlaması iyidir.
 */
export const MAX_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Kova seçimi — TEK KAPI.
 *
 * ⚠️ İki kovanın aynı olması KVKK ihlalidir (özel nitelikli veri, ürün
 *    görselleriyle aynı yerde ve aynı erişim politikasıyla tutulamaz).
 *    `@vt/config` bunu üretimde açılışta engelliyor; burada ikinci kez
 *    kontrol ediliyor çünkü bu sınıf test/script gibi env doğrulamasından
 *    geçmemiş bağlamlarda da kurulabilir.
 */
export function bucketFor(config: R2Config, visibility: StorageVisibility): string {
  if (!config.bucketPublic || !config.bucketPrivate) {
    throw appError('INTERNAL_ERROR', {
      internalMessage: 'R2 kova adları eksik — R2_BUCKET_PUBLIC / R2_BUCKET_PRIVATE tanımlı değil',
    });
  }
  if (config.bucketPublic === config.bucketPrivate) {
    throw appError('INTERNAL_ERROR', {
      internalMessage:
        'R2 public ve private kovaları aynı — kullanıcı fotoğrafı ürün görselleriyle aynı kovada tutulamaz',
    });
  }
  return visibility === 'private' ? config.bucketPrivate : config.bucketPublic;
}

/**
 * Anahtar şemasında (storage.provider.ts) TANIMLI olan önekler. Yalnızca
 * bunlar için gizlilik sınıfı hakkında kesin konuşabiliriz.
 *
 * ⚠️ DIŞA AÇIK: `media-public.controller.ts` bunu BEYAZ LİSTE olarak kullanıyor.
 *    Orada `visibilityForKey` tek başına yetmiyor — o fonksiyon bilinmeyen her
 *    öneki 'public' SAYIYOR, yani listeye yazılmayı unutulan private bir alanı
 *    sessizce açardı. Bu liste varsayılanı KAPALI yapan ikinci kapıdır.
 */
export const KNOWN_KEY_PREFIXES = [
  'products/',
  'stores/',
  'user-photos/',
  'tryon/',
  'seller-docs/',
  'returns/',
  // ⚠️ Üçü de private ve `visibilityForKey` artık öyle biliyor. Buraya da
  //    yazılmasalardı kontrol onları "tanınmayan önek" sayıp atlar, yani
  //    `put({ key: 'wardrobe/…', visibility: 'public' })` sessizce çalışırdı.
  'wardrobe/',
  'exports/',
  'staging/',
  // ⚠️ `site/` PUBLIC'tir ve TAM DA BU YÜZDEN buraya yazılması zorunlu.
  //    Aşağıdaki `assertVisibilityMatchesKey` tanınmayan önekte sessizce
  //    `return` ediyor. `site/` listede olmasaydı, yanlışlıkla
  //    `put({ key: 'site/banner/…', visibility: 'private' })` yazan bir çağrı
  //    hiçbir uyarı üretmezdi: nesne private kovaya inerdi, `publicUrl()` kova
  //    varlığını kontrol etmediği için yine de geçerli GÖRÜNEN bir adres
  //    dönerdi, yönetici "yükledim" derdi, satır yazılırdı, sayfa 200 dönerdi —
  //    ve görsel 404 olurdu. Önek burada olduğu için o çağrı artık patlıyor.
  'site/',
] as const;

/**
 * Anahtarın taşıdığı gizlilik sınıfı ile çağrının verdiği `visibility`
 * uyuşuyor mu?
 *
 * ⚠️ Bu kontrol olmadan `put({ key: 'user-photos/…', visibility: 'public' })`
 *    sessizce çalışır ve kullanıcı fotoğrafını CDN'e açardı. Anahtar şeması
 *    zaten hangi verinin nereye ait olduğunu biliyor; burada o bilgi bir
 *    güvenlik kontrolüne çevriliyor.
 *
 * ⚠️ Şemada TANINMAYAN önekler reddedilmez, çağıranın `visibility` kararı
 *    kabul edilir. Sebep: ara/geçici alanlar (ör. işlenmemiş ham yüklemenin
 *    tutulduğu `staging/…`) bilinçli olarak private'tır ve şema onları
 *    henüz bilmiyor. Katı davranılsaydı bu ajan, ham EXIF'li dosyayı private
 *    tutmak yerine public kovaya yazmak zorunda kalırdı — korumak istediğimiz
 *    şeyin tam tersi. Asıl tehlike (bilinen private anahtarın public'e
 *    yazılması) aşağıda kesin olarak engelleniyor.
 */
export function assertVisibilityMatchesKey(key: string, visibility: StorageVisibility): void {
  const known = KNOWN_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
  if (!known) return;

  const expected = visibilityForKey(key);
  if (expected !== visibility) {
    throw appError('INTERNAL_ERROR', {
      internalMessage: `Anahtar "${key}" ${expected} kovaya ait, ${visibility} olarak istendi — kova karışması engellendi`,
    });
  }
}

/**
 * İmzalı URL ömrü — TAVAN SABİTLERDEN OKUNUR, çağırandan değil.
 *
 * ⚠️ Çağıran taraf istediği süreyi verebilir ama tavanı aşamaz. Aksi hâlde
 *    bir uçta yazılan "expiresInSeconds: 86400" satırı, kullanıcı fotoğrafını
 *    bir gün boyunca linki olan herkese açık hâle getirirdi. Süre kısıtı
 *    hassasiyete göre `SIGNED_URL_TTL_SECONDS` içinde tanımlıdır.
 *
 * Yükleme (`put`) URL'leri ayrı ele alınır: yükleme birkaç dakikada biter,
 * uzun ömürlü bir yazma izni bırakmanın hiçbir gerekçesi yoktur.
 */
export function resolveSignedUrlTtl(
  key: string,
  operation: 'get' | 'put',
  requestedSeconds: number,
): number {
  const ceiling = operation === 'put' ? MEDIA.uploadUrlTtlSeconds : readTtlCeiling(key);
  const requested = Number.isFinite(requestedSeconds) ? Math.floor(requestedSeconds) : 0;
  if (requested < 1) {
    throw appError('INTERNAL_ERROR', {
      internalMessage: `Geçersiz imzalı URL ömrü: ${String(requestedSeconds)}`,
    });
  }
  return Math.min(requested, ceiling, MAX_SIGNED_URL_TTL_SECONDS);
}

/** Anahtar önekine göre okuma URL'i tavanı. Bilinmeyen önek en kısa ömrü alır. */
function readTtlCeiling(key: string): number {
  if (key.startsWith('user-photos/')) return SIGNED_URL_TTL_SECONDS.userPhoto;
  if (key.startsWith('tryon/')) return SIGNED_URL_TTL_SECONDS.tryOnResult;
  if (key.startsWith('seller-docs/')) return SIGNED_URL_TTL_SECONDS.sellerDocument;
  if (key.startsWith('returns/')) return SIGNED_URL_TTL_SECONDS.returnPhoto;
  // Public kovadaki nesneler zaten imza istemez; buraya düşen bir çağrı
  // beklenmedik bir anahtar demektir — en kısa ömrü ver, uzun değil.
  return SIGNED_URL_TTL_SECONDS.sellerDocument;
}

/** Ortam değişkenlerinden yapılandırma. `@vt/config` şeması ile birebir. */
export function r2ConfigFromEnv(source: {
  R2_ENDPOINT: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_PUBLIC: string;
  R2_BUCKET_PRIVATE: string;
  R2_PUBLIC_URL: string;
}): R2Config {
  return {
    endpoint: source.R2_ENDPOINT,
    accessKeyId: source.R2_ACCESS_KEY_ID,
    secretAccessKey: source.R2_SECRET_ACCESS_KEY,
    bucketPublic: source.R2_BUCKET_PUBLIC,
    bucketPrivate: source.R2_BUCKET_PRIVATE,
    publicUrl: source.R2_PUBLIC_URL.replace(/\/+$/, ''),
    region: 'auto',
  };
}
