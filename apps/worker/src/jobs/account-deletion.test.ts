import { describe, expect, it, vi } from 'vitest';
import type { StorageProvider } from '@vt/adapters';
import {
  AccountDeletionJob,
  ORDER_CONTACT_TOMBSTONE,
  blocksDeletion,
  redactAddressSnapshot,
  type KvkkNotifier,
} from './account-deletion.job.js';

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

/** Silme anı: talep 40 gün önce açılmış, geri alma penceresi (30 gün) dolmuş. */
const NOW = new Date('2026-08-12T03:00:00.000Z');
const REQUESTED_AT = new Date('2026-07-03T03:00:00.000Z');

function createStorage(overrides: Partial<StorageProvider> = {}): StorageProvider {
  return {
    name: 'test',
    put: vi.fn(),
    get: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteMany: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn(),
    signedUrl: vi.fn(),
    publicUrl: (key: string) => key,
    ...overrides,
  } as StorageProvider;
}

function createNotifier(): KvkkNotifier & { enqueue: ReturnType<typeof vi.fn> } {
  return { enqueue: vi.fn().mockResolvedValue(undefined) };
}

interface FakeOptions {
  users?: Array<{
    id: string;
    email: string | null;
    role: string;
    deletionRequestedAt: Date | null;
  }>;
  sellerships?: Array<{
    sellerId: string;
    seller: {
      status: string;
      store: { id: string } | null;
      _count: { ledgerEntries: number; payouts: number };
    };
  }>;
  photos?: Array<{ storageKey: string }>;
  tryOns?: Array<{ resultKey: string | null }>;
  orders?: Array<{ id: string; shippingAddress: unknown; billingAddress: unknown }>;
  returns?: Array<{ id: string; photoKeys: string[] }>;
  wardrobe?: Array<{ photoKey: string | null }>;
  /** Daha önce yazılmış "engellendi" denetim kaydı var mı? */
  blockedAuditExists?: boolean;
}

function createPrisma(options: FakeOptions = {}) {
  const model = () => ({
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    update: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
  });

  const tx = {
    returnRequest: model(),
    order: model(),
    aiUsageLog: model(),
    session: model(),
    socialAccount: model(),
    address: model(),
    bodyProfile: model(),
    favorite: model(),
    outfit: model(),
    cart: model(),
    stylistConversation: model(),
    idempotencyKey: model(),
    userPhoto: model(),
    digitalWardrobeItem: model(),
    user: model(),
    auditLog: model(),
    outboxEvent: model(),
    // ⚠️ Bu iki model transaction içinde ÇAĞRILMAMALI (muhasebe bütünlüğü);
    //    testler bunu doğruluyor.
    ledgerEntry: model(),
    consentRecord: model(),
    payoutRequest: model(),
    orderItem: model(),
    orderPackage: model(),
  };

  const prisma = {
    user: {
      findMany: vi.fn().mockResolvedValue(
        options.users ?? [
          {
            id: 'u1',
            email: 'ayse@example.com',
            role: 'CUSTOMER',
            deletionRequestedAt: REQUESTED_AT,
          },
        ],
      ),
    },
    sellerUser: { findMany: vi.fn().mockResolvedValue(options.sellerships ?? []) },
    userPhoto: {
      findMany: vi.fn().mockResolvedValue(options.photos ?? [{ storageKey: 'user-photos/u1/p1' }]),
    },
    tryOnJob: {
      findMany: vi.fn().mockResolvedValue(options.tryOns ?? [{ resultKey: 'tryon/j1.webp' }]),
    },
    order: {
      findMany: vi.fn().mockResolvedValue(
        options.orders ?? [
          {
            id: 'o1',
            shippingAddress: {
              firstName: 'Ayşe',
              lastName: 'Yılmaz',
              phone: '05551112233',
              line1: 'Bahçe Sok. No:5',
              city: 'İstanbul',
              district: 'Kadıköy',
            },
            billingAddress: { city: 'İstanbul', district: 'Kadıköy', taxNumberEnc: 'enc:123' },
          },
        ],
      ),
    },
    returnRequest: {
      findMany: vi
        .fn()
        .mockResolvedValue(options.returns ?? [{ id: 'r1', photoKeys: ['returns/r1/0.webp'] }]),
    },
    auditLog: {
      findFirst: vi.fn().mockResolvedValue(options.blockedAuditExists ? { id: 'a1' } : null),
    },
    digitalWardrobeItem: {
      findMany: vi.fn().mockResolvedValue(options.wardrobe ?? [{ photoKey: 'wardrobe/u1/w1' }]),
    },
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  };

  return { prisma, tx };
}

