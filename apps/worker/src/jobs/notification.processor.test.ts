import { describe, expect, it } from 'vitest';
import { UnrecoverableError } from 'bullmq';
import { appError } from '@vt/contracts';
import {
  NotificationSender,
  type DedupeClaim,
  type EmailProvider,
  type EmailSendInput,
  type NotificationDedupeStore,
  type SendResult,
  type SmsProvider,
  type SmsSendInput,
} from '@vt/adapters';
import type { Logger } from 'pino';
import type { DomainEventJobData } from '../queues.js';
import {
  NotificationProcessor,
  consumesNotificationQueue,
  notificationMessageId,
  notificationsForEvent,
  type NotificationContacts,
  type OrderContact,
  type PackageContact,
  type SellerContact,
} from './notification.processor.js';

// ── Test ikizleri ─────────────────────────────────────────────────────────

const ORDER: OrderContact = {
  orderNumber: 'VT-260811-0042',
  email: 'musteri@ornek.com',
  phone: '05321234567',
  grandTotalMinor: 129_990n,
};

const SELLER: SellerContact = {
  contactEmail: 'satici@ornek.com',
  contactPhone: '05339876543',
  storeName: 'Örnek Mağaza',
};

class FakeContacts implements NotificationContacts {
  orderContact: OrderContact | null = ORDER;
  packageContact: PackageContact | null = {
    ...ORDER,
    sellerId: 'seller-1',
    carrier: 'Aras Kargo',
    trackingNo: 'TR123456789',
    itemCount: 2,
  };
  sellerContact: SellerContact | null = SELLER;
  sellers: Array<SellerContact & { itemCount: number }> = [{ ...SELLER, itemCount: 2 }];

  order(): Promise<OrderContact | null> {
    return Promise.resolve(this.orderContact);
  }
  orderPackage(): Promise<PackageContact | null> {
    return Promise.resolve(this.packageContact);
  }
  seller(): Promise<SellerContact | null> {
    return Promise.resolve(this.sellerContact);
  }
  sellersForOrder(): Promise<Array<SellerContact & { itemCount: number }>> {
    return Promise.resolve(this.sellers);
  }
}

function event(overrides: Partial<DomainEventJobData>): DomainEventJobData {
  return {
    outboxEventId: 'evt-1',
    aggregate: 'order',
    aggregateId: 'order-1',
    type: 'order.paid',
    payload: {},
    ...overrides,
  };
}

class FakeSms implements SmsProvider {
  readonly name = 'fake-sms';
  readonly sent: SmsSendInput[] = [];
  error: unknown;

  send(input: SmsSendInput): Promise<SendResult> {
    if (this.error) return Promise.reject(this.error);
    this.sent.push(input);
    return Promise.resolve({ providerRef: 'ref-1' });
  }
}

class FakeEmail implements EmailProvider {
  readonly name = 'fake-email';
  send(_input: EmailSendInput): Promise<SendResult> {
    return Promise.resolve({ providerRef: 'mail-1' });
  }
}

class FakeDedupe implements NotificationDedupeStore {
  private readonly seen = new Set<string>();
  claim(messageId: string): Promise<DedupeClaim> {
    if (this.seen.has(messageId)) return Promise.resolve({ state: 'in-flight' });
    this.seen.add(messageId);
    return Promise.resolve({ state: 'fresh' });
  }
  complete(): Promise<void> {
    return Promise.resolve();
  }
  release(messageId: string): Promise<void> {
    this.seen.delete(messageId);
    return Promise.resolve();
  }
}

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as unknown as Logger;

// ── Olay eşlemesi ─────────────────────────────────────────────────────────

