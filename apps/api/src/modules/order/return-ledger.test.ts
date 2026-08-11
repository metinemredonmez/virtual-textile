import { describe, expect, it } from 'vitest';
import { isAppError, type AppError } from '@vt/contracts';
import {
  buildSaleLedgerEntries,
  computeReturnReversal,
  ledgerBalanceMinor,
  type LedgerEntryDraft,
  type OrderItemMoneySnapshot,
} from './return-ledger.js';

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    if (!isAppError(error)) throw error;
    return (error as AppError).code;
  }
  throw new Error('Hata bekleniyordu ama fırlatılmadı');
};

/**
 * Kasıtlı olarak "bölünmeyen" tutarlar seçildi.
 *   3 adet × 99,99 ₺ = 299,97 ₺
 *   komisyon %12,50   =  37,50 ₺
 *   kargo payı        =  10,00 ₺  (3'e bölünmüyor → 334/333/333 kuruş)
 *   satıcı hakedişi   = 252,47 ₺
 * Yuvarlama hatası varsa tam iadede bakiye sıfırlanmaz.
 */
const ITEM: OrderItemMoneySnapshot = {
  orderItemId: 'item-1',
  sellerId: 'seller-a',
  quantity: 3,
  lineTotalMinor: 29_997n,
  commissionAmountMinor: 3_750n,
  sellerNetMinor: 25_247n,
  label: 'Keten Gömlek (Bej / M)',
};

const balanceOf = (entries: readonly LedgerEntryDraft[], sellerId: string): bigint =>
  ledgerBalanceMinor(entries.filter((entry) => entry.sellerId === sellerId));

