import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import { AiController } from './ai.controller.js';
import { TryOnService } from './tryon.service.js';
import { SizeService } from './size.service.js';
import {
  LocalTryOnCacheKeyAdapter,
  PlaceholderTryOnStorageAdapter,
  PrismaBodyProfileAdapter,
  PrismaConsentAdapter,
  PrismaFitFeedbackAdapter,
  PrismaTryOnCatalogAdapter,
} from './ai.gateway.js';
import {
  BODY_PROFILE_PORT,
  CONSENT_PORT,
  FIT_FEEDBACK_PORT,
  TRYON_CACHE_KEY_PORT,
  TRYON_CATALOG_PORT,
  TRYON_STORAGE_PORT,
} from './ai.ports.js';

/**
 * AI MODÜLÜ
 *
 * Sahip olduğu tablolar: UserPhoto, TryOnJob, AiUsageLog.
 * Rıza (kullanıcı), varyant/ürün/beden tablosu (katalog) ve iade geri bildirimi
 * (sipariş) verisine yalnızca `ai.ports.ts`'deki dar arayüzlerden erişir.
 *
 * ⚠️ CANLIYA ÇIKMADAN ÖNCE: `TRYON_STORAGE_PORT` şu an imzalı URL üretemeyen
 *    bir yer tutucuya bağlı. Gerçek `StorageProvider` bağlanmadan sanal deneme
 *    sonucu kullanıcıya gösterilemez.
 */
@Module({
  controllers: [AiController],
  providers: [
    {
      provide: CONSENT_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PrismaConsentAdapter(prisma),
    },
    {
      provide: TRYON_CATALOG_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PrismaTryOnCatalogAdapter(prisma),
    },
    {
      provide: BODY_PROFILE_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PrismaBodyProfileAdapter(prisma),
    },
    {
      provide: FIT_FEEDBACK_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PrismaFitFeedbackAdapter(prisma),
    },
    {
      provide: TRYON_STORAGE_PORT,
      inject: [APP_LOGGER],
      useFactory: (...args: ConstructorParameters<typeof PlaceholderTryOnStorageAdapter>) =>
        new PlaceholderTryOnStorageAdapter(...args),
    },
    {
      // ⚠️ @vt/adapters `apps/api` bağımlılığı olduğunda burası doğrudan
      //    `tryOnCacheKey`'e bağlanmalı (bkz. ai.gateway.ts NEEDS-DEP notu).
      provide: TRYON_CACHE_KEY_PORT,
      useFactory: () => new LocalTryOnCacheKeyAdapter(),
    },
    {
      provide: TryOnService,
      inject: [
        PrismaService,
        CONSENT_PORT,
        TRYON_CATALOG_PORT,
        TRYON_STORAGE_PORT,
        TRYON_CACHE_KEY_PORT,
        APP_LOGGER,
      ],
      useFactory: (...args: ConstructorParameters<typeof TryOnService>) =>
        new TryOnService(...args),
    },
    {
      provide: SizeService,
      inject: [TRYON_CATALOG_PORT, BODY_PROFILE_PORT, FIT_FEEDBACK_PORT],
      useFactory: (...args: ConstructorParameters<typeof SizeService>) => new SizeService(...args),
    },
  ],
  // Ürün detayı ve stil danışmanı beden önerisini yeniden kullanacak;
  // AI tablolarına doğrudan erişmesinler diye servisler dışa açılıyor.
  exports: [TryOnService, SizeService],
})
export class AiModule {}

export { TryOnService } from './tryon.service.js';
export { SizeService } from './size.service.js';
export { recommendSize, orderSizes, SIZE_DISCLAIMER } from './size-engine.js';
export { evaluateTryOnConsent, latestConsentByType } from './consent.rules.js';
export type {
  SizeChart,
  SizeEngineInput,
  SizeEngineResult,
  SizeReason,
  BodyMeasurements,
  BrandFit,
  FitFeedbackSummary,
} from './size-engine.js';
export type { ConsentDecision, ConsentRecordLike } from './consent.rules.js';
export type { TryOnActor, TryOnCreateResult, TryOnJobView } from './tryon.service.js';
export type { SizeRecommendationView } from './size.service.js';
export type {
  BodyProfilePort,
  BodyProfileSnapshot,
  ConsentPort,
  FitFeedbackPort,
  ProductSizingSnapshot,
  TryOnCacheKeyPort,
  TryOnCatalogPort,
  TryOnStoragePort,
  TryOnVariantSnapshot,
} from './ai.ports.js';
export {
  BODY_PROFILE_PORT,
  CONSENT_PORT,
  FIT_FEEDBACK_PORT,
  TRYON_CACHE_KEY_PORT,
  TRYON_CATALOG_PORT,
  TRYON_STORAGE_PORT,
} from './ai.ports.js';
