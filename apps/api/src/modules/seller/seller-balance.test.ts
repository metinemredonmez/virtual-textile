import { describe, expect, it } from 'vitest';
import { FINANCE } from '@vt/config';
import { AppError } from '@vt/contracts';
import {
  assertPayoutEligible,
  buildPayoutLedgerRow,
  computeBalance,
  isPayoutEligible,
  nextAvailableAt,
  summarizeByType,
  type LedgerRow,
} from './seller-balance.js';
import { buildSaleLedgerEntries, computeReturnReversal } from '../order/index.js';

/**
 * Testler defteri SİPARİŞ MODÜLÜNÜN ürettiği satırlarla besliyor.
 * Kendi elle yazdığımız satırlarla test etseydik, iki modül ayrıştığında
 * (ör. iade ters kaydına availableAt eklenmesi) testler yeşil kalır ama
 * satıcıya yanlış bakiye gösterilirdi.
 */

const NOW = new Date('2026-08-11T12:00:00.000Z');
const day = (offset: number): Date => new Date(NOW.getTime() + offset * 24 * 60 * 60 * 1000);

/** Satış defter satırları — komisyon %12, kargo payı 500 kuruş. */
const sale = (options: {
  orderItemId?: string;
  lineTotalMinor: bigint;
  commissionAmountMinor: bigint;
  shippingShareMinor?: bigint;
  availableAt: Date | null;
}): LedgerRow[] => {
  const shipping = options.shippingShareMinor ?? 0n;
  return buildSaleLedgerEntries(
    {
      orderItemId: options.orderItemId ?? 'item-1',
      sellerId: 'seller-1',
      quantity: 1,
      lineTotalMinor: options.lineTotalMinor,
      commissionAmountMinor: options.commissionAmountMinor,
      sellerNetMinor: options.lineTotalMinor - options.commissionAmountMinor - shipping,
      label: 'VT-260811-0042',
    },
    { availableAt: options.availableAt },
  ).map((entry) => ({
    type: entry.type,
    amountMinor: entry.amountMinor,
    availableAt: entry.availableAt ?? null,
  }));
};

