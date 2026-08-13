import { INTL_ETIKET, VARSAYILAN_LOCALE, type Locale } from './i18n/locale.js';

/**
 * PARA — kayan noktalı sayı kullanılmaz.
 *
 * Tüm tutarlar `bigint` ve **kuruş** (minor unit) cinsindendir.
 * 123,45 ₺  →  12345n
 *
 * Neden: `0.1 + 0.2 !== 0.3`. Finansal hesapta bu tolere edilemez.
 */

export type Currency = 'TRY';
export type Minor = bigint;

export interface Money {
  readonly amountMinor: Minor;
  readonly currency: Currency;
}

export const ZERO: Money = { amountMinor: 0n, currency: 'TRY' };

export function money(amountMinor: Minor | number, currency: Currency = 'TRY'): Money {
  if (typeof amountMinor === 'number') {
    if (!Number.isInteger(amountMinor)) {
      throw new TypeError(
        `Para tutarı tam sayı (kuruş) olmalı, ${amountMinor} verildi. Lira için fromMajor() kullanın.`,
      );
    }
    return { amountMinor: BigInt(amountMinor), currency };
  }
  return { amountMinor, currency };
}

/** 149.9 lira → 14990n kuruş. Yalnızca kullanıcı girdisi/parse sınırında kullanılır. */
export function fromMajor(major: number, currency: Currency = 'TRY'): Money {
  return { amountMinor: BigInt(Math.round(major * 100)), currency };
}

