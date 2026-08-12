import { inflateRawSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import type { StorageProvider } from '@vt/adapters';
import type { KvkkNotifier } from './account-deletion.job.js';
import {
  DATA_EXPORT_LINK_HOURS,
  DataExportJob,
  buildExportDocument,
  createZipArchive,
  toExportOrder,
  type RawExportData,
  type RawOrder,
} from './data-export.job.js';

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

const NOW = new Date('2026-08-12T12:00:00.000Z');
const REQUESTED_AT = new Date('2026-08-12T11:00:00.000Z');

// ═══════════════════════════ ZIP YAZICI ════════════════════════════════════

/** Arşivin ilk kaydını okur — kütüphane olmadığı için elle. */
function readFirstEntry(zip: Buffer): { name: string; data: Buffer } {
  const nameLength = zip.readUInt16LE(26);
  const extraLength = zip.readUInt16LE(28);
  const compressedSize = zip.readUInt32LE(18);
  const name = zip.subarray(30, 30 + nameLength).toString('utf8');
  const start = 30 + nameLength + extraLength;
  return { name, data: inflateRawSync(zip.subarray(start, start + compressedSize)) };
}

describe('createZipArchive', () => {
  it('okunabilir bir ZIP üretir', () => {
    const payload = Buffer.from('{"merhaba":"dünya"}', 'utf8');
    const zip = createZipArchive([{ name: 'veriler.json', data: payload }]);

    expect(zip.readUInt32LE(0)).toBe(0x04034b50); // yerel başlık imzası
    const entry = readFirstEntry(zip);
    expect(entry.name).toBe('veriler.json');
    expect(entry.data.toString('utf8')).toBe('{"merhaba":"dünya"}');
  });

  it('merkezî dizin kayıt sayısını doğru yazar', () => {
    const zip = createZipArchive([
      { name: 'a.txt', data: Buffer.from('a') },
      { name: 'fotograflar/b.webp', data: Buffer.from('bb') },
      { name: 'c.txt', data: Buffer.from('ccc') },
    ]);

    // EOCD son 22 bayttır; kayıt sayısı 8. ve 10. ofsetlerde.
    const eocd = zip.subarray(zip.length - 22);
    expect(eocd.readUInt32LE(0)).toBe(0x06054b50);
    expect(eocd.readUInt16LE(8)).toBe(3);
    expect(eocd.readUInt16LE(10)).toBe(3);
  });

  it('boş arşiv de geçerlidir', () => {
    const zip = createZipArchive([]);
    expect(zip.length).toBe(22);
    expect(zip.readUInt32LE(0)).toBe(0x06054b50);
  });
});

// ═══════════════ ⚠️ BAŞKASININ VERİSİ ARŞİVE GİRMEZ ════════════════════════

const orderWithSellerData: RawOrder = {
  orderNumber: 'VT-260811-0042',
  status: 'DELIVERED',
  createdAt: new Date('2026-08-01T10:00:00.000Z'),
  currency: 'TRY',
  itemsTotalMinor: 25_000n,
  shippingTotalMinor: 2_990n,
  discountMinor: 0n,
  grandTotalMinor: 27_990n,
  shippingAddress: { city: 'İzmir' },
  billingAddress: { city: 'İzmir' },
  items: [
    {
      productTitle: 'Keten Gömlek',
      brandName: 'Marka',
      variantLabel: 'Siyah / M',
      sku: 'KG-S-M',
      quantity: 1,
      unitPriceMinor: 25_000n,
      lineTotalMinor: 25_000n,
      // ⚠️ SATICININ ticari verisi — arşive GİRMEMELİ.
      commissionRateBps: 1250,
      commissionAmountMinor: 3_125n,
      sellerNetMinor: 21_875n,
      commissionRuleVersionId: 'crv-1',
      packageId: 'pkg-1',
    },
  ],
  packages: [{ sellerId: 'seller-42', status: 'DELIVERED', carrier: 'Kargo A' }],
};

describe('toExportOrder — ⚠️ satıcı verisi sızmaz', () => {
  it('komisyon oranını, tutarını ve satıcı hakedişini YAZMAZ', () => {
    const exported = toExportOrder(orderWithSellerData);
    const text = JSON.stringify(exported, (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    );

    // Kendi verisini isteyen kullanıcıya platformun komisyon marjını göndermek,
    // bir hakkı yerine getirirken başkasınınkini ihlal etmektir.
    expect(text).not.toContain('1250');
    expect(text).not.toContain('3125');
    expect(text).not.toContain('21875');
    expect(text).not.toContain('crv-1');
    expect(text).not.toContain('seller-42');
    expect(text).not.toContain('pkg-1');
  });

  it('kullanıcıyı ilgilendiren alanları TAM yazar', () => {
    const exported = toExportOrder(orderWithSellerData) as {
      siparisNo: string;
      genelToplamKurus: bigint;
      kalemler: Array<Record<string, unknown>>;
    };

    expect(exported.siparisNo).toBe('VT-260811-0042');
    expect(exported.genelToplamKurus).toBe(27_990n);
    expect(exported.kalemler[0]).toEqual({
      urun: 'Keten Gömlek',
      marka: 'Marka',
      secenek: 'Siyah / M',
      stokKodu: 'KG-S-M',
      adet: 1,
      birimFiyatKurus: 25_000n,
      satirToplamiKurus: 25_000n,
    });
  });

  it('⚠️ paket bilgisi hiç yazılmaz — hangi satıcı gönderdi bilgisi arşivde kalıcılaşmaz', () => {
    expect(toExportOrder(orderWithSellerData)).not.toHaveProperty('packages');
    expect(toExportOrder(orderWithSellerData)).not.toHaveProperty('paketler');
  });
});

function rawData(overrides: Partial<RawExportData> = {}): RawExportData {
  return {
    user: {
      id: 'u1',
      email: 'ayse@example.com',
      phone: '05551112233',
      firstName: 'Ayşe',
      lastName: 'Yılmaz',
      locale: 'tr-TR',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    addresses: [],
    bodyProfile: null,
    consents: [
      {
        type: 'PHOTO_PROCESSING',
        granted: true,
        documentVersion: 'v1.2',
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    ],
    orders: [orderWithSellerData],
    favorites: [],
    outfits: [],
    tryOnJobs: [],
    photos: [],
    stylistMessages: [],
    sessions: [],
    ...overrides,
  };
}

describe('buildExportDocument', () => {
  it('satıcı verisini belge düzeyinde de taşımaz', () => {
    const document = buildExportDocument(rawData(), {
      generatedAt: NOW,
      linkExpiresAt: new Date(NOW.getTime() + 48 * 3600 * 1000),
      missingFiles: [],
    });

    const text = JSON.stringify(document, (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    expect(text).not.toContain('seller-42');
    expect(text).not.toContain('21875');
  });

  it('⚠️ eksik dosyaları AÇIKÇA listeler', () => {
    const document = buildExportDocument(rawData(), {
      generatedAt: NOW,
      linkExpiresAt: NOW,
      missingFiles: [{ name: 'fotograflar/p1', reason: 'depo-hatasi' }],
    }) as { eksikDosyalar: unknown[] };

    // Sessizce eksik teslim edilen bir arşiv, kullanıcıya "hepsi bu" der.
    expect(document.eksikDosyalar).toEqual([{ name: 'fotograflar/p1', reason: 'depo-hatasi' }]);
  });

  it('rıza geçmişini kayıp vermeden yazar', () => {
    const document = buildExportDocument(rawData(), {
      generatedAt: NOW,
      linkExpiresAt: NOW,
      missingFiles: [],
    }) as { rizaGecmisi: Array<Record<string, unknown>> };

    expect(document.rizaGecmisi).toHaveLength(1);
    expect(document.rizaGecmisi[0]?.metinSurumu).toBe('v1.2');
  });
});

// ══════════════════════════════ İŞ ═════════════════════════════════════════

function createStorage(overrides: Partial<StorageProvider> = {}): StorageProvider {
  return {
    name: 'test',
    put: vi.fn().mockResolvedValue({ key: 'k', etag: 'e' }),
    get: vi.fn().mockResolvedValue(Buffer.from('görsel')),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    exists: vi.fn(),
    signedUrl: vi.fn().mockResolvedValue('https://depo.example/imzali?sig=GIZLI-IMZA'),
    publicUrl: (key: string) => key,
    ...overrides,
  } as StorageProvider;
}

interface JobOptions {
  events?: Array<{ id: string; aggregateId: string; createdAt: Date }>;
  user?: { id: string; email: string | null; role: string; status: string } | null;
  lockExists?: boolean;
  photos?: Array<Record<string, unknown>>;
  tryOns?: Array<Record<string, unknown>>;
}

/**
 * ⚠️ Sahte `userPhoto`/`tryOnJob` satırları HER İKİ `select`'in alanlarını da
 *    taşır: iş bu tabloları iki kez okur (manifest için üstveri, arşiv için
 *    depo anahtarı) ve sahte tek bir yanıt döndürür.
 */
function createJob(options: JobOptions = {}, storage = createStorage()) {
  const photos = options.photos ?? [
    {
      id: 'p1',
      storageKey: 'user-photos/u1/p1',
      purpose: 'SAVED_PROFILE',
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      expiresAt: new Date('2026-09-29T00:00:00.000Z'),
    },
  ];
  const tryOns = options.tryOns ?? [];

  const prisma = {
    outboxEvent: {
      findMany: vi
        .fn()
        .mockResolvedValue(
          options.events ?? [{ id: 'evt-1', aggregateId: 'u1', createdAt: REQUESTED_AT }],
        ),
    },
    auditLog: {
      findFirst: vi.fn().mockResolvedValue(options.lockExists ? { id: 'a1' } : null),
      create: vi.fn().mockResolvedValue({}),
    },
    user: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          options.user === undefined
            ? { id: 'u1', email: 'ayse@example.com', role: 'CUSTOMER', status: 'ACTIVE' }
            : options.user,
        ),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: 'u1',
        email: 'ayse@example.com',
        phone: '0555',
        firstName: 'Ayşe',
        lastName: 'Yılmaz',
        locale: 'tr-TR',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    },
    address: { findMany: vi.fn().mockResolvedValue([]) },
    bodyProfile: { findUnique: vi.fn().mockResolvedValue(null) },
    consentRecord: { findMany: vi.fn().mockResolvedValue([]) },
    order: { findMany: vi.fn().mockResolvedValue([orderWithSellerData]) },
    favorite: { findMany: vi.fn().mockResolvedValue([]) },
    outfit: { findMany: vi.fn().mockResolvedValue([]) },
    tryOnJob: { findMany: vi.fn().mockResolvedValue(tryOns) },
    userPhoto: { findMany: vi.fn().mockResolvedValue(photos) },
    stylistMessage: { findMany: vi.fn().mockResolvedValue([]) },
    session: { findMany: vi.fn().mockResolvedValue([]) },
  };

  const notifier: KvkkNotifier = { enqueue: vi.fn().mockResolvedValue(undefined) };
  const job = new DataExportJob(prisma as never, storage, notifier, silentLogger as never);
  return { job, prisma, storage, notifier: notifier as { enqueue: ReturnType<typeof vi.fn> } };
}

describe('DataExportJob', () => {
  it('arşivi PRIVATE kovaya yazar', async () => {
    const { job, storage } = createJob();

    const result = await job.run(NOW);

    expect(result.prepared).toBe(1);
    const put = (storage.put as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      key: string;
      visibility: string;
      contentType: string;
    };
    // ⚠️ Bu dosya kullanıcının her şeyidir; public kovaya yazılması tek başına
    //    bir veri ihlalidir.
    expect(put.visibility).toBe('private');
    expect(put.key).toBe('exports/u1/evt-1.zip');
    expect(put.contentType).toBe('application/zip');
  });

  it('⚠️ imzalı bağlantı 48 saatten uzun yaşamaz', async () => {
    const { job, storage } = createJob();

    await job.run(NOW);

    const signed = (storage.signedUrl as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      expiresInSeconds: number;
      visibility: string;
    };
    expect(signed.visibility).toBe('private');
    expect(signed.expiresInSeconds).toBeLessThanOrEqual(DATA_EXPORT_LINK_HOURS * 3600);
    // Talep bir saat önce açıldı; kalan ömür 47 saat.
    expect(signed.expiresInSeconds).toBe(47 * 3600);
  });

  it('⚠️ İMZALI URL denetim izine YAZILMAZ', async () => {
    const { job, prisma } = createJob();

    await job.run(NOW);

    const audit = prisma.auditLog.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    // İmza, dosyanın kendisine erişim yetkisidir: denetim kaydını okuyabilen
    // herkes arşivi indirebilirdi.
    expect(JSON.stringify(audit.data)).not.toContain('GIZLI-IMZA');
    expect(audit.data.action).toBe('user.data_export.prepared');
    expect(audit.data.entityType).toBe('DataExport');
    expect(audit.data.entityId).toBe('evt-1');
  });

  it('⚠️ AYNI talebi ikinci kez işlemez', async () => {
    const { job, storage, notifier } = createJob({ lockExists: true });

    const result = await job.run(NOW);

    expect(result.skipped).toBe(1);
    expect(result.prepared).toBe(0);
    // Kilit olmasaydı kullanıcı her beş dakikada bir "arşiviniz hazır" e-postası
    // alırdı — outbox teslimatı en az bir kezdir.
    expect(storage.put).not.toHaveBeenCalled();
    expect(notifier.enqueue).not.toHaveBeenCalled();
  });

  it('⚠️ SİLİNMİŞ hesap için arşiv üretmez ama talebi kapatır', async () => {
    const { job, storage, prisma } = createJob({
      user: { id: 'u1', email: null, role: 'CUSTOMER', status: 'DELETED' },
    });

    const result = await job.run(NOW);

    expect(result.skipped).toBe(1);
    expect(storage.put).not.toHaveBeenCalled();
    const audit = prisma.auditLog.create.mock.calls[0]?.[0] as {
      data: { action: string; after: Record<string, unknown> };
    };
    expect(audit.data.action).toBe('user.data_export.skipped');
    expect(audit.data.after.reason).toBe('hesap-silinmis');
  });

  it('e-postayı imzalı bağlantıyla ve deterministik kimlikle kuyruğa alır', async () => {
    const { job, notifier } = createJob();

    await job.run(NOW);

    const message = notifier.enqueue.mock.calls[0]?.[0] as {
      channel: string;
      to: string;
      variables: Record<string, string>;
      messageId: string;
    };
    expect(message.channel).toBe('EMAIL');
    expect(message.to).toBe('ayse@example.com');
    expect(message.variables.link).toContain('GIZLI-IMZA');
    expect(message.messageId).toBe('kvkk:data-export:evt-1');
  });

  it('⚠️ tek bir dosya okunamazsa arşiv YİNE hazırlanır, eksik açıkça yazılır', async () => {
    const storage = createStorage({
      get: vi.fn().mockRejectedValue(new Error('nesne yok')),
    });
    const { job } = createJob({}, storage);

    const result = await job.run(NOW);

    // Yüzlerce dosyalık bir arşivi tek eksik nesne yüzünden hiç üretmemek,
    // kullanıcıya hiçbir şey vermemektir.
    expect(result.prepared).toBe(1);
    const put = (storage.put as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { body: Buffer };
    const manifest = readFirstEntry(put.body);
    expect(manifest.name).toBe('veriler.json');
    expect(manifest.data.toString('utf8')).toContain('depo-hatasi');
  });

  it('kullanıcı fotoğrafını arşive ekler', async () => {
    const { job, storage } = createJob();

    await job.run(NOW);

    expect(storage.get).toHaveBeenCalledWith('user-photos/u1/p1', 'private');
    const put = (storage.put as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { body: Buffer };
    // veriler.json + 1 fotoğraf
    expect(put.body.subarray(put.body.length - 22).readUInt16LE(8)).toBe(2);
  });

  it('⚠️ hazırlık patlarsa kilit YAZILMAZ — talep sonraki turda tekrar denenir', async () => {
    const storage = createStorage({ put: vi.fn().mockRejectedValue(new Error('depo düştü')) });
    const { job, prisma } = createJob({}, storage);

    const result = await job.run(NOW);

    expect(result.failed).toBe(1);
    // Hata anında kilit atılsaydı, geçici bir depo arızası kullanıcının hakkını
    // sessizce iptal ederdi.
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('bekleyen talep yoksa hiçbir şey yapmaz', async () => {
    const { job, storage } = createJob({ events: [] });

    const result = await job.run(NOW);

    expect(result).toEqual({ scanned: 0, prepared: 0, skipped: 0, failed: 0 });
    expect(storage.put).not.toHaveBeenCalled();
  });
});
