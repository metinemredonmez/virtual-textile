import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import type Redis from 'ioredis';
import type { PrismaClient } from '@vt/db';
import type { Logger } from 'pino';
import { Money, isAppError } from '@vt/contracts';
import type { NotificationSender, TemplateKey } from '@vt/adapters';
import {
  CONCURRENCY,
  DEFAULT_JOB_OPTIONS,
  QUEUE,
  QUEUE_OPTIONS,
  type DomainEventJobData,
  type NotificationJobData,
} from '../queues.js';

/**
 * BİLDİRİM İŞLEYİCİSİ
 *
 * ⚠️ QUEUE.NOTIFICATION 5 DENEME yapar (queues.ts). Bu cömertliğin tek dayanağı
 *    tekilleştirmedir: `messageId` ile aynı mesaj iki kez GÖNDERİLMEZ (bkz.
 *    NotificationSender + RedisNotificationDedupeStore). Tekilleştirme
 *    bozulursa 5 deneme, kullanıcıya 5 SMS demektir.
 *
 * ⚠️ KALICI HATALAR DENEME YAKMAZ: eksik şablon değişkeni ya da sağlayıcının
 *    4xx reddi tekrar denendiğinde aynı sonucu verir. Bunlar
 *    `UnrecoverableError` ile işaretlenir; aksi hâlde bozuk tek bir iş kuyruğu
 *    beş kat gereksiz meşgul eder ve gerçek arızayı gürültüye boğar.
 */

// ── Kişi/olay veri kaynağı ────────────────────────────────────────────────

export interface OrderContact {
  orderNumber: string;
  email: string;
  phone: string;
  grandTotalMinor: bigint;
}

export interface PackageContact extends OrderContact {
  sellerId: string;
  carrier: string | null;
  trackingNo: string | null;
  itemCount: number;
}

export interface SellerContact {
  contactEmail: string;
  contactPhone: string;
  storeName: string;
}

/**
 * Bildirim için gereken iletişim bilgileri.
 *
 * ⚠️ Neden olay yükünden okunmuyor: `order.paid` yükünde e-posta var ama
 *    TELEFON yok; `package.shipped` yükünde sipariş numarası yok. Eksik alanı
 *    olay üreticisine ekletmek, bildirim ihtiyacının sipariş modülünün
 *    sözleşmesini şekillendirmesi demekti. Okuma burada yapılır.
 */
export interface NotificationContacts {
  order(orderId: string): Promise<OrderContact | null>;
  orderPackage(packageId: string): Promise<PackageContact | null>;
  seller(sellerId: string): Promise<SellerContact | null>;
  sellersForOrder(orderId: string): Promise<Array<SellerContact & { itemCount: number }>>;
}

/** Prisma ile gerçek okuma. Worker zaten PrismaClient'a doğrudan erişir. */
export class PrismaNotificationContacts implements NotificationContacts {
  constructor(private readonly prisma: PrismaClient) {}

  async order(orderId: string): Promise<OrderContact | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { orderNumber: true, email: true, phone: true, grandTotalMinor: true },
    });
    return order;
  }

  async orderPackage(packageId: string): Promise<PackageContact | null> {
    const pkg = await this.prisma.orderPackage.findUnique({
      where: { id: packageId },
      select: {
        sellerId: true,
        carrier: true,
        trackingNo: true,
        _count: { select: { items: true } },
        order: {
          select: { orderNumber: true, email: true, phone: true, grandTotalMinor: true },
        },
      },
    });

    if (!pkg) return null;

    return {
      ...pkg.order,
      sellerId: pkg.sellerId,
      carrier: pkg.carrier,
      trackingNo: pkg.trackingNo,
      itemCount: pkg._count.items,
    };
  }

  async seller(sellerId: string): Promise<SellerContact | null> {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: {
        contactEmail: true,
        contactPhone: true,
        displayName: true,
        store: { select: { name: true } },
      },
    });

    if (!seller) return null;

    return {
      contactEmail: seller.contactEmail,
      contactPhone: seller.contactPhone,
      // Mağaza henüz açılmamış olabilir (onay öncesi) — ticari ad yedektir.
      storeName: seller.store?.name ?? seller.displayName,
    };
  }

  async sellersForOrder(orderId: string): Promise<Array<SellerContact & { itemCount: number }>> {
    const packages = await this.prisma.orderPackage.findMany({
      where: { orderId },
      select: {
        sellerId: true,
        _count: { select: { items: true } },
        seller: {
          select: {
            contactEmail: true,
            contactPhone: true,
            displayName: true,
            store: { select: { name: true } },
          },
        },
      },
    });

    return packages.map((pkg) => ({
      contactEmail: pkg.seller.contactEmail,
      contactPhone: pkg.seller.contactPhone,
      storeName: pkg.seller.store?.name ?? pkg.seller.displayName,
      itemCount: pkg._count.items,
    }));
  }
}

