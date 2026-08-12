import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR, APP_GUARD, Reflector } from '@nestjs/core';
import { InfraModule } from './infra/infra.module.js';
import { PrismaService } from './infra/prisma.service.js';
import { RedisService } from './infra/redis.service.js';
import { HealthController } from './modules/health/health.controller.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { MeModule } from './modules/me/index.js';
import { NotificationModule } from './modules/notification/index.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { NaturalSearchModule } from './modules/catalog/natural-search.module.js';
import { CartModule } from './modules/cart/index.js';
import { CheckoutModule } from './modules/checkout/index.js';
import { OrderModule } from './modules/order/index.js';
import { SellerModule } from './modules/seller/index.js';
import { AdminModule } from './modules/admin/index.js';
import { MediaModule } from './modules/media/index.js';
import { AiModule } from './modules/ai/index.js';
import { StylistModule } from './modules/stylist/index.js';
import { WardrobeModule } from './modules/wardrobe/index.js';
import { EnvelopeInterceptor } from './common/interceptors/envelope.interceptor.js';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor.js';
import { RateLimitGuard } from './common/guards/rate-limit.guard.js';
import { requestContextMiddleware } from './common/middleware/request-context.middleware.js';

@Module({
  imports: [
    InfraModule,
    // ⚠️ Bildirim modülü kökte AÇIKÇA bağlanır, yalnızca AuthModule üzerinden
    //    dolaylı olarak değil. Gerekçe: sağlayıcı fabrikaları açılışta bir kez
    //    çalışıp "hangi yetenek gerçek, hangisi yer tutucu" raporunu basıyor.
    //    Yalnızca AuthModule'e bağlı kalsaydı, o modül bir gün OTP'yi başka
    //    yoldan gönderdiğinde bildirim bağlaması sessizce kaybolurdu. Nest
    //    modülleri tekildir — iki yerde import edilmesi çift örnek üretmez.
    NotificationModule,
    AuthModule,
    // ⚠️ MeModule kökte AÇIKÇA bağlanır, yalnızca AuthModule üzerinden dolaylı
    //    olarak değil. AuthModule onu zaten import ediyor (başarılı girişte
    //    hesap silme talebini iptal etmek için), ama tek bağ o olsaydı KVKK
    //    md.11 uçları kimlik modülünün bir iç ayrıntısına asılmış olurdu:
    //    o import bir gün kalkarsa /v1/me/* sessizce 404'e döner.
    MeModule,
    CatalogModule,
    // ⚠️ NaturalSearchModule, CatalogModule'ün ÜSTÜNDE ayrı bir modüldür ve
    //    kökte AÇIKÇA bağlanır. Kendi içinde CatalogModule'ü import ediyor
    //    (arama mantığı `CatalogService.listProducts` içinde kalsın diye), ama
    //    tek bağ o olsaydı `POST /v1/search/natural` hiç yayına çıkmazdı:
    //    bir modül yalnızca başka bir modülü import etmekle kendi
    //    controller'ını kaydettirmez. Nest modülleri tekildir — CatalogModule'ün
    //    iki yerde import edilmesi ikinci bir CatalogService örneği üretmez.
    NaturalSearchModule,
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
    // ⚠️ WardrobeModule kökte AÇIKÇA bağlanır. Kendisi MediaModule,
    //    StylistModule ve AiModule'ü import ediyor ama TERSİ geçerli değil:
    //    hiçbir modül gardırobu import etmiyor, dolayısıyla burada
    //    bağlanmasaydı `/v1/wardrobe` uçları hiç yayına çıkmazdı. Bir modülün
    //    yazılmış, derlenmiş ve test edilmiş olması onu CANLI yapmaz — DI
    //    grafiğine girmesi yapar.
    WardrobeModule,
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