describe('buildSaleLedgerEntries', () => {
  it('satış kayıtlarının toplamı satıcı hakedişine eşittir', () => {
    const entries = buildSaleLedgerEntries(ITEM);
    expect(ledgerBalanceMinor(entries)).toBe(ITEM.sellerNetMinor);
    expect(entries.map((entry) => entry.type)).toEqual(['SALE', 'COMMISSION', 'SHIPPING_SHARE']);
    expect(entries.map((entry) => entry.amountMinor)).toEqual([29_997n, -3_750n, -1_000n]);
  });

  it('komisyonsuz kalemde sıfır tutarlı kayıt yazmaz', () => {
    const entries = buildSaleLedgerEntries({
      ...ITEM,
      commissionAmountMinor: 0n,
      sellerNetMinor: 29_997n,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.type).toBe('SALE');
  });
});

describe('computeReturnReversal — tam iade', () => {
  const reversal = computeReturnReversal([
    { ...ITEM, alreadyReturnedQuantity: 0, returnQuantity: 3 },
  ]);

  it('üç ters kaydı doğru işaretlerle üretir', () => {
    expect(reversal.entries.map((entry) => [entry.type, entry.amountMinor])).toEqual([
      ['REFUND', -29_997n],
      ['COMMISSION_REVERSAL', 3_750n],
      ['SHIPPING_REVERSAL', 1_000n],
    ]);
  });

  it('SATICI BAKİYESİ SIFIRLANIR — iade sonrası defterde bakiye kalmaz', () => {
    const ledger = [...buildSaleLedgerEntries(ITEM), ...reversal.entries];
    expect(ledgerBalanceMinor(ledger)).toBe(0n);
  });

  it('satıcıya net etki hakedişin tam tersidir', () => {
    expect(reversal.sellerNetImpactMinor).toBe(-ITEM.sellerNetMinor);
  });

  it('müşteriye iade edilecek tutar brüt satış tutarıdır (indirim yoksa)', () => {
    expect(reversal.customerRefundMinor).toBe(ITEM.lineTotalMinor);
  });
});

describe('computeReturnReversal — kısmi iade', () => {
  it('adet adet iade edilen kalem, tamamı iade edilince bakiyeyi sıfırlar', () => {
    // Önce 1 adet, sonra kalan 2 adet iade ediliyor.
    const first = computeReturnReversal([
      { ...ITEM, alreadyReturnedQuantity: 0, returnQuantity: 1 },
    ]);
    const second = computeReturnReversal([
      { ...ITEM, alreadyReturnedQuantity: 1, returnQuantity: 2 },
    ]);

    const ledger = [...buildSaleLedgerEntries(ITEM), ...first.entries, ...second.entries];
    expect(ledgerBalanceMinor(ledger)).toBe(0n);
  });

  it('kuruş kaybı yok: 3’e bölünmeyen kargo payı birim birim dağıtılır', () => {
    // 1000 kuruş / 3 adet → 334 + 333 + 333. Orantı çarpımı yapılsaydı
    // 333 + 333 + 333 = 999 olur, 1 kuruş defterde asılı kalırdı.
    const shipping = (from: number, count: number): bigint =>
      computeReturnReversal([
        { ...ITEM, alreadyReturnedQuantity: from, returnQuantity: count },
      ]).entries.find((entry) => entry.type === 'SHIPPING_REVERSAL')?.amountMinor ?? 0n;

    expect(shipping(0, 1)).toBe(334n);
    expect(shipping(1, 1)).toBe(333n);
    expect(shipping(2, 1)).toBe(333n);
    expect(shipping(0, 1) + shipping(1, 1) + shipping(2, 1)).toBe(1_000n);
  });

  it('kısmi iade sonrası bakiyede yalnızca iade edilmeyen adedin hakedişi kalır', () => {
    const first = computeReturnReversal([
      { ...ITEM, alreadyReturnedQuantity: 0, returnQuantity: 1 },
    ]);
    const ledger = [...buildSaleLedgerEntries(ITEM), ...first.entries];
    // 1 adet iade → 9999 − 1250 − 334 = 8415 kuruş satıcıdan geri alınır.
    expect(ledgerBalanceMinor(ledger)).toBe(25_247n - 8_415n);
    expect(first.sellerNetImpactMinor).toBe(-8_415n);
  });
});

describe('computeReturnReversal — indirim', () => {
  it('indirim müşteri iadesini azaltır ama satıcı defterine dokunmaz', () => {
    // Kupon 30,00 ₺ indirim sağlamıştı; müşteri o parayı hiç ödemedi.
    const reversal = computeReturnReversal([
      { ...ITEM, alreadyReturnedQuantity: 0, returnQuantity: 3, discountShareMinor: 3_000n },
    ]);

    expect(reversal.customerRefundMinor).toBe(29_997n - 3_000n);
    // Satış kaydı brüt tutarla düşmüştü; ters kaydı da brüt olmalı.
    expect(ledgerBalanceMinor([...buildSaleLedgerEntries(ITEM), ...reversal.entries])).toBe(0n);
  });
});

describe('computeReturnReversal — çok satıcılı sipariş', () => {
  const other: OrderItemMoneySnapshot = {
    orderItemId: 'item-2',
    sellerId: 'seller-b',
    quantity: 2,
    lineTotalMinor: 15_000n,
    commissionAmountMinor: 1_875n,
    sellerNetMinor: 12_625n, // kargo payı 500
  };

  it('her satıcının bakiyesi kendi kalemleriyle sıfırlanır', () => {
    const reversal = computeReturnReversal([
      { ...ITEM, alreadyReturnedQuantity: 0, returnQuantity: 3 },
      { ...other, alreadyReturnedQuantity: 0, returnQuantity: 2 },
    ]);

    const ledger = [
      ...buildSaleLedgerEntries(ITEM),
      ...buildSaleLedgerEntries(other),
      ...reversal.entries,
    ];

    expect(balanceOf(ledger, 'seller-a')).toBe(0n);
    expect(balanceOf(ledger, 'seller-b')).toBe(0n);
    expect(reversal.customerRefundMinor).toBe(29_997n + 15_000n);
  });

  it('yalnızca bir satıcı iade alırsa diğerinin bakiyesi korunur', () => {
    const reversal = computeReturnReversal([
      { ...other, alreadyReturnedQuantity: 0, returnQuantity: 2 },
    ]);
    const ledger = [
      ...buildSaleLedgerEntries(ITEM),
      ...buildSaleLedgerEntries(other),
      ...reversal.entries,
    ];

    expect(balanceOf(ledger, 'seller-a')).toBe(ITEM.sellerNetMinor);
    expect(balanceOf(ledger, 'seller-b')).toBe(0n);
  });
});

describe('computeReturnReversal — reddedilen girdiler', () => {
  it('sipariş edilenden fazla iade edilemez', () => {
    expect(
      codeOf(() =>
        computeReturnReversal([{ ...ITEM, alreadyReturnedQuantity: 2, returnQuantity: 2 }]),
      ),
    ).toBe('RETURN_NOT_ALLOWED');
  });

  it('sıfır adetli iade reddedilir', () => {
    expect(
      codeOf(() =>
        computeReturnReversal([{ ...ITEM, alreadyReturnedQuantity: 0, returnQuantity: 0 }]),
      ),
    ).toBe('RETURN_NOT_ALLOWED');
  });

  it('tutarsız satış kaydı (hakediş brütten büyük) işlemi durdurur', () => {
    expect(
      codeOf(() =>
        computeReturnReversal([
          {
            ...ITEM,
            sellerNetMinor: 29_000n, // lineTotal − komisyon = 26.247 → tutarsız
            alreadyReturnedQuantity: 0,
            returnQuantity: 1,
          },
        ]),
      ),
    ).toBe('PAYMENT_AMOUNT_MISMATCH');
  });
});
