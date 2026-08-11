import { describe, expect, it } from 'vitest';
import { FINANCE, ORDER } from '@vt/config';
import { AppError } from '@vt/contracts';
import {
  assertLedgerBalanced,
  calculateCommission,
  estimatedPayoutAvailableAt,
  foldShippingIntoFirstItem,
  packageShippingMinor,
  payoutAvailableAt,
  summarizeOrder,
  type CommissionRuleSnapshot,
} from './commission.js';
import { buildSaleLedgerEntries, ledgerBalanceMinor } from '../order/index.js';
import { SHIPPING } from './checkout.constants.js';

/**
 * Defter satırlarını sipariş modülü üretir; checkout onları YALNIZCA doğrular.
 * Testler bu yüzden `buildSaleLedgerEntries` ile checkout'un komisyon
 * hesabının BİRLİKTE tutarlı olduğunu ölçer — iki taraf ayrışırsa tam iadede
 * satıcı bakiyesi sıfırlanmaz.
 */
const saleEntries = (input: {
  orderItemId: string;
  lineTotalMinor: bigint;
  commissionAmountMinor: bigint;
  sellerNetMinor: bigint;
  availableAt: Date;
}) =>
  buildSaleLedgerEntries(
    {
      orderItemId: input.orderItemId,
      sellerId: 'seller-1',
      quantity: 1,
      lineTotalMinor: input.lineTotalMinor,
      commissionAmountMinor: input.commissionAmountMinor,
      sellerNetMinor: input.sellerNetMinor,
      label: 'VT-260811-0042',
    },
    { availableAt: input.availableAt },
  );

const rule = (rateBps: number, fixedFeeMinor = 0n): CommissionRuleSnapshot => ({
  versionId: 'crv-1',
  rateBps,
  fixedFeeMinor,
});

describe('calculateCommission', () => {
  it('basis point ile oransal komisyonu hesaplar', () => {
    // 1.000,00 ₺ üzerinden %12,50
    const result = calculateCommission(100_000n, rule(1250));
    expect(result.commissionAmountMinor).toBe(12_500n);
    expect(result.sellerNetMinor).toBe(87_500n);
    expect(result.commissionRateBps).toBe(1250);
    expect(result.commissionRuleVersionId).toBe('crv-1');
  });

  it('yarım yukarı yuvarlar — kuruş aşağı kaybolmaz', () => {
    // 149,90 ₺ × %12,50 = 18,7375 ₺ → 1874 kuruş (…75 yukarı)
    expect(calculateCommission(14_990n, rule(1250)).commissionAmountMinor).toBe(1_874n);
    // 0,03 ₺ × %12,00 = 0,0036 ₺ → 0 kuruş (…36 aşağı)
    expect(calculateCommission(3n, rule(1200)).commissionAmountMinor).toBe(0n);
    // 0,02 ₺ × %25,00 = 0,005 ₺ → tam yarım, YUKARI (aşağı yuvarlansa 0 olurdu)
    expect(calculateCommission(2n, rule(2500)).commissionAmountMinor).toBe(1n);
  });

  it('float kullanmaz — 2^53 üstü tutarlarda bile tam sonuç verir', () => {
    const huge = 9_007_199_254_740_993n; // 2^53 + 1 kuruş
    const result = calculateCommission(huge, rule(1000));
    expect(result.commissionAmountMinor + result.sellerNetMinor).toBe(huge);
  });

  it('sabit ücreti oransal komisyona ekler', () => {
    const result = calculateCommission(100_000n, rule(1200, 250n));
    expect(result.commissionAmountMinor).toBe(12_250n);
    expect(result.sellerNetMinor).toBe(87_750n);
  });

  it('komisyon kalem tutarını aşamaz — satıcı platforma borçlanmaz', () => {
    // 1,00 ₺ kalem, 5,00 ₺ sabit ücret
    const result = calculateCommission(100n, rule(1200, 50_000n));
    expect(result.commissionAmountMinor).toBe(100n);
    expect(result.sellerNetMinor).toBe(0n);
  });

  it('varsayılan komisyon oranıyla tutarlıdır', () => {
    const result = calculateCommission(50_000n, rule(FINANCE.defaultCommissionBps));
    expect(result.commissionAmountMinor).toBe(6_000n); // %12,00
  });

  it('tavanı aşan oranı reddeder', () => {
    expect(() => calculateCommission(100_000n, rule(FINANCE.maxCommissionBps + 1))).toThrow(
      AppError,
    );
  });

  it('negatif oranı ve negatif sabit ücreti reddeder', () => {
    expect(() => calculateCommission(100_000n, rule(-1))).toThrow(AppError);
    expect(() => calculateCommission(100_000n, rule(1200, -1n))).toThrow(AppError);
  });

  it('sıfır komisyonlu kuralda satıcı tam tutarı alır', () => {
    const result = calculateCommission(100_000n, rule(0));
    expect(result.commissionAmountMinor).toBe(0n);
    expect(result.sellerNetMinor).toBe(100_000n);
  });
});

