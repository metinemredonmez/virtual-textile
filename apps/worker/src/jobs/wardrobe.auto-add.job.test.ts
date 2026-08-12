import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import type { PrismaClient } from '@vt/db';
import type { WardrobeAutoAddCommand } from '@vt/contracts';
import type { DomainEventJobData } from '../queues.js';
import {
  PrismaWardrobeAutoAddStore,
  WardrobeAutoAddHandler,
  type DeliveredPackageView,
  type WardrobeAutoAddStore,
} from './wardrobe.auto-add.job.js';

/**
 * GARDIROBA OTOMATİK EKLEME — TÜKETİCİ
 *
 * Sınanan güvenceler:
 *   1. İDEMPOTENTLİK: aynı olay iki kez işlenirse İKİNCİ satır YAZILMAZ ve
 *      tekillik SERVİSTE değil DEPODA kurulur (ön sorgu yapılmaz).
 *   2. Yalnızca `package.delivered` tetikler.
 *   3. Prisma satırı → komut çevirimi: SNAPSHOT alanlar sipariş kaleminden,
 *      kategori ve renk CANLI katalogdan okunur.
 *   4. KVKK: PURCHASE kaydı private kova anahtarı (`photoKey`) YAZMAZ.
 */

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

function deliveredEvent(overrides: Partial<DomainEventJobData> = {}): DomainEventJobData {
  return {
    outboxEventId: 'evt-1',
    aggregate: 'order',
    aggregateId: 'order-1',
    type: 'package.delivered',
    payload: {
      packageId: 'pkg-1',
      sellerId: 'seller-1',
      from: 'SHIPPED',
      to: 'DELIVERED',
      carrier: 'Aras Kargo',
      trackingNo: 'TR1',
    },
    ...overrides,
  };
}

function view(overrides: Partial<DeliveredPackageView> = {}): DeliveredPackageView {
  return {
    userId: 'u-1',
    items: [
      {
        orderItemId: 'oi-1',
        variantId: 'v-1',
        productTitle: 'Keten Gömlek',
        variantLabel: 'Beyaz / M',
        imageKey: 'products/p-1/i-1/800.webp',
        category: 'UPPER_BODY',
        color: 'Beyaz',
      },
      {
        orderItemId: 'oi-2',
        variantId: 'v-2',
        productTitle: 'Chino Pantolon',
        variantLabel: 'Lacivert / 32',
        imageKey: 'products/p-2/i-1/800.webp',
        category: 'LOWER_BODY',
        color: 'Lacivert',
      },
    ],
    ...overrides,
  };
}

/**
 * UNIQUE(userId, sourceOrderItemId) + ON CONFLICT DO NOTHING davranışını
 * taklit eden sahte depo.
 *
 * ⚠️ Testin can alıcı noktası: tekillik İŞLEYİCİDE değil, DEPODA kurulur. Bu
 *    ikiz gerçek kısıtın davranışını taklit eder; işleyici "önce bak, sonra
 *    yaz" yapsaydı bu test yine geçerdi ama üretimde iki eşzamanlı tüketici iki
 *    satır yazardı. Bu yüzden ÖN SORGU YAPILMADIĞI ayrıca doğrulanır.
 */