function createJob(options: FakeOptions = {}, storage = createStorage()) {
  const { prisma, tx } = createPrisma(options);
  const notifier = createNotifier();
  const job = new AccountDeletionJob(prisma as never, storage, notifier, silentLogger as never);
  return { job, prisma, tx, storage, notifier };
}

// ═══════════════════════════ SATICI ENGELİ ═════════════════════════════════

describe('blocksDeletion — satıcı engeli kuralı', () => {
  it('mağazası olan satıcı engeller', () => {
    expect(
      blocksDeletion({ status: 'APPROVED', hasStore: true, ledgerEntryCount: 0, payoutCount: 0 }),
    ).toBe(true);
  });

  it('⚠️ hakedişi olan ASKIYA ALINMIŞ satıcı da engeller', () => {
    // Askıya alınmış satıcının ödenmemiş hakedişi olabilir; hesabı silmek o
    // parayı sahipsiz bırakırdı.
    expect(
      blocksDeletion({ status: 'SUSPENDED', hasStore: false, ledgerEntryCount: 3, payoutCount: 0 }),
    ).toBe(true);
  });

  it('bekleyen ödeme talebi engeller', () => {
    expect(
      blocksDeletion({ status: 'REJECTED', hasStore: false, ledgerEntryCount: 0, payoutCount: 1 }),
    ).toBe(true);
  });

  it('onay bekleyen başvuru engeller', () => {
    expect(
      blocksDeletion({ status: 'PENDING', hasStore: false, ledgerEntryCount: 0, payoutCount: 0 }),
    ).toBe(true);
  });

  it('⚠️ reddedilmiş ve hiç iz bırakmamış başvuru ENGELLEMEZ', () => {
    // Aksi hâlde reddedilmiş tek bir başvuru, kullanıcının silme hakkını
    // sonsuza kadar bloke ederdi — hakkın sessizce inkârı.
    expect(
      blocksDeletion({ status: 'REJECTED', hasStore: false, ledgerEntryCount: 0, payoutCount: 0 }),
    ).toBe(false);
  });
});