describe('defter kayıtları', () => {
  const availableAt = new Date('2026-09-01T00:00:00.000Z');

  it('SALE artı, COMMISSION eksi yazılır', () => {
    const commission = calculateCommission(100_000n, rule(1250));
    const entries = saleEntries({
      orderItemId: 'item-1',
      lineTotalMinor: 100_000n,
      commissionAmountMinor: commission.commissionAmountMinor,
      sellerNetMinor: commission.sellerNetMinor,
      availableAt,
    });

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ type: 'SALE', amountMinor: 100_000n });
    expect(entries[1]).toMatchObject({ type: 'COMMISSION', amountMinor: -12_500n });
    // ⚠️ Hakediş iade penceresi kapanmadan ödenebilir olmamalı.
    expect(entries.every((entry) => entry.availableAt === availableAt)).toBe(true);
  });

  it('defter toplamı satıcının net hakedişine eşittir', () => {
    const commission = calculateCommission(14_990n, rule(1250));
    const entries = saleEntries({
      orderItemId: 'item-1',
      lineTotalMinor: 14_990n,
      commissionAmountMinor: commission.commissionAmountMinor,
      sellerNetMinor: commission.sellerNetMinor,
      availableAt,
    });

    expect(ledgerBalanceMinor(entries)).toBe(commission.sellerNetMinor);
    expect(() => assertLedgerBalanced(entries, commission.sellerNetMinor)).not.toThrow();
  });

  it('komisyon sıfırsa gereksiz 0 satırı yazılmaz', () => {
    const commission = calculateCommission(100_000n, rule(0));
    const entries = saleEntries({
      orderItemId: 'item-1',
      lineTotalMinor: 100_000n,
      commissionAmountMinor: commission.commissionAmountMinor,
      sellerNetMinor: commission.sellerNetMinor,
      availableAt,
    });
    expect(entries).toHaveLength(1);
    expect(ledgerBalanceMinor(entries)).toBe(100_000n);
  });

  it('dengesiz defter veritabanına ulaşmadan yakalanır', () => {
    const entries = saleEntries({
      orderItemId: 'item-1',
      lineTotalMinor: 100_000n,
      commissionAmountMinor: 12_500n,
      sellerNetMinor: 87_500n,
      availableAt,
    });
    expect(() => assertLedgerBalanced(entries, 87_499n)).toThrow(AppError);
  });

  it('çok kalemli siparişte platform komisyonu kalemlerin toplamıdır', () => {
    const lines = [14_990n, 29_900n, 7_550n];
    let expectedCommission = 0n;
    let expectedNet = 0n;

    const entries = lines.flatMap((lineTotalMinor, index) => {
      const commission = calculateCommission(lineTotalMinor, rule(1250));
      expectedCommission += commission.commissionAmountMinor;
      expectedNet += commission.sellerNetMinor;
      return saleEntries({
        orderItemId: `item-${index}`,
        lineTotalMinor,
        commissionAmountMinor: commission.commissionAmountMinor,
        sellerNetMinor: commission.sellerNetMinor,
        availableAt,
      });
    });

    expect(ledgerBalanceMinor(entries)).toBe(expectedNet);
    const commissionTotal = entries
      .filter((entry) => entry.type === 'COMMISSION')
      .reduce((sum, entry) => sum + entry.amountMinor, 0n);
    expect(commissionTotal).toBe(-expectedCommission);
    // Kuruş kaybı yok: satış toplamı = net + komisyon
    expect(expectedNet + expectedCommission).toBe(lines.reduce((a, b) => a + b, 0n));
  });

  it('kargo payı satıcıya yansıtılmaz — platformda kalır', () => {
    // checkout sellerNet = lineTotal − komisyon kurar; SHIPPING_SHARE satırı
    // bu yüzden hiç oluşmamalı, aksi hâlde satıcı kargoyu iki kez öderdi.
    const commission = calculateCommission(50_000n, rule(1200));
    const entries = saleEntries({
      orderItemId: 'item-1',
      lineTotalMinor: 50_000n,
      commissionAmountMinor: commission.commissionAmountMinor,
      sellerNetMinor: commission.sellerNetMinor,
      availableAt,
    });
    expect(entries.some((entry) => entry.type === 'SHIPPING_SHARE')).toBe(false);
  });
});

