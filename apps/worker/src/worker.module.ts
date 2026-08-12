import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import sharp from 'sharp';
import type Redis from 'ioredis';
import type { Logger } from 'pino';
import { env } from '@vt/config';
import { PrismaClient } from '@vt/db';
import {
  NotificationSender,
  RedisNotificationDedupeStore,
  createEmailProvider,
  createSmsProvider,
  type StorageProvider,
  type TryOnProvider,
} from '@vt/adapters';
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
import {
  NotificationQueueConsumer,
  PrismaNotificationContacts,
  type NotificationContacts,
} from './jobs/notification.processor.js';

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

    /**
     * BİLDİRİM GÖNDERİCİSİ
     *
     * ⚠️ API ile AYNI sınıflar ve AYNI Redis anahtar ön eki kullanılır. İki
     *    taraf ayrı bir tekilleştirme deposu kullansaydı, API'nin gönderdiği
     *    mesajı kuyruk "görülmemiş" sayıp ikinci kez gönderebilirdi.
     *
     * ⚠️ Sağlayıcı seçimi ORTAMDAN okunur: anahtar yoksa geliştirmede konsol,
     *    ÜRETİMDE fail-closed (bkz. notification.factory.ts).
     */
    {
      provide: NotificationSender,
      inject: [RedisConnection, WORKER_LOGGER],
      useFactory: (redis: Redis, logger: Logger): NotificationSender => {
        const config = env();
        return new NotificationSender({
          sms: createSmsProvider(config),
          email: createEmailProvider(config),
          dedupe: new RedisNotificationDedupeStore(redis),
          logger,
        });
      },
    },

    {
      provide: PrismaNotificationContacts,
      inject: [PrismaClient],
      useFactory: (prisma: PrismaClient): NotificationContacts =>
        new PrismaNotificationContacts(prisma),
    },

    {
      provide: NotificationQueueConsumer,
      inject: [RedisConnection, NotificationSender, PrismaNotificationContacts, WORKER_LOGGER],
      useFactory: (
        connection: Redis,
        sender: NotificationSender,
        contacts: NotificationContacts,
        logger: Logger,
      ): NotificationQueueConsumer =>
        new NotificationQueueConsumer(
          env().WORKER_ROLE,
          { connection, sender, contacts, logger },
          logger,
        ),
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
