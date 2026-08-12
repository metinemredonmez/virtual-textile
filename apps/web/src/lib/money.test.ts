import { describe, expect, it } from 'vitest';
import { unsafeMinorString } from '@vt/contracts';
import { discountPercent, formatMinor, paraPozitif, readMinor } from './money';

/**
 * PARA OKUMA — bu depoda en pahalı sessiz hatanın olduğu yer.
 *
 * ⚠️ `unsafeMinorString` BURADA MEŞRU: test, telden gelmiş bir değeri TAKLİT
 *    ediyor. Üretim kodunda marka basmak yasağının gerekçesi "bu para API
 *    yanıtından doğdu" güvencesini delmemek; testte kaynak zaten tanımlıdır.
 */
const tel = (v: string) => unsafeMinorString(v);

describe('readMinor', () => {
  it('2^53 üstü kuruşu KAYIPSIZ okur — `Number()` bu satırda sessizce yanlış olur', () => {
    // 9_007_199_254_740_993 = 2^53 + 1. `Number()` bunu 2^53'e yuvarlar ve HATA VERMEZ.
    const buyuk = '9007199254740993';
    expect(readMinor(tel(buyuk)).amountMinor).toBe(9007199254740993n);
    expect(Number(buyuk).toString()).not.toBe(buyuk);
  });

  it('sıfır ve negatif tutarı olduğu gibi taşır', () => {
    expect(readMinor(tel('0')).amountMinor).toBe(0n);
    expect(readMinor(tel('-1250')).amountMinor).toBe(-1250n);
  });
});

describe('formatMinor', () => {
  it('129000 kuruşu binlik ayraçlı TL olarak biçimler', () => {
    // ⚠️ Ayraçlar dar/kırılmaz boşluk olabildiği için tam eşitlik yerine
    //    rakam dizisi ve simge aranıyor; biçimin kendisi Money'nin işi.
    const cikti = formatMinor(tel('129000'));
    expect(cikti).toContain('₺');
    expect(cikti.replace(/\s/g, '')).toContain('1.290,00');
  });
});

describe('discountPercent', () => {
  it('liste fiyatı yüksekse aşağı yuvarlanmış yüzdeyi verir', () => {
    // (167700-129000)*100/167700 = 23,07… → 23
    expect(discountPercent(tel('129000'), tel('167700'))).toBe(23);
  });

  it('liste fiyatı eşit ya da düşükse rozet ÇIKMAZ', () => {
    expect(discountPercent(tel('129000'), tel('129000'))).toBeNull();
    expect(discountPercent(tel('129000'), tel('100000'))).toBeNull();
  });

  it('liste fiyatı 0 iken bölme YAPILMAZ', () => {
    expect(discountPercent(tel('0'), tel('0'))).toBeNull();
  });
});

describe('paraPozitif', () => {
  it('"0" ve eşdeğer yazımlarında satırı GİZLER', () => {
    // ⚠️ `value !== '0'` yazılsaydı bu üç satırın ikisi "İndirim: ₺0,00" basardı.
    expect(paraPozitif(tel('0'))).toBe(false);
    expect(paraPozitif(tel('00'))).toBe(false);
    expect(paraPozitif(tel('-0'))).toBe(false);
  });

  it('pozitif tutarda satırı gösterir, negatifte göstermez', () => {
    expect(paraPozitif(tel('1'))).toBe(true);
    expect(paraPozitif(tel('-500'))).toBe(false);
  });
});
