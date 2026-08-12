import { describe, expect, it, vi } from 'vitest';
import { UnrecoverableError } from 'bullmq';
import type { Logger } from 'pino';
import type { DomainEventJobData } from '../queues.js';
import {
  DomainEventFanout,
  consumesDomainEventQueue,
  type DomainEventHandler,
  type DomainEventHandlerName,
} from './domain-event.fanout.js';
import { MAX_EVENT_AGE_MS } from './notification.processor.js';
import {
  WardrobeAutoAddHandler,
  type DeliveredPackageView,
  type WardrobeAutoAddStore,
} from './wardrobe.auto-add.job.js';

/**
 * DOMAIN OLAY DAĞITICISI
 *
 * Sınanan güvenceler:
 *   1. Bayat olay kapısı KUYRUĞUN değil, İŞLEYİCİNİN kararıdır: 48 saatlik bir
 *      olayda bildirim atlanır, gardırop YİNE işlenir.
 *   2. Bir işleyicinin hatası diğerini düşürmez — ama sessizce de yutulmaz.
 *   3. Misafir siparişi (Order.userId null) hata değildir, sıfır komuttur.
 */

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

const DELIVERED_EVENT: DomainEventJobData = {
  outboxEventId: 'evt-1',
  aggregate: 'order',
  aggregateId: 'order-1',
  type: 'package.delivered',
  payload: {
    packageId: 'pkg-1',
    sellerId: 'seller-1',
    from: 'SHIPPED',
    to: 'DELIVERED',
    carrier: 'Aras Kargo',
    trackingNo: 'TR1',
  },
};

const ONE_HOUR = 60 * 60 * 1000;
const FORTY_EIGHT_HOURS = 48 * ONE_HOUR;

/** Tek giyilebilir kalemi olan paket. */
function fakeStore(overrides: Partial<DeliveredPackageView> = {}): WardrobeAutoAddStore {
  const view: DeliveredPackageView = {
    userId: 'u-1',
    items: [
      {
        orderItemId: 'oi-1',
        variantId: 'v-1',
        productTitle: 'Keten Gömlek',
        variantLabel: 'Beyaz / M',
        imageKey: 'products/p-1/i-1/800.webp',
        category: 'UPPER_BODY',
        color: 'Beyaz',
      },
    ],
    ...overrides,
  };

  return {
    deliveredPackage: vi.fn().mockResolvedValue(view),
    insertPurchasedIgnoringDuplicates: vi.fn(
      async (commands: readonly unknown[]) => commands.length,
    ),
  };
}

/** Bildirim tarafının ikizi — gerçek işleyici canlı Redis kuyruğu ister. */
function stubNotification(
  overrides: Partial<DomainEventHandler> = {},
): DomainEventHandler & { process: ReturnType<typeof vi.fn> } {
  return {
    maxEventAgeMs: MAX_EVENT_AGE_MS,
    process: vi.fn().mockResolvedValue({ enqueued: 2 }),
    ...overrides,
  } as DomainEventHandler & { process: ReturnType<typeof vi.fn> };
}

function makeFanout(
  handlers: Record<DomainEventHandlerName, DomainEventHandler>,
): DomainEventFanout {
  return new DomainEventFanout({} as never, handlers, silentLogger);
}

describe('domain olay dağıtıcısı — yaş kapısı işleyicinin kararı', () => {
  /**
   * ⚠️ ASIL AYRIM. Kapı `Worker` geri çağrımındayken kuyruğun TAMAMINA
   *    uygulanıyordu. Bir gün geç işlenen "kargoya verildi" SMS'i yanıltır —
   *    ama bir gün geç işlenen teslimat da kullanıcının dolabındadır. Kapı
   *    yeniden Worker düzeyine çıkarılırsa bu test kırmızı yanar.
   */
  it('48 saatlik olayda bildirim ATLANIR, gardırop YİNE işlenir', async () => {
    const notification = stubNotification();
    const store = fakeStore();
    const wardrobe = new WardrobeAutoAddHandler(store, silentLogger);
    const fanout = makeFanout({ notification, wardrobe });

    const outcomes = await fanout.dispatch(DELIVERED_EVENT, Date.now() - FORTY_EIGHT_HOURS);

    expect(outcomes).toEqual({ notification: 'stale', wardrobe: 'ok' });
    expect(notification.process).not.toHaveBeenCalled();
    expect(store.insertPurchasedIgnoringDuplicates).toHaveBeenCalledTimes(1);
  });

  it('gardırop işleyicisinin yaş sınırı YOKTUR (null), bildirimin 24 saattir', () => {
    const wardrobe = new WardrobeAutoAddHandler(fakeStore(), silentLogger);

    expect(wardrobe.maxEventAgeMs).toBeNull();
    expect(MAX_EVENT_AGE_MS).toBe(24 * ONE_HOUR);
  });

  it('taze olayda iki işleyici de çalışır', async () => {
    const notification = stubNotification();
    const wardrobe = new WardrobeAutoAddHandler(fakeStore(), silentLogger);

    const outcomes = await makeFanout({ notification, wardrobe }).dispatch(
      DELIVERED_EVENT,
      Date.now() - ONE_HOUR,
    );

    expect(outcomes).toEqual({ notification: 'ok', wardrobe: 'ok' });
    expect(notification.process).toHaveBeenCalledTimes(1);
  });
});