describe('notificationsForEvent', () => {
  it('order.paid → müşteriye SMS+e-posta, satıcıya SMS+e-posta', async () => {
    const jobs = await notificationsForEvent(event({ type: 'order.paid' }), new FakeContacts());

    expect(jobs.map((job) => `${job.template}/${job.channel}`)).toEqual([
      'siparis-alindi/SMS',
      'siparis-alindi/EMAIL',
      'satici-yeni-siparis/SMS',
      'satici-yeni-siparis/EMAIL',
    ]);
  });

  it('sipariş tutarını kuruştan okunur biçime çevirir', async () => {
    const jobs = await notificationsForEvent(event({ type: 'order.paid' }), new FakeContacts());

    expect(jobs[0]?.variables.total).toContain('1.299,90');
  });

  /** ⚠️ Outbox yükünde bigint'ler string'e serileşir (serializeBigInts). */
  it('string olarak gelen kuruş değerini de okur', async () => {
    const jobs = await notificationsForEvent(
      event({
        type: 'return.approved',
        payload: { refundAmountMinor: '25000', orderNumber: 'VT-1' },
      }),
      new FakeContacts(),
    );

    expect(jobs[0]?.variables.amount).toContain('250,00');
  });

  /**
   * ⚠️ Tekilleştirmenin temeli: outbox EN AZ BİR KEZ teslim eder, aynı olay
   *    ikinci kez geldiğinde ANAHTARLAR AYNI olmalı.
   */
  it('aynı olay iki kez işlenirse messageId değerleri birebir aynıdır', async () => {
    const first = await notificationsForEvent(event({ type: 'order.paid' }), new FakeContacts());
    const second = await notificationsForEvent(event({ type: 'order.paid' }), new FakeContacts());

    expect(first.map((job) => job.messageId)).toEqual(second.map((job) => job.messageId));
  });

  it('farklı outbox olayları farklı messageId üretir', async () => {
    const first = await notificationsForEvent(event({ type: 'order.paid' }), new FakeContacts());
    const second = await notificationsForEvent(
      event({ type: 'order.paid', outboxEventId: 'evt-2' }),
      new FakeContacts(),
    );

    expect(first[0]?.messageId).not.toBe(second[0]?.messageId);
  });

  /** Bir siparişte birden çok satıcı olabilir; anahtarlar çakışmamalı. */
  it('çok satıcılı siparişte her satıcı ayrı anahtar alır', async () => {
    const contacts = new FakeContacts();
    contacts.sellers = [
      { ...SELLER, itemCount: 1 },
      { ...SELLER, contactEmail: 'iki@ornek.com', itemCount: 3 },
    ];

    const jobs = await notificationsForEvent(event({ type: 'order.paid' }), contacts);
    const ids = jobs.map((job) => job.messageId);

    expect(new Set(ids).size).toBe(ids.length);
    expect(jobs.filter((job) => job.template === 'satici-yeni-siparis')).toHaveLength(4);
  });

  it('package.shipped → takip numarasıyla kargo bildirimi', async () => {
    const jobs = await notificationsForEvent(
      event({ type: 'package.shipped', payload: { packageId: 'pkg-1' } }),
      new FakeContacts(),
    );

    expect(jobs).toHaveLength(2);
    expect(jobs[0]?.variables.trackingNumber).toBe('TR123456789');
    expect(jobs[0]?.variables.carrier).toBe('Aras Kargo');
  });

  /**
   * ⚠️ Takip numarası yoksa bildirim GÖNDERİLMEZ: "kargoya verildi" deyip
   *    takip numarası vermemek doğrudan destek çağrısı üretir.
   */
  it('takip numarası yoksa kargo bildirimi üretmez', async () => {
    const contacts = new FakeContacts();
    contacts.packageContact = {
      ...ORDER,
      sellerId: 's',
      carrier: 'Aras',
      trackingNo: null,
      itemCount: 1,
    };

    const jobs = await notificationsForEvent(
      event({ type: 'package.shipped', payload: { packageId: 'pkg-1' } }),
      contacts,
    );

    expect(jobs).toHaveLength(0);
  });

  it('package.delivered bildirim üretmez — şablonu yok', async () => {
    const jobs = await notificationsForEvent(
      event({ type: 'package.delivered', payload: { packageId: 'pkg-1' } }),
      new FakeContacts(),
    );

    expect(jobs).toHaveLength(0);
  });

  it('return.rejected → gerekçeli e-posta', async () => {
    const jobs = await notificationsForEvent(
      event({ type: 'return.rejected', payload: { rejectReason: 'Ürün kullanılmış' } }),
      new FakeContacts(),
    );

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.variables.reason).toBe('Ürün kullanılmış');
  });

  it('gerekçe yoksa şablon boş değişkenle kalmaz', async () => {
    const jobs = await notificationsForEvent(
      event({ type: 'return.rejected', payload: {} }),
      new FakeContacts(),
    );

    expect(jobs[0]?.variables.reason).toBe('Belirtilmedi');
  });

  it('payout.approved → satıcıya ödeme e-postası', async () => {
    const jobs = await notificationsForEvent(
      event({
        aggregate: 'payout',
        aggregateId: 'payout-1',
        type: 'payout.approved',
        payload: { sellerId: 'seller-1', amountMinor: '5000000' },
      }),
      new FakeContacts(),
    );

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.template).toBe('payout-gonderildi');
    expect(jobs[0]?.to).toBe('satici@ornek.com');
    expect(jobs[0]?.variables.amount).toContain('50.000,00');
  });

  it('seller.approved → mağaza adıyla onay e-postası', async () => {
    const jobs = await notificationsForEvent(
      event({ aggregate: 'seller', aggregateId: 'seller-1', type: 'seller.approved' }),
      new FakeContacts(),
    );

    expect(jobs[0]?.variables.storeName).toBe('Örnek Mağaza');
  });

  /** Domain olaylarının çoğunun bildirim karşılığı yoktur — hata değildir. */
  it('tanımadığı olayı sessizce geçer', async () => {
    const jobs = await notificationsForEvent(event({ type: 'order.expired' }), new FakeContacts());

    expect(jobs).toHaveLength(0);
  });

  it('sipariş bulunamazsa bildirim üretmez', async () => {
    const contacts = new FakeContacts();
    contacts.orderContact = null;

    expect(await notificationsForEvent(event({ type: 'order.paid' }), contacts)).toHaveLength(0);
  });
});

