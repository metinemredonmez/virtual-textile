import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@vt/contracts';
import { resetEnvCache } from '@vt/config';
import { TryOnService } from './tryon.service.js';
import { LocalTryOnCacheKeyAdapter } from './ai.gateway.js';
import type { ConsentPort, TryOnCatalogPort, TryOnStoragePort } from './ai.ports.js';
import type { ConsentRecordLike } from './consent.rules.js';

/**
 * ⚠️ BU DOSYA BİR KVKK GÜVENCESİNİ KORUR.
 *
 * Sınanan şey yalnızca "doğru hata kodu dönüyor mu" değil: rıza eksikken
 * ÜRETİM ZİNCİRİNİN HİÇ BAŞLAMADIĞI. Yani ne iş kaydı açılıyor, ne outbox
 * olayı yazılıyor — fotoğrafın yurt dışına çıkmasına giden yol hiç açılmıyor.
 */

const REQUIRED_ENV: Record<string, string> = {
  APP_URL: 'https://example.com',
  API_URL: 'https://api.example.com',
  CORS_ORIGINS: 'https://example.com',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(128),
  JWT_REFRESH_SECRET: 'b'.repeat(128),
  FIELD_ENCRYPTION_KEY: 'c'.repeat(64),
  INTERNAL_API_TOKEN: 'd'.repeat(32),
};

function useTestEnv(): void {
  for (const [key, value] of Object.entries(REQUIRED_ENV)) process.env[key] = value;
  // Kotayı testte belirleyici kılmak için sabitliyoruz.
  process.env.AI_TRYON_DAILY_PER_USER = '3';
  resetEnvCache();
}

const granted = (type: ConsentRecordLike['type']): ConsentRecordLike => ({
  type,
  granted: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
});

const revoked = (type: ConsentRecordLike['type']): ConsentRecordLike => ({
  type,
  granted: false,
  createdAt: new Date('2026-06-01T00:00:00Z'),
});

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function createPrisma(overrides: Record<string, unknown> = {}) {
  const tx = {
    tryOnJob: { create: vi.fn().mockResolvedValue({ id: 'job-1' }) },
    outboxEvent: { create: vi.fn().mockResolvedValue({ id: 'evt-1' }) },
  };

  const prisma = {
    userPhoto: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'photo-1',
        contentHash: 'hash-1',
        qualityScore: 85,
        qualityIssues: null,
      }),
    },
    tryOnJob: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
    },
    aiUsageLog: {
      create: vi.fn().mockResolvedValue({}),
      aggregate: vi.fn().mockResolvedValue({ _sum: { costMicroUsd: 0n } }),
    },
    $transaction: vi.fn(async (callback: (t: typeof tx) => Promise<unknown>) => callback(tx)),
    ...overrides,
  };

  return { prisma, tx };
}

function createCatalog(): TryOnCatalogPort {
  return {
    findVariant: vi.fn().mockResolvedValue({
      variantId: 'variant-1',
      productId: 'product-1',
      productTitle: 'Oversize Gömlek',
      size: 'M',
      color: 'Siyah',
      tryOnCategory: 'UPPER_BODY',
      imageKey: 'products/product-1/img/1024.webp',
      sizeChart: null,
      brandFit: null,
      isPurchasable: true,
    }),
    findProductForSizing: vi.fn(),
    findProductIdByVariant: vi.fn(),
  };
}

function createStorage(): TryOnStoragePort {
  return { signedResultUrl: vi.fn().mockResolvedValue('https://signed.example/result') };
}

function build(records: ConsentRecordLike[], prismaOverrides: Record<string, unknown> = {}) {
  const { prisma, tx } = createPrisma(prismaOverrides);
  const consents: ConsentPort = { findRecords: vi.fn().mockResolvedValue(records) };
  const catalog = createCatalog();
  const storage = createStorage();

  const service = new TryOnService(
    prisma as never,
    consents,
    catalog,
    storage,
    new LocalTryOnCacheKeyAdapter(),
    silentLogger as never,
  );

  return { service, prisma, tx, consents, catalog, storage };
}

