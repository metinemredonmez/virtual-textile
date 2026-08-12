import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import type Redis from 'ioredis';
import type { Logger } from 'pino';
import { CONCURRENCY, QUEUE, type DomainEventJobData } from '../queues.js';
import type { WorkerRole } from './notification.processor.js';

/**
 * DOMAIN OLAY DAĞITICISI (FANOUT)
 *
 * ⚠️⚠️ `QUEUE.DOMAIN_EVENT` ÜZERİNDEKİ TEK `Worker` BURADADIR.
 *      BullMQ bir işi yalnızca BİR tüketiciye verir; aynı kuyruğa ikinci bir
 *      `Worker` açılırsa olaylar ikisi arasında RASTGELE bölünür ve her iki
 *      yan etkinin de yarısı sessizce kaybolur. Bu yasak daha önce yalnızca
 *      YORUMLA korunuyordu (notification.processor.ts, data-export.job.ts);
 *      artık `worker.module.test.ts` içinde ölçülüyor.
 *
 *      Yeni bir yan etki (arama indeksi, muhasebe, webhook) ayrı bir tüketici
 *      olarak DEĞİL, buraya bir `DomainEventHandler` olarak eklenir.
 *
 *      ⚠️ AMA KOD KURALI SÜRECİ KONTROL EDEMEZ: bu depoda bir kez, aynı kuyrukta
 *      ESKİ KODLU beş worker prosesi çalıştı ve olayları rastgele böldü. Kaynak
 *      kusursuzdu, üretim değildi. `DomainEventConsumerCensus` bu yüzden var:
 *      tüketici sayısını Redis'ten OKUR ve beklenenden fazlaysa uyarır.
 *
 * ⚠️ İŞLEYİCİLER DİZİ DEĞİL, ADLANDIRILMIŞ KAYIT olarak alınır. Düz bir dizi
 *    kullanılsaydı bir işleyicinin kablodan düşmesini yalnızca test
 *    yakalayabilirdi; kayıt sayesinde DERLEME kırılır ("Property 'wardrobe' is
 *    missing"). Bu görevin varlık sebebi tam olarak "yazılmış ama bağlanmamış
 *    modül" hatasıdır — derlemeyle kapatılabilecek bir boşluğu teste bırakmak
 *    o hatayı tekrar davet etmek olurdu.
 */

/**
 * ⚠️ Ad listesi TİPTE tutulur. `Record<DomainEventHandlerName, ...>` yazan her
 *    yer (worker.module.ts kablolaması, aşağıdaki sıra tablosu) buraya yeni bir
 *    ad eklendiği anda derlemede kırılır.
 */
export type DomainEventHandlerName = 'notification' | 'wardrobe';

export interface DomainEventHandler {
  /**
   * Bu işleyicinin BAYAT OLAY SINIRI. `null` = sınır yok.
   *
   * ⚠️ ALAN ZORUNLUDUR; opsiyonel + "varsayılan 24 saat" YAPILMAMALIDIR.
   *    Opsiyonel olsaydı bir sonraki işleyiciyi yazan kişi kararı vermeyi
   *    unutur ve sessizce bildirim kuralını miras alırdı — bu, projeyi bir kez
   *    yakan `SIZE_LEARNING_PORT` hatasının tam şeklidir (opsiyonel parametre +
   *    zararsız görünen varsayılan).
   *
   * ⚠️ Kapı daha önce `Worker` geri çağrımının İÇİNDEYDİ, yani kuyruğun
   *    tamamına uygulanıyordu. İşleyiciye indirildi çünkü doğru cevap
   *    işleyiciye göre değişir (bkz. WardrobeAutoAddHandler).
   */
  readonly maxEventAgeMs: number | null;

  process(event: DomainEventJobData): Promise<unknown>;
}

/**
 * İŞLEYİCİ SIRASI — bildirim ÖNCE.
 *
 * Gecikmeye duyarlı olan bildirimdir: "siparişiniz kargoya verildi" SMS'i
 * saniyeler içinde gitmelidir, gardıroba satır düşmesi ise bir saniye
 * gecikebilir.
 *
 * ⚠️ `as const satisfies Record<DomainEventHandlerName, number>` — yeni bir
 *    işleyici adı eklenip buraya yazılmazsa DERLEME kırılır. Nesne yazım
 *    sırasına (`Object.keys` sonucuna) güvenmiyoruz: sıra bir çalışma zamanı
 *    tesadüfüdür, burada ise açık bir karardır.
 */
const HANDLER_ORDER = {
  notification: 0,
  wardrobe: 1,
} as const satisfies Record<DomainEventHandlerName, number>;

