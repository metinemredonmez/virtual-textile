/**
 * AI ADAPTER'LARI — dışa açılan yüzey
 *
 * ⚠️ Burada NestJS `@Module` TANIMLANMAZ. Bu paket (`@vt/adapters`) çerçeveden
 *    bağımsızdır: çalışma zamanı bağımlılığı yalnızca `@vt/config` ve
 *    `@vt/contracts`tır ve `@nestjs/common` bağımlılığı YOKTUR (yeni paket
 *    kurmak da bu görevin kapsamı dışında). Adapter'lar saf sınıflardır;
 *    NestJS sağlayıcı (provider) tanımları `apps/api` tarafında, DI'ın
 *    yaşadığı yerde yapılır.
 *
 *    Entegrasyon ajanı için beklenen bağlama:
 *      - `packages/adapters/src/index.ts` içine `export * from './ai/index.js';`
 *      - `apps/api` tarafında bir `AiModule`, aşağıdaki fabrikaları
 *        (`*FromEnv`) useFactory olarak sağlar.
 *
 * Sağlayıcı sırası (fallback zinciri):
 *   FalTryOnProvider → GeminiTryOnProvider
 * `generateWithFallback([fal, gemini], request)` ile kullanılır; kalıcı
 * hatalarda zincir kesilir (bkz. tryon.error-map.ts).
 */

export * from './ai-cost.js';
export * from './anthropic.js';
export * from './cache-key.js';
export * from './embedding.js';
export * from './fal.js';
export * from './gemini.js';
export * from './http.js';
export * from './llm.provider.js';
export * from './tryon.error-map.js';
export * from './tryon.factory.js';
export * from './tryon.metered.js';
export * from './tryon.provider.js';
export * from './tryon.quality.js';
