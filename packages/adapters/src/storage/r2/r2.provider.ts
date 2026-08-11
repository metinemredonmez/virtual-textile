import { MEDIA } from '@vt/config';
import { appError } from '@vt/contracts';
import {
  visibilityForKey,
  type PutObjectInput,
  type SignedUrlInput,
  type StorageProvider,
  type StorageVisibility,
} from '../storage.provider.js';
import {
  assertVisibilityMatchesKey,
  bucketFor,
  resolveSignedUrlTtl,
  type R2Config,
} from './r2.config.js';
import { DELETE_BATCH_SIZE, UnconfiguredR2Driver, type R2Driver } from './r2.driver.js';

/**
 * CLOUDFLARE R2 DEPOLAMA SAĞLAYICISI
 *
 * `StorageProvider` arayüzünün S3 uyumlu uygulaması. Ağ işini `R2Driver`
 * yapar; buradaki kod politikadır:
 *
 *   • kova seçimi          → `visibility` zorunlu, anahtar şemasıyla çapraz doğrulanır
 *   • imzalı URL ömrü      → SIGNED_URL_TTL_SECONDS tavanına kırpılır
 *   • yükleme boyutu       → MEDIA.maxUploadBytes
 *   • public URL üretimi   → private anahtar için ASLA
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ KOVA KURULUM ŞARTI — SÜRÜMLEME (VERSIONING) KAPALI OLMALIDIR.
 *
 *    `delete()` nesneyi gerçekten kaldırır. Kovada sürümleme AÇIK olursa
 *    DeleteObject nesneyi silmez, üstüne bir "delete marker" koyar: dosya
 *    sürüm geçmişinde durmaya devam eder. O durumda kullanıcıya "fotoğrafınız
 *    silindi" denir ama silinmemiştir — KVKK m.7 silme yükümlülüğü yerine
 *    getirilmemiş olur ve bunu hiçbir test yakalamaz, çünkü kod tarafında her
 *    şey başarılı görünür.
 *
 *    Aynı sebeple private kovada "lifecycle → noncurrent version retention"
 *    ve kova düzeyinde yedek/replikasyon açılmamalıdır. Bkz. docs/privacy.md.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export class R2StorageProvider implements StorageProvider {
  readonly name = 'r2';

  private readonly maxUploadBytes: number;

  constructor(
    private readonly config: R2Config,
    /** Verilmezse hata veren sürücü bağlanır — sessiz kayıp yerine gürültülü hata. */
    private readonly driver: R2Driver = new UnconfiguredR2Driver(),
  ) {
    this.maxUploadBytes = config.maxUploadBytes ?? MEDIA.maxUploadBytes;
  }

  async put(input: PutObjectInput): Promise<{ key: string; etag: string }> {
    this.assertKey(input.key);
    assertVisibilityMatchesKey(input.key, input.visibility);

    if (input.body.byteLength === 0) {
      throw appError('VALIDATION_FAILED', {
        internalMessage: `Boş gövde depoya yazılamaz: ${input.key}`,
      });
    }
    if (input.body.byteLength > this.maxUploadBytes) {
      throw appError('PHOTO_TOO_LARGE', {
        params: { maxMb: Math.floor(this.maxUploadBytes / (1024 * 1024)) },
        internalMessage: `${input.key} için gövde ${input.body.byteLength} bayt, tavan ${this.maxUploadBytes}`,
      });
    }

    const { etag } = await this.driver.putObject({
      bucket: bucketFor(this.config, input.visibility),
      key: input.key,
      body: input.body,
      contentType: input.contentType,
      cacheControl: input.cacheControl ?? this.defaultCacheControl(input.visibility),
      metadata: input.metadata,
    });

    return { key: input.key, etag };
  }

  async get(key: string, visibility: StorageVisibility): Promise<Buffer> {
    this.assertKey(key);
    assertVisibilityMatchesKey(key, visibility);
    return this.driver.getObject(bucketFor(this.config, visibility), key);
  }

  /**
   * ⚠️ Gerçek silme (bkz. sınıf başındaki sürümleme notu).
   *
   * Nesne zaten yoksa hata verilmez: silme akışı TEKRAR EDİLEBİLİR olmalıdır.
   * İlk deneme depodan silip veritabanı adımında düşerse, ikinci deneme
   * "zaten yok" diye patlarsa kayıt sonsuza kadar silinemez hâlde kalır.
   */
  async delete(key: string, visibility: StorageVisibility): Promise<void> {
    this.assertKey(key);
    assertVisibilityMatchesKey(key, visibility);
    await this.driver.deleteObject(bucketFor(this.config, visibility), key);
  }

  async deleteMany(keys: string[], visibility: StorageVisibility): Promise<void> {
    if (keys.length === 0) return;

    const bucket = bucketFor(this.config, visibility);
    for (const key of keys) {
      this.assertKey(key);
      assertVisibilityMatchesKey(key, visibility);
    }

    // Sağlayıcı tek istekte sınırlı sayıda anahtar kabul eder; parçala.
    for (let index = 0; index < keys.length; index += DELETE_BATCH_SIZE) {
      await this.driver.deleteObjects(bucket, keys.slice(index, index + DELETE_BATCH_SIZE));
    }
  }

  async exists(key: string, visibility: StorageVisibility): Promise<boolean> {
    this.assertKey(key);
    assertVisibilityMatchesKey(key, visibility);
    const head = await this.driver.headObject(bucketFor(this.config, visibility), key);
    return head !== null;
  }

  /**
   * İMZALI URL
   *
   * ⚠️ Ömür ÇAĞIRANIN İSTEĞİ DEĞİL, sabitlerdeki tavandır (`resolveSignedUrlTtl`).
   *    İstemciye giden bir bağlantı, süresi boyunca elinde tutan HERKESE
   *    erişim verir — ekran görüntüsü, log, tarayıcı geçmişi, paylaşılan link.
   *    Bu yüzden süre "yeterince uzun" değil, "işi bitirecek kadar kısa" seçilir.
   */
  async signedUrl(input: SignedUrlInput): Promise<string> {
    this.assertKey(input.key);
    assertVisibilityMatchesKey(input.key, input.visibility);

    if (input.operation === 'put' && !input.contentType) {
      throw appError('VALIDATION_FAILED', {
        internalMessage: `İmzalı yükleme URL'i için contentType zorunlu: ${input.key}`,
      });
    }
    if (input.operation === 'put' && input.maxSizeBytes !== undefined) {
      if (input.maxSizeBytes <= 0 || input.maxSizeBytes > this.maxUploadBytes) {
        throw appError('PHOTO_TOO_LARGE', {
          params: { maxMb: Math.floor(this.maxUploadBytes / (1024 * 1024)) },
          internalMessage: `İmzalı yükleme sınırı geçersiz: ${input.maxSizeBytes}`,
        });
      }
    }

    return this.driver.presign({
      bucket: bucketFor(this.config, input.visibility),
      key: input.key,
      operation: input.operation,
      expiresInSeconds: resolveSignedUrlTtl(input.key, input.operation, input.expiresInSeconds),
      contentType: input.contentType,
      contentLength: input.maxSizeBytes,
    });
  }

  /**
   * ⚠️ Private anahtar için public URL ÜRETİLMEZ.
   *
   * Bu metot "adres üret" gibi masum görünür ama ürettiği adres imzasızdır ve
   * süresizdir. Bir gün bir yanıt gövdesine `publicUrl(photo.storageKey)`
   * yazılırsa, kullanıcı fotoğrafının kalıcı bağlantısı istemciye gitmiş olur.
   * Bunu yorumla değil, kodla engelliyoruz.
   */
  publicUrl(key: string): string {
    this.assertKey(key);

    if (visibilityForKey(key) === 'private') {
      throw appError('INTERNAL_ERROR', {
        internalMessage: `Private anahtar için public URL istendi: ${key} — imzalı URL kullanılmalı`,
      });
    }
    if (!this.config.publicUrl) {
      throw appError('INTERNAL_ERROR', {
        internalMessage: 'R2_PUBLIC_URL tanımlı değil — public görsel adresi üretilemez',
      });
    }
    return `${this.config.publicUrl}/${key}`;
  }

  /**
   * Public ürün görselleri içeriğe göre adreslenir (anahtarda genişlik ve
   * kimlik var), bu yüzden uzun süre önbelleklenebilir. Private nesneler
   * imzalı URL ile servis edilir; ara katmanların (CDN, tarayıcı) onları
   * saklaması, imza süresi dolduktan sonra bile erişim demektir.
   */
  private defaultCacheControl(visibility: StorageVisibility): string {
    return visibility === 'public'
      ? 'public, max-age=31536000, immutable'
      : 'private, no-store, max-age=0';
  }

  /**
   * Anahtar temizliği. `..` ve baştaki `/` sızarsa çağıran, hedeflemediği bir
   * yolu okuyabilir/yazabilir — anahtarlar kullanıcı girdisinden türetildiği
   * için bu kontrol savunma hattıdır.
   */
  private assertKey(key: string): void {
    const invalid =
      key.length === 0 ||
      key.length > 1024 ||
      key.startsWith('/') ||
      key.includes('..') ||
      key.includes('//') ||
      // Boşluk ve kontrol karakterleri imza/başlık ayrıştırmasını bozar;
      // ayrıca NUL enjeksiyonu yol kontrolünü atlatmakta kullanılır.
      // eslint-disable-next-line no-control-regex
      /[\s\u0000-\u001f\u007f]/.test(key);

    if (invalid) {
      throw appError('VALIDATION_FAILED', {
        internalMessage: `Geçersiz depolama anahtarı: ${JSON.stringify(key.slice(0, 120))}`,
      });
    }
  }
}
