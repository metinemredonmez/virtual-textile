import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isWardrobeTrigger,
  planAutoAdd,
  readDeliveredPayload,
  WARDROBE_TRIGGER_EVENT,
  type DeliveredItemSnapshot,
} from './wardrobe.auto-add.js';
import { WardrobeService } from './wardrobe.service.js';
import type {
  WardrobeAutoAddCommand,
  WardrobePhotoStoragePort,
  WardrobeRepositoryPort,
  WardrobeStylistPort,
  WardrobeTryOnPort,
} from './wardrobe.ports.js';

/**
 * SATIN ALINAN ÜRÜNÜN GARDIROBA OTOMATİK EKLENMESİ
 *
 * Sınanan güvenceler:
 *   1. Tetik olay `package.delivered`dır; `package.shipped` gardıroba yazmaz.
 *   2. Doğal anahtar `orderItemId`dir — aynı olayın İKİNCİ işlenişi mükerrer
 *      kayıt AÇMAZ.
 *   3. Aynı varyanttan iki adet alındığında İKİ ayrı parça oluşur (gardırop
 *      bir küme değil, kullanıcının dolabıdır).
 *   4. Giyilemez / renksiz kalemler öneri havuzuna girmez.
 */

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function item(overrides: Partial<DeliveredItemSnapshot> = {}): DeliveredItemSnapshot {
  return {
    orderItemId: 'oi-1',
    variantId: 'v-1',
    productTitle: 'Keten Gömlek',
    variantLabel: 'Beyaz / M',
    imageKey: 'products/p-1/i-1/800.webp',
    category: 'UPPER_BODY',
    color: 'Beyaz',
    ...overrides,
  };
}

/**
 * UNIQUE(userId, sourceOrderItemId) + ON CONFLICT DO NOTHING davranışını
 * taklit eden sahte depo.
 *
 * ⚠️ Testin can alıcı noktası: tekillik SERVİSTE değil, DEPODA kurulur.
 *    Bu sahte depo gerçek kısıtın davranışını taklit eder; servis "önce bak,
 *    sonra yaz" yapsaydı bu test yine geçerdi ama üretimde iki eşzamanlı
 *    tüketici iki satır yazardı. Bu yüzden servisin ÖN SORGU YAPMADIĞI da
 *    ayrıca doğrulanır (aşağıya bkz.).
 */