// ── Olay → bildirim eşlemesi ──────────────────────────────────────────────

/**
 * TEKİLLEŞTİRME ANAHTARI
 *
 * ⚠️ `outboxEventId`den TÜRETİLİR ve rastgele hiçbir bileşen içermez. Outbox
 *    teslimatı EN AZ BİR KEZ'dir; aynı olay ikinci kez dağıtıldığında üretilen
 *    anahtar AYNI olmalıdır, yoksa tekilleştirme hiçbir şey yapmaz.
 *
 * `recipient` ayrımı şart: aynı olay hem müşteriye hem satıcıya gider ve
 * ikisinin de gönderilmesi gerekir.
 */
export function notificationMessageId(
  outboxEventId: string,
  template: TemplateKey,
  channel: 'SMS' | 'EMAIL',
  recipient: string,
): string {
  return `evt:${outboxEventId}:${template}:${channel}:${recipient}`;
}

/** Outbox yükünde bigint'ler string'e çevrilir (serializeBigInts). */
function minorToText(value: bigint | string | number): string {
  return Money.formatMoney(Money.money(BigInt(value)));
}

function readString(payload: unknown, key: string): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * OLAY → BİLDİRİM İŞLERİ
 *
 * ⚠️ Bu eşleme neden `apps/api` servislerinde değil: bildirim `OutboxEvent`ten
 *    tetiklenmeli, servisten DEĞİL. Sipariş transaction'ı geri alınırsa outbox
 *    satırı da geri alınır ve bildirim hiç doğmaz. Servis içinden çağrılsaydı
 *    "iptal olmuş sipariş için sipariş onayı" SMS'i gönderilirdi.
 *
 * ⚠️ TANIMADIĞI OLAY SESSİZCE GEÇİLİR (boş dizi). Domain olaylarının çoğunun
 *    bildirim karşılığı yoktur; bilinmeyeni hata saymak, her yeni olay türünde
 *    kuyruğu kırmak demekti.
 */