describe('hakedişin ödenebilir olma tarihi', () => {
  it('teslim + iade penceresi kadar sonradır', () => {
    const delivered = new Date('2026-08-11T10:00:00.000Z');
    const available = payoutAvailableAt(delivered);
    const diffDays = (available.getTime() - delivered.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBe(FINANCE.payoutEligibleAfterDays);
  });

  it('ödeme anındaki tahmin hazırlık SLA ve kargo süresini de kapsar', () => {
    const paidAt = new Date('2026-08-11T10:00:00.000Z');
    const available = estimatedPayoutAvailableAt(paidAt);
    const expectedMs =
      ORDER.sellerPreparationSlaHours * 60 * 60 * 1000 +
      SHIPPING.estimatedTransitDays * 24 * 60 * 60 * 1000 +
      FINANCE.payoutEligibleAfterDays * 24 * 60 * 60 * 1000;
    expect(available.getTime() - paidAt.getTime()).toBe(expectedMs);
    // Tahmin, teslim anında yeniden hesaplanana kadar hep DAHA GEÇ olmalı.
    expect(available.getTime()).toBeGreaterThan(payoutAvailableAt(paidAt).getTime());
  });
});

describe('kargo', () => {
  it('eşiğin altında sabit ücret alınır', () => {
    expect(packageShippingMinor(10_000n)).toBe(SHIPPING.flatFeePerSellerMinor);
  });

  it('eşikte ve üstünde kargo bedavadır', () => {
    expect(packageShippingMinor(SHIPPING.freeShippingThresholdMinor)).toBe(0n);
    expect(packageShippingMinor(SHIPPING.freeShippingThresholdMinor + 1n)).toBe(0n);
  });

  it('eşik paket bazındadır — iki satıcı iki kargo öder', () => {
    const totals = summarizeOrder([
      {
        itemsTotalMinor: 30_000n,
        shippingMinor: packageShippingMinor(30_000n),
        discountShareMinor: 0n,
      },
      {
        itemsTotalMinor: 30_000n,
        shippingMinor: packageShippingMinor(30_000n),
        discountShareMinor: 0n,
      },
    ]);
    expect(totals.shippingTotalMinor).toBe(SHIPPING.flatFeePerSellerMinor * 2n);
    expect(totals.grandTotalMinor).toBe(60_000n + SHIPPING.flatFeePerSellerMinor * 2n);
  });

  it('kargo ilk kaleme eklenir ama satıcının hakedişini değiştirmez', () => {
    const items = [
      { amountMinor: 10_000n, commissionMinor: 1_200n },
      { amountMinor: 5_000n, commissionMinor: 600n },
    ];
    const folded = foldShippingIntoFirstItem(items, 4_990n);

    const totalBefore = items.reduce((s, i) => s + i.amountMinor, 0n);
    const totalAfter = folded.reduce((s, i) => s + i.amountMinor, 0n);
    expect(totalAfter).toBe(totalBefore + 4_990n);

    // ⚠️ Kritik: satıcıya giden net (tutar − komisyon) değişmemeli.
    const netBefore = items.reduce((s, i) => s + (i.amountMinor - i.commissionMinor), 0n);
    const netAfter = folded.reduce((s, i) => s + (i.amountMinor - i.commissionMinor), 0n);
    expect(netAfter).toBe(netBefore);
  });

  it('kargo sıfırsa kalemler dokunulmadan döner', () => {
    const items = [{ amountMinor: 10_000n, commissionMinor: 1_200n }];
    expect(foldShippingIntoFirstItem(items, 0n)).toEqual(items);
  });
});

describe('sipariş toplamı', () => {
  it('kalem + kargo − indirim', () => {
    const totals = summarizeOrder([
      { itemsTotalMinor: 14_990n, shippingMinor: 4_990n, discountShareMinor: 1_000n },
      { itemsTotalMinor: 29_900n, shippingMinor: 0n, discountShareMinor: 0n },
    ]);
    expect(totals).toEqual({
      itemsTotalMinor: 44_890n,
      shippingTotalMinor: 4_990n,
      discountMinor: 1_000n,
      grandTotalMinor: 48_880n,
    });
  });

  it('indirim sipariş tutarını aşarsa reddeder', () => {
    expect(() =>
      summarizeOrder([{ itemsTotalMinor: 1_000n, shippingMinor: 0n, discountShareMinor: 2_000n }]),
    ).toThrow(AppError);
  });
});
