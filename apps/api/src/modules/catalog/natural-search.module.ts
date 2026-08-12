import { Module } from '@nestjs/common';
import { env, type Env } from '@vt/config';
import { PrismaService } from '../../infra/prisma.service.js';
import { RedisService } from '../../infra/redis.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import type { Logger } from '../../common/logger.js';
import { CatalogModule } from './catalog.module.js';
// ⚠️ Servisler `import type` ile alınmaz: Nest'in DI belirteci SINIF
//    REFERANSIDIR, tip silinirse "bağımlılık çözümlenemedi" hatası çıkar.
import { CatalogService } from './catalog.service.js';
import { NaturalSearchController } from './natural-search.controller.js';
import { NaturalSearchService } from './natural-search.service.js';
import {
  PrismaCatalogVocabularyAdapter,
  PrismaSearchAiUsageAdapter,
  RedisSearchQuotaAdapter,
  createSearchIntentProvider,
} from './natural-search.gateway.js';
import {
  SEARCH_AI_USAGE_PORT,
  SEARCH_INTENT_PROVIDER,
  SEARCH_QUOTA_PORT,
  SEARCH_VOCABULARY_PORT,
  type SearchIntentProvider,
} from './natural-search.ports.js';

/**
 * DOĞAL DİLDE ARAMA MODÜLÜ
 *
 * ⚠️ `CatalogModule` DEĞİŞTİRİLMEDİ, İMPORT EDİLDİ. Doğal dil katmanı
 *    katalogun ÜSTÜNDE durur: arama mantığı `CatalogService.listProducts()`
 *    içinde kalır, buradaki kod yalnızca ona verilecek filtreyi üretir.
 *    Aynı sınır, yorumlama tamamen devre dışı kaldığında bile aramanın
 *    çalışmaya devam etmesinin sebebidir.
 *
 * ⚠️ ENTEGRASYON: bu modülün `apps/api/src/app.module.ts` içindeki `imports`
 *    dizisine eklenmesi gerekir (`CatalogModule` satırının hemen ardına).
 *    Bu ajan o dosyaya dokunmadı — üzerinde paralel çalışan başka ajanlar var.
 */
export function createIntentProvider(config: Env = env()): SearchIntentProvider {
  return createSearchIntentProvider({
    apiKey: config.ANTHROPIC_API_KEY,
    /**
     * ⚠️ MALİYET NOTU: burada stil danışmanının modeli kullanılıyor
     *    (ANTHROPIC_MODEL). Niyet çıkarımı, danışmanın yaptığı çok turlu
     *    muhakemenin yanında çok daha küçük bir iştir ve ucuz/hızlı bir model
     *    aynı işi yapar. Ayrı bir `ANTHROPIC_FAST_MODEL` değişkeni
     *    `packages/config` sahibinin kararıdır; eklendiğinde değişecek tek
     *    yer bu satırdır.
     */
    model: config.ANTHROPIC_MODEL,
  });
}

@Module({
  imports: [CatalogModule],
  controllers: [NaturalSearchController],
  providers: [
    {
      provide: SEARCH_INTENT_PROVIDER,
      useFactory: (): SearchIntentProvider => createIntentProvider(),
    },
    {
      provide: SEARCH_VOCABULARY_PORT,
      inject: [PrismaService, APP_LOGGER],
      useFactory: (prisma: PrismaService, logger: Logger) =>
        new PrismaCatalogVocabularyAdapter(prisma, logger),
    },
    {
      provide: SEARCH_QUOTA_PORT,
      inject: [RedisService, APP_LOGGER],
      useFactory: (redis: RedisService, logger: Logger) =>
        new RedisSearchQuotaAdapter(redis, logger),
    },
    {
      provide: SEARCH_AI_USAGE_PORT,
      inject: [PrismaService, APP_LOGGER],
      useFactory: (prisma: PrismaService, logger: Logger) =>
        new PrismaSearchAiUsageAdapter(prisma, logger),
    },
    {
      provide: NaturalSearchService,
      inject: [
        CatalogService,
        SEARCH_INTENT_PROVIDER,
        SEARCH_VOCABULARY_PORT,
        SEARCH_QUOTA_PORT,
        SEARCH_AI_USAGE_PORT,
        APP_LOGGER,
      ],
      useFactory: (...args: ConstructorParameters<typeof NaturalSearchService>) =>
        new NaturalSearchService(...args),
    },
  ],
  exports: [NaturalSearchService],
})
export class NaturalSearchModule {}

export { NaturalSearchService } from './natural-search.service.js';
export type { NaturalSearchInput, NaturalSearchResult } from './natural-search.service.js';
export {
  SEARCH_AI_USAGE_PORT,
  SEARCH_INTENT_PROVIDER,
  SEARCH_QUOTA_PORT,
  SEARCH_VOCABULARY_PORT,
} from './natural-search.ports.js';
export type {
  CatalogVocabulary,
  CatalogVocabularyPort,
  SearchAiUsagePort,
  SearchIntentProvider,
  SearchQuotaPort,
} from './natural-search.ports.js';
export { NATURAL_SEARCH } from '@vt/config';