export async function notificationsForEvent(
  event: DomainEventJobData,
  contacts: NotificationContacts,
): Promise<NotificationJobData[]> {
  const jobs: NotificationJobData[] = [];
  const id = event.outboxEventId;

  switch (event.type) {
    case 'order.paid': {
      const order = await contacts.order(event.aggregateId);
      if (!order) break;

      const variables = {
        orderNumber: order.orderNumber,
        total: minorToText(order.grandTotalMinor),
      };

      // Müşteriye: SMS + e-posta. SMS anlık güven verir, e-posta kalıcı kayıt.
      jobs.push(
        {
          channel: 'SMS',
          to: order.phone,
          template: 'siparis-alindi',
          variables,
          messageId: notificationMessageId(id, 'siparis-alindi', 'SMS', 'musteri'),
        },
        {
          channel: 'EMAIL',
          to: order.email,
          template: 'siparis-alindi',
          variables,
          messageId: notificationMessageId(id, 'siparis-alindi', 'EMAIL', 'musteri'),
        },
      );

      // Satıcılara: yeni sipariş kargo süresini (SLA) başlatan olaydır.
      const sellers = await contacts.sellersForOrder(event.aggregateId);
      for (const [index, seller] of sellers.entries()) {
        const sellerVariables = {
          orderNumber: order.orderNumber,
          itemCount: String(seller.itemCount),
        };
        // ⚠️ Alıcı etiketi sıra numarası içerir: bir siparişte birden çok
        //    satıcı olabilir ve anahtarlar çakışırsa yalnızca ilkine gider.
        const tag = `satici-${String(index)}`;
        jobs.push(
          {
            channel: 'SMS',
            to: seller.contactPhone,
            template: 'satici-yeni-siparis',
            variables: sellerVariables,
            messageId: notificationMessageId(id, 'satici-yeni-siparis', 'SMS', tag),
          },
          {
            channel: 'EMAIL',
            to: seller.contactEmail,
            template: 'satici-yeni-siparis',
            variables: sellerVariables,
            messageId: notificationMessageId(id, 'satici-yeni-siparis', 'EMAIL', tag),
          },
        );
      }
      break;
    }

    case 'package.shipped': {
      const packageId = readString(event.payload, 'packageId');
      if (!packageId) break;

      const pkg = await contacts.orderPackage(packageId);
      // ⚠️ Kargo firması/takip numarası yoksa bildirim GÖNDERİLMEZ: "kargoya
      //    verildi" deyip takip numarası vermemek, müşteriyi destek hattına
      //    yönlendiren en sık sebeplerden biridir.
      if (!pkg?.carrier || !pkg.trackingNo) break;

      const variables = {
        orderNumber: pkg.orderNumber,
        carrier: pkg.carrier,
        trackingNumber: pkg.trackingNo,
      };
      jobs.push(
        {
          channel: 'SMS',
          to: pkg.phone,
          template: 'siparis-kargolandi',
          variables,
          messageId: notificationMessageId(id, 'siparis-kargolandi', 'SMS', 'musteri'),
        },
        {
          channel: 'EMAIL',
          to: pkg.email,
          template: 'siparis-kargolandi',
          variables,
          messageId: notificationMessageId(id, 'siparis-kargolandi', 'EMAIL', 'musteri'),
        },
      );
      break;
    }

    case 'return.approved': {
      const order = await contacts.order(event.aggregateId);
      if (!order) break;

      const refund = (event.payload as { refundAmountMinor?: bigint | string | number } | null)
        ?.refundAmountMinor;
      if (refund === undefined) break;

      const variables = {
        orderNumber: readString(event.payload, 'orderNumber') ?? order.orderNumber,
        amount: minorToText(refund),
      };
      jobs.push(
        {
          channel: 'SMS',
          to: order.phone,
          template: 'iade-onaylandi',
          variables,
          messageId: notificationMessageId(id, 'iade-onaylandi', 'SMS', 'musteri'),
        },
        {
          channel: 'EMAIL',
          to: order.email,
          template: 'iade-onaylandi',
          variables,
          messageId: notificationMessageId(id, 'iade-onaylandi', 'EMAIL', 'musteri'),
        },
      );
      break;
    }

    case 'return.rejected': {
      const order = await contacts.order(event.aggregateId);
      if (!order) break;

      jobs.push({
        channel: 'EMAIL',
        to: order.email,
        template: 'iade-reddedildi',
        variables: {
          orderNumber: order.orderNumber,
          // Gerekçesiz ret, kullanıcıya ne yapacağını söylemez.
          reason: readString(event.payload, 'rejectReason') ?? 'Belirtilmedi',
        },
        messageId: notificationMessageId(id, 'iade-reddedildi', 'EMAIL', 'musteri'),
      });
      break;
    }

    case 'payout.approved': {
      const sellerId = readString(event.payload, 'sellerId');
      const amount = (event.payload as { amountMinor?: bigint | string | number } | null)
        ?.amountMinor;
      if (!sellerId || amount === undefined) break;

      const seller = await contacts.seller(sellerId);
      if (!seller) break;

      jobs.push({
        channel: 'EMAIL',
        to: seller.contactEmail,
        template: 'payout-gonderildi',
        variables: {
          amount: minorToText(amount),
          date: new Date().toLocaleDateString('tr-TR'),
        },
        messageId: notificationMessageId(id, 'payout-gonderildi', 'EMAIL', 'satici'),
      });
      break;
    }

    case 'seller.approved': {
      const seller = await contacts.seller(event.aggregateId);
      if (!seller) break;

      jobs.push({
        channel: 'EMAIL',
        to: seller.contactEmail,
        template: 'satici-onaylandi',
        variables: { storeName: seller.storeName },
        messageId: notificationMessageId(id, 'satici-onaylandi', 'EMAIL', 'satici'),
      });
      break;
    }

    default:
      // Bildirim karşılığı olmayan olay — normal durum.
      break;
  }

  return jobs;
}

// ── QUEUE.NOTIFICATION tüketicisi ─────────────────────────────────────────

