import { describe, expect, it, vi } from 'vitest';
import { UnrecoverableError } from 'bullmq';
import type { Logger } from 'pino';
import type { DomainEventJobData } from '../queues.js';
import {
  DomainEventFanout,
  consumesDomainEventQueue,
  type DispatchContext,
  type DomainEventConsumerCensus,
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
 *   4. TEKRAR DENEMEDE başarmış işleyici YENİDEN KOŞMAZ (yapısal idempotentlik;
 *      eskiden koruma yalnızca süreli tekilleştirme katmanlarındaydı).
 *   5. Kuyrukta beklenenden fazla tüketici varsa çalışma zamanı UYARIR.
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

/** Sabit sayı döndüren tüketici sayacı. */
function countingCensus(count: number): DomainEventConsumerCensus {
  return { count: vi.fn().mockResolvedValue(count) };
}

function makeFanout(
  handlers: Record<DomainEventHandlerName, DomainEventHandler>,
  census: DomainEventConsumerCensus = countingCensus(1),
): DomainEventFanout {
  return new DomainEventFanout({} as never, handlers, census, silentLogger);
}

/**
 * İLK DENEMENİN bağlamı.
 *
 * ⚠️ `alreadyDone` testte de AÇIKÇA yazılır. Yardımcı onu gizleseydi "önceki
 *    denemede ne başarılmıştı" sorusu testlerde de görünmez olurdu — oysa bu
 *    dosyadaki en yeni güvence tam olarak o sorudur.
 */
function firstAttempt(enqueuedAt: number): DispatchContext & { saved: string[][] } {
  return retryAfter(enqueuedAt, []);
}

/** TEKRAR DENEMENİN bağlamı: `alreadyDone` dolu gelir. */
function retryAfter(
  enqueuedAt: number,
  alreadyDone: readonly string[],
): DispatchContext & { saved: string[][] } {
  const saved: string[][] = [];
  return {
    enqueuedAt,
    alreadyDone,
    remember: async (names) => {
      saved.push([...names]);
      return Promise.resolve();
    },
    saved,
  };
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

    const outcomes = await fanout.dispatch(
      DELIVERED_EVENT,
      firstAttempt(Date.now() - FORTY_EIGHT_HOURS),
    );

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
      firstAttempt(Date.now() - ONE_HOUR),
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
      .dispatch(DELIVERED_EVENT, firstAttempt(Date.now()))
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
      .dispatch(DELIVERED_EVENT, firstAttempt(Date.now()))
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
      .dispatch(DELIVERED_EVENT, firstAttempt(Date.now()))
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
      .dispatch(DELIVERED_EVENT, firstAttempt(Date.now()))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(UnrecoverableError);
  });

  it('iki işleyici de başarılıysa hata fırlatılmaz', async () => {
    const outcomes = await makeFanout({
      notification: stubNotification(),
      wardrobe: new WardrobeAutoAddHandler(fakeStore(), silentLogger),
    }).dispatch(DELIVERED_EVENT, firstAttempt(Date.now()));

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
      firstAttempt(Date.now()),
    );

    expect(outcomes).toEqual({ notification: 'ok', wardrobe: 'ok' });
    expect(store.insertPurchasedIgnoringDuplicates).not.toHaveBeenCalled();
  });
});

