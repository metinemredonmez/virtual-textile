import { describe, expect, it } from 'vitest';
import { adetCoz, kurusCoz, yuzdeCoz } from './sayi';

/**
 * AYRAÇ SEZGİSELİ — bugüne kadar YALNIZCA tarayıcı gözlemiyle korunuyordu.
 *
 * ⚠️ Bu dosyanın kırılma biçimi SESSİZDİR: "1.5" yanlış çözülürse hesap on kat
 *    şişer ve hiçbir yerde hata görünmez. Tam da bu yüzden birim test hak
 *    ediyordu (AGENTS.md §10 bunu eksik olarak yazıyordu).
 */
describe('ayraç sezgiseli', () => {
  it('virgül varsa nokta BİNLİKTİR', () => {
    expect(kurusCoz('1.290,50', 10_000_00n)).toBe(129050n);
  });

  it('virgül yoksa ve noktadan sonra TAM 3 basamak varsa nokta binliktir', () => {
    expect(kurusCoz('1.290', 10_000_00n)).toBe(129000n);
  });

  it('virgül yoksa ve noktadan sonra 3 basamak YOKSA nokta ONDALIKTIR', () => {
    // ⚠️ Kritik satır: körü körüne nokta silinseydi bu 150n (yani 1,50 ₺) değil
    //    1500n (15,00 ₺) olurdu — on kat sapma, hatasız.
    expect(kurusCoz('1.5', 10_000_00n)).toBe(150n);
  });

  it('çok noktalı binlik yazımı tek sayıya toplar', () => {
    expect(kurusCoz('1.234.567', 10_000_000_00n)).toBe(123456700n);
  });

  it('boşluk ve ₺ simgesi temizlenir', () => {
    expect(kurusCoz(' 1.290,50 ₺', 10_000_00n)).toBe(129050n);
    // Kırılmaz boşluk (U+00A0) da `\s` kapsamında.
    expect(kurusCoz('1 290,50'.replace(' ', ''), 10_000_00n)).toBe(129050n);
  });
});

describe('kurusCoz', () => {
  it('basamaktan fazla ondalığı KIRPMAZ, REDDEDER', () => {
    // Sessiz kırpma, yazılan sayı ile hesaplanan sayıyı ayrıştırırdı.
    expect(kurusCoz('1,234', 10_000_00n)).toBeNull();
  });

  it('üst sınırı aşan tutarı reddeder, sınırın kendisini kabul eder', () => {
    expect(kurusCoz('100,01', 10000n)).toBeNull();
    expect(kurusCoz('100,00', 10000n)).toBe(10000n);
  });

  it('boş ve rakam olmayan girdiyi reddeder', () => {
    expect(kurusCoz('', 10000n)).toBeNull();
    expect(kurusCoz('abc', 10000n)).toBeNull();
    expect(kurusCoz('1,2,3', 10000n)).toBeNull();
  });

  it('eksi işareti PARA GİRDİSİ DEĞİLDİR', () => {
    expect(kurusCoz('-5', 10000n)).toBeNull();
  });
});

describe('yuzdeCoz', () => {
  it('"2,15" → 215 bps', () => {
    expect(yuzdeCoz('2,15', 10_000)).toBe(215);
  });

  it('tam sayı yüzdeyi de bps ölçeğine çıkarır', () => {
    expect(yuzdeCoz('3', 10_000)).toBe(300);
  });

  it('çağıranın verdiği bps tavanını aşan değeri reddeder', () => {
    expect(yuzdeCoz('100,01', 10_000)).toBeNull();
  });
});

describe('adetCoz', () => {
  it('binlik ayraçlı adedi çözer', () => {
    expect(adetCoz('12.500', 1_000_000)).toBe(12500);
  });

  it('ondalıklı adet REDDEDİLİR', () => {
    expect(adetCoz('12,5', 1_000_000)).toBeNull();
  });

  it('tavanı aşan adedi reddeder', () => {
    expect(adetCoz('1.001', 1000)).toBeNull();
  });
});
