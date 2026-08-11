import { describe, expect, it } from 'vitest';
import { calculateCartTotals, type CartLineInput, type CouponInput } from './cart-totals.js';

/**
 * Bu testler para davranışının sözleşmesidir.
 * Bir tanesi kırmızıya dönerse kuruş kaybediyoruz demektir — testi değil kodu düzeltin.
 */

let lineSeq = 0;
function line(
  sellerId: string,
  unitMinor: bigint,
  quantity = 1,
  currentMinor?: bigint,
): CartLineInput {
  lineSeq += 1;
  return {
    id: `line-${lineSeq}`,
    variantId: `variant-${lineSeq}`,
    sellerId,
    quantity,
    addedPriceMinor: unitMinor,
    currentPriceMinor: currentMinor ?? unitMinor,
  };
}

function coupon(overrides: Partial<CouponInput> = {}): CouponInput {
  return {
    id: 'coupon-1',
    code: 'INDIRIM',
    sellerId: null,
    discountType: 'PERCENTAGE',
    discountValue: 1000n, // %10
    maxDiscountMinor: null,
    minCartMinor: 0n,
    ...overrides,
  };
}

const sumPackages = (
  packages: ReadonlyArray<{ discount: { amountMinor: bigint }; total: { amountMinor: bigint } }>,
): { discount: bigint; total: bigint } => ({
  discount: packages.reduce((acc, p) => acc + p.discount.amountMinor, 0n),
  total: packages.reduce((acc, p) => acc + p.total.amountMinor, 0n),
});

describe('calculateCartTotals — boş sepet', () => {
  it('sıfır döner, çökmez', () => {
    const totals = calculateCartTotals([]);

    expect(totals.packages).toEqual([]);
    expect(totals.subtotal.amountMinor).toBe(0n);
    expect(totals.discount.amountMinor).toBe(0n);
    expect(totals.total.amountMinor).toBe(0n);
    expect(totals.itemCount).toBe(0);
    expect(totals.distinctItemCount).toBe(0);
    expect(totals.hasPriceChange).toBe(false);
  });

  it('boş sepette kupon hata değil, "uygulanamaz" olarak işaretlenir', () => {
    const totals = calculateCartTotals([], coupon());

    expect(totals.discount.amountMinor).toBe(0n);
    expect(totals.couponRejection).toBe('NOT_APPLICABLE');
    expect(totals.appliedCouponCode).toBeNull();
  });
});

describe('calculateCartTotals — satıcı bazında gruplama', () => {
  it('her satıcı ayrı paket olur ve kalem sırası korunur', () => {
    const totals = calculateCartTotals([
      line('satici-a', 10_00n),
      line('satici-b', 20_00n),
      line('satici-a', 5_00n, 2),
    ]);

    expect(totals.packages.map((p) => p.sellerId)).toEqual(['satici-a', 'satici-b']);
    expect(totals.packages[0]!.lines).toHaveLength(2);
    expect(totals.packages[0]!.subtotal.amountMinor).toBe(20_00n); // 1000 + 2×500
    expect(totals.packages[1]!.subtotal.amountMinor).toBe(20_00n);
    expect(totals.subtotal.amountMinor).toBe(40_00n);
    expect(totals.itemCount).toBe(4);
    expect(totals.distinctItemCount).toBe(3);
  });

  it('mağaza kuponu yalnızca kendi satıcısının paketine iner', () => {
    const totals = calculateCartTotals(
      [line('satici-a', 100_00n), line('satici-b', 300_00n)],
      coupon({ sellerId: 'satici-a', discountValue: 2000n }), // %20
    );

    expect(totals.packages[0]!.discount.amountMinor).toBe(20_00n); // 10.000 × %20
    expect(totals.packages[1]!.discount.amountMinor).toBe(0n);
    expect(totals.discount.amountMinor).toBe(20_00n);
    expect(totals.total.amountMinor).toBe(380_00n);
  });

  it('mağaza kuponunun asgari tutarı yalnızca o mağazanın toplamına bakar', () => {
    // Başka mağazadan ürün ekleyerek eşiği aşmak mümkün olmamalı.
    const totals = calculateCartTotals(
      [line('satici-a', 50_00n), line('satici-b', 500_00n)],
      coupon({ sellerId: 'satici-a', minCartMinor: 100_00n }),
    );

    expect(totals.couponRejection).toBe('MIN_AMOUNT');
    expect(totals.discount.amountMinor).toBe(0n);
  });

  it('platform kuponu tüm paketlere dağılır', () => {
    const totals = calculateCartTotals(
      [line('satici-a', 100_00n), line('satici-b', 300_00n)],
      coupon({ discountValue: 1000n }), // %10 → 4.000 kuruş
    );

    expect(totals.discount.amountMinor).toBe(40_00n);
    expect(totals.packages[0]!.discount.amountMinor).toBe(10_00n);
    expect(totals.packages[1]!.discount.amountMinor).toBe(30_00n);
  });
});

