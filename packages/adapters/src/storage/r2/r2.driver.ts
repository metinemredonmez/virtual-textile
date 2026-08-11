import { integrationError } from '@vt/contracts';

/**
 * S3 SÜRÜCÜSÜ — DAR YÜZEY
 *
 * `R2StorageProvider` iş kurallarını (kova seçimi, ömür tavanı, boyut kontrolü)
 * uygular; ağ ile konuşan tek şey bu arayüzdür. Ayrım iki işe yarıyor:
 *
 *  1. Sağlayıcı mantığı SDK olmadan test edilebilir (bkz. r2.test.ts).
 *  2. `@aws-sdk` bağımlılığı TEK dosyada kalır (aws-s3.driver.ts). SDK sürümü
 *     değişir veya başka bir S3 istemcisine geçilirse burası değişmez.
 *
 * ⚠️ Bu arayüzde `visibility` YOKTUR, sadece `bucket` vardır. Gizlilik kararı
 *    bir üst katmanda verilir ve buraya çözülmüş hâlde iner; sürücü politika
 *    bilmez, yalnızca yazar/okur.
 */

export interface R2PutInput {
  readonly bucket: string;
  readonly key: string;
  readonly body: Buffer;
  readonly contentType: string;
  readonly cacheControl?: string | undefined;
  readonly metadata?: Record<string, string> | undefined;
}

export interface R2PresignInput {
  readonly bucket: string;
  readonly key: string;
  readonly operation: 'get' | 'put';
  readonly expiresInSeconds: number;
  readonly contentType?: string | undefined;
  /**
   * İmzaya gömülen Content-Length.
   *
   * ⚠️ İstemcinin "10 MB göndereceğim" sözü bağlayıcı değildir; imzalı PUT'ta
   *    bu değer imzanın parçası olduğunda farklı boyutlu bir gövde S3
   *    tarafında REDDEDİLİR. Sözleşme sunucuda değil, imzada tutulur.
   */
  readonly contentLength?: number | undefined;
}

export interface R2HeadResult {
  readonly sizeBytes: number;
  readonly contentType: string | undefined;
  readonly etag: string;
}

export interface R2Driver {
  readonly name: string;

  putObject(input: R2PutInput): Promise<{ etag: string }>;
  getObject(bucket: string, key: string): Promise<Buffer>;
  /**
   * ⚠️ GERÇEK SİLME. Sürüm kimliği GÖNDERİLMEZ; kovada sürümleme (versioning)
   *    kapalı olduğu için bu çağrı nesneyi geri getirilemez biçimde kaldırır.
   *    Sürümleme açılırsa bu çağrı yalnızca "delete marker" bırakır ve
   *    KVKK silme taahhüdü sessizce ihlal edilir (bkz. r2.provider.ts).
   */
  deleteObject(bucket: string, key: string): Promise<void>;
  /** Toplu silme. Sağlayıcı sınırı gereği çağrı başına en fazla 1000 anahtar. */
  deleteObjects(bucket: string, keys: readonly string[]): Promise<void>;
  headObject(bucket: string, key: string): Promise<R2HeadResult | null>;
  presign(input: R2PresignInput): Promise<string>;
}

/** Sağlayıcı sınırı: DeleteObjects tek istekte en fazla bu kadar anahtar alır. */
export const DELETE_BATCH_SIZE = 1000;

/**
 * SÜRÜCÜ BAĞLANMAMIŞ.
 *
 * ⚠️ Sessizce başarılı DÖNMEZ. "Yüklendi" deyip hiçbir yere yazmayan bir depo,
 *    yükleme hatası veren depodan çok daha pahalıdır: ürün görselleri kayıp
 *    görünür, silme taahhüdü yerine getirilmiş sanılır ve kimse fark etmez.
 *    Her çağrı görünür biçimde hata verir.
 */
export class UnconfiguredR2Driver implements R2Driver {
  readonly name = 'r2-unconfigured';

  putObject(): Promise<{ etag: string }> {
    return Promise.reject(this.fail('putObject'));
  }
  getObject(): Promise<Buffer> {
    return Promise.reject(this.fail('getObject'));
  }
  deleteObject(): Promise<void> {
    return Promise.reject(this.fail('deleteObject'));
  }
  deleteObjects(): Promise<void> {
    return Promise.reject(this.fail('deleteObjects'));
  }
  headObject(): Promise<R2HeadResult | null> {
    return Promise.reject(this.fail('headObject'));
  }
  presign(): Promise<string> {
    return Promise.reject(this.fail('presign'));
  }

  private fail(operation: string): Error {
    return integrationError(
      'UPSTREAM_UNAVAILABLE',
      { provider: 'r2', operation },
      {
        internalMessage: `R2 sürücüsü bağlanmamış (${operation}) — createAwsS3Driver() ile AWS SDK geçilmeli`,
      },
    );
  }
}