function fakeStore(
  packageView: DeliveredPackageView | null = view(),
): WardrobeAutoAddStore & { rows: WardrobeAutoAddCommand[] } {
  const rows: WardrobeAutoAddCommand[] = [];
  const seen = new Set<string>();

  return {
    rows,
    deliveredPackage: vi.fn().mockResolvedValue(packageView),
    insertPurchasedIgnoringDuplicates: vi.fn(
      async (commands: readonly WardrobeAutoAddCommand[]) => {
        let inserted = 0;
        for (const command of commands) {
          const key = `${command.userId}::${command.sourceOrderItemId}`;
          if (seen.has(key)) continue; // ON CONFLICT DO NOTHING
          seen.add(key);
          rows.push(command);
          inserted += 1;
        }
        return inserted;
      },
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('gardıroba otomatik ekleme — tetik olayı', () => {
  it('package.delivered gardıroba yazar', async () => {
    const store = fakeStore();
    const result = await new WardrobeAutoAddHandler(store, silentLogger).process(deliveredEvent());

    expect(result).toEqual({ added: 2, skipped: 0 });
    expect(store.rows.map((row) => row.sourceOrderItemId)).toEqual(['oi-1', 'oi-2']);
  });

  /**
   * ⚠️ `package.shipped` AYNI KUYRUKTAN geçer. Ayrım yapılmasaydı kargoya
   *    verilen —henüz kullanıcının elinde olmayan— parça gardıroba girerdi.
   */
  it('package.shipped ve package.cancelled paketi bile OKUMAZ', async () => {
    const store = fakeStore();
    const handler = new WardrobeAutoAddHandler(store, silentLogger);

    await handler.process(deliveredEvent({ type: 'package.shipped' }));
    await handler.process(deliveredEvent({ type: 'package.cancelled' }));
    await handler.process(deliveredEvent({ type: 'order.paid' }));

    expect(store.deliveredPackage).not.toHaveBeenCalled();
    expect(store.rows).toHaveLength(0);
  });

  /** Bozuk yük tekrar denendiğinde de bozuk kalır — fırlatmak kuyruğu boşuna meşgul eder. */
  it('packageId taşımayan yük hata FIRLATMAZ, hata olarak loglanır', async () => {
    const store = fakeStore();

    const result = await new WardrobeAutoAddHandler(store, silentLogger).process(
      deliveredEvent({ payload: { sellerId: 'seller-1' } }),
    );

    expect(result).toEqual({ added: 0, skipped: 0 });
    expect(store.deliveredPackage).not.toHaveBeenCalled();
    expect(silentLogger.error).toHaveBeenCalled();
  });

  it('paket bulunamazsa uyarı yazılır, hata fırlatılmaz', async () => {
    const store = fakeStore(null);

    const result = await new WardrobeAutoAddHandler(store, silentLogger).process(deliveredEvent());

    expect(result).toEqual({ added: 0, skipped: 0 });
    expect(silentLogger.warn).toHaveBeenCalled();
  });
});

describe('gardıroba otomatik ekleme — İDEMPOTENTLİK', () => {
  /**
   * Outbox EN AZ BİR KEZ teslim eder ve BullMQ 3 kez dener; üst üste üç işleyiş
   * gerçek bir senaryodur.
   */
  it('aynı teslimat olayı iki kez işlenirse mükerrer kayıt OLUŞMAZ', async () => {
    const store = fakeStore();
    const handler = new WardrobeAutoAddHandler(store, silentLogger);

    const first = await handler.process(deliveredEvent());
    const second = await handler.process(deliveredEvent());

    expect(first.added).toBe(2);
    // ⚠️ İkinci işleyişte HİÇBİR yeni satır yok — asıl güvence budur.
    expect(second.added).toBe(0);
    expect(store.rows).toHaveLength(2);
  });

  it('olay üç kez işlense de satır sayısı değişmez', async () => {
    const store = fakeStore();
    const handler = new WardrobeAutoAddHandler(store, silentLogger);

    await handler.process(deliveredEvent());
    await handler.process(deliveredEvent());
    await handler.process(deliveredEvent());

    expect(store.rows).toHaveLength(2);
  });

  /**
   * ⚠️ TEKİLLİK DEPODA KURULUR, İŞLEYİCİDE DEĞİL.
   *    İşleyici "önce var mı diye sorgula, yoksa yaz" yapsaydı iki eşzamanlı
   *    tüketici de "yok" cevabı alır ve iki satır yazılırdı. Okunan tek şey
   *    paketin kendisidir; gardırop tablosuna ÖN SORGU yoktur.
   */
  it('ekleme öncesi gardırop tablosuna var-mı sorgusu YAPILMAZ', async () => {
    const store = fakeStore();

    await new WardrobeAutoAddHandler(store, silentLogger).process(deliveredEvent());

    expect(store.deliveredPackage).toHaveBeenCalledTimes(1);
    expect(store.insertPurchasedIgnoringDuplicates).toHaveBeenCalledTimes(1);
  });

  it('mükerrer yutulması hata olarak loglanmaz', async () => {
    const handler = new WardrobeAutoAddHandler(fakeStore(), silentLogger);

    await handler.process(deliveredEvent());
    await handler.process(deliveredEvent());

    // Sahte alarm üretmemeli: added < planned NORMALDİR.
    expect(silentLogger.error).not.toHaveBeenCalled();
  });
});

describe('gardıroba otomatik ekleme — eleme ve izleme', () => {
  it('giyilemez kalem yazılmaz, sıfır komut kalırsa UYARI üretilir', async () => {
    const store = fakeStore(
      view({
        items: [
          {
            orderItemId: 'oi-parfum',
            variantId: 'v-9',
            productTitle: 'Parfüm',
            variantLabel: '50 ml',
            imageKey: 'products/p-9/i-1/800.webp',
            category: null,
            color: 'Şeffaf',
          },
        ],
      }),
    );

    const result = await new WardrobeAutoAddHandler(store, silentLogger).process(deliveredEvent());

    expect(result).toEqual({ added: 0, skipped: 1 });
    expect(store.insertPurchasedIgnoringDuplicates).not.toHaveBeenCalled();
    /**
     * ⚠️ Teslim edilmiş paketten SIFIR komut çıkması, kablonun KOPUK olduğu
     *    durumla birebir aynı görünür. Tek ayırt edici işaret bu uyarıdır —
     *    en olası sebep `Category.tryOnCategory`nin katalogda boş olmasıdır.
     */
    expect(silentLogger.warn).toHaveBeenCalled();
  });

  it('misafir siparişinde (userId null) hiçbir şey yazılmaz', async () => {
    const store = fakeStore(view({ userId: null }));

    const result = await new WardrobeAutoAddHandler(store, silentLogger).process(deliveredEvent());

    expect(result).toEqual({ added: 0, skipped: 0 });
    expect(store.insertPurchasedIgnoringDuplicates).not.toHaveBeenCalled();
    expect(silentLogger.error).not.toHaveBeenCalled();
  });
});

// ── Prisma adaptörü ───────────────────────────────────────────────────────

describe('PrismaWardrobeAutoAddStore', () => {
  /**
   * ⚠️ Okunan alanların KAYNAĞI karışıktır ve bu bilinçlidir: başlık/etiket/görsel
   *    sipariş kaleminin SNAPSHOT kolonlarından, kategori ve renk CANLI
   *    katalogdan gelir (sipariş kalemi bu ikisini tutmaz).
   */
  it('paket satırını gardırop görünümüne çevirir', async () => {
    const prisma = {
      orderPackage: {
        findUnique: vi.fn().mockResolvedValue({
          order: { userId: 'u-1' },
          items: [
            {
              id: 'oi-1',
              variantId: 'v-1',
              productTitle: 'Keten Gömlek',
              variantLabel: 'Beyaz / M',
              imageKey: 'products/p-1/i-1/800.webp',
              variant: {
                color: 'Beyaz',
                product: { category: { tryOnCategory: 'UPPER_BODY' } },
              },
            },
          ],
        }),
      },
    } as unknown as PrismaClient;

    const result = await new PrismaWardrobeAutoAddStore(prisma).deliveredPackage('pkg-1');

    expect(result).toEqual({
      userId: 'u-1',
      items: [
        {
          orderItemId: 'oi-1',
          variantId: 'v-1',
          productTitle: 'Keten Gömlek',
          variantLabel: 'Beyaz / M',
          imageKey: 'products/p-1/i-1/800.webp',
          category: 'UPPER_BODY',
          color: 'Beyaz',
        },
      ],
    });
  });

  /** ⚠️ `Category.tryOnCategory` NULLABLE: kategori boşsa kalem giyilemez sayılır. */
  it('kategorisi boş kategori null taşır', async () => {
    const prisma = {
      orderPackage: {
        findUnique: vi.fn().mockResolvedValue({
          order: { userId: 'u-1' },
          items: [
            {
              id: 'oi-1',
              variantId: 'v-1',
              productTitle: 'Parfüm',
              variantLabel: '50 ml',
              imageKey: 'k',
              variant: { color: 'Şeffaf', product: { category: { tryOnCategory: null } } },
            },
          ],
        }),
      },
    } as unknown as PrismaClient;

    const result = await new PrismaWardrobeAutoAddStore(prisma).deliveredPackage('pkg-1');

    expect(result?.items[0]?.category).toBeNull();
  });

  it('paket yoksa null döner', async () => {
    const prisma = {
      orderPackage: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;

    expect(await new PrismaWardrobeAutoAddStore(prisma).deliveredPackage('yok')).toBeNull();
  });

  /**
   * ⚠️ İDEMPOTENTLİĞİN GERÇEK DAYANAĞI: `skipDuplicates: true` →
   *    PostgreSQL'de `ON CONFLICT DO NOTHING`. Bu bayrak düşerse aynı olayın
   *    ikinci işlenişi mükerrer satır açar.
   *
   * ⚠️ KVKK: PURCHASE kaydında `photoKey` YAZILMAZ. `photoKey` private
   *    kovadaki KULLANICI fotoğrafıdır; buradaki görsel satıcının PUBLIC ürün
   *    görselidir ve public kalır.
   */
  it('yazma ON CONFLICT DO NOTHING kullanır ve private kova anahtarı yazmaz', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = { digitalWardrobeItem: { createMany } } as unknown as PrismaClient;

    const added = await new PrismaWardrobeAutoAddStore(prisma).insertPurchasedIgnoringDuplicates([
      {
        userId: 'u-1',
        variantId: 'v-1',
        category: 'UPPER_BODY',
        color: 'Beyaz',
        label: 'Keten Gömlek — Beyaz / M',
        productImageKey: 'products/p-1/i-1/800.webp',
        sourceOrderItemId: 'oi-1',
      },
    ]);

    expect(added).toBe(1);
    const args = createMany.mock.calls[0]?.[0] as {
      skipDuplicates: boolean;
      data: Array<Record<string, unknown>>;
    };
    expect(args.skipDuplicates).toBe(true);
    expect(args.data[0]).toMatchObject({
      source: 'PURCHASE',
      productImageKey: 'products/p-1/i-1/800.webp',
      sourceOrderItemId: 'oi-1',
    });
    expect(args.data[0]).not.toHaveProperty('photoKey');
  });

  it('komut yoksa veritabanına hiç gidilmez', async () => {
    const createMany = vi.fn();
    const prisma = { digitalWardrobeItem: { createMany } } as unknown as PrismaClient;

    expect(await new PrismaWardrobeAutoAddStore(prisma).insertPurchasedIgnoringDuplicates([])).toBe(
      0,
    );
    expect(createMany).not.toHaveBeenCalled();
  });
});
