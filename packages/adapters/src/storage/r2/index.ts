/**
 * CLOUDFLARE R2 (S3 uyumlu) DEPOLAMA ADAPTER'I
 *
 * Kurulum:
 *   const driver   = createAwsS3Driver(sdk, config);   // aws-s3.driver.ts
 *   const storage  = new R2StorageProvider(config, driver);
 *
 * ⚠️ ENTEGRASYON AJANI İÇİN: `packages/adapters/src/index.ts` bu ajanın
 *    klasörü dışında olduğu için dokunulmadı. Barrel'a şu satır eklenmeli:
 *      export * from './storage/r2/index.js';
 */
export { R2StorageProvider } from './r2.provider.js';
export {
  bucketFor,
  assertVisibilityMatchesKey,
  resolveSignedUrlTtl,
  r2ConfigFromEnv,
  KNOWN_KEY_PREFIXES,
  MAX_SIGNED_URL_TTL_SECONDS,
  type R2Config,
} from './r2.config.js';
export {
  UnconfiguredR2Driver,
  DELETE_BATCH_SIZE,
  type R2Driver,
  type R2HeadResult,
  type R2PresignInput,
  type R2PutInput,
} from './r2.driver.js';
export {
  createAwsS3Driver,
  type AwsS3Sdk,
  type AwsS3DriverOptions,
  type S3ClientLike,
} from './aws-s3.driver.js';
export { createR2Storage, r2StorageFromEnv, resetR2Storage, type R2Env } from './r2.factory.js';
