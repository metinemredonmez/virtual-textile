import { describe, expect, it, vi } from 'vitest';
import type { PackageStatus } from '@vt/db';
import type { PackageDeliveredPayload } from '@vt/contracts';
import { OrderService, type OrderActor } from './order.service.js';
import type { PrismaService } from '../../infra/prisma.service.js';
import type { SellerLedgerPort } from './ledger.port.js';

/**
 * ═══════════ `package.delivered` OLAYININ ÜRETİCİ UCU ═══════════
 *
 * ⚠️⚠️ BU DOSYANIN VAR OLMA SEBEBİ:
 *
 *    Olay tipi bir ŞABLONDAN üretiliyor: `package.${target.toLowerCase()}`.
 *    Derleme bu dizeyi ASLA göremez. Yani `target` enum'ı yeniden adlandırılsa
 *    ya da `recordEvent` çağrısı bir "sadeleştirme" turunda atlansa, `tsc`
 *    sessiz kalır ve gardıroba otomatik ekleme (ve bildirimler) ÜRETİMDE
 *    ÇALIŞMAZ. Kimse fark etmez, çünkü hiçbir şey kırmızı yanmaz.
 *
 *    Aynı sessizlik bu projede iki kez yaşandı (SIZE_LEARNING_PORT, BullMQ
 *    jobId). Bu test, zincirin ÜRETİCİ ucundaki tek statik bekçidir.
 *
 * ⚠️ Yük şekli de ölçülür: `PackageDeliveredPayload` üretici ile tüketicinin
 *    ORTAK sözleşmesidir ve `DomainEventJobData.payload` `unknown` olduğu için
 *    çalışma zamanında hiçbir doğrulaması yoktur.
 *
 * Ölçülen tek şey KAYIT: veritabanı sahtedir, hiçbir sorgu çalışmaz.
 */

interface TxSpy {
  outboxEvent: { create: ReturnType<typeof vi.fn> };
  orderEvent: { create: ReturnType<typeof vi.fn> };
}

const SYSTEM_ACTOR: OrderActor = { type: 'SYSTEM' };

/**
 * Teslim geçişini yürütecek kadar sahte transaction.
 *
 * ⚠️ Paket SHIPPED'den DELIVERED'a geçirilir: geçiş makinesi (order-status.ts)
 *    yalnızca bu yolu kabul eder.
 */
function makeService(status: PackageStatus = 'SHIPPED'): {
  service: OrderService;
  tx: TxSpy;
} {
  const tx: TxSpy & Record<string, unknown> = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    orderPackage: {
      findUnique: vi.fn().mockResolvedValue({ orderId: 'order-1' }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: 'pkg-1',
        orderId: 'order-1',
        sellerId: 'seller-1',
        status,
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    order: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        status: 'SHIPPED',
        paidAt: new Date('2026-08-01T00:00:00Z'),
        cancelledAt: null,
        completedAt: null,
        reservationExpiresAt: null,
        packages: [{ status: 'DELIVERED', deliveredAt: new Date() }],
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    orderEvent: { create: vi.fn().mockResolvedValue({}) },
    outboxEvent: { create: vi.fn().mockResolvedValue({}) },
  };

  const prisma = {
    $transaction: (fn: (client: unknown) => Promise<unknown>) => fn(tx),
  } as unknown as PrismaService;

  const ledger = {} as SellerLedgerPort;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  return { service: new OrderService(prisma, ledger, logger as never), tx };
}

/** Outbox'a yazılan tek satırı okur. */
function writtenOutboxEvent(tx: TxSpy): { type: string; payload: Record<string, unknown> } {
  expect(tx.outboxEvent.create).toHaveBeenCalledTimes(1);
  return (tx.outboxEvent.create.mock.calls[0]?.[0] as { data: never }).data;
}

describe('teslim geçişi — outbox olayı', () => {
  /**
   * ⚠️ EN KRİTİK İDDİA. Bu dize `wardrobe/auto-add.ts` içindeki
   *    `WARDROBE_TRIGGER_EVENT` ile BİREBİR aynı olmalıdır; aksi hâlde
   *    tüketici olayı hiç tanımaz ve gardıroba tek satır düşmez.
   */
  it('⚠️ DELIVERED geçişi type = "package.delivered" olan bir OutboxEvent yazar', async () => {
    const { service, tx } = makeService();

    await service.transitionPackage('pkg-1', 'DELIVERED', SYSTEM_ACTOR);

    expect(writtenOutboxEvent(tx).type).toBe('package.delivered');
  });

  /**
   * ⚠️ Tüketici paket kimliğini YALNIZCA yükten okuyabilir: `aggregateId`
   *    SİPARİŞ kimliğidir, paketin değil. `packageId` düşerse gardırop hangi
   *    paketin teslim edildiğini bilemez.
   */
  it('⚠️ yük packageId taşır — aggregateId ise SİPARİŞ kimliğidir', async () => {
    const { service, tx } = makeService();

    await service.transitionPackage('pkg-1', 'DELIVERED', SYSTEM_ACTOR);

    const event = writtenOutboxEvent(tx) as unknown as {
      aggregate: string;
      aggregateId: string;
      payload: PackageDeliveredPayload;
    };

    expect(event.aggregate).toBe('order');
    expect(event.aggregateId).toBe('order-1');
    expect(event.payload.packageId).toBe('pkg-1');
    expect(event.payload.to).toBe('DELIVERED');
    expect(event.payload.from).toBe('SHIPPED');
  });

  /**
   * ⚠️ Outbox satırı sipariş yazımıyla AYNI transaction'dadır. Ayrı yazılsaydı
   *    geri alınan bir teslimat için gardıroba parça eklenir ve bildirim
   *    giderdi.
   */
  it('olay teslim güncellemesiyle AYNI transaction içinde yazılır', async () => {
    const { service, tx } = makeService();

    await service.transitionPackage('pkg-1', 'DELIVERED', SYSTEM_ACTOR);

    // Aynı `tx` nesnesi hem paketi güncelledi hem outbox'a yazdı.
    expect(tx.orderEvent.create).toHaveBeenCalledTimes(1);
    expect(tx.outboxEvent.create).toHaveBeenCalledTimes(1);
  });

  /** Kargolama olayı gardırobu tetiklememelidir; tipi farklı olmalı. */
  it('SHIPPED geçişi package.shipped yazar — gardırop tetiklenmez', async () => {
    const { service, tx } = makeService('PREPARING');

    await service.transitionPackage('pkg-1', 'SHIPPED', SYSTEM_ACTOR, {
      carrier: 'Aras Kargo',
      trackingNo: 'TR1',
    });

    expect(writtenOutboxEvent(tx).type).toBe('package.shipped');
  });
});
