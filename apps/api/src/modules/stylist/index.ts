import { Module } from '@nestjs/common';
import { env, type Env } from '@vt/config';
import { isStylistLlmConfigured, logProviderWiring } from '@vt/adapters';
import { PrismaService } from '../../infra/prisma.service.js';
import { RedisService } from '../../infra/redis.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import type { Logger } from '../../common/logger.js';
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
import { createAnthropicStylistProvider } from './llm/anthropic-llm.bridge.js';
import {
  AI_USAGE_PORT,
  LLM_PROVIDER,
  TRYON_PORT,
  USER_PROFILE_PORT,
  type LlmProvider,
} from './stylist.ports.js';

/**
 * STİL DANIŞMANI LLM FABRİKASI
 *
 * ⚠️ ZARİF DÜŞÜŞ (fail-closed ama YAYILMAYAN). ANTHROPIC_API_KEY yoksa
 *    `UnavailableLlmProvider` bağlanır: `isConfigured` false olduğu için servis
 *    sağlayıcıya HİÇ çağrı yapmadan STYLIST_UNAVAILABLE (503) döner. Danışman
 *    kapalıyken kullanıcı gezinmeye, sepete atmaya ve satın almaya devam eder —
 *    buradaki eksiklik ticaret akışına yayılmaz.
 *
 * ⚠️ Yanlış olan seçenek "hazırım" deyip ilk kullanıcı mesajında patlamaktı:
 *    o durumda hata, kullanıcının konuşmayı yazdığı ana ertelenir ve maliyet
 *    defterine başarısız bir tur olarak düşer.
 */
export function createLlmProvider(config: Env = env()): LlmProvider {
  if (!isStylistLlmConfigured(config)) return createStylistLlmProvider();

  return createAnthropicStylistProvider({
    apiKey: config.ANTHROPIC_API_KEY,
    model: config.ANTHROPIC_MODEL,
  });
}

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
 * LLM sağlayıcısı da bir porttur ve ORTAMDAN seçilir: anahtar varsa gerçek
 * Anthropic adapter'ı (bkz. llm/anthropic-llm.bridge.ts), yoksa yer tutucu.
 */
@Module({
  imports: [CatalogModule, CartModule],
  controllers: [StylistController],
  providers: [
    {
      provide: LLM_PROVIDER,
      // Logger yalnızca açılış raporu için enjekte ediliyor.
      inject: [APP_LOGGER],
      useFactory: (logger: Logger): LlmProvider => {
        const config = env();
        logProviderWiring(logger, config);
        return createLlmProvider(config);
      },
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
// Sağlayıcı seçiminin iki ucu da dışa açık: testler ve teşhis, hangi ucun
// bağlandığını modülü ayağa kaldırmadan sorabilsin.
export {
  AnthropicStylistLlmProvider,
  createAnthropicStylistProvider,
} from './llm/anthropic-llm.bridge.js';
export { UnavailableLlmProvider, createStylistLlmProvider } from './llm/stylist-llm.provider.js';
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
