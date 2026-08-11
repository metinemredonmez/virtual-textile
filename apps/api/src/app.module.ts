import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR, APP_GUARD, Reflector } from '@nestjs/core';
import { InfraModule } from './infra/infra.module.js';
import { PrismaService } from './infra/prisma.service.js';
import { RedisService } from './infra/redis.service.js';
import { HealthController } from './modules/health/health.controller.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { CartModule } from './modules/cart/index.js';
import { CheckoutModule } from './modules/checkout/index.js';
import { OrderModule } from './modules/order/index.js';
import { SellerModule } from './modules/seller/index.js';
import { AdminModule } from './modules/admin/index.js';
import { MediaModule } from './modules/media/index.js';
import { AiModule } from './modules/ai/index.js';
import { StylistModule } from './modules/stylist/index.js';
import { EnvelopeInterceptor } from './common/interceptors/envelope.interceptor.js';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor.js';
import { RateLimitGuard } from './common/guards/rate-limit.guard.js';
import { requestContextMiddleware } from './common/middleware/request-context.middleware.js';

@Module({
  imports: [
    InfraModule,
    AuthModule,
    CatalogModule,
    // ── Ticaret ──
    CartModule,
    CheckoutModule,
    OrderModule,
    // ── Paneller ──
    SellerModule,
    AdminModule,
    // ── Medya ve yapay zekâ ──
    MediaModule,
    AiModule,
    StylistModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    {
      provide: APP_INTERCEPTOR,
      inject: [PrismaService, Reflector],
      useFactory: (prisma: PrismaService, reflector: Reflector) =>
        new IdempotencyInterceptor(prisma, reflector),
    },
    {
      provide: APP_GUARD,
      inject: [RedisService, Reflector],
      useFactory: (redis: RedisService, reflector: Reflector) =>
        new RateLimitGuard(redis, reflector),
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Nest 11 / path-to-regexp 8: joker karakter adlandırılmış olmalı ('*' değil).
    consumer.apply(requestContextMiddleware).forRoutes('{*path}');
  }
}