export class NotificationProcessor {
  private worker?: Worker<NotificationJobData>;

  constructor(
    private readonly connection: Redis,
    private readonly sender: NotificationSender,
    private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<NotificationJobData>(
      QUEUE.NOTIFICATION,
      async (job: Job<NotificationJobData>) => this.process(job.data),
      { connection: this.connection, concurrency: CONCURRENCY[QUEUE.NOTIFICATION] },
    );

    this.worker.on('failed', (job, error) => {
      this.logger.error(
        { messageId: job?.data.messageId, template: job?.data.template, err: error },
        'Bildirim işi başarısız',
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  async process(data: NotificationJobData): Promise<{ status: string }> {
    if (data.channel === 'PUSH') {
      // ⚠️ Push sağlayıcısı YOK. Sessizce başarılı saymak, bildirim
      //    gönderildiği yanılgısı yaratır; 5 kez denemek de boşuna. İş kalıcı
      //    hatayla düşer ve kuyrukta GÖRÜNÜR kalır.
      throw new UnrecoverableError('Push kanalı için sağlayıcı bağlanmadı');
    }

    try {
      const outcome = await this.sender.send({
        channel: data.channel,
        to: data.to,
        template: data.template as TemplateKey,
        variables: data.variables,
        messageId: data.messageId,
      });
      return { status: outcome.status };
    } catch (error) {
      // ⚠️ Tekrar denemenin sonucu değiştirmeyeceği hatalar denemeleri yakmaz:
      //    eksik şablon değişkeni, yapılandırılmamış sağlayıcı, sağlayıcının
      //    4xx reddi. Katalog `retryable` alanı bu kararın tek kaynağıdır.
      if (isAppError(error) && !error.retryable) {
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }
  }
}

// ── QUEUE.DOMAIN_EVENT → bildirim köprüsü ─────────────────────────────────

/**
 * OUTBOX OLAYLARINI BİLDİRİME ÇEVİREN KÖPRÜ
 *
 * ⚠️⚠️ BU KUYRUĞUN TEK TÜKETİCİSİ BUDUR. BullMQ'da bir iş yalnızca BİR
 *      tüketiciye gider; `QUEUE.DOMAIN_EVENT` için ikinci bir `Worker` açılırsa
 *      olaylar iki tüketici arasında RASTGELE bölünür ve bildirimlerin yarısı
 *      sessizce kaybolur. Yeni yan etkiler (arama indeksi, muhasebe, webhook)
 *      ayrı bir tüketici olarak DEĞİL, bu köprünün yanına bir işleyici olarak
 *      eklenmelidir.
 *
 * ⚠️ Olayın kendisi bildirim işine çevrilirken YENİ bir kuyruk kaydı yazılır;
 *    iş kimliği `messageId`dir. Aynı olay iki kez dağıtılırsa BullMQ ikinci
 *    eklemeyi yok sayar — tekilleştirmenin ilk katmanı budur, ikincisi
 *    gönderim anındaki Redis kaydıdır.
 */
/**
 * Bu yaştan eski domain olayı bildirime ÇEVRİLMEZ.
 *
 * 24 saat: bir günden eski "siparişiniz alındı" mesajı kullanıcıya bilgi
 * vermez, kafa karıştırır. Sınır aynı zamanda ilk açılıştaki birikmiş kuyruk
 * patlamasına karşı sigortadır (bkz. onModuleInit).
 */
export const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000;

export class DomainEventNotificationBridge {
  private worker?: Worker<DomainEventJobData>;
  private readonly queue: Queue<NotificationJobData>;

  constructor(
    private readonly connection: Redis,
    private readonly contacts: NotificationContacts,
    private readonly logger: Logger,
  ) {
    this.queue = new Queue<NotificationJobData>(QUEUE.NOTIFICATION, {
      connection,
      defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, ...QUEUE_OPTIONS[QUEUE.NOTIFICATION] },
    });
  }

  onModuleInit(): void {
    this.worker = new Worker<DomainEventJobData>(
      QUEUE.DOMAIN_EVENT,
      async (job: Job<DomainEventJobData>) => {
        // ⚠️ BAYAT OLAY KAPISI. `QUEUE.DOMAIN_EVENT`in bu köprüden önce HİÇBİR
        //    tüketicisi yoktu: outbox dağıtıcısı olayları aylardır kuyruğa
        //    yazıp `publishedAt` işaretliyor, işler ise Redis'te bekliyordu.
        //    Kapı olmasaydı bu köprünün ilk açılışı, birikmiş her sipariş için
        //    "siparişiniz alındı" SMS'i gönderirdi — geçmişteki her müşteriye,
        //    aynı anda, gerçek para harcayarak.
        //
        //    Kapı kalıcı olarak da doğrudur: bir gün gecikmiş "kargoya
        //    verildi" bildirimi bilgilendirmez, yanıltır.
        const age = Date.now() - job.timestamp;
        if (age > MAX_EVENT_AGE_MS) {
          this.logger.warn(
            { outboxEventId: job.data.outboxEventId, type: job.data.type, ageMs: age },
            'Bayat domain olayı — bildirim üretilmedi',
          );
          return { enqueued: 0 };
        }
        return this.process(job.data);
      },
      { connection: this.connection, concurrency: CONCURRENCY[QUEUE.DOMAIN_EVENT] },
    );

    this.worker.on('failed', (job, error) => {
      this.logger.error(
        { outboxEventId: job?.data.outboxEventId, type: job?.data.type, err: error },
        'Domain olayı bildirime çevrilemedi',
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }

  async process(event: DomainEventJobData): Promise<{ enqueued: number }> {
    const jobs = await notificationsForEvent(event, this.contacts);

    for (const job of jobs) {
      await this.queue.add(job.template, job, {
        // ⚠️ İş kimliği = messageId. Aynı olay iki kez dağıtılırsa BullMQ
        //    ikinci işi sessizce yok sayar.
        jobId: job.messageId,
      });
    }

    if (jobs.length > 0) {
      this.logger.info(
        { outboxEventId: event.outboxEventId, type: event.type, enqueued: jobs.length },
        'Domain olayından bildirim üretildi',
      );
    }

    return { enqueued: jobs.length };
  }
}

// ── Rol kapısı ────────────────────────────────────────────────────────────

export type WorkerRole = 'core' | 'media' | 'all';

/**
 * ⚠️ Bildirim 'core' rolünün işidir (bkz. env.ts: "core → outbox, bildirim,
 *    zamanlanmış işler"). 'media' rolü ağır görsel işleri yürütür; bildirim
 *    orada tüketilseydi ödeme SMS'i saniyeler süren bir try-on işinin
 *    arkasında beklerdi.
 */
export function consumesNotificationQueue(role: WorkerRole): boolean {
  return role === 'core' || role === 'all';
}

export interface NotificationConsumerDeps {
  connection: Redis;
  sender: NotificationSender;
  contacts: NotificationContacts;
  logger: Logger;
}

/**
 * Rol kapısı — `TryOnQueueConsumer` ile aynı kalıp ve aynı gerekçe: işleyiciler
 * rol mantığı bilmez, nesneler bu rolde HİÇ YARATILMAZ.
 */
export class NotificationQueueConsumer {
  private readonly processor: NotificationProcessor | null;
  private readonly bridge: DomainEventNotificationBridge | null;

  constructor(
    private readonly role: WorkerRole,
    deps: NotificationConsumerDeps,
    private readonly logger: Logger,
  ) {
    const active = consumesNotificationQueue(role);
    this.processor = active
      ? new NotificationProcessor(deps.connection, deps.sender, deps.logger)
      : null;
    this.bridge = active
      ? new DomainEventNotificationBridge(deps.connection, deps.contacts, deps.logger)
      : null;
  }

  /** Bu proses kuyrukları tüketiyor mu? Sağlık raporu ve testler için. */
  get active(): boolean {
    return this.processor !== null;
  }

  onModuleInit(): void {
    if (!this.processor || !this.bridge) {
      this.logger.info(
        { role: this.role, queue: QUEUE.NOTIFICATION },
        'Bildirim kuyruğu bu rolde tüketilmiyor',
      );
      return;
    }

    this.processor.onModuleInit();
    this.bridge.onModuleInit();
    this.logger.info(
      { role: this.role, queues: [QUEUE.NOTIFICATION, QUEUE.DOMAIN_EVENT] },
      'Bildirim kuyrukları tüketiliyor',
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.processor?.onModuleDestroy();
    await this.bridge?.onModuleDestroy();
  }
}
