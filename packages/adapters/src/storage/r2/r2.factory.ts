import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { isStorageConfigured, type StorageKeys } from '../../wiring.js';
import type { StorageProvider } from '../storage.provider.js';
import { createAwsS3Driver, type AwsS3DriverOptions, type AwsS3Sdk } from './aws-s3.driver.js';
import { r2ConfigFromEnv, type R2Config } from './r2.config.js';
import { R2StorageProvider } from './r2.provider.js';

/**
 * R2 DEPOLAMA — AWS SDK'YI BAĞLAYAN FABRİKA
 *
 * `aws-s3.driver.ts` SDK'yı bilerek `import` etmez: kullandığı yüzeyi yapısal
 * bir arayüzle (`AwsS3Sdk`) tanımlayıp dışarıdan alır. Böylece testte sahte
 * sürücü geçilebiliyor ve "bir yerde ACL: public-read geçilmiş mi" sorusunun
 * cevabı tek dosyada okunabilir kalıyor. SDK'yı gerçekten `import` eden TEK
 * yer burasıdır.
 */

/**
 * ⚠️ TEK TİP DÖNÜŞÜMÜ — gerekçesi:
 *
 * `AwsS3Sdk` komut yapıcılarını `new (input: Record<string, unknown>) => object`
 * olarak tanımlar; SDK'nınkiler ise `new (input: PutObjectCommandInput) => …`
 * gibi DAR girdiler ister. Yapıcı parametreleri karşı-değişken (contravariant)
 * denetlendiği için dar girdili bir yapıcı, geniş girdili bir yapıcının yerine
 * geçemez ve dönüşüm olmadan atanamaz.
 *
 * Dönüşüm burada güvenlidir çünkü ÇAĞRI YERİ `aws-s3.driver.ts` içindedir ve
 * oradaki her komut, SDK'nın beklediği alanlarla (Bucket, Key, Body …) elle
 * kuruluyor. Kaybedilen tek şey, o dosyanın zaten yazdığı alan adlarının
 * derleyici tarafından ikinci kez doğrulanması.
 */
const awsSdk = {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  getSignedUrl,
} as unknown as AwsS3Sdk;

/** Verilen yapılandırmayla GERÇEK bir depolama sağlayıcısı kurar. */
export function createR2Storage(
  config: R2Config,
  options: AwsS3DriverOptions = {},
): StorageProvider {
  return new R2StorageProvider(config, createAwsS3Driver(awsSdk, config, options));
}

export type R2Env = StorageKeys & {
  R2_BUCKET_PUBLIC: string;
  R2_BUCKET_PRIVATE: string;
  R2_PUBLIC_URL: string;
};

let shared: StorageProvider | undefined;

/**
 * Ortamdan depolama sağlayıcısı — ANAHTAR YOKSA `null`.
 *
 * `null` dönmesi bir hata değil, bir CEVAPTIR: çağıran modül yerine kendi
 * fail-closed yer tutucusunu bağlar. Fabrikanın burada hata fırlatması,
 * anahtarsız bir geliştirme ortamında uygulamanın hiç açılmaması demekti;
 * oysa ticaret akışı depolama olmadan da çalışmalıdır.
 *
 * ⚠️ Süreç başına TEK ÖRNEK. `S3Client` kendi bağlantı havuzunu, sürücü ise
 *    kendi devre kesicisini taşır; her modülün ayrı örnek kurması havuzu böler
 *    ve devre kesici kararlarını ayrıştırır — bir taraf devreyi açarken diğeri
 *    aynı çöken servise istek göndermeye devam ederdi. Yapılandırma süreç
 *    genelinde zaten tek (env), bu yüzden örnek de tek.
 */
export function r2StorageFromEnv(config: R2Env): StorageProvider | null {
  if (!isStorageConfigured(config)) return null;
  shared ??= createR2Storage(r2ConfigFromEnv(config));
  return shared;
}

/** Yalnızca test için — paylaşılan örneği düşürür. */
export function resetR2Storage(): void {
  shared = undefined;
}
