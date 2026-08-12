import { describe, expect, it } from 'vitest';
import {
  isWardrobeTrigger,
  planAutoAdd,
  readDeliveredPayload,
  WARDROBE_TRIGGER_EVENT,
  type DeliveredItemSnapshot,
  type PackageDeliveredPayload,
} from './auto-add.js';

/**
 * SATIN ALINAN ÜRÜNÜN GARDIROBA OTOMATİK EKLENMESİ — SAF ÇEKİRDEK
 *
 * ⚠️ Bu dosya `apps/api/src/modules/wardrobe/wardrobe.auto-add.test.ts`ten
 *    TAŞINDI (kopyalanmadı; kaynak dosyayla birlikte silindi). Buradaki
 *    testlerin hiçbiri sahte nesne kullanmaz — ölçtükleri şey saf karardır.
 *    Kablolamanın GERÇEKTEN kurulu olduğunu ölçen testler ayrı yerdedir:
 *      apps/worker/src/worker.module.test.ts        (DI grafiği + tek Worker)
 *      apps/worker/src/jobs/domain-event.fanout.test.ts (yaş kapısı, yalıtım)
 *      apps/worker/src/jobs/wardrobe.auto-add.job.test.ts (idempotentlik)
 *
 * Sınanan güvenceler:
 *   1. Tetik olay `package.delivered`dır; `package.shipped` gardıroba yazmaz.
 *   2. Doğal anahtar `orderItemId`dir.
 *   3. Aynı varyanttan iki adet alındığında İKİ ayrı parça oluşur.
 *   4. Giyilemez / renksiz kalemler öneri havuzuna girmez.
 */

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

  /**
   * ⚠️ ÜRETİCİ–TÜKETİCİ SÖZLEŞMESİ. `order.service.ts` yükü
   *    `satisfies PackageDeliveredPayload` ile yazar; okuyucu aynı tipten
   *    okur. Alan adı bir tarafta değişirse derleme İKİ tarafta birden kırılır.
   *    Bu test o sözleşmenin çalışma zamanı ucunu bağlar: üreticinin yazdığı
   *    biçimdeki bir yük GERÇEKTEN okunabiliyor mu?
   */
  it('üreticinin yazdığı tam payload okunabilir', () => {
    const produced: PackageDeliveredPayload = {
      packageId: 'pkg-1',
      sellerId: 'seller-1',
      from: 'SHIPPED',
      to: 'DELIVERED',
      carrier: 'Aras Kargo',
      trackingNo: 'TR123456789',
    };

    expect(readDeliveredPayload(produced)).toEqual({ packageId: 'pkg-1', from: 'SHIPPED' });
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
   * ⚠️ Aynı tişörtten iki AYRI sipariş kalemi iki ayrı parçadır. Doğal anahtar
   *    `(userId, variantId)` seçilseydi ikincisi sessizce yutulurdu.
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

  /**
   * ⚠️ Aynı olay iki kez işlense de plan AYNI komutları üretir — yani
   *    idempotentliğin dayandığı anahtar KARARLIDIR. Satır sayısının
   *    değişmediğini asıl kanıtlayan test veritabanı sözleşmesinin taklit
   *    edildiği yerdedir (wardrobe.auto-add.job.test.ts).
   */
  it('aynı girdi iki kez planlanınca aynı doğal anahtarlar çıkar', () => {
    const input = {
      userId: 'u-1',
      items: [item({ orderItemId: 'oi-1' }), item({ orderItemId: 'oi-2', variantId: 'v-2' })],
    };

    expect(planAutoAdd(input)).toEqual(planAutoAdd(input));
  });
});
