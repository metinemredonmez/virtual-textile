import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service.js';
import { RedisService } from '../../infra/redis.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { CatalogService } from '../catalog/catalog.service.js';
// ⚠️ Servisler `import type` ile alınmaz: Nest'in DI belirteci SINIF
//    REFERANSIDIR, tip silinirse "bağımlılık çözümlenemedi" hatası çıkar.
import { CartModule, OutfitService } from '../cart/index.js';
import { StylistController } from './stylist.controller.js';
import { StylistService } from './stylist.service.js';
import {
  PrismaAiUsageAdapter,
  PrismaUserProfileAdapter,
  TryOnHandoffAdapter,
} from './stylist.gateway.js';
import { createStylistLlmProvider } from './llm/stylist-llm.provider.js';
import { AI_USAGE_PORT, LLM_PROVIDER, TRYON_PORT, USER_PROFILE_PORT } from './stylist.ports.js';

/**
 * AI STİL DANIŞMANI MODÜLÜ
 *
 * Sahip olduğu tablolar: StylistConversation, StylistMessage.
 *
 * Katalog ve sepet verisine ilgili modüllerin SERVİSLERİ üzerinden erişir;
 * kendi Prisma sorgusunu yazmaz. Servisi henüz yayımlanmamış alanlar
 * (kullanıcı profili, sanal deneme, AI maliyet defteri) `stylist.ports.ts`
 * içindeki dar arayüzlerin arkasındadır — o modüller hazır olduğunda
 * AŞAĞIDAKİ PROVIDER SATIRLARI değişir, başka hiçbir dosyaya dokunulmaz.
 *
 * ⚠️ LLM sağlayıcısı da bir porttur. `@vt/adapters` bağımlılığı eklenene
 *    kadar `UnavailableLlmProvider` devreye girer ve /stylist uçları 503
 *    döner; uygulama yine açılır, ticaret akışı çalışır.
 */
@Module({
  imports: [CatalogModule, CartModule],
  controllers: [StylistController],
  providers: [
    {
      provide: LLM_PROVIDER,
      // ⚠️ Gerçek adapter (@vt/adapters → AnthropicLlmProvider) hazır ama
      //    apps/api ona henüz bağımlı değil. Bağımlılık eklendiğinde YALNIZCA
      //    bu fabrika değişir; bkz. llm/stylist-llm.provider.ts.
      useFactory: () => createStylistLlmProvider(),
    },
    {
      provide: USER_PROFILE_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PrismaUserProfileAdapter(prisma),
    },
    {
      provide: TRYON_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new TryOnHandoffAdapter(prisma),
    },
    {
      provide: AI_USAGE_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PrismaAiUsageAdapter(prisma),
    },
    {
      provide: StylistService,
      inject: [
        PrismaService,
        RedisService,
        CatalogService,
        OutfitService,
        LLM_PROVIDER,
        USER_PROFILE_PORT,
        TRYON_PORT,
        AI_USAGE_PORT,
        APP_LOGGER,
      ],
      useFactory: (...args: ConstructorParameters<typeof StylistService>) =>
        new StylistService(...args),
    },
  ],
  exports: [StylistService],
})
export class StylistModule {}

export { StylistService } from './stylist.service.js';
export type { ConversationView, StylistEvent, StylistEmit } from './stylist.service.js';
export { AI_USAGE_PORT, LLM_PROVIDER, TRYON_PORT, USER_PROFILE_PORT } from './stylist.ports.js';
export type {
  AiUsageEntry,
  AiUsagePort,
  LlmProvider,
  LlmStreamEvent,
  LlmTurnRequest,
  LlmTurnResult,
  StylistUserProfile,
  TryOnHandoff,
  TryOnPort,
  UserProfilePort,
} from './stylist.ports.js';
export { ACTIVE_PROMPT_VERSION } from './prompts/index.js';
