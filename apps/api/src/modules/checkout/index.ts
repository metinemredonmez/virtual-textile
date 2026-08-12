import { Module } from '@nestjs/common';
import { env, type Env } from '@vt/config';
import {
  IyzicoPaymentProvider,
  circuitFor,
  isPaymentConfigured,
  logProviderWiring,
} from '@vt/adapters';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import type { Logger } from '../../common/logger.js';
import { CheckoutController } from './checkout.controller.js';
import { CheckoutService } from './checkout.service.js';
import {
  PrismaAddressReaderBridge,
  PrismaCatalogReaderBridge,
  UnconfiguredPaymentProvider,
} from './checkout.bridges.js';
import {
  ADDRESS_READER,
  CATALOG_READER,
  PAYMENT_PROVIDER,
  type PaymentProviderPort,
} from './checkout.ports.js';
import { CartModule, CartService } from '../cart/index.js';
import { OrderModule, OrderService } from '../order/index.js';

export * from './checkout.ports.js';
export * from './checkout.schema.js';
export * from './checkout.constants.js';
export * from './commission.js';
// Alınamaz kalem detayının tipi istemci tarafında da kullanılır: hata
// yanıtındaki `details` bu şekle göre okunuyor.
export * from './cart-eligibility.js';
export * from './checkout.service.js';
export * from './checkout.controller.js';
export * from './checkout.bridges.js';
export { captureRawBody, RawBody, plainHeaders } from './raw-body.js';

/**
 * ÖDEME SAĞLAYICISI FABRİKASI
 *
 * ⚠️ FAIL-CLOSED. Anahtar yoksa gerçek sağlayıcı yerine her çağrıda GÖRÜNÜR
 *    hata veren yer tutucu bağlanır. Sessizce "başarılı" dönen sahte bir ödeme
 *    sağlayıcısı, bu sistemde yapılabilecek en tehlikeli şeydir: tahsil
 *    edilmemiş bir sipariş kargoya verilir ve fark ancak mutabakatta görülür.
 *
 * ⚠️ Üretimde (NODE_ENV=production) buranın yer tutucuya düşmesi bir
 *    YAPILANDIRMA HATASIDIR. Burada ayrıca kontrol edilmiyor: `@vt/config` env
 *    şeması IYZICO_API_KEY / IYZICO_SECRET_KEY / IYZICO_WEBHOOK_SECRET
 *    anahtarlarını üretimde zaten zorunlu kılıyor ve eksikse süreç hiç
 *    başlamıyor. İkinci bir kapı, ilkinin ne söylediğini belirsizleştirirdi.
 *
 * `config` parametresi varsayılanıyla `env()`'ten okur; testte seçim mantığı
 * ortam kurmadan doğrulanabilsin diye dışarıdan da verilebilir.
 */
export function createPaymentProvider(config: Env = env()): PaymentProviderPort {
  if (!isPaymentConfigured(config)) return new UnconfiguredPaymentProvider();

  return new IyzicoPaymentProvider({
    baseUrl: config.IYZICO_BASE_URL,
    apiKey: config.IYZICO_API_KEY,
    secretKey: config.IYZICO_SECRET_KEY,
    // ⚠️ Webhook HMAC anahtarı API secret'tan AYRIDIR; karıştırılırsa her
    //    sağlayıcı bildirimi geçersiz imza sayılır ve ödemeler askıda kalır.
    webhookSecret: config.IYZICO_WEBHOOK_SECRET,
    // Devre kesici sağlayıcı ADIYLA paylaşılır: iade ve hakediş çağrıları da
    // aynı devreyi görsün, biri açıkken diğeri çöken servise ısrar etmesin.
    circuitBreaker: circuitFor('iyzico'),
  });
}

/**
 * CHECKOUT MODÜLÜ
 *
 * Uçlar:
 *   POST /v1/checkout/init         → sepeti siparişe çevirir, stoğu rezerve eder
 *   POST /v1/checkout/pay          → 3DS başlatır (@Idempotent)
 *   POST /v1/payments/3ds/callback → banka dönüşü (@Public)
 *   POST /v1/webhooks/iyzico       → sağlayıcı bildirimi (@Public, ham gövde)
 *
 * ⚠️ `apps/api/src/main.ts` → `NestFactory.create(AppModule, { rawBody: true })`
 *    olmalıdır. Bu olmadan webhook ucu 500 döner (imza doğrulaması ATLANMAZ,
 *    bkz. raw-body.ts).
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
    {
      provide: PAYMENT_PROVIDER,
      // Logger yalnızca açılış raporu için enjekte ediliyor: hangi yeteneğin
      // gerçek, hangisinin yer tutucu olduğu tek bir kayıtta görünsün.
      inject: [APP_LOGGER],
      useFactory: (logger: Logger): PaymentProviderPort => {
        const config = env();
        logProviderWiring(logger, config);
        return createPaymentProvider(config);
      },
    },
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