describe('calculateCartTotals — kuruş kaybı olmamalı', () => {
  it('üç eşit pakete bölünemeyen indirimde kalan kuruş kaybolmaz', () => {
    // 100 kuruş / 3 = 33,33… → 33+33+33 = 99 olsaydı 1 kuruş buharlaşırdı.
    const totals = calculateCartTotals(
      [line('a', 10_00n), line('b', 10_00n), line('c', 10_00n)],
      coupon({ discountType: 'FIXED_AMOUNT', discountValue: 100n }),
    );

    expect(totals.packages.map((p) => p.discount.amountMinor)).toEqual([34n, 33n, 33n]);
    expect(sumPackages(totals.packages).discount).toBe(100n);
  });

  it('paketlerin toplamı daima sepet toplamına eşittir (rastgele senaryolar)', () => {
    // Deterministik sözde-rastgele: test hep aynı senaryoları üretir,
    // kırıldığında yeniden üretilebilir olsun.
    let seed = 987_654_321;
    const next = (limit: number): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % limit;
    };

    for (let round = 0; round < 300; round += 1) {
      const lines: CartLineInput[] = [];
      const sellerCount = 1 + next(5);
      const lineCount = 1 + next(9);

      for (let i = 0; i < lineCount; i += 1) {
        lines.push(line(`satici-${next(sellerCount)}`, BigInt(1 + next(99_999)), 1 + next(5)));
      }

      const applied = coupon({
        discountType: next(2) === 0 ? 'PERCENTAGE' : 'FIXED_AMOUNT',
        discountValue: BigInt(1 + next(9_999)),
        maxDiscountMinor: next(3) === 0 ? BigInt(1 + next(50_000)) : null,
      });

      const totals = calculateCartTotals(lines, applied);
      const summed = sumPackages(totals.packages);

      // 1) Dağıtılan indirim, hesaplanan indirimin TAM olarak kendisi.
      expect(summed.discount).toBe(totals.discount.amountMinor);
      // 2) Paket toplamları sepet toplamını verir.
      expect(summed.total).toBe(totals.total.amountMinor);
      // 3) subtotal − discount = total.
      expect(totals.subtotal.amountMinor - totals.discount.amountMinor).toBe(
        totals.total.amountMinor,
      );
      // 4) Hiçbir paket negatife düşmez.
      for (const pkg of totals.packages) {
        expect(pkg.total.amountMinor >= 0n).toBe(true);
        expect(pkg.discount.amountMinor >= 0n).toBe(true);
      }
    }
  });
});

describe('calculateCartTotals — kupon tavanı ve sınırlar', () => {
  it('yüzdesel indirim maxDiscountMinor tavanını aşamaz', () => {
    const totals = calculateCartTotals(
      [line('a', 1_000_00n)],
      coupon({ discountValue: 5000n, maxDiscountMinor: 100_00n }), // %50 ama tavan 100 ₺
    );

    expect(totals.discount.amountMinor).toBe(100_00n);
    expect(totals.total.amountMinor).toBe(900_00n);
  });

  it('tavan altında kalan indirim aynen uygulanır', () => {
    const totals = calculateCartTotals(
      [line('a', 100_00n)],
      coupon({ discountValue: 1000n, maxDiscountMinor: 100_00n }),
    );

    expect(totals.discount.amountMinor).toBe(10_00n);
  });

  it('yüzde hesabı yarım yukarı yuvarlanır, float kullanılmaz', () => {
    // 3333 kuruş × %10 = 333,3 → 333
    const totals = calculateCartTotals([line('a', 33_33n)], coupon({ discountValue: 1000n }));
    expect(totals.discount.amountMinor).toBe(333n);

    // 3335 kuruş × %10 = 333,5 → 334 (half-up)
    const up = calculateCartTotals([line('a', 33_35n)], coupon({ discountValue: 1000n }));
    expect(up.discount.amountMinor).toBe(334n);
  });

  it('sabit tutarlı indirim sepet tutarını aşamaz — toplam negatife düşmez', () => {
    const totals = calculateCartTotals(
      [line('a', 50_00n)],
      coupon({ discountType: 'FIXED_AMOUNT', discountValue: 500_00n }),
    );

    expect(totals.discount.amountMinor).toBe(50_00n);
    expect(totals.total.amountMinor).toBe(0n);
  });

  it('asgari sepet tutarı sağlanmazsa indirim uygulanmaz', () => {
    const totals = calculateCartTotals([line('a', 99_99n)], coupon({ minCartMinor: 100_00n }));

    expect(totals.couponRejection).toBe('MIN_AMOUNT');
    expect(totals.discount.amountMinor).toBe(0n);
    expect(totals.appliedCouponCode).toBeNull();
  });

  it('ücretsiz kargo kuponu tutarı değiştirmez, yalnızca bayrak koyar', () => {
    const totals = calculateCartTotals(
      [line('a', 100_00n)],
      coupon({ discountType: 'FREE_SHIPPING', discountValue: 0n }),
    );

    expect(totals.freeShipping).toBe(true);
    expect(totals.discount.amountMinor).toBe(0n);
    expect(totals.total.amountMinor).toBe(100_00n);
    expect(totals.appliedCouponCode).toBe('INDIRIM');
  });
});

describe('calculateCartTotals — fiyat değişimi', () => {
  it('güncel fiyat farklıysa kalem işaretlenir ama tutar eklendiği fiyattan hesaplanır', () => {
    const totals = calculateCartTotals([line('a', 100_00n, 2, 120_00n)]);

    const first = totals.packages[0]!.lines[0]!;
    expect(first.priceChanged).toBe(true);
    expect(first.priceDiffMinor).toBe(20_00n);
    expect(first.lineTotal.amountMinor).toBe(200_00n); // eklendiği fiyat × 2
    expect(totals.hasPriceChange).toBe(true);
  });

  it('fiyat düştüyse de işaretlenir — kullanıcıya yeni fiyat teklif edilebilsin', () => {
    const totals = calculateCartTotals([line('a', 100_00n, 1, 80_00n)]);

    expect(totals.packages[0]!.lines[0]!.priceDiffMinor).toBe(-20_00n);
    expect(totals.hasPriceChange).toBe(true);
  });

  it('fiyat aynıysa işaret konmaz', () => {
    const totals = calculateCartTotals([line('a', 100_00n, 3)]);
    expect(totals.hasPriceChange).toBe(false);
    expect(totals.packages[0]!.lines[0]!.priceChanged).toBe(false);
  });
});