describe('domain olay dağıtıcısı — hata yalıtımı', () => {
  /**
   * ⚠️ Gardırop yazımının patlaması bildirimlerin gitmemesi anlamına
   *    GELMEMELİDİR. Tek bir try/catch zinciri kurulsaydı ilk hata ikinciyi
   *    hiç başlatmazdı.
   */
  it('gardırop patlarsa bildirim YİNE gönderilir — ve iş failed biter', async () => {
    const notification = stubNotification();
    const store = fakeStore();
    vi.mocked(store.insertPurchasedIgnoringDuplicates).mockRejectedValue(
      new Error('veritabanı erişilemiyor'),
    );
    const wardrobe = new WardrobeAutoAddHandler(store, silentLogger);

    const error = await makeFanout({ notification, wardrobe })
      .dispatch(DELIVERED_EVENT, Date.now())
      .catch((caught: unknown) => caught);

    expect(notification.process).toHaveBeenCalledTimes(1);
    // ⚠️ Sessizce yutulmaz: iş BullMQ'da `failed` olarak GÖRÜNÜR kalır.
    expect(error).toBeInstanceOf(Error);
  });

  it('bildirim patlarsa gardırop YİNE yazılır', async () => {
    const notification = stubNotification({
      process: vi.fn().mockRejectedValue(new Error('SMS sağlayıcısı yanıt vermiyor')),
    });
    const store = fakeStore();
    const wardrobe = new WardrobeAutoAddHandler(store, silentLogger);

    await makeFanout({ notification, wardrobe })
      .dispatch(DELIVERED_EVENT, Date.now())
      .catch(() => undefined);

    expect(store.insertPurchasedIgnoringDuplicates).toHaveBeenCalledTimes(1);
  });

  /**
   * ⚠️ Kalıcı hata denemeleri YAKMAZ. Ama geçici bir hata varsa iş tekrar
   *    denenmelidir: aksi hâlde kalıcı bir bildirim hatası, geçici bir
   *    veritabanı hatasından dolayı yazılamamış gardırop satırını da kalıcı
   *    olarak öldürürdü.
   */
  it('hataların HEPSİ kalıcıysa sonuç da kalıcıdır', async () => {
    const notification = stubNotification({
      process: vi.fn().mockRejectedValue(new UnrecoverableError('şablon değişkeni eksik')),
    });
    const store = fakeStore();
    vi.mocked(store.insertPurchasedIgnoringDuplicates).mockRejectedValue(
      new UnrecoverableError('kalem katalogda yok'),
    );
    const wardrobe = new WardrobeAutoAddHandler(store, silentLogger);

    const error = await makeFanout({ notification, wardrobe })
      .dispatch(DELIVERED_EVENT, Date.now())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UnrecoverableError);
  });

  it('hatalardan biri geçiciyse iş TEKRAR DENENİR', async () => {
    const notification = stubNotification({
      process: vi.fn().mockRejectedValue(new UnrecoverableError('şablon değişkeni eksik')),
    });
    const store = fakeStore();
    vi.mocked(store.insertPurchasedIgnoringDuplicates).mockRejectedValue(
      new Error('bağlantı zaman aşımı'),
    );
    const wardrobe = new WardrobeAutoAddHandler(store, silentLogger);

    const error = await makeFanout({ notification, wardrobe })
      .dispatch(DELIVERED_EVENT, Date.now())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(UnrecoverableError);
  });

  it('iki işleyici de başarılıysa hata fırlatılmaz', async () => {
    const outcomes = await makeFanout({
      notification: stubNotification(),
      wardrobe: new WardrobeAutoAddHandler(fakeStore(), silentLogger),
    }).dispatch(DELIVERED_EVENT, Date.now());

    expect(outcomes).toEqual({ notification: 'ok', wardrobe: 'ok' });
  });
});

describe('domain olay dağıtıcısı — misafir siparişi', () => {
  /**
   * ⚠️ `Order.userId` NULLABLE (misafir siparişi). Yazılacak dolap yoktur; bu
   *    bir hata DEĞİLDİR ve diğer işleyiciyi de düşürmemelidir.
   */
  it('misafir siparişinde komut üretilmez, hata da olmaz', async () => {
    const notification = stubNotification();
    const store = fakeStore({ userId: null });
    const wardrobe = new WardrobeAutoAddHandler(store, silentLogger);

    const outcomes = await makeFanout({ notification, wardrobe }).dispatch(
      DELIVERED_EVENT,
      Date.now(),
    );

    expect(outcomes).toEqual({ notification: 'ok', wardrobe: 'ok' });
    expect(store.insertPurchasedIgnoringDuplicates).not.toHaveBeenCalled();
  });
});

describe('domain olay dağıtıcısı — rol kapısı', () => {
  /** ⚠️ env.ts: "core → outbox, bildirim, zamanlanmış işler". */
  it('domain olayları core ve all rollerinde tüketilir, media rolünde tüketilmez', () => {
    expect(consumesDomainEventQueue('core')).toBe(true);
    expect(consumesDomainEventQueue('all')).toBe(true);
    expect(consumesDomainEventQueue('media')).toBe(false);
  });
});