/**
 * Bir işleyicinin tek olaydaki akıbeti — log ve test için.
 *
 * `done` = bu denemede HİÇ ÇALIŞMADI, çünkü ÖNCEKİ denemede zaten başarmıştı.
 */
export type HandlerOutcome = 'ok' | 'stale' | 'failed' | 'done';

/**
 * Tek bir dağıtımın bağlamı.
 *
 * ⚠️ ÜÇ ALAN DA ZORUNLU, opsiyonel + "zararsız varsayılan" DEĞİL. `alreadyDone`
 *    opsiyonel olsaydı çağıran onu vermeyi unutur, kod derlenir ve tekrar
 *    denemede her işleyici baştan koşardı — yani düzeltilen hata sessizce geri
 *    gelirdi. Aynı ders: `SIZE_LEARNING_PORT`.
 */
export interface DispatchContext {
  /** İşin KUYRUĞA GİRDİĞİ an (`job.timestamp`). Bayat olay kapısı bunu ölçer. */
  readonly enqueuedAt: number;
  /** ÖNCEKİ denemede başarılı olmuş işleyiciler — bu turda hiç çağrılmazlar. */
  readonly alreadyDone: readonly string[];
  /**
   * Başarılı işleyicileri işin verisine KALICI yazar (`job.updateData`).
   *
   * ⚠️ Yalnızca en az bir hata varken çağrılır: iş tamamen başarılıysa tekrar
   *    denenmeyecektir ve Redis'e fazladan yazmanın anlamı yoktur.
   */
  readonly remember: (names: readonly DomainEventHandlerName[]) => Promise<void>;
}

/**
 * KUYRUK TÜKETİCİ SAYIMI — ZOMBİ PROSES KAPANI.
 *
 * ⚠️ Bu arayüzün var olma sebebi ölçülmüş bir olaydır: aynı kuyrukta ESKİ KODLU
 *    beş worker prosesi çalışıyordu ve olayları rastgele bölüyorlardı. BullMQ
 *    bir işi yalnızca BİR tüketiciye verir; yeni kodun düzelttiği hata,
 *    olayların %80'i eski prosese düştüğü için üretimde düzelmiş GÖRÜNMÜYORDU.
 *    Çalışma zamanında bunu gören hiçbir şey yoktu — ne log, ne sağlık raporu.
 *
 * ⚠️ Sayım Redis'in kendi istemci kaydından gelir (`Queue.getWorkersCount`),
 *    yani PROSESLERİ SAYAR, bizim beklentimizi değil. Kendi içinde tuttuğumuz
 *    bir sayaç zombiyi göremezdi: zombi bizim sayacımıza yazmaz.
 */
export interface DomainEventConsumerCensus {
  count(): Promise<number>;
}

/**
 * Beklenen tüketici sayısı.
 *
 * ⚠️ 1: `ecosystem.config.cjs` içinde `vt-worker-core` TEK ÖRNEK olarak
 *    tanımlıdır (zamanlanmış işler yalnızca o rolde çalışır, ikinci örnek aynı
 *    fotoğrafı iki kez silerdi). Domain olay kuyruğunu da yalnızca 'core' rolü
 *    tüketir. Yani 1'den fazlası ya zombi bir proses ya da yanlış bir dağıtımdır.
 *
 * ⚠️ Yeniden yükleme (`pm2 reload`) sırasında eski ve yeni proses kısa süre
 *    birlikte yaşayabilir; o anda tek bir uyarı satırı normaldir. UYARININ
 *    SÜREKLİ tekrarlaması normal değildir.
 */
const EXPECTED_CONSUMER_COUNT = 1;

/** Tüketici sayımı bu aralıkla tekrarlanır. */
const CENSUS_INTERVAL_MS = 5 * 60 * 1000;

export class DomainEventFanout {
  private worker?: Worker<DomainEventJobData>;
  private censusTimer?: NodeJS.Timeout;

