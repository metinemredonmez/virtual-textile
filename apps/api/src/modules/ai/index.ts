import { Module } from '@nestjs/common';
import { env, type Env } from '@vt/config';
import {
  createTryOnProviders,
  logProviderWiring,
  r2StorageFromEnv,
  type StorageProvider,
  type TryOnProvider,
} from '@vt/adapters';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import type { Logger } from '../../common/logger.js';
import { AiController } from './ai.controller.js';
import { MultiTryOnController } from './multi-tryon.controller.js';
import { TryOnService } from './tryon.service.js';
import { MultiTryOnService } from './multi-tryon.service.js';
import { SizeService } from './size.service.js';
import {
  LocalTryOnCacheKeyAdapter,
  PlaceholderTryOnStorageAdapter,
  PrismaBodyProfileAdapter,
  PrismaConsentAdapter,
  PrismaFitFeedbackAdapter,
  PrismaTryOnCatalogAdapter,
} from './ai.gateway.js';
import { PrismaSizeLearningAdapter, SIZE_LEARNING_PORT } from './fit-learning.gateway.js';
import {
  BODY_PROFILE_PORT,
  CONSENT_PORT,
  FIT_FEEDBACK_PORT,
  TRYON_CACHE_KEY_PORT,
  TRYON_CATALOG_PORT,
  TRYON_STORAGE_PORT,
  type TryOnStoragePort,
} from './ai.ports.js';

/**
 * SANAL DENEME SAĞLAYICI ZİNCİRİ — DI belirteci.
 *
 * Üretimi yürüten taraf worker'dır; API bu zinciri yalnızca yayımlar ki
 * "hangi sağlayıcı yapılandırılmış" sorusunun cevabı tek yerde üretilsin ve
 * iki taraf farklı zincir kurmasın.
 */
export const TRYON_PROVIDERS = 'AI_TRYON_PROVIDERS';

/**
 * ⚠️ FAIL-CLOSED. FAL_KEY de GOOGLE_AI_API_KEY de yoksa zincir tek elemanlıdır
 *    ve o eleman çağrıldığında hata fırlatır. Sahte bir "başarılı" sonuç,
 *    kullanıcıya üzerinde ürün olmayan bir görsel göstermek ve kotasını
 *    harcamak olurdu.
 *
 * Zincire yalnızca YAPILANDIRILMIŞ sağlayıcılar girer: anahtarsız bir sağlayıcı
 * listede kalsaydı her üretim önce onun 401'ini bekler, sonra yedeğe düşerdi.
 */
export function createTryOnProviderChain(config: Env = env()): readonly TryOnProvider[] {
  return createTryOnProviders(config);
}

/**
 * Sanal deneme sonucunun imzalı adresini üretir.
 *
 * ⚠️ Sonuç görseli private kovadadır ve kullanıcının vücut görüntüsünü taşır;
 *    adres kısa ömürlüdür ve tavanı `SIGNED_URL_TTL_SECONDS.tryOnResult` ile
 *    depolama katmanında ayrıca sınırlanır (bkz. r2.config.ts) — çağıran taraf
 *    daha uzun bir süre isteyemez.
 *
 * ⚠️ Hata YUTULMAZ. Port sözleşmesinde `null` "görsel yok" demektir; imza
 *    üretilemediğinde null dönmek, var olan bir sonucu yokmuş gibi göstermek
 *    ve depolama kesintisini sessizce gizlemek olurdu.
 */
class SignedUrlTryOnStorageAdapter implements TryOnStoragePort {
  constructor(private readonly storage: StorageProvider) {}

  signedResultUrl(resultKey: string, expiresInSeconds: number): Promise<string | null> {
    return this.storage.signedUrl({
      key: resultKey,
      visibility: 'private',
      operation: 'get',
      expiresInSeconds,
    });
  }
}

/**
 * AI MODÜLÜ
 *
 * Sahip olduğu tablolar: UserPhoto, TryOnJob, AiUsageLog.
 * Rıza (kullanıcı), varyant/ürün/beden tablosu (katalog) ve iade geri bildirimi
 * (sipariş) verisine yalnızca `ai.ports.ts`'deki dar arayüzlerden erişir.
 *
 * Dış sağlayıcılar ORTAMDAN seçilir: anahtar varsa gerçek adapter, yoksa
 * fail-closed yer tutucu. Anahtar geldiğinde kod değil env değişir.
 */
