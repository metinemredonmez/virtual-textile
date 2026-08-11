import { Global, Module, type OnModuleDestroy } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import pino, { type Logger } from 'pino';
import { env } from '@vt/config';
import { createPrismaClient, PrismaClient } from '@vt/db';
import type { StorageProvider } from '@vt/adapters';
import { OutboxDispatcher } from './jobs/outbox.dispatcher.js';
import { PhotoRetentionJob, ReservationReleaseJob } from './jobs/photo-retention.job.js';

export const WORKER_LOGGER = 'WORKER_LOGGER';
export const STORAGE = 'STORAGE';

@Injectable()
class RedisConnection extends Redis implements OnModuleDestroy {
  constructor() {
    super(env().REDIS_URL, {
      // BullMQ blocking komutlar kullanır; null olmalı, aksi hâlde
      // uzun bekleyen tüketiciler zaman aşımıyla düşer.
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  async onModuleDestroy(): Promise<void> {
    await this.quit();
  }
}

/**
 * ⚠️ Depolama sağlayıcısı henüz uygulanmadı (R2/S3 adapter'ı yazılacak).
 * Bu geçici uygulama fotoğrafı SİLMEZ, yalnızca loglar — yani saklama süresi
 * taahhüdü HENÜZ YERİNE GETİRİLMİYOR. Canlıya çıkmadan önce gerçek adapter
 * bağlanmalıdır.
 */
function createPlaceholderStorage(logger: Logger): StorageProvider {
  const notImplemented = (operation: string) => (): never => {
    throw new Error(`StorageProvider.${operation} henüz uygulanmadı`);
  };
  return {
    name: 'placeholder',
    put: notImplemented('put'),
    get: notImplemented('get'),
    delete: (key) => {
      logger.warn({ key }, '⚠️ Depo adapter’ı yok — nesne SİLİNMEDİ');
      return Promise.resolve();
    },
    deleteMany: (keys) => {
      logger.warn({ count: keys.length }, '⚠️ Depo adapter’ı yok — nesneler SİLİNMEDİ');
      return Promise.resolve();
    },
    exists: () => Promise.resolve(false),
    signedUrl: notImplemented('signedUrl'),
    publicUrl: (key) => key,
  };
}

@Global()
@Module({
  providers: [
    { provide: RedisConnection, useClass: RedisConnection },
    {
      provide: WORKER_LOGGER,
      useFactory: (): Logger => {
        const config = env();
        return pino({
          level: config.LOG_LEVEL,
          base: { service: 'worker' },
          redact: {
            paths: ['*.password', '*.token', '*.apiKey', '*.secret', '*.iban', '*.otpCode'],
            censor: '[gizlendi]',
          },
          ...(config.NODE_ENV === 'development'
            ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
            : {}),
        });
      },
    },
    {
      provide: PrismaClient,
      useFactory: () => createPrismaClient({ databaseUrl: env().DATABASE_URL }),
    },
    {
      provide: STORAGE,
      inject: [WORKER_LOGGER],
      useFactory: (logger: Logger) => createPlaceholderStorage(logger),
    },
    {
      provide: OutboxDispatcher,
      inject: [PrismaClient, RedisConnection, WORKER_LOGGER],
      useFactory: (...args: ConstructorParameters<typeof OutboxDispatcher>) =>
        new OutboxDispatcher(...args),
    },
    {
      provide: PhotoRetentionJob,
      inject: [PrismaClient, STORAGE, WORKER_LOGGER],
      useFactory: (...args: ConstructorParameters<typeof PhotoRetentionJob>) =>
        new PhotoRetentionJob(...args),
    },
    {
      provide: ReservationReleaseJob,
      inject: [PrismaClient, WORKER_LOGGER],
      useFactory: (...args: ConstructorParameters<typeof ReservationReleaseJob>) =>
        new ReservationReleaseJob(...args),
    },
  ],
  exports: [
    RedisConnection,
    PrismaClient,
    WORKER_LOGGER,
    STORAGE,
    OutboxDispatcher,
    PhotoRetentionJob,
    ReservationReleaseJob,
  ],
})
export class InfraModule {}
