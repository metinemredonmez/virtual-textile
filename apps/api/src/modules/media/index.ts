import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import { MeMediaController, SellerMediaController } from './media.controller.js';
import { MediaService } from './media.service.js';
import { MediaProductService } from './media-product.service.js';
import { MEDIA_IMAGE_PROCESSOR, UnconfiguredImageProcessor } from './image-processor.js';
import { MEDIA_CATALOG, MEDIA_CONSENT, MEDIA_STORAGE } from './media.ports.js';
import {
  PrismaMediaCatalogBridge,
  PrismaMediaConsentBridge,
  UnconfiguredStorageProvider,
} from './media.bridges.js';

/**
 * MEDYA MODÜLÜ — görsel yükleme, EXIF temizliği, kalite ve try-on uygunluk skoru.
 *
 * Sahip olduğu tablo: `UserPhoto` (ai_user_photos).
 *
 * Başka modülün verisine erişim (kural 3):
 *   • ProductImage / Product → `MEDIA_CATALOG` portu, geçici Prisma köprüsü
 *   • ConsentRecord          → `MEDIA_CONSENT` portu, geçici Prisma köprüsü
 *
 * ⚠️ ENTEGRASYON AJANI İÇİN — dört iş:
 *
 *   1. Bu modülü `app.module.ts`'e ekleyin (bu ajan o dosyaya dokunmuyor).
 *
 *   2. `apps/api/package.json` → dependencies'e `"@vt/adapters": "workspace:*"`
 *      ve `"sharp": "^0.33"` ekleyin. İsteğe bağlı: `"blurhash"`.
 *      `packages/adapters/package.json` → `"@aws-sdk/client-s3"` ve
 *      `"@aws-sdk/s3-request-presigner"`.
 *
 *   3. MEDIA_STORAGE token'ını gerçek sağlayıcıya bağlayın:
 *
 *        import { R2StorageProvider, createAwsS3Driver, r2ConfigFromEnv } from '@vt/adapters';
 *        {
 *          provide: MEDIA_STORAGE,
 *          useFactory: () => {
 *            const config = r2ConfigFromEnv(env());
 *            return new R2StorageProvider(config, createAwsS3Driver(awsSdk, config));
 *          },
 *        }
 *
 *   4. MEDIA_IMAGE_PROCESSOR token'ını `SharpImageProcessor`'a bağlayın:
 *
 *        import sharp from 'sharp';
 *        { provide: MEDIA_IMAGE_PROCESSOR, useFactory: () => new SharpImageProcessor(sharp) }
 *
 *      ⚠️ 3 ve 4 yapılmadan modül AYAKTA ama KAPALIDIR: her yükleme isteği
 *         görünür biçimde hata verir. Bu bilinçli — yapılandırılmamış bir
 *         medya katmanının sessizce "başarılı" demesi, EXIF'i temizlenmemiş
 *         fotoğrafın depoya girmesi ya da silinmiş sanılan verinin durması
 *         demektir.
 *
 * ⚠️ ALTYAPI ŞARTI: private ve public kova AYRI olmalı ve iki kovada da
 *    SÜRÜMLEME (versioning) KAPALI olmalıdır. Sürümleme açıkken silme, nesneyi
 *    kaldırmaz; "sildim" denilen fotoğraf sürüm geçmişinde kalır ve KVKK silme
 *    taahhüdü sessizce ihlal edilir (bkz. r2.provider.ts).
 */
@Module({
  controllers: [SellerMediaController, MeMediaController],
  providers: [
    // ── Geçici köprüler (bkz. media.bridges.ts) ──
    {
      provide: MEDIA_CATALOG,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PrismaMediaCatalogBridge(prisma),
    },
    {
      provide: MEDIA_CONSENT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PrismaMediaConsentBridge(prisma),
    },

    // ── Bağlanmayı bekleyen dış bağımlılıklar (fail-closed) ──
    { provide: MEDIA_STORAGE, useClass: UnconfiguredStorageProvider },
    { provide: MEDIA_IMAGE_PROCESSOR, useClass: UnconfiguredImageProcessor },

    // ── Servisler ──
    {
      provide: MediaService,
      inject: [PrismaService, MEDIA_STORAGE, MEDIA_IMAGE_PROCESSOR, MEDIA_CONSENT, APP_LOGGER],
      useFactory: (...args: ConstructorParameters<typeof MediaService>) =>
        new MediaService(...args),
    },
    {
      provide: MediaProductService,
      inject: [MEDIA_STORAGE, MEDIA_IMAGE_PROCESSOR, MEDIA_CATALOG, APP_LOGGER],
      useFactory: (...args: ConstructorParameters<typeof MediaProductService>) =>
        new MediaProductService(...args),
    },
  ],
  // Sanal deneme modülü kullanıcı fotoğrafına `UserPhoto` tablosuna girmeden
  // erişebilsin diye servisler dışa açılıyor.
  exports: [MediaService, MediaProductService, MEDIA_STORAGE, MEDIA_IMAGE_PROCESSOR],
})
export class MediaModule {}

// ── Genel yüzey ───────────────────────────────────────────────────────────

export { MediaService, type UploadTicket, type UserPhotoView } from './media.service.js';
export {
  MediaProductService,
  type ProductImageConfirmResult,
  type ProductImageView,
} from './media-product.service.js';
export { MeMediaController, SellerMediaController } from './media.controller.js';

// Saf çekirdek — diğer modüller bu kuralları yeniden yazmasın.
export {
  scorePhotoQuality,
  isPhotoQualityAcceptable,
  PHOTO_QUALITY_WEIGHTS,
  type PhotoQualityInput,
  type PhotoQualityIssue,
  type PhotoQualityResult,
} from './photo-quality.js';

export {
  scoreTryOnReadiness,
  MIN_TRYON_READINESS_SCORE,
  TRYON_READINESS_WEIGHTS,
  type ReadinessAngle,
  type ReadinessImageFacts,
  type TryOnReadinessIssue,
  type TryOnReadinessResult,
  type TryOnSuggestion,
} from './tryon-readiness.js';

export {
  analyzeGrayscale,
  backgroundUniformity,
  meanLuminance,
  sharpness,
  subjectTouchesEdge,
  ANALYSIS_SIZE,
  type GrayscaleImage,
} from './image-analysis.js';

export { photoExpiresAt, requiresStorageConsent } from './photo-retention.js';
export { detectImageFormat, looksLikeItHasExif, type DetectedImageFormat } from './image-format.js';

export {
  MEDIA_IMAGE_PROCESSOR,
  UnconfiguredImageProcessor,
  type DerivedImage,
  type ImageAnalysis,
  type ImageProcessor,
  type ProcessedImage,
  type SanitizeOptions,
} from './image-processor.js';

export {
  SharpImageProcessor,
  type BlurhashEncoder,
  type SharpFactory,
  type SharpImageProcessorOptions,
  type SharpInstance,
} from './sharp-image-processor.js';

export * from './media.ports.js';
export * from './media.schema.js';
export {
  PrismaMediaCatalogBridge,
  PrismaMediaConsentBridge,
  UnconfiguredStorageProvider,
} from './media.bridges.js';
