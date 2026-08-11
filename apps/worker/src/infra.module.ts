import { Global, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import pino, { type Logger } from 'pino';
import { env } from '@vt/config';
import { appError } from '@vt/contracts';
import { createPrismaClient, PrismaClient } from '@vt/db';
import {
  isStorageConfigured,
  r2StorageFromEnv,
  type R2Env,
  type StorageProvider,
} from '@vt/adapters';
import { OutboxDispatcher } from './jobs/outbox.dispatcher.js';
import { PhotoRetentionJob, ReservationReleaseJob } from './jobs/photo-retention.job.js';

export const WORKER_LOGGER = 'WORKER_LOGGER';
export const STORAGE = 'STORAGE';
/** Depo durumu — sağlık raporu bunu okur (bkz. StorageStatus). */
export const STORAGE_STATUS = 'STORAGE_STATUS';

/**
 * Seçim TEK KEZ yapılır ve hem `STORAGE` hem `STORAGE_STATUS` aynı sonuçtan
 * türetilir. İki ayrı fabrika olsaydı sürücü iki kez kurulur ve rapor ile
 * fiilen kullanılan depo birbirinden ayrışabilirdi.
 */
const STORAGE_SELECTION = 'STORAGE_SELECTION';

/**
 * ⚠️ Dışa açık: `TryOnProcessor` gibi BullMQ tüketicileri bu bağlantıyı
 *    enjekte eder. Token olarak sınıfın kendisi kullanılır.
 */
@Injectable()
export class RedisConnection extends Redis implements OnModuleDestroy {
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

// ── Depo seçimi ────────────────────────────────────────────────────────────

/** Yer tutucuya düşme nedeni — sağlık raporunda görünür. */
export type StorageUnconfiguredReason = 'anahtar-yok' | 'kurulum-hatasi';

/**
 * DEPO DURUMU
 *
 * ⚠️ Buradaki asıl soru `configured` değil, `deleteWorks`. Yer tutucu depo
 *    "başarılı" döner ama nesneyi SİLMEZ; yani saklama süresi taahhüdü
 *    (KVKK m.7) fiilen yerine getirilmez ve kod tarafında her şey yolunda
 *    görünür. Bu ayrımı raporlamazsak kimse fark etmez.
 */
export interface StorageStatus {
  /** Bağlı sürücünün adı: 'r2' gerçek, 'placeholder' sahte. */
  readonly driver: string;
  /** Gerçek sürücü kuruldu mu? */
  readonly configured: boolean;
  /** ⚠️ `delete()` nesneyi GERÇEKTEN kaldırıyor mu? */
  readonly deleteWorks: boolean;
  /** Yapılandırılmadıysa nedeni, yapılandırıldıysa null. */
  readonly reason: StorageUnconfiguredReason | null;
}

export interface SelectedStorage {
  readonly storage: StorageProvider;
  readonly status: StorageStatus;
}

/**
 * Gerçek sürücüyü kuran fabrika. Varsayılanı `@vt/adapters` sağlar; testte
 * sahte bir fabrika geçilerek hata yolu denenebilir.
 *
 * ⚠️ SDK'yı `import` eden tek yer `@vt/adapters` içindeki `r2.factory.ts`dir.
 *    `@aws-sdk/*` paketleri o paketin bağımlılığıdır, `@vt/worker`ın DEĞİL;
 *    worker'dan doğrudan import edilseydi pnpm izole node_modules altında
 *    (node-linker=isolated) hiç çözülemezdi.
 */
export type R2StorageFactory = (source: R2Env) => StorageProvider | null;

/**
 * DEPO SEÇİMİ — anahtar varsa gerçek R2, yoksa yer tutucu.
 *
 * ⚠️ Bu seçim KVKK açısından kritiktir: yer tutucu `delete()` nesneyi SİLMEZ,
 *    yalnızca "silinmedi" loglar. Yani saklama süresi taahhüdü o sürücüyle
 *    fiilen yerine getirilmez. Anahtar geldiği anda karar otomatik olarak
 *    gerçek silmeye döner — kod değişikliği gerekmez, env yeter.
 *
 * ⚠️ Yer tutucuya düşülen HER durumda açılışta uyarı basılır. Sessiz kalmak,
 *    "fotoğrafınız silindi" denip silinmemesi demektir.
 */
export function selectStorage(
  source: R2Env,
  logger: Logger,
  createStorage: R2StorageFactory = r2StorageFromEnv,
): SelectedStorage {
  // Yüklem `@vt/adapters/wiring` içinde tek yerden tanımlı; worker kendi
  // "yapılandırıldı mı" kuralını yazsaydı iki taraf zamanla ayrışırdı.
  if (!isStorageConfigured(source)) {
    return placeholderSelection(logger, 'anahtar-yok');
  }

  try {
    const storage = createStorage(source);
    if (!storage) {
      // Fabrika da anahtar yok diyorsa yüklemler ayrışmış demektir; yine de
      // güvenli tarafta kal.
      return placeholderSelection(logger, 'anahtar-yok');
    }

    logger.info(
      { driver: storage.name, bucketPrivate: source.R2_BUCKET_PRIVATE },
      'Depo bağlandı — fotoğraf silme gerçek',
    );

    return {
      storage,
      status: { driver: storage.name, configured: true, deleteWorks: true, reason: null },
    };
  } catch (error) {
    // Sürücü kurulamadıysa proses yine de ayakta kalmalı: outbox, bildirim ve
    // rezervasyon işleri depodan bağımsız çalışır. Ama depo durumu "çalışmıyor"
    // olarak raporlanır ve fotoğraf temizliği kaydı silinmiş İŞARETLEMEZ
    // (bkz. PhotoRetentionJob — depo silme başarısızsa DB güncellenmez).
    logger.error({ err: error }, 'R2 depo sürücüsü kurulamadı — yer tutucuya düşülüyor');
    return placeholderSelection(logger, 'kurulum-hatasi');
  }
}

function placeholderSelection(logger: Logger, reason: StorageUnconfiguredReason): SelectedStorage {
  logger.warn({ reason }, 'depo yapılandırılmadı — fotoğraf silme çalışmıyor');
  const storage = createPlaceholderStorage(logger);
  return {
    storage,
    status: { driver: storage.name, configured: false, deleteWorks: false, reason },
  };
}

/**
 * ⚠️ YER TUTUCU DEPO — fotoğrafı SİLMEZ, yalnızca loglar.
 *
 * Yani saklama süresi taahhüdü bu sürücüyle YERİNE GETİRİLMİYOR. Yalnızca
 * R2 anahtarları yokken (yerel geliştirme, sözleşmesiz test ortamı) devreye
 * girer; anahtar geldiği anda `selectStorage` gerçek sürücüye geçer.
 *
 * Yazma/okuma işlemleri KASITLI olarak hata verir: "yazdım" deyip hiçbir yere
 * yazmayan bir depo, hata veren depodan çok daha pahalıdır.
 */
function createPlaceholderStorage(logger: Logger): StorageProvider {
  const notImplemented = (operation: string) => (): never => {
    throw appError('INTERNAL_ERROR', {
      internalMessage: `StorageProvider.${operation} yapılandırılmadı — R2 anahtarları eksik`,
    });
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
      provide: STORAGE_SELECTION,
      inject: [WORKER_LOGGER],
      useFactory: (logger: Logger): SelectedStorage => selectStorage(env(), logger),
    },
    {
      provide: STORAGE,
      inject: [STORAGE_SELECTION],
      useFactory: (selection: SelectedStorage): StorageProvider => selection.storage,
    },
    {
      provide: STORAGE_STATUS,
      inject: [STORAGE_SELECTION],
      useFactory: (selection: SelectedStorage): StorageStatus => selection.status,
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
    STORAGE_STATUS,
    OutboxDispatcher,
    PhotoRetentionJob,
    ReservationReleaseJob,
  ],
})
export class InfraModule {}
