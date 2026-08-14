// AWS S3 SÜRÜCÜSÜ — SDK'YI BİLEREK `import` ETMEZ.
//
// SDK kurulu ve bağlı; gerçek `import` `r2.factory.ts` içindedir ve buraya
// `createAwsS3Driver()` çağrısıyla DIŞARIDAN geçilir. Kullandığımız yüzey
// aşağıda yapısal arayüzlerle (`AwsS3Sdk`) tanımlanır.
//
// ⚠️ Bu ayrım bir eksiklik değil, TASARIM ve korunmalıdır: SDK'nın tüm yüzeyi
//    yerine yalnızca kullandığımız 6 komut görünür. "Bir yerde ACL:
//    public-read geçilmiş mi" sorusunun cevabı böylece TEK dosyada okunabilir
//    kalıyor — kullanıcı fotoğraflarının herkese açık kovaya yazılıp
//    yazılmadığı bu dosya okunarak denetlenebiliyor. SDK doğrudan `import`
//    edilirse o denetim yüzeyi pakete dağılır ve testte sahte sürücü
//    geçilemez.

import { appError } from '@vt/contracts';
import { circuitFor, type CircuitBreaker } from '../../resilience/circuit-breaker.js';
import { resilient } from '../../resilience/resilient.js';
import {
  DELETE_BATCH_SIZE,
  type R2Driver,
  type R2HeadResult,
  type R2PresignInput,
  type R2PutInput,
} from './r2.driver.js';
import type { R2Config } from './r2.config.js';

// ── SDK'nın kullandığımız yüzeyi ────────────────────────────────────────────

/** `new S3Client(...)` sonucunun bizim ihtiyacımız olan kısmı. */
export interface S3ClientLike {
  send(command: object): Promise<unknown>;
  destroy?: () => void;
}

/** GetObject yanıtındaki gövde — SDK v3 akışı bu yardımcıyı sağlar. */
interface GetObjectOutputLike {
  Body?: { transformToByteArray(): Promise<Uint8Array> } | undefined;
  ETag?: string | undefined;
}

interface HeadObjectOutputLike {
  ContentLength?: number | undefined;
  ContentType?: string | undefined;
  ETag?: string | undefined;
}

type CommandConstructor = new (input: Record<string, unknown>) => object;

export interface AwsS3Sdk {
  S3Client: new (config: Record<string, unknown>) => S3ClientLike;
  PutObjectCommand: CommandConstructor;
  GetObjectCommand: CommandConstructor;
  DeleteObjectCommand: CommandConstructor;
  DeleteObjectsCommand: CommandConstructor;
  HeadObjectCommand: CommandConstructor;
  getSignedUrl: (
    client: S3ClientLike,
    command: object,
    options: { expiresIn: number },
  ) => Promise<string>;
}

export interface AwsS3DriverOptions {
  /** Verilmezse "r2" adıyla paylaşılan devre kesici kullanılır. */
  circuitBreaker?: CircuitBreaker;
  /** Depo çağrıları için zaman aşımı. Yükleme büyük olabilir, varsayılan cömert. */
  timeoutMs?: number;
}

/** Nesne bulunamadı mı? S3 bunu iki farklı biçimde bildirebiliyor. */
function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as {
    name?: unknown;
    Code?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  if (candidate.name === 'NotFound' || candidate.name === 'NoSuchKey') return true;
  if (candidate.Code === 'NoSuchKey') return true;
  return candidate.$metadata?.httpStatusCode === 404;
}

/**
 * GERÇEK S3/R2 SÜRÜCÜSÜ — SDK'ya dokunan TEK yer.
 *
 * Her çağrı `resilient()` içinden geçer: zaman aşımı → yeniden deneme →
 * devre kesici. Depo çağrılarının hepsi idempotenttir (aynı anahtara aynı
 * gövdeyi yazmak, aynı anahtarı iki kez silmek sonucu değiştirmez), bu yüzden
 * `idempotencyKey` verilerek retry AÇIK bırakılıyor — ödeme adapter'ından
 * farklı olarak burada tekrar denemek güvenlidir.
 */