describe('AccountDeletionJob — satıcı engeli', () => {
  const activeSeller = {
    sellerId: 's1',
    seller: { status: 'APPROVED', store: { id: 'st1' }, _count: { ledgerEntries: 4, payouts: 1 } },
  };

  it('⚠️ aktif satıcılığı olan hesabı SİLMEZ', async () => {
    const { job, storage, tx } = createJob({ sellerships: [activeSeller] });

    const result = await job.run(NOW);

    expect(result.blockedBySeller).toBe(1);
    expect(result.anonymized).toBe(0);
    // Ne depoya ne kullanıcı satırına dokunulmalı.
    expect(storage.deleteMany).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('engeli denetim izine ve olaya yazar — admin görsün', async () => {
    const { job, tx } = createJob({ sellerships: [activeSeller] });

    await job.run(NOW);

    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    const audit = tx.auditLog.create.mock.calls[0]?.[0] as {
      data: { action: string; entityId: string };
    };
    expect(audit.data.action).toBe('user.deletion.blocked');
    expect(audit.data.entityId).toBe('u1');

    const event = tx.outboxEvent.create.mock.calls[0]?.[0] as { data: { type: string } };
    expect(event.data.type).toBe('user.deletion_blocked');
  });

  it('⚠️ aynı engeli her gün yeniden RAPORLAMAZ', async () => {
    // Günlük cron, çözülmeyen tek bir engel için yılda 365 satır yazsaydı
    // gerçek olaylar gürültü içinde kaybolurdu.
    const { job, tx } = createJob({ sellerships: [activeSeller], blockedAuditExists: true });

    const result = await job.run(NOW);

    expect(result.blockedBySeller).toBe(1);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════ SİLME SIRASI ══════════════════════════════════

describe('AccountDeletionJob — silme sırası', () => {
  it('⚠️ ÖNCE depodan siler, SONRA veritabanına yazar', async () => {
    const order: string[] = [];
    const storage = createStorage({
      deleteMany: vi.fn().mockImplementation(() => {
        order.push('storage');
        return Promise.resolve();
      }),
    });
    const { job, prisma } = createJob({}, storage);
    const original = prisma.$transaction;
    prisma.$transaction = vi.fn(async (fn: (client: never) => Promise<unknown>) => {
      order.push('db');
      return original(fn as never);
    });

    await job.run(NOW);

    // Ters sırada olsaydı ve depo silme düşseydi, hangi nesnenin silineceğini
    // bir daha asla öğrenemezdik — fotoğraf sonsuza kadar depoda kalırdı.
    expect(order).toEqual(['storage', 'db']);
  });

  it('fotoğraf, try-on çıktısı, iade kanıtı ve gardırop fotoğrafını TEK seferde siler', async () => {
    const { job, storage } = createJob();

    await job.run(NOW);

    // ⚠️ Dört kaynak TEK çağrıda birleşir: her kaynak için ayrı tur atılsaydı
    //    ilki başarılı, ikincisi başarısız olduğunda kısmen silinmiş bir hesap
    //    kalır ve sonraki tur baştan başlayamazdı.
    expect(storage.deleteMany).toHaveBeenCalledWith(
      ['user-photos/u1/p1', 'tryon/j1.webp', 'returns/r1/0.webp', 'wardrobe/u1/w1'],
      'private',
    );
    expect(storage.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('⚠️ depo silme başarısızsa hesabı silinmiş İŞARETLEMEZ', async () => {
    const storage = createStorage({
      deleteMany: vi.fn().mockRejectedValue(new Error('depo erişilemiyor')),
    });
    const { job, prisma, tx, notifier } = createJob({}, storage);

    const result = await job.run(NOW);

    expect(result.anonymized).toBe(0);
    expect(result.storageFailures).toBe(1);
    // Kayıt açık kalır ve yarın tekrar denenir. "Sildim" deyip silmemiş olmak,
    // hiç denememekten kötüdür.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(notifier.enqueue).not.toHaveBeenCalled();
  });

  it('⚠️ iade kayıtları sipariş bağı KOPARILMADAN ÖNCE temizlenir', async () => {
    // `Order.userId` null'a çekildikten sonra iadeler sipariş üzerinden
    // bulunamazdı; kanıt fotoğrafları depodan silinmiş ama satırda anahtarları
    // duruyor hâlde kalırdı.
    const seen: string[] = [];
    const { job, tx } = createJob();
    tx.returnRequest.updateMany.mockImplementation(() => {
      seen.push('returns');
      return Promise.resolve({ count: 1 });
    });
    tx.order.update.mockImplementation(() => {
      seen.push('orders');
      return Promise.resolve({});
    });

    await job.run(NOW);

    expect(seen).toEqual(['returns', 'orders']);
  });
});

// ═══════════════════════ ANONİMLEŞTİRME KAPSAMI ════════════════════════════

describe('AccountDeletionJob — anonimleştirme kapsamı', () => {
  it('kullanıcı satırını SİLMEZ, kimlik alanlarını temizler', async () => {
    const { job, tx } = createJob();

    const result = await job.run(NOW);

    expect(result.anonymized).toBe(1);
    const update = tx.user.update.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(update.data.status).toBe('DELETED');
    // ⚠️ NULL, sabit bir yer tutucu değil: e-posta ve telefon UNIQUE'tir,
    //    ikinci silme benzersizlik ihlaliyle patlardı.
    expect(update.data.email).toBeNull();
    expect(update.data.phone).toBeNull();
    expect(update.data.passwordHash).toBeNull();
    expect(update.data.firstName).toBeNull();
    expect(update.data.lastName).toBeNull();
    expect(update.data.twoFactorEnabled).toBe(false);
  });

  it('⚠️ SİPARİŞ SİLİNMEZ — userId koparılır, tutar ve tarih kalır', async () => {
    const { job, tx } = createJob();

    await job.run(NOW);

    expect(tx.order.deleteMany).not.toHaveBeenCalled();
    const update = tx.order.update.mock.calls[0]?.[0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(update.where.id).toBe('o1');
    expect(update.data.userId).toBeNull();
    expect(update.data.email).toBe(ORDER_CONTACT_TOMBSTONE.email);
    expect(update.data.phone).toBe(ORDER_CONTACT_TOMBSTONE.phone);
    // Tutar alanlarına dokunulmamalı — muhasebe kaydı bozulmaz.
    expect(update.data).not.toHaveProperty('grandTotalMinor');
    expect(update.data).not.toHaveProperty('itemsTotalMinor');
  });

  it('⚠️ sipariş adres anlık görüntüsündeki kimlik alanları silinir', async () => {
    const { job, tx } = createJob();

    await job.run(NOW);

    const update = tx.order.update.mock.calls[0]?.[0] as {
      data: { shippingAddress: Record<string, unknown> };
    };
    const address = update.data.shippingAddress;
    // Sipariş "duruyor" diye atlanan bu alan, kişisel verinin hiç silinmediği
    // en sık yerdir: ad, telefon ve açık adres sipariş içinde saklanır.
    expect(address).not.toHaveProperty('firstName');
    expect(address).not.toHaveProperty('lastName');
    expect(address).not.toHaveProperty('phone');
    expect(address).not.toHaveProperty('line1');
    // İl/ilçe raporlama verisidir, tek başına kişiyi göstermez.
    expect(address.city).toBe('İstanbul');
    expect(address.district).toBe('Kadıköy');
  });

  it('⚠️ LEDGER, KOMİSYON ve PAYOUT tablolarına HİÇ dokunmaz', async () => {
    const { job, tx } = createJob();

    await job.run(NOW);

    // Muhasebe bütünlüğü kişisel veri talebiyle bozulamaz (VUK/TTK: 10 yıl).
    expect(tx.ledgerEntry.deleteMany).not.toHaveBeenCalled();
    expect(tx.ledgerEntry.updateMany).not.toHaveBeenCalled();
    expect(tx.payoutRequest.deleteMany).not.toHaveBeenCalled();
    expect(tx.payoutRequest.updateMany).not.toHaveBeenCalled();
    // Sipariş kalemi ve paketi de silinmez: satıcı hakedişinin dayanağıdır.
    expect(tx.orderItem.deleteMany).not.toHaveBeenCalled();
    expect(tx.orderPackage.deleteMany).not.toHaveBeenCalled();
  });

  it('⚠️ ConsentRecord SİLİNMEZ — silme talebinin kendisi kayıt altında kalmalı', async () => {
    const { job, tx } = createJob();

    await job.run(NOW);

    expect(tx.consentRecord.deleteMany).not.toHaveBeenCalled();
    expect(tx.consentRecord.updateMany).not.toHaveBeenCalled();
  });

  it('oturum, adres, sepet, favori ve kombinleri siler', async () => {
    const { job, tx } = createJob();

    await job.run(NOW);

    expect(tx.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(tx.address.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(tx.cart.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(tx.favorite.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(tx.outfit.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(tx.userPhoto.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(tx.socialAccount.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(tx.stylistConversation.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });

  /**
   * ⚠️ `user_wardrobe_items.userId` üzerinde ON DELETE CASCADE tanımlı, ama bu
   *    iş kullanıcı SATIRINI silmiyor — `status = 'DELETED'` ile güncelliyor.
   *    Yani cascade hiç tetiklenmez. Açık `deleteMany` düşerse gardırop
   *    satırları sessizce hayatta kalır ve hiçbir test bunu fark etmez.
   */
  it('⚠️ dijital gardırobu AÇIKÇA siler — FK cascade tetiklenmiyor', async () => {
    const { job, tx } = createJob();

    await job.run(NOW);

    expect(tx.digitalWardrobeItem.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });

  it('gardırop fotoğrafını DEPODAN da siler', async () => {
    const { job, storage } = createJob();

    await job.run(NOW);

    const deleted = storage.deleteMany.mock.calls.flatMap(([keys]) => keys);
    expect(deleted).toContain('wardrobe/u1/w1');
  });

  /**
   * ⚠️ `productImageKey` satıcının PUBLIC ürün görselidir ve başka kullanıcılar
   *    da onu görür. Silinseydi, hesabını kapatan tek bir kullanıcı yüzünden o
   *    ürünün görseli tüm katalogdan kaybolurdu.
   */
  it('⚠️ satın alınan ürünün görselini SİLMEZ — o satıcının public nesnesi', async () => {
    const { job, prisma, storage } = createJob();

    await job.run(NOW);

    // Sorgu yalnızca `photoKey` seçiyor; `productImageKey` hiç okunmuyor.
    expect(prisma.digitalWardrobeItem.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', photoKey: { not: null } },
      select: { photoKey: true },
    });

    const deleted = storage.deleteMany.mock.calls.flatMap(([keys]) => keys);
    expect(deleted.some((key: string) => key.startsWith('products/'))).toBe(false);
  });

  it('gardırop fotoğrafı silinemezse hesap anonimleştirilmez', async () => {
    const storage = createStorage();
    storage.deleteMany.mockRejectedValue(new Error('R2 ulaşılamıyor'));
    const { job, tx } = createJob({}, storage);

    const outcome = await job.run(NOW);

    expect(outcome.storageFailures).toBe(1);
    expect(tx.digitalWardrobeItem.deleteMany).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('AI maliyet kaydını siler değil, kişi bağını koparır', async () => {
    const { job, tx } = createJob();

    await job.run(NOW);

    // Fatura açıklanabilir kalmalı; kim harcadı bilgisi gitmeli.
    expect(tx.aiUsageLog.deleteMany).not.toHaveBeenCalled();
    expect(tx.aiUsageLog.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      data: { userId: null },
    });
  });

  it('denetim izi ve KİŞİSEL VERİ İÇERMEYEN olay yazar', async () => {
    const { job, tx } = createJob();

    await job.run(NOW);

    const audit = tx.auditLog.create.mock.calls[0]?.[0] as { data: { action: string } };
    expect(audit.data.action).toBe('user.deletion.executed');

    const event = tx.outboxEvent.create.mock.calls[0]?.[0] as {
      data: { type: string; payload: Record<string, unknown> };
    };
    expect(event.data.type).toBe('user.account_deleted');
    // ⚠️ Outbox satırı KALICIDIR. E-posta veya ad yazılsaydı, silinen kişinin
    //    verisi silme olayının kendi kaydında yaşamaya devam ederdi.
    expect(JSON.stringify(event.data.payload)).not.toContain('ayse@example.com');
  });

  it('silme tamamlandıktan SONRA bildirim kuyruğa alınır', async () => {
    const { job, notifier } = createJob();

    await job.run(NOW);

    expect(notifier.enqueue).toHaveBeenCalledTimes(1);
    const message = notifier.enqueue.mock.calls[0]?.[0] as {
      to: string;
      channel: string;
      messageId: string;
    };
    expect(message.to).toBe('ayse@example.com');
    expect(message.channel).toBe('EMAIL');
    // Deterministik kimlik: iş iki kez çalışsa da tek e-posta gider.
    expect(message.messageId).toBe('kvkk:account-deleted:u1');
  });

  it('bildirim kuyruğa alınamazsa silme GERİ ALINMAZ', async () => {
    const { job, notifier, tx } = createJob();
    notifier.enqueue.mockRejectedValue(new Error('redis yok'));

    const result = await job.run(NOW);

    expect(result.anonymized).toBe(1);
    expect(tx.user.update).toHaveBeenCalled();
  });

  it('e-posta adresi olmayan hesapta bildirim denenmez', async () => {
    const { job, notifier } = createJob({
      users: [{ id: 'u1', email: null, role: 'CUSTOMER', deletionRequestedAt: REQUESTED_AT }],
    });

    const result = await job.run(NOW);

    expect(result.anonymized).toBe(1);
    expect(notifier.enqueue).not.toHaveBeenCalled();
  });

  it('süresi dolmuş talep yoksa hiçbir şey yapmaz', async () => {
    const { job, storage, prisma } = createJob({ users: [] });

    const result = await job.run(NOW);

    expect(result).toEqual({
      scanned: 0,
      anonymized: 0,
      blockedBySeller: 0,
      storageFailures: 0,
    });
    expect(storage.deleteMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('redactAddressSnapshot', () => {
  it('yalnızca il/ilçe bırakır ve temizlenme anını yazar', () => {
    const redacted = redactAddressSnapshot(
      {
        firstName: 'Ayşe',
        lastName: 'Yılmaz',
        phone: '05551112233',
        line1: 'Bahçe Sok. No:5',
        postalCode: '34710',
        taxNumberEnc: 'enc:123',
        city: 'İstanbul',
        district: 'Kadıköy',
      },
      NOW,
    ) as Record<string, unknown>;

    expect(Object.keys(redacted).sort()).toEqual(['city', 'district', 'kvkkRedactedAt']);
    expect(redacted.kvkkRedactedAt).toBe(NOW.toISOString());
  });

  it('⚠️ bozuk/eksik anlık görüntüde de PATLAMAZ', () => {
    // Anlık görüntü JSON'dur ve şemayla korunmaz; eski siparişlerde alanlar
    // eksik olabilir. Burada fırlatan bir kod, o kullanıcının hesabını
    // sonsuza kadar silinemez hâle getirirdi.
    const redacted = redactAddressSnapshot(null, NOW) as Record<string, unknown>;
    expect(redacted.city).toBeNull();
    expect(redacted.district).toBeNull();
  });
});
