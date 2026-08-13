import { describe, expect, it } from 'vitest';
import { icuBicimle, yerTutucular } from './icu.js';
import { INTL_ETIKET, isLocale, localeCoz, LOCALES, VARSAYILAN_LOCALE } from './locale.js';

describe('icuBicimle — düz yer tutucu', () => {
  it('süslü parantez yoksa şablonu olduğu gibi döndürür', () => {
    expect(icuBicimle('Sepetiniz boş.', undefined, 'tr')).toBe('Sepetiniz boş.');
  });

  it('adı geçen değeri yerine koyar', () => {
    expect(icuBicimle('Kod: {requestId}', { requestId: 'abc' }, 'tr')).toBe('Kod: abc');
  });

  /**
   * ⚠️ Eksik parametrede BOŞ DİZGE ÜRETİLMEZ. Gerekçe `api-failure.ts`
   *    başlığında: yarım cümle ("en fazla adet alabilirsiniz") hatanın
   *    kendisinden daha kafa karıştırıcı; yer tutucu görünür kalırsa arıza
   *    ilk gören kişide belli olur.
   */
  it('eksik değerde yer tutucu olduğu gibi kalır', () => {
    expect(icuBicimle('En fazla {max} adet', {}, 'tr')).toBe('En fazla {max} adet');
    expect(icuBicimle('En fazla {max} adet', undefined, 'tr')).toBe('En fazla {max} adet');
  });

  it('sayısal değeri dile göre biçimler', () => {
    expect(icuBicimle('{n}', { n: 12345 }, 'tr')).toBe('12.345');
    expect(icuBicimle('{n}', { n: 12345 }, 'en')).toBe('12,345');
  });
});

describe('icuBicimle — çoğul', () => {
  const sablon = '{count, plural, one {# satır} other {# satır}}';
  const enSablon = '{count, plural, one {# row} other {# rows}}';

  it('İngilizcede tekil/çoğul dalını sayıya göre seçer', () => {
    expect(icuBicimle(enSablon, { count: 1 }, 'en')).toBe('1 row');
    expect(icuBicimle(enSablon, { count: 2 }, 'en')).toBe('2 rows');
    expect(icuBicimle(enSablon, { count: 0 }, 'en')).toBe('0 rows');
  });

  /** Türkçede sayıdan sonra çoğul eki yok — iki dal da aynı, ve bu doğru. */
  it('Türkçede her iki dal da aynı metni verir', () => {
    expect(icuBicimle(sablon, { count: 1 }, 'tr')).toBe('1 satır');
    expect(icuBicimle(sablon, { count: 9 }, 'tr')).toBe('9 satır');
  });

  it('=0 gibi tam eşleşme kategori dalını EZER', () => {
    const s = '{n, plural, =0 {hiç} one {# tane} other {# tane}}';
    expect(icuBicimle(s, { n: 0 }, 'tr')).toBe('hiç');
    expect(icuBicimle(s, { n: 1 }, 'tr')).toBe('1 tane');
  });

  it('# sayıyı dile göre biçimler', () => {
    const s = '{n, plural, other {# adet}}';
    expect(icuBicimle(s, { n: 12345 }, 'tr')).toBe('12.345 adet');
    expect(icuBicimle(s, { n: 12345 }, 'en')).toBe('12,345 adet');
  });

  it('seçenek gövdesindeki başka yer tutucular da doldurulur', () => {
    const s = '{n, plural, other {# / {limit}}}';
    expect(icuBicimle(s, { n: 3, limit: 5 }, 'tr')).toBe('3 / 5');
  });

  it('sayı olmayan değerde yer tutucu olduğu gibi kalır', () => {
    const s = '{n, plural, other {# adet}}';
    expect(icuBicimle(s, { n: 'abc' }, 'tr')).toBe(s);
  });

  it('other dalı yoksa ve kategori tutmuyorsa yer tutucu korunur', () => {
    const s = '{n, plural, =0 {hiç}}';
    expect(icuBicimle(s, { n: 4 }, 'tr')).toBe(s);
  });
});

describe('icuBicimle — bozuk şablon', () => {
  /**
   * ⚠️ Bozuk şablonda FIRLATILMAZ. Bu kod yolu HATA GÖSTERME yoludur; burada
   *    atılan bir istisna, kullanıcının gördüğü tek çıkışı da yok eder.
   */
  it('kapanmamış parantezde metnin kalanını olduğu gibi basar', () => {
    expect(icuBicimle('Kod: {requestId', { requestId: 'x' }, 'tr')).toBe('Kod: {requestId');
  });

  it('desteklenmeyen tipte yer tutucuyu olduğu gibi bırakır', () => {
    const s = '{n, select, other {x}}';
    expect(icuBicimle(s, { n: 'a' }, 'tr')).toBe(s);
  });
});

describe('yerTutucular', () => {
  it('düz adları toplar', () => {
    expect(yerTutucular('{a} ve {b}')).toEqual(['a', 'b']);
  });

  /** Çoğul seçenek gövdeleri yer tutucu DEĞİLDİR — `#` bir isim değil, bir dal işareti. */
  it('çoğul seçenek gövdelerini isim sanmaz', () => {
    expect(yerTutucular('{minutes, plural, one {# minute} other {# minutes}}')).toEqual([
      'minutes',
    ]);
  });

  it('seçenek gövdesindeki gerçek yer tutucuyu bulur', () => {
    expect(yerTutucular('{used, plural, other {# / {limit}}}')).toEqual(['limit', 'used']);
  });

  it('aynı adı iki kez saymaz', () => {
    expect(yerTutucular('{a} {a}')).toEqual(['a']);
  });
});

describe('locale', () => {
  it('desteklenen diller tr ve en', () => {
    expect([...LOCALES]).toEqual(['tr', 'en']);
    expect(VARSAYILAN_LOCALE).toBe('tr');
  });

  it('isLocale yalnızca listedekileri kabul eder', () => {
    expect(isLocale('tr')).toBe(true);
    expect(isLocale('de')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  /** Bilinmeyen değer FIRLATMAZ, varsayılana düşer — çağıran her yerde `??` yazmasın. */
  it('localeCoz bilinmeyeni varsayılana indirger', () => {
    expect(localeCoz('en')).toBe('en');
    expect(localeCoz('de')).toBe('tr');
    expect(localeCoz(null)).toBe('tr');
  });

  it('her dil için bir Intl etiketi var', () => {
    for (const locale of LOCALES) {
      expect(INTL_ETIKET[locale]).toBeTruthy();
      expect(() => new Intl.NumberFormat(INTL_ETIKET[locale])).not.toThrow();
    }
  });
});