@Module({
  controllers: [AiController, MultiTryOnController],
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
      useFactory: (logger: Logger): TryOnStoragePort => {
        const config = env();
        logProviderWiring(logger, config);

        // ⚠️ Depo yapılandırılmamışsa yer tutucu: uyarı yazar ve `null` döner.
        //    Sanal deneme sonucu görünmez ama uygulama açılır ve ticaret akışı
        //    çalışmaya devam eder — burada fail-closed olan şey görselin
        //    gösterilmemesidir, akışın kesilmesi değil.
        const storage = r2StorageFromEnv(config);
        return storage === null
          ? new PlaceholderTryOnStorageAdapter(logger)
          : new SignedUrlTryOnStorageAdapter(storage);
      },
    },
    {
      // ⚠️ Burası doğrudan `tryOnCacheKey`'e bağlanmalı: @vt/adapters ARTIK
      //    bağımlılık (bu dosya zaten ondan import ediyor), yani kopyayı
      //    ayakta tutan engel kalktı. Devrin neden bu ajanda yapılmadığı ve
      //    testlerin ne olacağı için bkz. ai.gateway.ts → TODO(kod-gerekli).
      provide: TRYON_CACHE_KEY_PORT,
      useFactory: () => new LocalTryOnCacheKeyAdapter(),
    },
    {
      provide: TRYON_PROVIDERS,
      useFactory: (): readonly TryOnProvider[] => createTryOnProviderChain(env()),
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
      /**
       * KOMBİN (ÇOKLU ÜRÜN) DENEME SERVİSİ
       *
       * ⚠️ Önbellek anahtarı için TRYON_CACHE_KEY_PORT'a bağlanmaz: port tek
       *    varyantlık sözleşmedir, kombin ÖNEK anahtarları üretir. Servis
       *    anahtarı doğrudan `@vt/adapters → outfitStepKeys` ile hesaplar —
       *    yani worker ile aynı fonksiyondan. Buraya ikinci bir yerel kopya
       *    koymak, `ai.gateway.ts`teki TODO'nun anlattığı hatayı tekrarlamak
       *    olurdu: iki yerde yaşayan bir özet fonksiyonu ayrışır ve
       *    ayrıştığında kimse fark etmez, yalnızca fatura artar.
       */
      provide: MultiTryOnService,
      inject: [PrismaService, CONSENT_PORT, TRYON_CATALOG_PORT, TRYON_STORAGE_PORT, APP_LOGGER],
      useFactory: (...args: ConstructorParameters<typeof MultiTryOnService>) =>
        new MultiTryOnService(...args),
    },
    {
      /**
       * ÖĞRENME KATMANININ VERİ KAYNAĞI — marka eğilimi + kişisel geçmiş.
       *
       * ⚠️ Ayrı bir belirteç, `FIT_FEEDBACK_PORT`'un üzerine binmiyor: o port
       *    TEK ürünün özetidir ve beden motorunun bugünkü sözleşmesidir.
       *    Buradaki iki sorgu MARKA ve KULLANICI düzeyinde çalışır, farklı
       *    tablolara dokunur ve farklı gizlilik kuralına tabidir.
       */
      provide: SIZE_LEARNING_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PrismaSizeLearningAdapter(prisma),
    },
    {
      /**
       * ⚠️ 4. bağımlılık (`SIZE_LEARNING_PORT`) sınıfta OPSİYONEL ve varsayılanı
       *    `null`. Bağlanmadığı sürece kod derleniyor ve testler geçiyordu, ama
       *    marka/kişisel sinyaller motora HİÇ AKMIYORDU — yani öğrenme katmanı
       *    yazılmış olmasına rağmen ölü koddu. Bu satır onu devreye alır.
       */
      provide: SizeService,
      inject: [TRYON_CATALOG_PORT, BODY_PROFILE_PORT, FIT_FEEDBACK_PORT, SIZE_LEARNING_PORT],
      useFactory: (...args: ConstructorParameters<typeof SizeService>) => new SizeService(...args),
    },
  ],
  // Ürün detayı ve stil danışmanı beden önerisini yeniden kullanacak;
  // AI tablolarına doğrudan erişmesinler diye servisler dışa açılıyor.
  // Sağlayıcı zinciri de dışa açık: üretimi yürüten taraf (worker) aynı
  // seçimi ikinci kez kurmasın.
  exports: [TryOnService, MultiTryOnService, SizeService, TRYON_PROVIDERS],
})
export class AiModule {}

export { TryOnService } from './tryon.service.js';
export { MultiTryOnService } from './multi-tryon.service.js';
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
export type { OutfitStepView, OutfitTryOnResult } from './multi-tryon.service.js';
export { outfitTryOnCreateSchema, type OutfitTryOnCreateInput } from './multi-tryon.schema.js';
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