function fakeRepository(): WardrobeRepositoryPort & { rows: WardrobeAutoAddCommand[] } {
  const rows: WardrobeAutoAddCommand[] = [];
  const seen = new Set<string>();

  return {
    rows,
    listByUser: vi.fn().mockResolvedValue([]),
    findOwned: vi.fn().mockResolvedValue(null),
    insertManual: vi.fn(),
    deleteOwned: vi.fn().mockResolvedValue(null),
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

function makeService(repository: WardrobeRepositoryPort): WardrobeService {
  const storage: WardrobePhotoStoragePort = {
    signedUploadUrl: vi.fn(),
    signedReadUrl: vi.fn(),
    exists: vi.fn(),
    delete: vi.fn(),
  };
  const stylist: WardrobeStylistPort = { suggestOutfits: vi.fn().mockResolvedValue([]) };
  const tryOn: WardrobeTryOnPort = { prepareOutfit: vi.fn() };

  return new WardrobeService(repository, storage, stylist, tryOn, silentLogger as never);
}

describe('gardırop otomatik ekleme — tetik olayı', () => {
  it('yalnızca package.delivered tetikler', () => {
    expect(WARDROBE_TRIGGER_EVENT).toBe('package.delivered');
    expect(isWardrobeTrigger('package.delivered')).toBe(true);
  });

  /**
   * ⚠️ Kargoya verilen parça henüz kullanıcının elinde DEĞİLDİR. Gardıroba
   *    girseydi kullanıcı elinde olmayan bir kotu kombinlerde görürdü.
   */
  it('package.shipped ve package.cancelled tetiklemez', () => {
    expect(isWardrobeTrigger('package.shipped')).toBe(false);
    expect(isWardrobeTrigger('package.cancelled')).toBe(false);
    expect(isWardrobeTrigger('order.paid')).toBe(false);
  });

  it('payload paket kimliğini taşır, bozuk payload null döner', () => {
    expect(readDeliveredPayload({ packageId: 'pkg-1', from: 'SHIPPED' })).toEqual({
      packageId: 'pkg-1',
      from: 'SHIPPED',
    });
    expect(readDeliveredPayload({ sellerId: 's-1' })).toBeNull();
    expect(readDeliveredPayload(null)).toBeNull();
    expect(readDeliveredPayload('package.delivered')).toBeNull();
  });
});

describe('gardırop otomatik ekleme — doğal anahtar', () => {
  it('her sipariş kalemi için sourceOrderItemId üretilir', () => {
    const plan = planAutoAdd({
      userId: 'u-1',
      items: [item({ orderItemId: 'oi-1' }), item({ orderItemId: 'oi-2', variantId: 'v-2' })],
    });

    expect(plan.commands.map((c) => c.sourceOrderItemId)).toEqual(['oi-1', 'oi-2']);
  });

  /**
   * ⚠️ Aynı tişörtten iki adet alan kullanıcının dolabında İKİ tişört vardır.
   *    Doğal anahtar `(userId, variantId)` seçilseydi ikincisi sessizce
   *    yutulurdu.
   */
  it('aynı varyanttan iki kalem iki ayrı parça olur', () => {
    const plan = planAutoAdd({
      userId: 'u-1',
      items: [
        item({ orderItemId: 'oi-1', variantId: 'v-1' }),
        item({ orderItemId: 'oi-2', variantId: 'v-1' }),
      ],
    });

    expect(plan.commands).toHaveLength(2);
    expect(new Set(plan.commands.map((c) => c.sourceOrderItemId)).size).toBe(2);
  });

  it('aynı payload içinde tekrar eden kalem elenir', () => {
    const plan = planAutoAdd({
      userId: 'u-1',
      items: [item({ orderItemId: 'oi-1' }), item({ orderItemId: 'oi-1' })],
    });

    expect(plan.commands).toHaveLength(1);
    expect(plan.skipped).toEqual([{ orderItemId: 'oi-1', reason: 'DUPLICATE_IN_EVENT' }]);
  });

  it('etiket sipariş anındaki SNAPSHOT alanlarından kurulur', () => {
    const plan = planAutoAdd({ userId: 'u-1', items: [item()] });
    expect(plan.commands[0]?.label).toBe('Keten Gömlek — Beyaz / M');
    expect(plan.commands[0]?.productImageKey).toBe('products/p-1/i-1/800.webp');
  });
});

describe('gardırop otomatik ekleme — öneri havuzunun temizliği', () => {
  it('giyilebilir kategorisi olmayan kalem eklenmez', () => {
    const plan = planAutoAdd({
      userId: 'u-1',
      items: [item({ orderItemId: 'oi-parfum', category: null })],
    });

    expect(plan.commands).toHaveLength(0);
    expect(plan.skipped).toEqual([{ orderItemId: 'oi-parfum', reason: 'NOT_WEARABLE' }]);
  });

  it('rengi bilinmeyen kalem eklenmez', () => {
    const plan = planAutoAdd({
      userId: 'u-1',
      items: [
        item({ orderItemId: 'oi-x', color: null }),
        item({ orderItemId: 'oi-y', color: '  ' }),
      ],
    });

    expect(plan.commands).toHaveLength(0);
    expect(plan.skipped.map((s) => s.reason)).toEqual(['NO_COLOR', 'NO_COLOR']);
  });
});

describe('gardırop otomatik ekleme — İDEMPOTENTLİK', () => {
  let repository: ReturnType<typeof fakeRepository>;
  let service: WardrobeService;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = fakeRepository();
    service = makeService(repository);
  });

  const delivered = {
    userId: 'u-1',
    items: [item({ orderItemId: 'oi-1' }), item({ orderItemId: 'oi-2', variantId: 'v-2' })],
  };

  it('aynı teslimat olayı iki kez işlenirse mükerrer kayıt OLUŞMAZ', async () => {
    const first = await service.applyDelivered(delivered);
    const second = await service.applyDelivered(delivered);

    expect(first.added).toBe(2);
    // ⚠️ İkinci işleyişte HİÇBİR yeni satır yok — asıl güvence budur.
    expect(second.added).toBe(0);
    expect(repository.rows).toHaveLength(2);
  });

  /**
   * Outbox EN AZ BİR KEZ teslim eder ve BullMQ 3 kez dener; üst üste üç
   * işleyiş gerçek bir senaryodur.
   */
  it('olay üç kez işlense de satır sayısı değişmez', async () => {
    await service.applyDelivered(delivered);
    await service.applyDelivered(delivered);
    await service.applyDelivered(delivered);

    expect(repository.rows).toHaveLength(2);
  });

  /**
   * ⚠️ İADE REDDİ SENARYOSU — hata değil, normal iş akışı.
   *    Paket RETURN_REQUESTED → DELIVERED geri döndüğünde
   *    `package.delivered` İKİNCİ KEZ gerçekten üretilir
   *    (order-status.ts: RETURN_REQUESTED: ['RETURNED', 'DELIVERED']).
   */
  it('iade reddi sonrası yeniden teslim olayı mükerrer kayıt açmaz', async () => {
    await service.applyDelivered(delivered);
    const afterReturnRejected = await service.applyDelivered(delivered);

    expect(afterReturnRejected.added).toBe(0);
    expect(repository.rows).toHaveLength(2);
  });

  it('ilk teslimat kaybolmuşsa ikinci olay kayıtları YİNE de açar', async () => {
    // İlk olay hiç işlenmedi (dağıtıcı çöktü); ikinci olay tek şansımız.
    const result = await service.applyDelivered(delivered);
    expect(result.added).toBe(2);
  });

  /**
   * ⚠️ TEKİLLİK DEPODA KURULUR, SERVİSTE DEĞİL.
   *
   *    Servis "önce var mı diye sorgula, yoksa yaz" yapsaydı iki eşzamanlı
   *    tüketici de "yok" cevabı alır ve iki satır yazılırdı. Bu yüzden servis
   *    ekleme öncesi HİÇBİR okuma yapmamalıdır.
   */
  it('ekleme öncesi var-mı sorgusu YAPILMAZ (yarış koşulu savunması)', async () => {
    await service.applyDelivered(delivered);

    expect(repository.findOwned).not.toHaveBeenCalled();
    expect(repository.listByUser).not.toHaveBeenCalled();
    expect(repository.insertPurchasedIgnoringDuplicates).toHaveBeenCalledTimes(1);
  });

  it('eklenecek kalem yoksa depoya hiç gidilmez', async () => {
    const result = await service.applyDelivered({
      userId: 'u-1',
      items: [item({ orderItemId: 'oi-parfum', category: null })],
    });

    expect(result).toEqual({ added: 0, skipped: 1 });
    expect(repository.insertPurchasedIgnoringDuplicates).not.toHaveBeenCalled();
  });

  it('mükerrer yutulması hata olarak loglanmaz', async () => {
    await service.applyDelivered(delivered);
    await service.applyDelivered(delivered);

    // Sahte alarm üretmemeli: added < planned NORMALDİR.
    expect(silentLogger.error).not.toHaveBeenCalled();
  });
});
