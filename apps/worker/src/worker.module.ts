import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import sharp from 'sharp';
import type Redis from 'ioredis';
import type { Logger } from 'pino';
import { env } from '@vt/config';
import { PrismaClient } from '@vt/db';
import type { StorageProvider, TryOnProvider } from '@vt/adapters';
import { InfraModule, RedisConnection, STORAGE, WORKER_LOGGER } from './infra.module.js';
import { SchedulerService } from './scheduler.service.js';
import {
  SignedUrlIssuer,
  TRYON_PROVIDERS,
  TRYON_URL_ISSUER,
  TRYON_WATERMARKER,
  type ImageWatermarker,
  type ProviderInputUrlIssuer,
} from './jobs/tryon.processor.js';
import { SharpWatermarker, type WatermarkSharpFactory } from './jobs/tryon.watermarker.js';
import { TryOnQueueConsumer, createTryOnProviders } from './jobs/tryon.registration.js';

/**
 * ⚠️ Rol okuması FABRİKA İÇİNDE yapılır, modül tanımında değil.
 *    Modül tanımı `import` anında çalışır; `main.ts` ise `loadEnv()`i
 *    bootstrap içinde çağırır. Rolü tanım anında okusaydık env doğrulaması
 *    henüz yapılmamış olurdu ve hata mesajı "hangi değişken eksik" yerine
 *    anlamsız bir yığın izi olurdu.
 */
@Module({
  imports: [ScheduleModule.forRoot(), InfraModule],
  providers: [
    SchedulerService,

    {
      provide: TRYON_PROVIDERS,
      inject: [WORKER_LOGGER],
      useFactory: (logger: Logger): readonly TryOnProvider[] => createTryOnProviders(env(), logger),
    },

    /**
     * FİLİGRAN — KOŞULSUZ GERÇEK.
     *
     * ⚠️ Burada env'e BAKILMAZ ve bakılmamalıdır. `sharp` bir dış servis değil,
     *    kurulu bir kütüphanedir; anahtar gerektirmez. Yasal uyarının
     *    eklenmesi bir ortam değişkenine bağlansaydı, unutulan tek bir satır
     *    uyarısız görsel üretirdi. (Aynı gerekçe: api → createImageProcessor.)
     *
     * Fail-closed davranış korunuyor: `SharpWatermarker` her hata yolunda
     * FIRLATIR — yazı tipi bulunamayıp metin boş rasterleşse bile. İşi
     * `TryOnProcessor` başarısız yazar ve kullanıcı kotasını iade eder.
     */
    {
      provide: TRYON_WATERMARKER,
      useFactory: (): ImageWatermarker =>
        new SharpWatermarker(sharp as unknown as WatermarkSharpFactory),
    },

    {
      provide: TRYON_URL_ISSUER,
      inject: [STORAGE, RedisConnection],
      useFactory: (storage: StorageProvider, redis: Redis): ProviderInputUrlIssuer =>
        new SignedUrlIssuer(storage, redis),
    },

    {
      provide: TryOnQueueConsumer,
      inject: [
        PrismaClient,
        RedisConnection,
        TRYON_PROVIDERS,
        TRYON_WATERMARKER,
        STORAGE,
        TRYON_URL_ISSUER,
        WORKER_LOGGER,
      ],
      useFactory: (
        prisma: PrismaClient,
        connection: Redis,
        providers: readonly TryOnProvider[],
        watermarker: ImageWatermarker,
        storage: StorageProvider,
        urls: ProviderInputUrlIssuer,
        logger: Logger,
      ): TryOnQueueConsumer =>
        new TryOnQueueConsumer(
          env().WORKER_ROLE,
          { prisma, connection, providers, watermarker, storage, urls, logger },
          logger,
        ),
    },
  ],
})
export class WorkerModule {}