describe('domain olay dağıtıcısı — tekrar denemede işleyici tekrarı', () => {
  /**
   * ⚠️ ASIL GÜVENCE. Eskiden bir işleyicinin hatası, BAŞARMIŞ olanı da 3 kez
   *    yeniden koşturuyordu; zarar görmemesi yalnızca alt katmanların
   *    tekilleştirmesine bağlıydı ve onların biri SÜRELİYDİ (BullMQ
   *    `removeOnComplete.age` = 24 saat, Redis dedupe TTL'i). Yani "güvenli"
   *    ifadesi yapısal değil, zamana bağlı bir iddiaydı.
   */
  it('⚠️ önceki denemede başaran işleyici YENİDEN ÇAĞRILMAZ', async () => {
    const notification = stubNotification();
    const store = fakeStore();
    const wardrobe = new WardrobeAutoAddHandler(store, silentLogger);

    const outcomes = await makeFanout({ notification, wardrobe }).dispatch(
      DELIVERED_EVENT,
      retryAfter(Date.now(), ['notification']),
    );

    expect(outcomes).toEqual({ notification: 'done', wardrobe: 'ok' });
    expect(notification.process).not.toHaveBeenCalled();
  });

  /** Başarı listesi FIRLATMADAN ÖNCE yazılmalı; sonra yazılsa hiç yazılmazdı. */
  it('hata varsa başaran işleyiciler işe kaydedilir', async () => {
    const notification = stubNotification();
    const store = fakeStore();
    vi.mocked(store.insertPurchasedIgnoringDuplicates).mockRejectedValue(
      new Error('veritabanı erişilemiyor'),
    );
    const wardrobe = new WardrobeAutoAddHandler(store, silentLogger);
    const context = firstAttempt(Date.now());

    await makeFanout({ notification, wardrobe })
      .dispatch(DELIVERED_EVENT, context)
      .catch(() => undefined);

    expect(context.saved).toEqual([['notification']]);
  });

  /** Her şey başarılıysa tekrar deneme olmayacaktır; Redis'e yazmanın anlamı yok. */
  it('hata yoksa işe hiçbir şey yazılmaz', async () => {
    const context = firstAttempt(Date.now());

    await makeFanout({
      notification: stubNotification(),
      wardrobe: new WardrobeAutoAddHandler(fakeStore(), silentLogger),
    }).dispatch(DELIVERED_EVENT, context);

    expect(context.saved).toEqual([]);
  });

  /**
   * ⚠️ 'stale' bir BAŞARI DEĞİL, atlanmış bir karardır. Listeye girseydi kapı
   *    bir daha hiç değerlendirilmezdi.
   */
  it('bayat sayılan işleyici tamamlanmış sayılmaz', async () => {
    const notification = stubNotification();
    const store = fakeStore();
    vi.mocked(store.insertPurchasedIgnoringDuplicates).mockRejectedValue(new Error('geçici'));
    const wardrobe = new WardrobeAutoAddHandler(store, silentLogger);
    const context = firstAttempt(Date.now() - FORTY_EIGHT_HOURS);

    await makeFanout({ notification, wardrobe })
      .dispatch(DELIVERED_EVENT, context)
      .catch(() => undefined);

    expect(context.saved).toEqual([[]]);
  });
});

describe('domain olay dağıtıcısı — zombi proses kapanı', () => {
  /**
   * ⚠️ ÖLÇÜLMÜŞ OLAY. Aynı kuyrukta eski kodlu beş worker prosesi çalışıyor ve
   *    olayları rastgele bölüyorlardı; çalışma zamanında bunu gören hiçbir şey
   *    yoktu, düzeltilen hata üretimde "düzelmemiş" görünüyordu.
   */
  it('⚠️ beklenenden fazla tüketici varsa UYARIR', async () => {
    const fanout = makeFanout(
      {
        notification: stubNotification(),
        wardrobe: new WardrobeAutoAddHandler(fakeStore(), silentLogger),
      },
      countingCensus(5),
    );
    vi.mocked(silentLogger.warn).mockClear();

    expect(await fanout.runCensus()).toBe(5);
    expect(silentLogger.warn).toHaveBeenCalledTimes(1);
  });

  it('tek tüketici normaldir — uyarı üretmez', async () => {
    const fanout = makeFanout({
      notification: stubNotification(),
      wardrobe: new WardrobeAutoAddHandler(fakeStore(), silentLogger),
    });
    vi.mocked(silentLogger.warn).mockClear();

    expect(await fanout.runCensus()).toBe(1);
    expect(silentLogger.warn).not.toHaveBeenCalled();
  });

  /** Sayım bir teşhis aracıdır: Redis aksarsa olay işleme DURMAMALIDIR. */
  it('sayım patlarsa hata fırlatmaz', async () => {
    const fanout = makeFanout(
      {
        notification: stubNotification(),
        wardrobe: new WardrobeAutoAddHandler(fakeStore(), silentLogger),
      },
      { count: vi.fn().mockRejectedValue(new Error('Redis yanıt vermiyor')) },
    );

    expect(await fanout.runCensus()).toBeNull();
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