export function createAwsS3Driver(
  sdk: AwsS3Sdk,
  config: R2Config,
  options: AwsS3DriverOptions = {},
): R2Driver {
  if (!config.endpoint || !config.accessKeyId || !config.secretAccessKey) {
    throw appError('INTERNAL_ERROR', {
      internalMessage:
        'R2 kimlik bilgileri eksik — R2_ENDPOINT/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY',
    });
  }

  const client = new sdk.S3Client({
    // R2'de bölge yok; SigV4 yine de bir değer istiyor.
    region: config.region ?? 'auto',
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle ?? false,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },

    /**
     * ⚠️ ESNEK SAĞLAMA TOPLAMI KAPATILDI — İMZALI YÜKLEMEYİ KIRIYORDU.
     *
     *  AWS SDK v3 (bu depoda ^3.1107) `PutObject` için varsayılan olarak
     *  `requestChecksumCalculation: 'WHEN_SUPPORTED'` kullanıyor: isteğe bir
     *  CRC32 sağlama toplamı ekliyor. NORMAL bir `send()` çağrısında bu
     *  doğrudur ve iyidir — gövde elde olduğu için toplam gerçek gövdeden
     *  hesaplanır.
     *
     *  ⚠️ AMA İMZALAMADA (`getSignedUrl`) GÖVDE YOKTUR. SDK toplamı BOŞ
     *     gövdeden hesaplayıp adrese gömüyor:
     *
     *         x-amz-checksum-crc32=AAAAAA%3D%3D      ← boş gövdenin CRC32'si
     *         x-amz-sdk-checksum-algorithm=CRC32
     *
     *     Tarayıcı o adrese GERÇEK dosyayı PUT ettiğinde R2 sağlamayı
     *     doğruluyor, tutmuyor ve isteği reddediyor. Canlıda ölçüldü: CORS ön
     *     uçuşu 204 geçiyor, ardından gerçek PUT düşüyor ve ekranda yalnızca
     *     "Beklenmeyen bir hata oluştu" görünüyor.
     *
     *  ⚠️ BU ARIZA `curl` İLE DE GÖRÜNMEZ: elle atılan bir PUT o sorgu
     *     parametrelerini taşımaz. Bu depoda "curl geçti, tarayıcı düştü"
     *     sınıfının DÖRDÜNCÜ örneği (öncekiler: r2.dev, `Secure` çerez, CORS).
     *
     *  `WHEN_REQUIRED`: sağlama yalnızca S3 API'sinin ZORUNLU tuttuğu
     *  işlemlerde eklenir (ör. `DeleteObjects`). Sıradan `PutObject` imzasına
     *  girmez, imzalı adres temiz kalır.
     *
     * ⚠️ VERİ BÜTÜNLÜĞÜ KAYBI DEĞİL: TLS zaten aktarımı bütünlük denetimiyle
     *    koruyor ve R2 nesneyi yazdıktan sonra ETag döndürüyor. Kaybedilen şey
     *    uçtan uca ek bir doğrulama katmanı; kazanılan şey ÇALIŞAN bir yükleme.
     */
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });

  const breaker = options.circuitBreaker ?? circuitFor('r2');
  const timeoutMs = options.timeoutMs;

  const call = async <T>(operation: string, key: string, fn: () => Promise<T>): Promise<T> =>
    resilient<T>(
      {
        provider: 'r2',
        operation,
        errorCode: 'UPSTREAM_UNAVAILABLE',
        // Depo işlemleri idempotent — anahtarın varlığı retry'ı açar.
        idempotencyKey: `${operation}:${key}`,
        circuitBreaker: breaker,
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      },
      fn,
    );

  return {
    name: 'r2',

    async putObject(input: R2PutInput): Promise<{ etag: string }> {
      return call('putObject', input.key, async () => {
        const response = (await client.send(
          new sdk.PutObjectCommand({
            Bucket: input.bucket,
            Key: input.key,
            Body: input.body,
            ContentType: input.contentType,
            ...(input.cacheControl ? { CacheControl: input.cacheControl } : {}),
            ...(input.metadata ? { Metadata: input.metadata } : {}),
            // ⚠️ ACL GEÇİLMİYOR. Erişim kova politikasıyla yönetilir; nesne
            //    başına ACL yazılsaydı tek bir "public-read" satırı private
            //    kovadaki bir fotoğrafı herkese açardı.
          }),
        )) as { ETag?: string };
        return { etag: response.ETag ?? '' };
      });
    },

    async getObject(bucket: string, key: string): Promise<Buffer> {
      return call('getObject', key, async () => {
        const response = (await client.send(
          new sdk.GetObjectCommand({ Bucket: bucket, Key: key }),
        )) as GetObjectOutputLike;

        if (!response.Body) {
          throw appError('NOT_FOUND', {
            internalMessage: `R2 nesnesi boş gövde döndürdü: ${bucket}/${key}`,
          });
        }
        return Buffer.from(await response.Body.transformToByteArray());
      });
    },

    async deleteObject(bucket: string, key: string): Promise<void> {
      await call('deleteObject', key, async () => {
        // ⚠️ VersionId GÖNDERİLMİYOR — bkz. r2.driver.ts / sürümleme notu.
        await client.send(new sdk.DeleteObjectCommand({ Bucket: bucket, Key: key }));
      });
    },

    async deleteObjects(bucket: string, keys: readonly string[]): Promise<void> {
      if (keys.length === 0) return;
      if (keys.length > DELETE_BATCH_SIZE) {
        throw appError('INTERNAL_ERROR', {
          internalMessage: `Toplu silme sınırı aşıldı: ${keys.length} > ${DELETE_BATCH_SIZE}`,
        });
      }
      await call('deleteObjects', keys[0] ?? '', async () => {
        await client.send(
          new sdk.DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: keys.map((key) => ({ Key: key })), Quiet: true },
          }),
        );
      });
    },

    async headObject(bucket: string, key: string): Promise<R2HeadResult | null> {
      try {
        const response = (await call('headObject', key, () =>
          client.send(new sdk.HeadObjectCommand({ Bucket: bucket, Key: key })),
        )) as HeadObjectOutputLike;

        return {
          sizeBytes: response.ContentLength ?? 0,
          contentType: response.ContentType,
          etag: response.ETag ?? '',
        };
      } catch (error) {
        // "Yok" bir hata değil, bir cevaptır. `exists()` bunu false'a çevirir.
        // `resilient` sardığı için asıl hata `cause` içinde taşınır.
        if (isNotFound(error) || isNotFound((error as { cause?: unknown }).cause)) return null;
        throw error;
      }
    },

    async presign(input: R2PresignInput): Promise<string> {
      const command =
        input.operation === 'put'
          ? new sdk.PutObjectCommand({
              Bucket: input.bucket,
              Key: input.key,
              ...(input.contentType ? { ContentType: input.contentType } : {}),
              // Boyut imzanın parçası olur: istemci sözünden büyük bir gövde
              // gönderirse S3 imzayı doğrulayamaz ve yükleme reddedilir.
              ...(input.contentLength === undefined ? {} : { ContentLength: input.contentLength }),
            })
          : new sdk.GetObjectCommand({ Bucket: input.bucket, Key: input.key });

      // İmzalama yerel bir işlemdir (ağ çağrısı yok) — resilient sarılmaz.
      return sdk.getSignedUrl(client, command, { expiresIn: input.expiresInSeconds });
    },
  };
}
