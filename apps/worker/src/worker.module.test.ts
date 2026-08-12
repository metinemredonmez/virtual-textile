import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Env } from '@vt/config';

/**
 * ═══════════════ BAĞLANTI DUMAN TESTİ — worker.module ═══════════════
 *
 * ⚠️⚠️ BU DOSYANIN VAR OLMA SEBEBİ — projede İKİ KEZ yaşanmış bir hata sınıfı:
 *
 *    1. `SIZE_LEARNING_PORT` opsiyonel parametre + null varsayılanla hiç
 *       enjekte edilmemişti; 990 test yeşilken beden sinyali motora hiç
 *       ulaşmıyordu.
 *    2. BullMQ `jobId` iki nokta kabul etmiyordu; 1113 test yeşilken TEK BİR
 *       bildirim bile gönderilmemişti.
 *
 *    Ortak nokta: birim testleri sahte nesnelerle çalıştığı için bağlantının
 *    KOPUK olduğunu göremez. Bu dosya sahte nesneyle değil, GERÇEK Nest
 *    grafiğiyle ilgilenir: `WorkerModule` derlenir, `init()` ile bütün
 *    `onModuleInit` kancaları GERÇEKTEN çalıştırılır ve şu üç şey ölçülür:
 *
 *      a) `DomainEventFanout` işleyicilerinin arkasında GERÇEK nesne var mı
 *         (kayıt anahtarının VARLIĞINI zaten derleme koruyor — bkz.
 *          worker.module.ts'teki `satisfies Record<...>`; burada ölçülen
 *          anahtarın DOLULUĞU),
 *      b) `QUEUE.DOMAIN_EVENT` üzerinde TAM OLARAK BİR `Worker` açılıyor mu,
 *      c) yaş kapısı kararları işleyicilerin üzerinde duruyor mu.
 *
 * ⚠️ `PrismaClient` ve `RedisConnection` override edilir; grafiğin GERİ KALANI
 *    gerçektir — ölçmek istediğimiz şey tam olarak o gerçek grafiktir.
 *    `bullmq` sahtelenir çünkü `Worker`/`Queue` yapıcıları canlı Redis ister;
 *    sahteleme aynı zamanda "kaç Worker açıldı" sorusunu ölçülebilir kılar.
 */

const { workerCalls, queueCalls } = vi.hoisted(() => ({
  workerCalls: [] as string[],
  queueCalls: [] as string[],
}));

vi.mock('bullmq', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bullmq')>();

  class FakeWorker {
    constructor(name: string) {
      workerCalls.push(name);
    }
    on(): this {
      return this;
    }
    close(): Promise<void> {
      return Promise.resolve();
    }
  }

  class FakeQueue {
    constructor(name: string) {
      queueCalls.push(name);
    }
    add(): Promise<void> {
      return Promise.resolve();
    }
    close(): Promise<void> {
      return Promise.resolve();
    }
  }

  return { ...actual, Worker: FakeWorker, Queue: FakeQueue };
});

/**
 * ⚠️ `env()` sahtelenmezse grafik açılışta eksik değişkende FIRLATIR. Buradaki
 *    değerler yalnızca grafiğin kurulmasını sağlar; sağlayıcı anahtarları
 *    KASITLI olarak verilmiyor — hepsi fail-closed yer tutucuya düşer.
 */
vi.mock('@vt/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vt/config')>();
  return {
    ...actual,
    env: (): Env =>
      ({
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        WORKER_ROLE: 'core',
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
        REDIS_URL: 'redis://localhost:6379',
      }) as Env,
  };
});

const { QUEUE } = await import('./queues.js');
const { WorkerModule } = await import('./worker.module.js');
const { PrismaClient } = await import('@vt/db');
const { RedisConnection } = await import('./infra.module.js');
const { SchedulerService } = await import('./scheduler.service.js');
const { DomainEventQueueConsumer } = await import('./jobs/domain-event.fanout.js');
type DomainEventHandler = import('./jobs/domain-event.fanout.js').DomainEventHandler;
const { WardrobeAutoAddHandler } = await import('./jobs/wardrobe.auto-add.job.js');
const { MAX_EVENT_AGE_MS, NotificationEventHandler, NotificationQueueConsumer } =
  await import('./jobs/notification.processor.js');