const INPUT = { userPhotoId: 'photo-1', variantId: 'variant-1', mode: 'FAST' as const };
const ACTOR = { userId: 'user-1' };

beforeEach(() => {
  vi.clearAllMocks();
  useTestEnv();
});

describe('POST /tryon — rıza kapısı', () => {
  it('hiç rıza kaydı yoksa CONSENT_REQUIRED fırlatır', async () => {
    const { service } = build([]);

    await expect(service.create(INPUT, ACTOR)).rejects.toMatchObject({
      code: 'CONSENT_REQUIRED',
    });
  });

  it('yurt dışı aktarım rızası yoksa CONSENT_CROSS_BORDER_REQUIRED fırlatır', async () => {
    // Fotoğraf işleme rızası tek başına yetmez: aktarım ayrı bir rızadır.
    const { service } = build([granted('PHOTO_PROCESSING')]);

    await expect(service.create(INPUT, ACTOR)).rejects.toMatchObject({
      code: 'CONSENT_CROSS_BORDER_REQUIRED',
    });
  });

  it('aktarım rızası geri çekilmişse reddeder', async () => {
    const { service } = build([
      granted('PHOTO_PROCESSING'),
      granted('CROSS_BORDER_TRANSFER'),
      revoked('CROSS_BORDER_TRANSFER'),
    ]);

    await expect(service.create(INPUT, ACTOR)).rejects.toMatchObject({
      code: 'CONSENT_CROSS_BORDER_REQUIRED',
    });
  });

  it('rıza eksikken HİÇBİR ÜRETİM İZİ bırakmaz', async () => {
    // ⚠️ Asıl güvence bu: iş kaydı da outbox olayı da yazılmamalı. Yazılsaydı
    // worker fotoğrafı yurt dışına gönderirdi.
    const { service, prisma, tx } = build([granted('PHOTO_PROCESSING')]);

    await expect(service.create(INPUT, ACTOR)).rejects.toBeInstanceOf(AppError);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.tryOnJob.create).not.toHaveBeenCalled();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('rıza kontrolü fotoğraf ve ürün okumasından ÖNCE yapılır', async () => {
    // Sıra önemli: rızasız bir istekte kullanıcının fotoğraf kaydına
    // dokunmaya bile gerek yok.
    const { service, prisma, catalog } = build([]);

    await expect(service.create(INPUT, ACTOR)).rejects.toBeInstanceOf(AppError);

    expect(prisma.userPhoto.findFirst).not.toHaveBeenCalled();
    expect(catalog.findVariant).not.toHaveBeenCalled();
  });

  it('yalnızca sanal deneme için gereken rıza türlerini sorgular', async () => {
    const { service, consents } = build([
      granted('PHOTO_PROCESSING'),
      granted('CROSS_BORDER_TRANSFER'),
    ]);

    await service.create(INPUT, ACTOR);

    expect(consents.findRecords).toHaveBeenCalledWith('user-1', [
      'PHOTO_PROCESSING',
      'CROSS_BORDER_TRANSFER',
    ]);
  });
});

describe('POST /tryon — rıza tamken akış', () => {
  const bothGranted = [granted('PHOTO_PROCESSING'), granted('CROSS_BORDER_TRANSFER')];

  it('işi ve outbox olayını AYNI transaction içinde yazar, 202 için veri döner', async () => {
    const { service, prisma, tx } = build(bothGranted);

    const result = await service.create(INPUT, ACTOR);

    expect(result).toMatchObject({ outcome: 'QUEUED', jobId: 'job-1' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.tryOnJob.create).toHaveBeenCalledTimes(1);
    expect(tx.outboxEvent.create).toHaveBeenCalledTimes(1);

    // ⚠️ Kuyruğa doğrudan yazılmaz; olay outbox üzerinden taşınır.
    const event = tx.outboxEvent.create.mock.calls[0]?.[0] as {
      data: { type: string; payload: Record<string, unknown> };
    };
    expect(event.data.type).toBe('tryon.requested');
    expect(event.data.payload).toMatchObject({ tryOnJobId: 'job-1', mode: 'FAST' });
    expect(event.data.payload.cacheKey).toEqual(expect.any(String));
  });

  it('önbellek isabetinde üretim yapmaz, maliyet 0 ve cacheHit=true yazar', async () => {
    const {
      service,
      prisma: db,
      tx,
    } = build(bothGranted, {
      tryOnJob: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'cached-job',
          resultKey: 'tryon/cached-job.webp',
          visualConfidence: 82,
        }),
        findUnique: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
      },
    });

    const result = await service.create(INPUT, ACTOR);

    expect(result).toMatchObject({ outcome: 'CACHED', jobId: 'cached-job' });
    // Yeni iş açılmaz: en büyük maliyet kaldıracı budur.
    expect(tx.tryOnJob.create).not.toHaveBeenCalled();

    const log = db.aiUsageLog.create.mock.calls[0]?.[0] as {
      data: { cacheHit: boolean; costMicroUsd: bigint; success: boolean };
    };
    expect(log.data.cacheHit).toBe(true);
    expect(log.data.costMicroUsd).toBe(0n);
    expect(log.data.success).toBe(true);
  });

  it('önbellek isabeti KOTADAN DÜŞMEZ', async () => {
    const { service } = build(bothGranted, {
      tryOnJob: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'cached-job',
          resultKey: 'tryon/cached-job.webp',
          visualConfidence: 90,
        }),
        findUnique: vi.fn(),
        // Kota zaten dolu; önbellek isabeti yine de dönmeli.
        count: vi.fn().mockResolvedValue(99),
      },
    });

    await expect(service.create(INPUT, ACTOR)).resolves.toMatchObject({ outcome: 'CACHED' });
  });

  it('günlük kota dolduysa TRYON_QUOTA_EXCEEDED fırlatır ve iş açmaz', async () => {
    const { service, tx } = build(bothGranted, {
      tryOnJob: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn(),
        count: vi.fn().mockResolvedValue(3), // AI_TRYON_DAILY_PER_USER = 3
      },
    });

    await expect(service.create(INPUT, ACTOR)).rejects.toMatchObject({
      code: 'TRYON_QUOTA_EXCEEDED',
    });
    expect(tx.tryOnJob.create).not.toHaveBeenCalled();
  });

  it('try-on desteklenmeyen kategoride üretim başlatmaz', async () => {
    const { service, catalog, tx } = build(bothGranted);
    (catalog.findVariant as ReturnType<typeof vi.fn>).mockResolvedValue({
      variantId: 'variant-1',
      productId: 'product-1',
      productTitle: 'Kolye',
      size: 'TEK EBAT',
      color: 'Altın',
      tryOnCategory: null,
      imageKey: 'products/p/1.webp',
      sizeChart: null,
      brandFit: null,
      isPurchasable: true,
    });

    await expect(service.create(INPUT, ACTOR)).rejects.toMatchObject({
      code: 'PRODUCT_NOT_TRYONABLE',
    });
    expect(tx.tryOnJob.create).not.toHaveBeenCalled();
  });

  it('süresi dolmuş veya başkasına ait fotoğrafta PHOTO_NOT_FOUND döner', async () => {
    // Sorgu sahiplik + süre + silinmişlik koşullarını birlikte taşır;
    // eşleşme yoksa ayrım yapmadan "bulunamadı" denir.
    const { service } = build(bothGranted, {
      userPhoto: { findFirst: vi.fn().mockResolvedValue(null) },
    });

    await expect(service.create(INPUT, ACTOR)).rejects.toMatchObject({
      code: 'PHOTO_NOT_FOUND',
    });
  });
});