describe('computeBalance', () => {
  it('bakiye defterin toplamıdır, ayrı kolondan değil', () => {
    const rows = sale({
      lineTotalMinor: 100_000n,
      commissionAmountMinor: 12_000n,
      shippingShareMinor: 500n,
      availableAt: day(-1),
    });

    const balance = computeBalance(rows, NOW);

    // 100.000 − 12.000 − 500 = 87.500
    expect(balance.totalMinor).toBe(87_500n);
    expect(balance.availableMinor).toBe(87_500n);
    expect(balance.pendingMinor).toBe(0n);
  });

  it('olgunlaşmamış hakediş çekilebilir bakiyeye girmez', () => {
    const rows = [
      ...sale({
        orderItemId: 'olgun',
        lineTotalMinor: 50_000n,
        commissionAmountMinor: 6_000n,
        availableAt: day(-1),
      }),
      ...sale({
        orderItemId: 'bekleyen',
        lineTotalMinor: 30_000n,
        commissionAmountMinor: 3_600n,
        availableAt: day(5),
      }),
    ];

    const balance = computeBalance(rows, NOW);

    expect(balance.totalMinor).toBe(44_000n + 26_400n);
    expect(balance.availableMinor).toBe(44_000n);
    expect(balance.pendingMinor).toBe(26_400n);
  });

  it('availableAt tam olarak şimdi ise çekilebilirdir (sınır dâhil)', () => {
    const rows = sale({
      lineTotalMinor: 10_000n,
      commissionAmountMinor: 0n,
      availableAt: new Date(NOW.getTime()),
    });

    expect(computeBalance(rows, NOW).availableMinor).toBe(10_000n);
  });

  it('bir milisaniye sonrası henüz çekilebilir değildir', () => {
    const rows = sale({
      lineTotalMinor: 10_000n,
      commissionAmountMinor: 0n,
      availableAt: new Date(NOW.getTime() + 1),
    });

    const balance = computeBalance(rows, NOW);
    expect(balance.availableMinor).toBe(0n);
    expect(balance.pendingMinor).toBe(10_000n);
  });

  /**
   * ⚠️ EN KRİTİK TEST.
   * İade ters kayıtları availableAt = null ile düşer. "Yalnızca
   * availableAt <= now olanları topla" kuralı bu satırları atlar ve iadesi
   * yapılmış satışın parası hâlâ çekilebilir görünürdü.
   */
  it('iade edilmiş satışın parası çekilebilir bakiyeden düşer', () => {
    const snapshot = {
      orderItemId: 'item-1',
      sellerId: 'seller-1',
      quantity: 1,
      lineTotalMinor: 100_000n,
      commissionAmountMinor: 12_000n,
      sellerNetMinor: 88_000n,
      label: 'VT-260811-0042',
    };

    const saleRows: LedgerRow[] = buildSaleLedgerEntries(snapshot, {
      availableAt: day(-1),
    }).map((entry) => ({
      type: entry.type,
      amountMinor: entry.amountMinor,
      availableAt: entry.availableAt ?? null,
    }));

    const reversal = computeReturnReversal([
      { ...snapshot, alreadyReturnedQuantity: 0, returnQuantity: 1 },
    ]);
    const reversalRows: LedgerRow[] = reversal.entries.map((entry) => ({
      type: entry.type,
      amountMinor: entry.amountMinor,
      availableAt: entry.availableAt ?? null,
    }));

    // Ters kayıtlar gerçekten tarihsiz düşüyor — testin dayanağı bu.
    expect(reversalRows.every((row) => row.availableAt === null)).toBe(true);

    const balance = computeBalance([...saleRows, ...reversalRows], NOW);

    expect(balance.totalMinor).toBe(0n);
    expect(balance.availableMinor).toBe(0n);
    expect(balance.withdrawableMinor).toBe(0n);
  });

  it('ödenmiş payout bakiyeden düşer — aynı para iki kez çekilemez', () => {
    const rows: LedgerRow[] = [
      ...sale({ lineTotalMinor: 100_000n, commissionAmountMinor: 0n, availableAt: day(-1) }),
      {
        type: 'PAYOUT',
        amountMinor: buildPayoutLedgerRow({
          sellerId: 'seller-1',
          payoutId: 'payout-1',
          amountMinor: 60_000n,
        }).amountMinor,
        availableAt: null,
      },
    ];

    const balance = computeBalance(rows, NOW);

    expect(balance.totalMinor).toBe(40_000n);
    expect(balance.availableMinor).toBe(40_000n);
    expect(balance.withdrawableMinor).toBe(40_000n);
  });

  it('bakiye eksiye düşerse çekilebilir tavan sıfırdır', () => {
    const rows: LedgerRow[] = [
      { type: 'REFUND', amountMinor: -25_000n, availableAt: null },
      { type: 'SALE', amountMinor: 10_000n, availableAt: day(-1) },
    ];

    const balance = computeBalance(rows, NOW);

    expect(balance.availableMinor).toBe(-15_000n);
    // Talep tavanı negatif olamaz; borç tahsilatı satıcı ucunun işi değildir.
    expect(balance.withdrawableMinor).toBe(0n);
  });

  it('boş defter sıfır bakiyedir', () => {
    expect(computeBalance([], NOW)).toEqual({
      totalMinor: 0n,
      availableMinor: 0n,
      pendingMinor: 0n,
      withdrawableMinor: 0n,
    });
  });

  it('kuruş kaybı yok: parça parça satışların toplamı tek toplama eşit', () => {
    const rows = Array.from({ length: 7 }, (_, index) =>
      sale({
        orderItemId: `item-${index}`,
        lineTotalMinor: 33_333n,
        commissionAmountMinor: 4_000n,
        shippingShareMinor: 333n,
        availableAt: day(-1),
      }),
    ).flat();

    expect(computeBalance(rows, NOW).totalMinor).toBe(7n * (33_333n - 4_000n - 333n));
  });
});

describe('nextAvailableAt', () => {
  it('en yakın olgunlaşma tarihini döndürür', () => {
    const rows: LedgerRow[] = [
      { type: 'SALE', amountMinor: 10_000n, availableAt: day(9) },
      { type: 'SALE', amountMinor: 20_000n, availableAt: day(3) },
      { type: 'SALE', amountMinor: 30_000n, availableAt: day(-2) },
    ];

    expect(nextAvailableAt(rows, NOW)).toEqual(day(3));
  });

  it('bekleyen borcun tarihi "paran gelecek" diye gösterilmez', () => {
    const rows: LedgerRow[] = [
      { type: 'COMMISSION', amountMinor: -5_000n, availableAt: day(1) },
      { type: 'SALE', amountMinor: 40_000n, availableAt: day(4) },
    ];

    expect(nextAvailableAt(rows, NOW)).toEqual(day(4));
  });

  it('bekleyen hakediş yoksa null döner', () => {
    const rows: LedgerRow[] = [{ type: 'SALE', amountMinor: 10_000n, availableAt: day(-1) }];
    expect(nextAvailableAt(rows, NOW)).toBeNull();
  });
});

describe('summarizeByType', () => {
  it('tür bazında toplar', () => {
    const rows = sale({
      lineTotalMinor: 100_000n,
      commissionAmountMinor: 12_000n,
      shippingShareMinor: 500n,
      availableAt: day(-1),
    });

    expect(summarizeByType(rows)).toEqual({
      SALE: 100_000n,
      COMMISSION: -12_000n,
      SHIPPING_SHARE: -500n,
    });
  });
});