describe('notificationMessageId', () => {
  it('aynı girdide aynı anahtarı üretir', () => {
    expect(notificationMessageId('e1', 'siparis-alindi', 'SMS', 'musteri')).toBe(
      notificationMessageId('e1', 'siparis-alindi', 'SMS', 'musteri'),
    );
  });

  it('kanal ve alıcı anahtarı ayrıştırır — müşteri ve satıcı ikisi de alır', () => {
    const musteriSms = notificationMessageId('e1', 'siparis-alindi', 'SMS', 'musteri');
    const musteriMail = notificationMessageId('e1', 'siparis-alindi', 'EMAIL', 'musteri');
    const satici = notificationMessageId('e1', 'siparis-alindi', 'SMS', 'satici-0');

    expect(new Set([musteriSms, musteriMail, satici]).size).toBe(3);
  });
});

// ── İşleyici ──────────────────────────────────────────────────────────────

describe('NotificationProcessor', () => {
  function makeProcessor(sms = new FakeSms()) {
    const sender = new NotificationSender({
      sms,
      email: new FakeEmail(),
      dedupe: new FakeDedupe(),
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    });
    return {
      processor: new NotificationProcessor({} as never, sender, silentLogger),
      sms,
    };
  }

  it('SMS işini gönderir', async () => {
    const { processor, sms } = makeProcessor();

    const result = await processor.process({
      channel: 'SMS',
      to: '05321234567',
      template: 'otp-dogrulama',
      variables: { code: '123456', minutes: '3' },
      messageId: 'm1',
    });

    expect(result.status).toBe('sent');
    expect(sms.sent).toHaveLength(1);
  });

  /** ⚠️ Aynı messageId ikinci kez gelirse SMS tekrar gitmez. */
  it('aynı işi iki kez işlerse ikinci kez göndermez', async () => {
    const { processor, sms } = makeProcessor();
    const job = {
      channel: 'SMS' as const,
      to: '05321234567',
      template: 'otp-dogrulama',
      variables: { code: '123456', minutes: '3' },
      messageId: 'm1',
    };

    await processor.process(job);
    await processor.process(job);

    expect(sms.sent).toHaveLength(1);
  });

  /**
   * ⚠️ Kalıcı hata 5 denemeyi yakmamalı: eksik değişken tekrar denendiğinde
   *    aynı sonucu verir, yalnızca kuyruğu meşgul eder.
   */
  it('eksik şablon değişkeninde UnrecoverableError fırlatır', async () => {
    const { processor } = makeProcessor();

    await expect(
      processor.process({
        channel: 'SMS',
        to: '05321234567',
        template: 'otp-dogrulama',
        variables: { code: '123456' },
        messageId: 'm1',
      }),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('yeniden denenebilir hatayı olduğu gibi fırlatır — kuyruk tekrar dener', async () => {
    const sms = new FakeSms();
    sms.error = appError('UPSTREAM_UNAVAILABLE');
    const { processor } = makeProcessor(sms);

    const error = await processor
      .process({
        channel: 'SMS',
        to: '05321234567',
        template: 'otp-dogrulama',
        variables: { code: '123456', minutes: '3' },
        messageId: 'm1',
      })
      .catch((caught: unknown) => caught);

    expect(error).not.toBeInstanceOf(UnrecoverableError);
  });

  /** Push sağlayıcısı yok: sessizce "gönderdim" demek yerine görünür hata. */
  it('PUSH kanalında kalıcı hata verir', async () => {
    const { processor } = makeProcessor();

    await expect(
      processor.process({
        channel: 'PUSH',
        to: 'device-token',
        template: 'siparis-alindi',
        variables: {},
        messageId: 'm1',
      }),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });
});

describe('rol kapısı', () => {
  /** ⚠️ env.ts: "core → outbox, bildirim, zamanlanmış işler". */
  it('bildirim core ve all rollerinde tüketilir, media rolünde tüketilmez', () => {
    expect(consumesNotificationQueue('core')).toBe(true);
    expect(consumesNotificationQueue('all')).toBe(true);
    expect(consumesNotificationQueue('media')).toBe(false);
  });
});