  constructor(
    private readonly connection: Redis,
    private readonly handlers: Record<DomainEventHandlerName, DomainEventHandler>,
    private readonly census: DomainEventConsumerCensus,
    private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<DomainEventJobData>(
      QUEUE.DOMAIN_EVENT,
      /**
       * ⚠️ `job.timestamp` İŞİN KUYRUĞA GİRDİĞİ andır, `OutboxEvent.createdAt`
       *    DEĞİL. Yani ölçülen yaş "olay ne zaman doğdu" değil, "kuyrukta ne
       *    kadar bekledi"dir. Outbox satırının kendi yaşını
       *    `outbox.dispatcher.ts` ayrıca alarmlıyor (STALE_THRESHOLD_MS = 1sa).
       *    Bir gün gardıroba da yaş kapısı istenirse doğru saat
       *    `OutboxEvent.createdAt`tır ve payload'a taşınması gerekir.
       */
      async (job: Job<DomainEventJobData>) =>
        this.dispatch(job.data, {
          enqueuedAt: job.timestamp,
          /**
           * ⚠️ Önceki denemenin başarı listesi İŞİN KENDİSİNDE taşınır. Bellekte
           *    tutulamazdı: tekrar denemeyi başka bir proses alabilir.
           */
          alreadyDone: job.data.completedHandlers ?? [],
          remember: async (names) => {
            await job.updateData({ ...job.data, completedHandlers: [...names] });
          },
        }),
      { connection: this.connection, concurrency: CONCURRENCY[QUEUE.DOMAIN_EVENT] },
    );

    this.worker.on('failed', (job, error) => {
      /**
       * ⚠️ SON DENEME AYRI LOGLANIR. Aradaki denemeler gürültüdür — iş yeniden
       *    kuyruğa girer ve büyük ihtimalle başarır. Deneme hakkı BİTTİĞİNDE ise
       *    olay KALICI olarak kaybolmuştur: outbox satırı `publishedAt` dolu
       *    olduğu için dağıtıcı onu bir daha taşımaz. İki durumu aynı satırla
       *    loglamak, kalıcı kaybı geçici hata gürültüsünün içinde saklıyordu.
       *    (Kalıcı kayıplar ayrıca DB'ye yazılır: `OutboxDispatcher.auditDeadLetters`.)
       */
      const attempts = job?.opts.attempts ?? 1;
      const exhausted = job !== undefined && job.attemptsMade >= attempts;

      this.logger.error(
        {
          outboxEventId: job?.data.outboxEventId,
          type: job?.data.type,
          attemptsMade: job?.attemptsMade,
          attempts,
          err: error,
        },
        exhausted
          ? '⚠️ Domain olayı KALICI olarak kaybedildi — deneme hakkı bitti'
          : 'Domain olayı işlenemedi — tekrar denenecek',
      );
    });

    // ⚠️ İlk sayım hemen değil, worker Redis'e kaydolduktan sonra anlamlıdır;
    //    periyodik tur zaten kısa süre içinde ilkini yapar.
    this.censusTimer = setInterval(() => void this.runCensus(), CENSUS_INTERVAL_MS);
    // Sayım zamanlayıcısı prosesin kapanmasını GECİKTİRMEZ.
    this.censusTimer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.censusTimer) clearInterval(this.censusTimer);
    await this.worker?.close();
  }

  /**
   * Kuyrukta kaç tüketici olduğunu ölçer ve beklenenden fazlaysa uyarır.
   *
   * ⚠️ Hata FIRLATMAZ: sayım bir teşhis aracıdır, Redis'in `CLIENT LIST`
   *    cevabındaki bir aksaklık olay işlemeyi durdurmamalıdır.
   */
  async runCensus(): Promise<number | null> {
    try {
      const count = await this.census.count();

      if (count > EXPECTED_CONSUMER_COUNT) {
        this.logger.warn(
          { queue: QUEUE.DOMAIN_EVENT, consumers: count, expected: EXPECTED_CONSUMER_COUNT },
          '⚠️ Domain olay kuyruğunda beklenenden fazla tüketici var — olaylar prosesler arasında BÖLÜNÜYOR (zombi proses?)',
        );
      }

      return count;
    } catch (error) {
      this.logger.warn(
        { queue: QUEUE.DOMAIN_EVENT, err: error },
        'Tüketici sayımı yapılamadı — zombi proses kapanı bu turda kör',
      );
      return null;
    }
  }

  /**
   * Olayı bütün işleyicilere dağıtır.
   *
   * ⚠️ HATA YALITIMI: işleyiciler `allSettled` ile koşar. Biri patlarsa diğeri
   *    YİNE de çalışır — gardırop yazımının başarısız olması bildirimlerin
   *    gitmemesi anlamına gelmemelidir, tersi de doğrudur.
   *
   * ⚠️ AMA SESSİZCE YUTULMAZ: en az bir hata varsa iş FIRLATIR, böylece BullMQ
   *    onu `failed` sayar ve arıza kuyrukta GÖRÜNÜR kalır.
   *
   * ⚠️ TEKRAR DENEMEDE BAŞARILI İŞLEYİCİ YENİDEN KOŞMAZ. Eskiden bir işleyicinin
   *    hatası, başarmış olanı da 3 kez tekrar çalıştırıyordu ve zarar görmemesi
   *    yalnızca alt katmanların tekilleştirmesine bağlıydı — üstelik biri SÜRELİ:
   *      • bildirim: BullMQ `jobId` dedupe'u `removeOnComplete.age` (24 saat)
   *        sonrası kaybolur, gönderim dedupe kaydı da Redis'te TTL'lidir;
   *      • gardırop: UNIQUE(userId, sourceOrderItemId) — bu yapısaldır, süresiz.
   *    Yani güvenlik yapısal değil, ZAMANA BAĞLIYDI: yeniden denemeler saatlerce
   *    ertelendiğinde (gecikmeli kuyruk, elle `retry`) aynı SMS ikinci kez
   *    gidebilirdi. Artık başarmış işleyici işin verisine yazılır ve bir daha
   *    çağrılmaz; tekilleştirme katmanları ikinci savunma hattı olarak kalır.
   */
  async dispatch(
    event: DomainEventJobData,
    context: DispatchContext,
  ): Promise<Record<DomainEventHandlerName, HandlerOutcome>> {
    const age = Date.now() - context.enqueuedAt;
    const names = (Object.keys(this.handlers) as DomainEventHandlerName[]).sort(
      (a, b) => HANDLER_ORDER[a] - HANDLER_ORDER[b],
    );

    const outcomes = {} as Record<DomainEventHandlerName, HandlerOutcome>;
    const running: Array<{ name: DomainEventHandlerName; task: Promise<unknown> }> = [];

    for (const name of names) {
      const handler = this.handlers[name];

      if (context.alreadyDone.includes(name)) {
        outcomes[name] = 'done';
        continue;
      }

      if (handler.maxEventAgeMs !== null && age > handler.maxEventAgeMs) {
        outcomes[name] = 'stale';
        this.logger.warn(
          { outboxEventId: event.outboxEventId, type: event.type, ageMs: age, handler: name },
          'Bayat domain olayı — işleyici atlandı',
        );
        continue;
      }

      running.push({ name, task: handler.process(event) });
    }

    const settled = await Promise.allSettled(running.map((entry) => entry.task));

    const failures: Array<{ name: DomainEventHandlerName; error: unknown }> = [];
    for (const [index, result] of settled.entries()) {
      const name = running[index]!.name;
      if (result.status === 'fulfilled') {
        outcomes[name] = 'ok';
        continue;
      }
      outcomes[name] = 'failed';
      failures.push({ name, error: result.reason });
      this.logger.error(
        { outboxEventId: event.outboxEventId, type: event.type, handler: name, err: result.reason },
        'Domain olayı işleyicisi başarısız',
      );
    }

    if (failures.length > 0) {
      /**
       * ⚠️ Başarı listesi FIRLATMADAN ÖNCE yazılır. Sonra yazılsaydı hiç
       *    yazılmazdı ve tekrar denemede her şey baştan koşardı.
       *
       * ⚠️ 'stale' işleyici listeye GİRMEZ: o bir başarı değil, atlanmış bir
       *    karardır. Kapıyı her denemede yeniden değerlendirmek doğrudur.
       *
       * ⚠️ Yazma başarısız olursa iş yine de fırlatılır (kayıt bir iyileştirme,
       *    zorunluluk değil) — ama sessiz kalmaz.
       */
      const done = [
        ...context.alreadyDone.filter((name): name is DomainEventHandlerName => name in outcomes),
        ...names.filter((name) => outcomes[name] === 'ok'),
      ];
      try {
        await context.remember(done);
      } catch (error) {
        this.logger.warn(
          { outboxEventId: event.outboxEventId, type: event.type, err: error },
          'Tamamlanan işleyiciler işe yazılamadı — tekrar denemede hepsi yeniden koşacak',
        );
      }

      throw fanoutError(failures);
    }

    return outcomes;
  }
}

