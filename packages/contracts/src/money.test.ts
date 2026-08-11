import { describe, expect, it } from 'vitest';
import {
  add,
  allocate,
  applyBps,
  formatMoney,
  fromMajor,
  money,
  multiply,
  subtract,
  sum,
  toMajor,
} from './money.js';

describe('money', () => {
  it('lira girdisini kuruşa çevirir', () => {
    expect(fromMajor(149.9).amountMinor).toBe(14990n);
    expect(fromMajor(0.1).amountMinor).toBe(10n);
  });

  it('kayan nokta hatasına düşmez', () => {
    // 0.1 + 0.2 === 0.30000000000000004 tuzağı
    const total = add(fromMajor(0.1), fromMajor(0.2));
    expect(total.amountMinor).toBe(30n);
    expect(toMajor(total)).toBe(0.3);
  });

  it('tam sayı olmayan kuruş kabul etmez', () => {
    expect(() => money(12.5)).toThrow(/tam sayı/);
  });

  it('toplama, çıkarma ve çarpma yapar', () => {
    expect(add(money(1000), money(500)).amountMinor).toBe(1500n);
    expect(subtract(money(1000), money(500)).amountMinor).toBe(500n);
    expect(multiply(money(1000), 3).amountMinor).toBe(3000n);
    expect(sum([money(100), money(200), money(300)]).amountMinor).toBe(600n);
  });

  it('Türkçe biçimde gösterir', () => {
    // Intl, para birimi ile sayı arasında bölünemez boşluk (U+00A0) kullanır.
    // Kaçış dizisi ile yazılıyor: kaynak dosyada görünmez karakter bırakmamak için.
    expect(formatMoney(money(12345)).replace(/\u00a0/g, ' ')).toBe('\u20ba123,45');
  });
});

describe('applyBps — komisyon hesabı', () => {
  it('%12,50 komisyonu doğru hesaplar', () => {
    const { result } = applyBps(money(100_000), 1250); // 1000,00 ₺ üzerinden %12,50
    expect(result.amountMinor).toBe(12_500n); // 125,00 ₺
  });

  it('yarım yukarı yuvarlar ve kalanı bildirir', () => {
    // 333 kuruş * %12,5 = 41,625 kuruş → 42
    const { result, remainder } = applyBps(money(333), 1250);
    expect(result.amountMinor).toBe(42n);
    expect(remainder).toBeGreaterThan(0n);
  });

  it('%0 komisyonda sıfır döner', () => {
    expect(applyBps(money(100_000), 0).result.amountMinor).toBe(0n);
  });

  it('negatif basis point kabul etmez', () => {
    expect(() => applyBps(money(1000), -1)).toThrow();
  });
});

describe('allocate — kuruş kaybı olmadan dağıtım', () => {
  it('dağıtılan toplam her zaman kaynağa eşittir', () => {
    const discount = money(10_000); // 100,00 ₺
    const parts = allocate(discount, [1, 1, 1]); // 3 satıcıya eşit paylaştır
    const total = parts.reduce((acc, p) => acc + p.amountMinor, 0n);
    expect(total).toBe(10_000n); // 33,33 + 33,33 + 33,34 — 1 kuruş kaybolmaz
  });

  it('ağırlığa göre dağıtır', () => {
    const parts = allocate(money(1000), [3, 1]);
    expect(parts.map((p) => p.amountMinor)).toEqual([750n, 250n]);
  });

  it('tüm ağırlıklar sıfırsa sıfır dağıtır', () => {
    const parts = allocate(money(1000), [0, 0]);
    expect(parts.every((p) => p.amountMinor === 0n)).toBe(true);
  });

  it('boş ağırlık listesinde boş döner', () => {
    expect(allocate(money(1000), [])).toEqual([]);
  });
});