describe('assertPayoutEligible', () => {
  const base = { withdrawableMinor: 500_000n, hasPendingRequest: false };

  it('yeterli bakiye ve bekleyen talep yoksa geçer', () => {
    expect(() => assertPayoutEligible({ ...base, requestedMinor: 100_000n })).not.toThrow();
  });

  it('asgari tutarın altında PAYOUT_BELOW_MINIMUM', () => {
    expect(() =>
      assertPayoutEligible({ ...base, requestedMinor: FINANCE.minPayoutMinor - 1n }),
    ).toThrow(expect.objectContaining({ code: 'PAYOUT_BELOW_MINIMUM' }) as unknown as Error);
  });

  it('asgari tutarın tam kendisi geçerlidir (sınır dâhil)', () => {
    expect(() =>
      assertPayoutEligible({ ...base, requestedMinor: FINANCE.minPayoutMinor }),
    ).not.toThrow();
  });

  it('bekleyen talep varsa PAYOUT_PENDING_EXISTS', () => {
    try {
      assertPayoutEligible({ ...base, requestedMinor: 100_000n, hasPendingRequest: true });
      expect.unreachable('hata bekleniyordu');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('PAYOUT_PENDING_EXISTS');
      expect((error as AppError).httpStatus).toBe(409);
    }
  });

  it('bakiye yetmezse PAYOUT_INSUFFICIENT_BALANCE', () => {
    try {
      assertPayoutEligible({ ...base, requestedMinor: 500_001n });
      expect.unreachable('hata bekleniyordu');
    } catch (error) {
      expect((error as AppError).code).toBe('PAYOUT_INSUFFICIENT_BALANCE');
    }
  });

  it('bakiyenin TAMAMI çekilebilir (sınır dâhil)', () => {
    expect(() => assertPayoutEligible({ ...base, requestedMinor: 500_000n })).not.toThrow();
  });

  /**
   * Kontrol sırası sözleşmenin parçası: satıcıya önce isteğinin kendisiyle
   * ilgili hata gösterilir, sonra sistem durumu.
   */
  it('hem asgari altı hem bekleyen talep varsa önce asgari hatası verilir', () => {
    try {
      assertPayoutEligible({
        withdrawableMinor: 0n,
        hasPendingRequest: true,
        requestedMinor: 1n,
      });
      expect.unreachable('hata bekleniyordu');
    } catch (error) {
      expect((error as AppError).code).toBe('PAYOUT_BELOW_MINIMUM');
    }
  });

  it('bekleyen talep, bakiye yeterliyken bile engeller', () => {
    try {
      assertPayoutEligible({
        withdrawableMinor: 10_000_000n,
        hasPendingRequest: true,
        requestedMinor: 100_000n,
      });
      expect.unreachable('hata bekleniyordu');
    } catch (error) {
      expect((error as AppError).code).toBe('PAYOUT_PENDING_EXISTS');
    }
  });

  it('bekleyen bakiye çekilebilir sayılmaz — uçtan uca', () => {
    const rows = [
      ...sale({
        orderItemId: 'olgun',
        lineTotalMinor: 12_000n,
        commissionAmountMinor: 0n,
        availableAt: day(-1),
      }),
      ...sale({
        orderItemId: 'bekleyen',
        lineTotalMinor: 900_000n,
        commissionAmountMinor: 0n,
        availableAt: day(10),
      }),
    ];
    const balance = computeBalance(rows, NOW);

    // Toplam 912.000 kuruş görünüyor ama yalnızca 12.000'i olgunlaşmış.
    expect(balance.totalMinor).toBe(912_000n);
    expect(
      isPayoutEligible({
        requestedMinor: 50_000n,
        withdrawableMinor: balance.withdrawableMinor,
        hasPendingRequest: false,
      }),
    ).toBe(false);
    expect(
      isPayoutEligible({
        requestedMinor: 12_000n,
        withdrawableMinor: balance.withdrawableMinor,
        hasPendingRequest: false,
      }),
    ).toBe(true);
  });
});

describe('buildPayoutLedgerRow', () => {
  it('payout borcu NEGATİF yazılır', () => {
    const row = buildPayoutLedgerRow({
      sellerId: 'seller-1',
      payoutId: 'payout-1',
      amountMinor: 75_000n,
    });

    expect(row.type).toBe('PAYOUT');
    expect(row.amountMinor).toBe(-75_000n);
    expect(row.availableAt).toBeNull();
  });

  it('sıfır veya negatif tutarla payout kaydı yazılamaz', () => {
    expect(() => buildPayoutLedgerRow({ sellerId: 's', payoutId: 'p', amountMinor: 0n })).toThrow(
      AppError,
    );
  });
});
