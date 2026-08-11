import { describe, expect, it, vi } from 'vitest';
import type { StorageProvider } from '@vt/adapters';
import { PhotoRetentionJob } from './photo-retention.job.js';

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

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

function createPrisma(photos: Array<{ id: string; storageKey: string }>, derived: string[] = []) {
  return {
    userPhoto: {
      findMany: vi.fn().mockResolvedValue(photos.map((p) => ({ ...p, userId: 'u1' }))),
      update: vi.fn().mockResolvedValue({}),
    },
    tryOnJob: {
      findMany: vi
        .fn()
        .mockResolvedValue(derived.map((key, i) => ({ id: `j${i}`, resultKey: key }))),
      updateMany: vi.fn().mockResolvedValue({ count: derived.length }),
    },
    $transaction: vi.fn().mockResolvedValue([]),
  };
}

describe('PhotoRetentionJob', () => {
  it('süresi dolmuş fotoğraf yoksa hiçbir şey yapmaz', async () => {
    const storage = createStorage();
    const prisma = createPrisma([]);
    const job = new PhotoRetentionJob(prisma as never, storage, silentLogger as never);

    const result = await job.run();

    expect(result).toEqual({ scanned: 0, deleted: 0, storageFailures: 0 });
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('fotoğrafı ve türetilmiş try-on sonuçlarını birlikte siler', async () => {
    const storage = createStorage();
    const prisma = createPrisma([{ id: 'p1', storageKey: 'user-photos/u1/p1' }], ['tryon/j0.webp']);
    const job = new PhotoRetentionJob(prisma as never, storage, silentLogger as never);

    const result = await job.run();

    expect(result.deleted).toBe(1);
    // Türetilmiş görseller de gitmeli — kaynak silinip sonuç kalırsa
    // kullanıcının vücut görüntüsü depoda durmaya devam eder.
    expect(storage.deleteMany).toHaveBeenCalledWith(['tryon/j0.webp'], 'private');
    expect(storage.delete).toHaveBeenCalledWith('user-photos/u1/p1', 'private');
  });

  it('⚠️ ÖNCE depodan siler, SONRA veritabanı kaydını işaretler', async () => {
    const order: string[] = [];
    const storage = createStorage({
      delete: vi.fn().mockImplementation(() => {
        order.push('storage');
        return Promise.resolve();
      }),
    });
    const prisma = createPrisma([{ id: 'p1', storageKey: 'k1' }]);
    prisma.$transaction = vi.fn().mockImplementation(() => {
      order.push('db');
      return Promise.resolve([]);
    });

    const job = new PhotoRetentionJob(prisma as never, storage, silentLogger as never);
    await job.run();

    // Ters sırada olsaydı ve depo silme başarısız olsaydı, hangi nesnenin
    // silineceğini bilemezdik — dosya sonsuza kadar depoda kalırdı.
    expect(order).toEqual(['storage', 'db']);
  });

  it('⚠️ depo silme başarısızsa kaydı silinmiş İŞARETLEMEZ', async () => {
    const storage = createStorage({
      delete: vi.fn().mockRejectedValue(new Error('depo erişilemiyor')),
    });
    const prisma = createPrisma([{ id: 'p1', storageKey: 'k1' }]);
    const job = new PhotoRetentionJob(prisma as never, storage, silentLogger as never);

    const result = await job.run();

    expect(result.deleted).toBe(0);
    expect(result.storageFailures).toBe(1);
    // Kayıt açık kalır ve sonraki turda tekrar denenir. "Sildim" demek ama
    // silmemiş olmak, KVKK açısından hiç denememekten kötüdür.
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('bir fotoğraf patlasa da diğerlerini işlemeye devam eder', async () => {
    let call = 0;
    const storage = createStorage({
      delete: vi.fn().mockImplementation(() => {
        call += 1;
        return call === 1 ? Promise.reject(new Error('bum')) : Promise.resolve();
      }),
    });
    const prisma = createPrisma([
      { id: 'p1', storageKey: 'k1' },
      { id: 'p2', storageKey: 'k2' },
    ]);
    const job = new PhotoRetentionJob(prisma as never, storage, silentLogger as never);

    const result = await job.run();

    expect(result.scanned).toBe(2);
    expect(result.deleted).toBe(1);
    expect(result.storageFailures).toBe(1);
  });
});
