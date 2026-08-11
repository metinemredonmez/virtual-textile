import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import { CheckoutController } from './checkout.controller.js';
import { CheckoutService } from './checkout.service.js';
import {
  PrismaAddressReaderBridge,
  PrismaCatalogReaderBridge,
  UnconfiguredPaymentProvider,
} from './checkout.bridges.js';
import { ADDRESS_READER, CATALOG_READER, PAYMENT_PROVIDER } from './checkout.ports.js';
import { CartModule, CartService } from '../cart/index.js';
import { OrderModule, OrderService } from '../order/index.js';

export * from './checkout.ports.js';
export * from './checkout.schema.js';
export * from './checkout.constants.js';
export * from './commission.js';
export * from './checkout.service.js';
export * from './checkout.controller.js';
export * from './checkout.bridges.js';
export { captureRawBody, RawBody, plainHeaders } from './raw-body.js';

/**
 * CHECKOUT MODÜLÜ
 *
 * Uçlar:
 *   POST /v1/checkout/init         → sepeti siparişe çevirir, stoğu rezerve eder
 *   POST /v1/checkout/pay          → 3DS başlatır (@Idempotent)
 *   POST /v1/payments/3ds/callback → banka dönüşü (@Public)
 *   POST /v1/webhooks/iyzico       → sağlayıcı bildirimi (@Public, ham gövde)
 *
 * ⚠️ ENTEGRASYON AJANI İÇİN ÜÇ ADIM:
 *
 *  1. `apps/api/package.json` → dependencies'e `"@vt/adapters": "workspace:*"`
 *
 *  2. Bu modüldeki PAYMENT_PROVIDER bağlamasını gerçek adapter'a çevir:
 *
 *       {
 *         provide: PAYMENT_PROVIDER,
 *         useFactory: () => {
 *           const config = env();
 *           return new IyzicoPaymentProvider({
 *             baseUrl: config.IYZICO_BASE_URL,
 *             apiKey: config.IYZICO_API_KEY,
 *             secretKey: config.IYZICO_SECRET_KEY,
 *             webhookSecret: config.IYZICO_WEBHOOK_SECRET,
 *             circuitBreaker: circuitFor('iyzico'),
 *           });
 *         },
 *       }
 *
 *  3. `apps/api/src/main.ts` → `NestFactory.create(AppModule, { rawBody: true })`.
 *     Bu olmadan webhook ucu 500 döner (imza doğrulaması ATLANMAZ, bkz. raw-body.ts).
 *
 * Katalog/adres okuma köprüleri (`checkout.bridges.ts`) ilgili modüller
 * servislerini dışa açtığında token bağlamaları değiştirilerek SİLİNİR.
 * Sepet ve sipariş numarası zaten CartService / OrderService üzerinden geçiyor.
 */
@Module({
  // Sepet ve sipariş modüllerinin SERVİSLERİ kullanılır; tablolarına
  // dokunulmaz (kural 3).
  imports: [CartModule, OrderModule],
  controllers: [CheckoutController],
  providers: [
    { provide: PAYMENT_PROVIDER, useClass: UnconfiguredPaymentProvider },
    { provide: CATALOG_READER, useClass: PrismaCatalogReaderBridge },
    { provide: ADDRESS_READER, useClass: PrismaAddressReaderBridge },
    {
      provide: CheckoutService,
      inject: [
        PrismaService,
        APP_LOGGER,
        PAYMENT_PROVIDER,
        CartService,
        OrderService,
        CATALOG_READER,
        ADDRESS_READER,
      ],
      useFactory: (...args: ConstructorParameters<typeof CheckoutService>) =>
        new CheckoutService(...args),
    },
  ],
  exports: [CheckoutService],
})
export class CheckoutModule {}
