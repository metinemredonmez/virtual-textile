import { UnrecoverableError, Worker, type Job } from 'bullmq';
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

/** Bir işleyicinin tek olaydaki akıbeti — log ve test için. */
export type HandlerOutcome = 'ok' | 'stale' | 'failed';

export class DomainEventFanout {
  private worker?: Worker<DomainEventJobData>;

  constructor(
    private readonly connection: Redis,
    private readonly handlers: Record<DomainEventHandlerName, DomainEventHandler>,
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
      async (job: Job<DomainEventJobData>) => this.dispatch(job.data, job.timestamp),
      { connection: this.connection, concurrency: CONCURRENCY[QUEUE.DOMAIN_EVENT] },
    );

    this.worker.on('failed', (job, error) => {
      this.logger.error(
        { outboxEventId: job?.data.outboxEventId, type: job?.data.type, err: error },
        'Domain olayı işlenemedi',
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  /**
   * Olayı bütün işleyicilere dağıtır.
   *
   * ⚠️ HATA YALITIMI: işleyiciler `allSettled` ile koşar. Biri patlarsa diğeri
   *    YİNE de çalışır — gardırop yazımının başarısız olması bildirimlerin
   *    gitmemesi anlamına gelmemelidir, tersi de doğrudur.
   *
   * ⚠️ AMA SESSİZCE YUTULMAZ: en az bir hata varsa iş FIRLATIR, böylece BullMQ
   *    onu `failed` sayar ve arıza kuyrukta GÖRÜNÜR kalır. Tekrar denemek iki
   *    tarafta da güvenlidir: bildirim `queueJobId` + Redis dedupe ile,
   *    gardırop UNIQUE(userId, sourceOrderItemId) ile korunur.
   */
  async dispatch(
    event: DomainEventJobData,
    enqueuedAt: number,
  ): Promise<Record<DomainEventHandlerName, HandlerOutcome>> {
    const age = Date.now() - enqueuedAt;
    const names = (Object.keys(this.handlers) as DomainEventHandlerName[]).sort(
      (a, b) => HANDLER_ORDER[a] - HANDLER_ORDER[b],
    );

    const outcomes = {} as Record<DomainEventHandlerName, HandlerOutcome>;
    const running: Array<{ name: DomainEventHandlerName; task: Promise<unknown> }> = [];

    for (const name of names) {
      const handler = this.handlers[name];

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

    if (failures.length > 0) throw fanoutError(failures);

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
 * Rol kapısı — `NotificationQueueConsumer` ile birebir aynı kalıp: işleyiciler
 * rol mantığı bilmez, `Worker` bu rolde HİÇ YARATILMAZ.
 */
export class DomainEventQueueConsumer {
  private readonly fanout: DomainEventFanout | null;

  constructor(
    private readonly role: WorkerRole,
    deps: DomainEventConsumerDeps,
    private readonly logger: Logger,
  ) {
    this.fanout = consumesDomainEventQueue(role)
      ? new DomainEventFanout(deps.connection, deps.handlers, deps.logger)
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
  }
}