/**
 * ⚠️ Sahte Redis'in `connect`/`disconnect` metotları var: BullMQ bir bağlantı
 *    nesnesini bu iki metottan tanır. Olmasaydı onu "seçenek nesnesi" sanıp
 *    KENDİ canlı bağlantısını açardı.
 */
function fakeRedis(): unknown {
  return {
    connect: () => Promise.resolve(),
    disconnect: () => undefined,
    quit: () => Promise.resolve(),
    on: () => undefined,
    options: {},
  };
}

async function bootWorkerGraph(): Promise<TestingModule> {
  const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
    .overrideProvider(PrismaClient)
    .useValue({ $connect: () => Promise.resolve(), $disconnect: () => Promise.resolve() })
    .overrideProvider(RedisConnection)
    .useValue(fakeRedis())
    /**
     * ⚠️ `SchedulerService` bağımlılıklarını DEKORATÖR METADATA'sıyla alır
     *    (`design:paramtypes`). Vitest/esbuild `emitDecoratorMetadata`
     *    üretmez, dolayısıyla o metadata testte YOKTUR ve Nest sınıfı
     *    çözemez. Ölçtüğümüz şey zamanlayıcı değil; override edilip
     *    grafiğin geri kalanı GERÇEK bırakılıyor. (Yan fayda: cron'lar test
     *    sırasında hiç kurulmaz.)
     */
    .overrideProvider(SchedulerService)
    .useValue({})
    .compile();

  // ⚠️ `compile()` YETMEZ: `onModuleInit` kancaları yalnızca `init()` ile
  //    çalışır ve `Worker`lar orada açılır. Kablonun kurulduğu an burasıdır.
  await moduleRef.init();
  return moduleRef;
}

let moduleRef: TestingModule;

beforeEach(async () => {
  workerCalls.length = 0;
  queueCalls.length = 0;
  moduleRef = await bootWorkerGraph();
});

afterEach(async () => {
  await moduleRef.close();
});