/**
 * Toplanan hataları tek bir fırlatılabilir hataya çevirir.
 *
 * ⚠️ HEPSİ kalıcı hataysa sonuç da kalıcıdır: `UnrecoverableError` denemeleri
 *    yakmaz (ör. bildirimde eksik şablon değişkeni — üç kez daha denemek aynı
 *    sonucu verir). Ama içlerinden BİRİ bile geçici hataysa iş tekrar
 *    denenmelidir; aksi hâlde kalıcı bir bildirim hatası, geçici bir veritabanı
 *    hatasından dolayı yazılamamış gardırop satırını da kalıcı olarak öldürürdü.
 */
function fanoutError(failures: Array<{ name: DomainEventHandlerName; error: unknown }>): Error {
  const message = `Domain olayı işleyicileri başarısız: ${failures
    .map((failure) => `${failure.name}: ${errorText(failure.error)}`)
    .join('; ')}`;

  const allPermanent = failures.every((failure) => failure.error instanceof UnrecoverableError);
  if (allPermanent) return new UnrecoverableError(message);

  return new AggregateError(
    failures.map((failure) => failure.error),
    message,
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ── Rol kapısı ────────────────────────────────────────────────────────────

/**
 * ⚠️ Domain olay kuyruğunun TEK rol kapısı. Gardıroba ayrı bir kapı
 *    VERİLMEZ: iki kapı farklı cevap verdiği gün ya kuyruk hiç tüketilmez ya da
 *    aynı kuyrukta iki `Worker` doğar. Kuyruk başına tek kapı, kapı başına tek
 *    `Worker`.
 *
 * ⚠️ Mantık `consumesNotificationQueue` ile aynıdır ve aynı kalmalıdır: ikisi
 *    de 'core' rolünün işidir (bkz. env.ts: "core → outbox, bildirim,
 *    zamanlanmış işler"). 'media' rolü ağır görsel işleri yürütür; domain
 *    olayları orada tüketilseydi ödeme SMS'i saniyeler süren bir try-on işinin
 *    arkasında beklerdi.
 */
export function consumesDomainEventQueue(role: WorkerRole): boolean {
  return role === 'core' || role === 'all';
}

export interface DomainEventConsumerDeps {
  connection: Redis;
  handlers: Record<DomainEventHandlerName, DomainEventHandler>;
  logger: Logger;
}

/**
 * Redis'in kendi istemci kaydından tüketici sayan gerçek uygulama.
 *
 * ⚠️ `Queue` nesnesi YALNIZCA sayım için açılır; bu kuyruğa iş EKLEMEZ (işleri
 *    `OutboxDispatcher` ekler). BullMQ'da `Queue` açmak bir tüketici yaratmaz —
 *    yani sayacın kendisi sayılan şeyi bozmaz.
 */
export class BullMqConsumerCensus implements DomainEventConsumerCensus {
  private readonly queue: Queue<DomainEventJobData>;

  constructor(connection: Redis) {
    this.queue = new Queue<DomainEventJobData>(QUEUE.DOMAIN_EVENT, { connection });
  }

  async count(): Promise<number> {
    return this.queue.getWorkersCount();
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

/**
 * Rol kapısı — `NotificationQueueConsumer` ile birebir aynı kalıp: işleyiciler
 * rol mantığı bilmez, `Worker` bu rolde HİÇ YARATILMAZ.
 */
export class DomainEventQueueConsumer {
  private readonly fanout: DomainEventFanout | null;
  private readonly census: BullMqConsumerCensus | null;

  constructor(
    private readonly role: WorkerRole,
    deps: DomainEventConsumerDeps,
    private readonly logger: Logger,
  ) {
    /**
     * ⚠️ Sayaç DIŞARIDAN ENJEKTE EDİLMEZ, burada kurulur. Bir bağımlılık olarak
     *    verilseydi modül kablolamasından düşebilir ve zombi proses kapanı —
     *    varlık sebebi "kimse fark etmedi" olan bir koruma — sessizce kalkardı.
     *    `DomainEventFanout` ise onu arayüz olarak alır: test sahte sayaçla
     *    kurar, üretimde Redis'i sayan tek uygulama budur.
     */
    this.census = consumesDomainEventQueue(role) ? new BullMqConsumerCensus(deps.connection) : null;
    this.fanout = this.census
      ? new DomainEventFanout(deps.connection, deps.handlers, this.census, deps.logger)
      : null;
  }

  /** Bu proses kuyruğu tüketiyor mu? Sağlık raporu ve testler için. */
  get active(): boolean {
    return this.fanout !== null;
  }

  onModuleInit(): void {
    if (!this.fanout) {
      this.logger.info(
        { role: this.role, queue: QUEUE.DOMAIN_EVENT },
        'Domain olay kuyruğu bu rolde tüketilmiyor',
      );
      return;
    }

    this.fanout.onModuleInit();
    this.logger.info(
      { role: this.role, queue: QUEUE.DOMAIN_EVENT, handlers: Object.keys(HANDLER_ORDER) },
      'Domain olay kuyruğu tüketiliyor',
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.fanout?.onModuleDestroy();
    await this.census?.close();
  }
}
