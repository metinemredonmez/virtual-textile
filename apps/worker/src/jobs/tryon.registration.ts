import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import type { Logger } from 'pino';
import type { PrismaClient } from '@vt/db';
import {
  FalTryOnProvider,
  GeminiTryOnProvider,
  type StorageProvider,
  type TryOnProvider,
} from '@vt/adapters';
import { QUEUE } from '../queues.js';
import {
  TryOnProcessor,
  type ImageWatermarker,
  type ProviderInputUrlIssuer,
} from './tryon.processor.js';

/** `env().WORKER_ROLE` ile aynı küme. */
export type WorkerRole = 'core' | 'media' | 'all';

/**
 * AĞIR KUYRUĞU KİM TÜKETİR?
 *
 * ⚠️ 'core' rolü sanal deneme işi TÜKETMEZ. Rol ayrımının varlık sebebi tam
 *    olarak budur: try-on üretimi dakikalarca süren, dış API'ye bağlı bir iştir
 *    ve aynı proseste 10 saniyede bir çalışması gereken outbox dağıtıcısını
 *    aç bırakır. O zaman ödeme bildirimi görsel kuyruğunun arkasında bekler.
 *
 * ⚠️ Zamanlanmış işlerin gatelemesiyle SİMETRİK ama TERS yönlüdür
 *    (bkz. SchedulerService.runsCronJobs): cron'lar 'media'da çalışmaz,
 *    ağır kuyruk 'core'da tüketilmez. 'all' yalnızca yerel geliştirme içindir.
 */
export function consumesTryOnQueue(role: WorkerRole): boolean {
  return role === 'media' || role === 'all';
}

/** Sağlayıcı fabrikasının okuduğu env alanları. */
export interface TryOnProviderEnv {
  FAL_KEY: string;
  FAL_TRYON_MODEL: string;
  GOOGLE_AI_API_KEY: string;
  GOOGLE_AI_IMAGE_MODEL: string;
}

/**
 * FALLBACK ZİNCİRİ: fal (birincil) → gemini (yedek).
 *
 * ⚠️ ANAHTARI OLMAYAN SAĞLAYICI ZİNCİRE KONMAZ. Konsaydı her iş önce onu
 *    dener, 401 alır, gecikme ve gürültü üretir; üstelik `generateWithFallback`
 *    bunu geçici hata sayıp maliyet kaydı açar. Zincirde yalnızca gerçekten
 *    çağrılabilecek sağlayıcılar bulunur.
 *
 * Zincir boşsa iş kuyruğa alınır, denenir ve BAŞARISIZ yazılır — kullanıcının
 * kotası iade edilir (bkz. TryOnProcessor.fail). Sessizce beklemede kalmaz.
 */
export function createTryOnProviders(
  source: TryOnProviderEnv,
  logger: Logger,
): readonly TryOnProvider[] {
  const providers: TryOnProvider[] = [];

  if (source.FAL_KEY) {
    providers.push(new FalTryOnProvider({ apiKey: source.FAL_KEY, model: source.FAL_TRYON_MODEL }));
  }
  if (source.GOOGLE_AI_API_KEY) {
    providers.push(
      new GeminiTryOnProvider({
        apiKey: source.GOOGLE_AI_API_KEY,
        model: source.GOOGLE_AI_IMAGE_MODEL,
      }),
    );
  }

  if (providers.length === 0) {
    logger.warn(
      { queue: QUEUE.TRYON },
      'sanal deneme sağlayıcısı yapılandırılmadı — gelen işler başarısız olacak (kota iade edilir)',
    );
  }

  return providers;
}

export interface TryOnConsumerDeps {
  prisma: PrismaClient;
  connection: Redis;
  providers: readonly TryOnProvider[];
  watermarker: ImageWatermarker;
  storage: StorageProvider;
  urls: ProviderInputUrlIssuer;
  logger: Logger;
}

/**
 * QUEUE.TRYON TÜKETİCİSİNİN ROL KAPISI
 *
 * `TryOnProcessor` kendi başına rol bilmez; `onModuleInit`te koşulsuz olarak
 * BullMQ `Worker`ı açar. Kapı burada tutuluyor ki işleyicinin kendisi
 * (rıza kontrolü, kota iadesi, filigran sırası) rol mantığıyla karışmasın.
 *
 * ⚠️ 'core' rolünde işleyici HİÇ KURULMAZ — yalnızca `onModuleInit`i atlamak
 *    yetmezdi, çünkü BullMQ Worker'ı yapıcıda değil init'te açılıyor olsa da
 *    ileride bu değişirse sessizce ikinci bir tüketici doğardı. Nesne hiç
 *    yaratılmayınca böyle bir kaza mümkün değil.
 */
export class TryOnQueueConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly processor: TryOnProcessor | null;

  constructor(
    private readonly role: WorkerRole,
    deps: TryOnConsumerDeps,
    private readonly logger: Logger,
  ) {
    this.processor = consumesTryOnQueue(role)
      ? new TryOnProcessor(
          deps.prisma,
          deps.connection,
          deps.providers,
          deps.watermarker,
          deps.storage,
          deps.urls,
          deps.logger,
        )
      : null;
  }

  /** Bu proses kuyruğu tüketiyor mu? Sağlık raporu ve testler için. */
  get active(): boolean {
    return this.processor !== null;
  }

  onModuleInit(): void {
    if (!this.processor) {
      this.logger.info(
        { role: this.role, queue: QUEUE.TRYON },
        'Sanal deneme kuyruğu bu rolde tüketilmiyor',
      );
      return;
    }

    this.processor.onModuleInit();
    this.logger.info({ role: this.role, queue: QUEUE.TRYON }, 'Sanal deneme kuyruğu tüketiliyor');
  }

  async onModuleDestroy(): Promise<void> {
    await this.processor?.onModuleDestroy();
  }
}
