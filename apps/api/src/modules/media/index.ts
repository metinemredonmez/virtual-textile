import { Module } from '@nestjs/common';
import sharp from 'sharp';
import { encode as encodeBlurhash } from 'blurhash';
import { env, type Env } from '@vt/config';
import { logProviderWiring, r2StorageFromEnv } from '@vt/adapters';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import type { Logger } from '../../common/logger.js';
import { MeMediaController, SellerMediaController } from './media.controller.js';
import { MediaService } from './media.service.js';
import { MediaProductService } from './media-product.service.js';
import { MEDIA_IMAGE_PROCESSOR, type ImageProcessor } from './image-processor.js';
import {
  SharpImageProcessor,
  type BlurhashEncoder,
  type SharpFactory,
} from './sharp-image-processor.js';
import {
  MEDIA_CATALOG,
  MEDIA_CONSENT,
  MEDIA_STORAGE,
  type MediaStoragePort,
} from './media.ports.js';
import {
  PrismaMediaCatalogBridge,
  PrismaMediaConsentBridge,
  UnconfiguredStorageProvider,
} from './media.bridges.js';

/**
 * DEPOLAMA FABRİKASI
 *
 * ⚠️ FAIL-CLOSED. R2 kimlik bilgileri yoksa her çağrıda görünür hata veren yer
 *    tutucu bağlanır. Yapılandırılmamış bir deponun "yüklendi" ya da "sildim"
 *    demesi, ürün görselinin kaybolmasından çok daha kötüdür: kullanıcı
 *    fotoğrafının silindiğini sanması KVKK taahhüdünün sessizce ihlalidir.
 *
 * ⚠️ Üretimde buranın yer tutucuya düşmesi bir YAPILANDIRMA HATASIDIR; ek
 *    kontrol yazılmıyor çünkü env şeması R2_ENDPOINT / R2_ACCESS_KEY_ID /
 *    R2_SECRET_ACCESS_KEY anahtarlarını üretimde zaten zorunlu kılıyor.
 *
 * ⚠️ ALTYAPI ŞARTI: private ve public kova AYRI olmalı ve iki kovada da
 *    SÜRÜMLEME (versioning) KAPALI olmalıdır. Sürümleme açıkken silme nesneyi
 *    kaldırmaz; "sildim" denilen fotoğraf sürüm geçmişinde kalır (bkz.
 *    r2.provider.ts). Bu, kodla kapatılabilecek bir açık değildir.
 */
export function createStorageProvider(config: Env = env()): MediaStoragePort {
  return r2StorageFromEnv(config) ?? new UnconfiguredStorageProvider();
}

/**
 * GÖRSEL İŞLEYİCİ FABRİKASI — KOŞULSUZ GERÇEK.
 *
 * ⚠️ Burada env'e BAKILMAZ ve bakılmamalıdır. `sharp` bir dış servis değil,
 *    kurulu bir kütüphanedir; anahtar gerektirmez. EXIF/GPS temizliği bu
 *    işleyicide yapıldığı için yapılandırmaya bağlanmış olsaydı, unutulan tek
 *    bir ortam değişkeni yüzünden kullanıcının ev konumunu taşıyan bir fotoğraf
 *    depoya girebilirdi. `UnconfiguredImageProcessor` artık hiçbir bağlamada
 *    kullanılmıyor; testlerin "işleyici yokken ne olur" senaryosunu kurabilmesi
 *    için dışa açık kalıyor.
 *
 * blurhash kodlayıcısı ARTIK GEÇİLİYOR (`blurhash` paketi kuruldu). Yokluğunda
 * `blurhash()` null dönmeye devam eder — yer tutucu bir kolaylıktır, güvenlik
 * gereği değil — ama artık `ProductImage.blurhash` gerçek değer alıyor.
 * Enjeksiyon korunuyor: `SharpImageProcessor` paketi kendisi import etmez, o
 * yüzden testler kodlayıcı olmadan da (null yolu) kurulabiliyor.
 */
export function createImageProcessor(): ImageProcessor {
  return new SharpImageProcessor(sharp as unknown as SharpFactory, {
    encodeBlurhash: encodeBlurhash as BlurhashEncoder,
  });
}

/**
 * MEDYA MODÜLÜ — görsel yükleme, EXIF temizliği, kalite ve try-on uygunluk skoru.
 *
 * Sahip olduğu tablo: `UserPhoto` (ai_user_photos).
 *
 * Başka modülün verisine erişim (kural 3):
 *   • ProductImage / Product → `MEDIA_CATALOG` portu, geçici Prisma köprüsü
 *   • ConsentRecord          → `MEDIA_CONSENT` portu, geçici Prisma köprüsü
 *
 * Sağlayıcı seçimi ORTAMDAN okunur (yukarıdaki fabrikalar): anahtar geldiğinde
 * deploy edilen şey yeni bir kod değil, yeni bir env'dir.
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

    // ── Dış bağımlılıklar — ortama göre gerçek ya da fail-closed yer tutucu ──
    {
      provide: MEDIA_STORAGE,
      // Logger yalnızca açılış raporu için: hangi yetenek gerçek, hangisi yer
      // tutucu — tek bir kayıtta, anahtar DEĞERLERİ yazılmadan.
      inject: [APP_LOGGER],
      useFactory: (logger: Logger): MediaStoragePort => {
        const config = env();
        logProviderWiring(logger, config);
        return createStorageProvider(config);
      },
    },
    { provide: MEDIA_IMAGE_PROCESSOR, useFactory: createImageProcessor },

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