/** Yalnızca gösterim için. Hesaplamada ASLA kullanılmaz. */
export function toMajor(m: Money): number {
  return Number(m.amountMinor) / 100;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new TypeError(`Farklı para birimleri toplanamaz: ${a.currency} ve ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amountMinor: a.amountMinor - b.amountMinor, currency: a.currency };
}

export function sum(items: readonly Money[], currency: Currency = 'TRY'): Money {
  return items.reduce<Money>((acc, item) => add(acc, item), { amountMinor: 0n, currency });
}

export function multiply(m: Money, quantity: number): Money {
  if (!Number.isInteger(quantity)) {
    throw new TypeError(`Adet tam sayı olmalı, ${quantity} verildi.`);
  }
  return { amountMinor: m.amountMinor * BigInt(quantity), currency: m.currency };
}

export function isZero(m: Money): boolean {
  return m.amountMinor === 0n;
}

export function isNegative(m: Money): boolean {
  return m.amountMinor < 0n;
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.amountMinor < b.amountMinor) return -1;
  if (a.amountMinor > b.amountMinor) return 1;
  return 0;
}

export function max(a: Money, b: Money): Money {
  return compare(a, b) >= 0 ? a : b;
}

export function min(a: Money, b: Money): Money {
  return compare(a, b) <= 0 ? a : b;
}

/** Basis point: 1250 bps = %12,50. Yüzdeyi float olarak taşımamak için. */
export type BasisPoints = number;

export const BPS_DENOMINATOR = 10_000n;

/**
 * Basis point ile oransal tutar hesaplar.
 *
 * Yuvarlama **yarım yukarı (half-up)** yapılır ve kalan çağıran tarafa bildirilir;
 * komisyon hesabında 1 kuruşluk fark bile mutabakatı bozar.
 */
export function applyBps(m: Money, bps: BasisPoints): { result: Money; remainder: Minor } {
  if (!Number.isInteger(bps) || bps < 0) {
    throw new TypeError(`Basis point negatif olmayan tam sayı olmalı, ${bps} verildi.`);
  }
  const numerator = m.amountMinor * BigInt(bps);
  const quotient = numerator / BPS_DENOMINATOR;
  const remainder = numerator % BPS_DENOMINATOR;
  // half-up yuvarlama
  const rounded = remainder * 2n >= BPS_DENOMINATOR ? quotient + 1n : quotient;
  return {
    result: { amountMinor: rounded, currency: m.currency },
    remainder,
  };
}

export function bpsToPercentLabel(bps: BasisPoints): string {
  return `%${(bps / 100).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/**
 * Bir tutarı ağırlıklara göre böler ve **kuruş kaybı olmadan** dağıtır.
 * Kalan kuruşlar en büyük ağırlıktan başlayarak birer birer dağıtılır.
 *
 * Kullanım: sepet indirimini satıcı paketlerine paylaştırma.
 */
export function allocate(m: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) return [];
  if (weights.some((w) => w < 0)) throw new TypeError('Ağırlıklar negatif olamaz.');

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight === 0) {
    return weights.map(() => ({ amountMinor: 0n, currency: m.currency }));
  }

  const shares = weights.map(
    (w) => (m.amountMinor * BigInt(Math.round(w * 1e6))) / BigInt(Math.round(totalWeight * 1e6)),
  );
  let distributed = shares.reduce((a, b) => a + b, 0n);
  const result = shares.map((amountMinor) => ({ amountMinor, currency: m.currency }));

  // Kalan kuruşları ağırlığı en büyük olandan başlayarak dağıt
  const order = weights
    .map((w, i) => ({ w, i }))
    .sort((a, b) => b.w - a.w)
    .map(({ i }) => i);

  let index = 0;
  while (distributed < m.amountMinor) {
    const target = order[index % order.length]!;
    result[target] = {
      amountMinor: result[target]!.amountMinor + 1n,
      currency: m.currency,
    };
    distributed += 1n;
    index += 1;
  }

  return result;
}

/**
 * ⚠️ DİL BAŞINA BİR BİÇİMLEYİCİ — VE PARA BİRİMİ DEĞİŞMEZ.
 *
 *    `currency: 'TRY'` sabittir: kullanıcı arayüz dilini İngilizceye çevirdiğinde
 *    ödeyeceği tutar değişmez. Locale yalnızca ayracı ve simgenin yerini seçer
 *    ("1.290,00 ₺" ↔ "TRY 1,290.00"). Para birimini dile bağlamak, dil
 *    değiştiren kullanıcıya BAŞKA BİR FİYAT göstermek olurdu.
 *
 * ⚠️ Tekil `TRY_FORMATTER` sabitinin yerine harita geçti; çağrı başına
 *    `new Intl.NumberFormat` KURULMAZ. Ürün ızgarası tek çizimde 24 fiyat
 *    basıyor ve `Intl` kurucusu bu depodaki en pahalı gösterim çağrısı.
 */
const PARA_BICIMLEYICI = new Map<Locale, Intl.NumberFormat>();

function paraBicimleyici(locale: Locale): Intl.NumberFormat {
  let bicimleyici = PARA_BICIMLEYICI.get(locale);
  if (!bicimleyici) {
    bicimleyici = new Intl.NumberFormat(INTL_ETIKET[locale], {
      style: 'currency',
      currency: 'TRY',
      minimumFractionDigits: 2,
    });
    PARA_BICIMLEYICI.set(locale, bicimleyici);
  }
  return bicimleyici;
}

/**
 * Yalnızca gösterim: 12345n → "₺123,45" (tr) · "TRY 123.45" (en)
 *
 * ⚠️ Simgenin YERİ de locale'den gelir, elle eklenmez: Türkçede önde (`₺123,45`),
 *    İngilizcede kod olarak önde (`TRY 123.45`). Bir dizgi birleştirmesiyle
 *    "123,45 ₺" üretmek iki dilden birinde mutlaka yanlış olurdu. Ayraç
 *    boşluğu bazı ICU sürümlerinde bölünmez boşluktur (U+00A0); metin
 *    karşılaştıran testler bunu normalleştirmeli.
 *
 * ⚠️ İmza GERİYE UYUMLU: locale verilmezse Türkçe. Onlarca çağrı yerinin
 *    hepsine ikinci argüman eklemek, bu turda dokunulmaması gereken dosyaları
 *    da değiştirmek olurdu. Ekran kodunda bu fonksiyon zaten HİÇ görünmez
 *    (AGENTS.md §3): telden gelen tutar `<Fiyat>`ten, kullanıcının yazdığı
 *    `<Tutar>`dan geçer ve locale'i o iki bileşen taşır.
 */
export function formatMoney(m: Money, locale: Locale = VARSAYILAN_LOCALE): string {
  return paraBicimleyici(locale).format(toMajor(m));
}

/** JSON'da bigint serileşmediği için API sınırında string'e çevrilir. */
export function serializeMoney(m: Money): { amountMinor: string; currency: Currency } {
  return { amountMinor: m.amountMinor.toString(), currency: m.currency };
}

export function deserializeMoney(input: { amountMinor: string; currency: Currency }): Money {
  return { amountMinor: BigInt(input.amountMinor), currency: input.currency };
}