describe('WorkerModule kablolaması — domain olay dağıtıcısı', () => {
  /**
   * ⚠️ ASIL TEST BUDUR. `handlers.wardrobe` anahtarının VAR OLDUĞUNU derleme
   *    koruyor; burada arkasında GERÇEK bir `WardrobeAutoAddHandler` olduğu
   *    ölçülüyor. `SIZE_LEARNING_PORT` dersi tam olarak buydu: anahtar vardı,
   *    arkasında null vardı, her şey yeşildi ve özellik ölüydü.
   */
  it('⚠️ gardırop işleyicisi GERÇEKTEN kabloda — arkasında gerçek nesne var', () => {
    const consumer = moduleRef.get(DomainEventQueueConsumer);
    const handlers = readHandlers(consumer);

    expect(handlers.wardrobe).toBeInstanceOf(WardrobeAutoAddHandler);
  });

  it('bildirim işleyicisi de aynı dağıtıcının arkasında — ikisi de kabloda', () => {
    const consumer = moduleRef.get(DomainEventQueueConsumer);
    const handlers = readHandlers(consumer);

    expect(handlers.notification).toBeInstanceOf(NotificationEventHandler);
    expect(Object.keys(handlers).sort()).toEqual(['notification', 'wardrobe']);
  });

  /**
   * ⚠️ Gardırop işleyicisinin deposu da GERÇEK olmalı. Port arkasına `null` ya
   *    da yarım bir nesne konsaydı yukarıdaki test yine geçerdi.
   */
  it('gardırop işleyicisinin deposu bağlı — okuma ve yazma yolu var', () => {
    const consumer = moduleRef.get(DomainEventQueueConsumer);
    const handler = readHandlers(consumer).wardrobe as unknown as Record<string, unknown>;
    const store = handler.store as Record<string, unknown> | null;

    expect(store).not.toBeNull();
    expect(typeof store?.deliveredPackage).toBe('function');
    expect(typeof store?.insertPurchasedIgnoringDuplicates).toBe('function');
  });

  /**
   * ⚠️⚠️ BullMQ bir işi TEK tüketiciye verir. `QUEUE.DOMAIN_EVENT` için ikinci
   *      bir `Worker` açılırsa olaylar ikisi arasında RASTGELE bölünür:
   *      bildirimlerin yarısı ve gardırop kayıtlarının yarısı sessizce
   *      kaybolur. Bu yasak bugüne kadar yalnızca YORUMLA korunuyordu
   *      (notification.processor.ts, data-export.job.ts).
   */
  it('⚠️ domain-event kuyruğunda TAM OLARAK BİR Worker açılır', () => {
    const domainEventWorkers = workerCalls.filter((name) => name === QUEUE.DOMAIN_EVENT);

    expect(domainEventWorkers).toHaveLength(1);
  });

  it('bildirim kuyruğunun tüketicisi ayrıca ayakta — dağıtıcı onu yutmadı', () => {
    expect(moduleRef.get(NotificationQueueConsumer).active).toBe(true);
    expect(workerCalls.filter((name) => name === QUEUE.NOTIFICATION)).toHaveLength(1);
  });

  /**
   * ⚠️ Bildirim işleyicisi Worker sahipliğini kaybetti ama ÜRETİCİ tarafını
   *    (QUEUE.NOTIFICATION kuyruğuna yazma) korumalı. Kuyruk kurulmazsa
   *    olaylardan bildirim işi hiç doğmaz — ve bu, dağıtıcı kusursuz çalışırken
   *    de olabilirdi.
   */
  it('bildirim işleyicisi notification kuyruğuna YAZABİLİR', () => {
    expect(queueCalls).toContain(QUEUE.NOTIFICATION);
  });

  /**
   * ⚠️ ZOMBİ PROSES KAPANI DA KABLODA OLMALI. Kod kuralı süreci kontrol edemez:
   *    bu depoda bir kez aynı kuyrukta ESKİ KODLU beş worker prosesi çalıştı ve
   *    olayları rastgele böldü — kaynak kusursuzdu, ÜRETİM değildi. Sayaç
   *    dağıtıcının arkasında değilse çalışma zamanı yine kör kalır.
   */
  it('⚠️ tüketici sayacı dağıtıcının arkasında — kuyruk gözleniyor', () => {
    const fanout = (moduleRef.get(DomainEventQueueConsumer) as unknown as { fanout: unknown })
      .fanout;
    const census = (fanout as { census: { count?: unknown } }).census;

    expect(typeof census.count).toBe('function');
  });
});

describe('WorkerModule kablolaması — yaş kapısı işleyicinin üzerinde', () => {
  /**
   * ⚠️ Kapı `Worker` geri çağrımına geri taşınırsa (bir "sadeleştirme" turunda)
   *    gardırop da 24 saatlik sınıra tabi olur ve bir gün geç işlenen teslimat
   *    kullanıcının dolabına HİÇ girmez. Karar burada, kabloda ölçülüyor.
   */
  it('gardırop yaş kapısı YOK (null), bildirim kapısı 24 saat', () => {
    const handlers = readHandlers(moduleRef.get(DomainEventQueueConsumer));

    expect(handlers.wardrobe.maxEventAgeMs).toBeNull();
    expect(handlers.notification.maxEventAgeMs).toBe(MAX_EVENT_AGE_MS);
  });
});

/** Dağıtıcının işleyici kaydını okur (özel alan — kablolama ölçümü için). */
function readHandlers(consumer: unknown): Record<string, DomainEventHandler> {
  const fanout = (consumer as { fanout: unknown }).fanout;
  expect(fanout).not.toBeNull();
  return (fanout as { handlers: Record<string, DomainEventHandler> }).handlers;
}
