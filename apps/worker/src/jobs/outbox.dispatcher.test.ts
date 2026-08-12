import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import type { PrismaClient } from '@vt/db';

/**
 * OUTBOX DAĞITICI — ÖLÜ MEKTUP DENETİMİ
 *
 * ⚠️⚠️ BU DOSYANIN VAR OLMA SEBEBİ: "EN AZ BİR KEZ teslimat" güvencesi yalnızca
 *      KUYRUĞA KADAR doğruydu. Olay kuyruğa girer girmez `publishedAt` yazılıyor,
 *      tüketici 3 denemede de düşerse iş BullMQ'nun `failed` kümesinde kalıyor ve
 *      outbox satırı "yayınlandı" görünüyordu. Sonuç: olay SESSİZCE ve KALICI
 *      olarak kayboluyor, hiçbir kayıt bunu göstermiyordu.
 *
 * ⚠️ `bullmq` sahteleniyor: gerçek `Queue` yapıcı içinde Redis bağlantısı
 *    kurmaya kalkar. Ölçülen şey kuyruk kütüphanesi değil, DENETİMİN KENDİSİ.
 */

// ⚠️ `vi.hoisted`: `vi.mock` fabrikası dosyanın en üstüne taşınır ve normal bir
//    `const` ona henüz görünmez olurdu.
const queueSpy = vi.hoisted(() => ({
  add: vi.fn(),
  getFailed: vi.fn(),
  close: vi.fn(),
}));

vi.mock('bullmq', () => ({
  Queue: class {
    add = queueSpy.add;
    getFailed = queueSpy.getFailed;
    close = queueSpy.close;
  },
}));

const { OutboxDispatcher } = await import('./outbox.dispatcher.js');

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

/** Deneme hakkı bitmiş bir BullMQ işi. */
function deadJob(id: string, reason = 'AggregateError: gardırop yazılamadı') {
  return { id, attemptsMade: 3, opts: { attempts: 3 }, failedReason: reason };
}

function makeDispatcher(rows: Array<{ id: string; type: string }>) {
  const prisma = {
    outboxEvent: {
      findMany: vi.fn().mockResolvedValue(rows),
      update: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient;

  return {
    dispatcher: new OutboxDispatcher(prisma, {} as never, silentLogger),
    prisma: prisma as unknown as {
      outboxEvent: { findMany: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    },
  };
}

describe('OutboxDispatcher.auditDeadLetters', () => {
  beforeEach(() => {
    queueSpy.add.mockReset().mockResolvedValue({});
    queueSpy.close.mockReset().mockResolvedValue(undefined);
    queueSpy.getFailed.mockReset().mockResolvedValue([]);
    vi.mocked(silentLogger.error).mockClear();
  });

  it('⚠️ deneme hakkı biten olayı outbox satırına yazar ve hata olarak loglar', async () => {
    queueSpy.getFailed.mockResolvedValue([deadJob('evt-1')]);
    const { dispatcher, prisma } = makeDispatcher([{ id: 'evt-1', type: 'package.delivered' }]);

    expect(await dispatcher.auditDeadLetters()).toEqual({ dead: 1 });

    const update = prisma.outboxEvent.update.mock.calls[0]?.[0] as {
      where: { id: string };
      data: { attempts: number; lastError: string };
    };
    expect(update.where.id).toBe('evt-1');
    expect(update.data.attempts).toBe(3);
    // ⚠️ Ön ek kaynağı ayırır: 'kuyruk:' tüketici tarafındaki kalıcı hatadır.
    expect(update.data.lastError).toContain('kuyruk:');
    expect(silentLogger.error).toHaveBeenCalledTimes(1);
  });

  /** Hâlâ deneme hakkı olan iş ölü değildir; kuyruk onu yeniden alacak. */
  it('deneme hakkı kalan iş ölü sayılmaz', async () => {
    queueSpy.getFailed.mockResolvedValue([
      { id: 'evt-1', attemptsMade: 1, opts: { attempts: 3 }, failedReason: 'geçici' },
    ]);
    const { dispatcher, prisma } = makeDispatcher([{ id: 'evt-1', type: 'package.delivered' }]);

    expect(await dispatcher.auditDeadLetters()).toEqual({ dead: 0 });
    expect(prisma.outboxEvent.findMany).not.toHaveBeenCalled();
    expect(prisma.outboxEvent.update).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ Aynı ölü olay her dakika yeniden alarm üretseydi, gerçek alarm gürültüde
   *    boğulurdu. Sorgu yalnızca `lastError` BOŞ satırları getirir; bu test o
   *    koşulun sorguda kaldığını ölçer.
   */
  it('daha önce kaydedilmiş ölü olay ikinci kez alarm üretmez', async () => {
    queueSpy.getFailed.mockResolvedValue([deadJob('evt-1')]);
    const { dispatcher, prisma } = makeDispatcher([]);

    expect(await dispatcher.auditDeadLetters()).toEqual({ dead: 0 });

    const where = prisma.outboxEvent.findMany.mock.calls[0]?.[0] as {
      where: { lastError: null };
    };
    expect(where.where.lastError).toBeNull();
    expect(prisma.outboxEvent.update).not.toHaveBeenCalled();
    expect(silentLogger.error).not.toHaveBeenCalled();
  });

  it('başarısız iş yoksa veritabanına hiç gitmez', async () => {
    const { dispatcher, prisma } = makeDispatcher([]);

    expect(await dispatcher.auditDeadLetters()).toEqual({ dead: 0 });
    expect(prisma.outboxEvent.findMany).not.toHaveBeenCalled();
  });
});
