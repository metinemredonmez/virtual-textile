import { describe, expect, it } from 'vitest';
import { yerTutucular } from '../i18n/icu.js';
import { LOCALES, type Locale } from '../i18n/locale.js';
import { ERROR_CATALOG_EN, ERROR_MESSAGES } from './error-catalog.en.js';
import { ERROR_CATALOG, ERROR_CODES, getErrorDefinition, type ErrorCode } from './error-catalog.js';
import { errorMessage, wireErrorMessage } from './error-message.js';

/**
 * ÇEVİRİ BOŞLUĞU KAPISI.
 *
 * ⚠️ ÇEVİRİ EKSİĞİ ÖLÜ BAĞLANTIDAN DAHA SİNSİDİR. Ölü bağlantı 404 verir;
 *    eksik çeviri BAŞARILI bir sayfa üretir — `tsc` geçer, `next build` geçer,
 *    yanıt 200 döner ve kullanıcı ya ham anahtarı ya Türkçeyi görür. Kimse
 *    fark etmez. Bu dosyanın tek işi o sessizliği bozmak.
 *
 * İki katman var ve ikisi de gerekli:
 *   1. DERLEME — `error-catalog.en.ts` `satisfies Record<ErrorCode, string>`
 *      taşıyor, yani EKSİK ya da FAZLA anahtar derlemeyi kırar.
 *   2. BU TESTLER — derlemenin GÖREMEDİĞİ şeyi kapatır: iki metin de `string`
 *      olduğu için yer tutucu farkı, boş dizge ve "çevrilmemiş kopya" tip
 *      düzeyinde görünmez.
 */
describe('hata kataloğu — diller arası tutarlılık', () => {
  it('her dil TAM 115 kod taşır ve anahtar kümeleri birebir eşittir', () => {
    // ⚠️ Alt sınır iddiası: tarama boşalırsa test var olmamasıyla aynı şeydir.
    //
    // 114 → 115: TRYON_OUTFIT_UNAVAILABLE — kombin denemesi özellik kapısı.
    //   Kombin üretiminin worker tarafı yazılmamış; uç 202 QUEUED dönüp
    //   sonsuza kadar bekletiyor ve kota yakıyordu. Kapı, worker tarafı
    //   bağlandığında bu kodla birlikte kalkacak ve sayı 114'e dönecek.
    // 111 → 114: site içeriği turunda üç kod eklendi (SITE_IMAGE_NOT_FOUND,
    // SITE_IMAGE_TARGET_INVALID, SITE_IMAGE_TOO_MANY_CARDS). Sayının ELLE
    // güncellenmesi gerekmesi bir zahmet değil, TASARIM: kod eklemek bilinçli
    // bir karar olmalı ve bu satır o kararın kaydı.
    expect(ERROR_CODES.length).toBe(115);

    for (const locale of LOCALES) {
      expect(Object.keys(ERROR_MESSAGES[locale]).sort()).toEqual([...ERROR_CODES].sort());
    }
  });

  it('hiçbir dilde boş ya da yalnızca boşluktan oluşan metin yok', () => {
    for (const locale of LOCALES) {
      for (const code of ERROR_CODES) {
        expect(ERROR_MESSAGES[locale][code].trim(), `${locale}/${code}`).not.toBe('');
      }
    }
  });

  /**
   * ⚠️ BU TESTİN OLMADIĞI DÜNYA: `INSUFFICIENT_STOCK`un İngilizcesine
   *    `{available}` yazmayı unutursun. Anahtar var, tip `string`, derleme
   *    geçer. Kullanıcı "Not enough stock left." görür — kaç adet
   *    alabileceğini SÖYLEMEYEN bir cümle. Türkçesi söylüyor. Fark yalnızca
   *    İngilizce konuşan kullanıcıda ve yalnızca stok bittiğinde görünür.
   */
  it('yer tutucu kümeleri her dilde AYNI', () => {
    for (const code of ERROR_CODES) {
      const kaynak = yerTutucular(ERROR_CATALOG[code].message);
      expect(yerTutucular(ERROR_CATALOG_EN[code]), `${code} yer tutucuları`).toEqual(kaynak);
    }
  });

  /**
   * ⚠️ `params` bildirimi yer tutucularla EŞİT olmak zorunda: eksikse değer
   *    biçimlenmeden basılır (kuruş tutarı ekrana "100000" diye çıkar),
   *    fazlaysa artık kullanılmayan bir tür bildirimi kalır ve bir sonraki
   *    okuyan onu şablonda arar.
   */
  it('params tür bildirimi mesajdaki yer tutucularla birebir örtüşür', () => {
    for (const code of ERROR_CODES) {
      const beklenen = yerTutucular(ERROR_CATALOG[code].message);
      const bildirilen = Object.keys(getErrorDefinition(code).params ?? {}).sort();
      expect(bildirilen, `${code} params bildirimi`).toEqual(beklenen);
    }
  });

  /**
   * "Çevrilmedi" hâlinin en sık biçimi: Türkçe cümleyi kopyalayıp bırakmak.
   * Tip düzeyinde görünmez, gözle de kaçar — 111 satırın içinde bir tanesi.
   */
  it('hiçbir İngilizce metin Türkçe kaynağın birebir kopyası değil', () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_CATALOG_EN[code], `${code} çevrilmemiş`).not.toBe(ERROR_CATALOG[code].message);
    }
  });

  it('İngilizce metinlerde Türkçeye özgü harf kalmamış', () => {
    // ç ğ ı İ ö ş ü — bir cümle yarım çevrildiğinde geriye tam olarak bunlar kalır.
    const turkceHarf = /[çğıİşĞİÇŞ]|ü(?![a-z])/;
    for (const code of ERROR_CODES) {
      expect(turkceHarf.test(ERROR_CATALOG_EN[code]), `${code}: ${ERROR_CATALOG_EN[code]}`).toBe(
        false,
      );
    }
  });
});

describe('errorMessage — parametre biçimleme', () => {
  it('parametresiz kod her iki dilde de katalog metnini aynen verir', () => {
    expect(errorMessage('CART_EMPTY', { locale: 'tr' })).toBe('Sepetiniz boş.');
    expect(errorMessage('CART_EMPTY', { locale: 'en' })).toBe('Your cart is empty.');
  });

  /**
   * ⚠️ BU DEPODAKİ ASIL TUZAK. Tutar telde KURUŞ olarak geliyor; biçim
   *    gösterildiği dilde kuruluyor. Sunucu hazır dizgi gönderseydi İngilizce
   *    cümlede Türkçe ayraçlı bir tutar kalırdı.
   */
  it('para parametresi dile göre biçimlenir, para birimi TRY kalır', () => {
    // Bölünmez boşluk (U+00A0) normalleştiriliyor — `money.test.ts` de aynısını
    // yapıyor. ⚠️ Kaçış dizisiyle yazılır, HAM karakterle değil: ham hâli gözle
    // normal boşluktan ayırt edilemiyor, yani testi okuyan neyin
    // normalleştirildiğini göremiyor (`no-irregular-whitespace` de bu yüzden var).
    const duz = (metin: string): string => metin.replace(/\u00a0/g, ' ');

    expect(
      duz(errorMessage('PAYOUT_BELOW_MINIMUM', { locale: 'tr', params: { minAmount: '10000' } })),
    ).toBe('Ödeme talebi en az ₺100,00 tutarında olmalıdır.');

    expect(
      duz(errorMessage('PAYOUT_BELOW_MINIMUM', { locale: 'en', params: { minAmount: '10000' } })),
    ).toBe('A payout request must be at least TRY 100.00.');
  });

  /**
   * ⚠️ Parametre `BigInt` yolundan geçiyor: dizgi hiçbir noktada `Number()`a
   *    verilmiyor. `Number('10000')` da çalışırdı — bu testin işi çalıştığını
   *    değil, YOLUN DOĞRU OLDUĞUNU sabitlemek: kuruş ayırma `BigInt` üstünde
   *    yapılıyor ve tutar tam.
   *
   * ⚠️ AÇIK SINIR: gösterim `Money.toMajor` üzerinden geçtiği için (`Number /
   *    100`) 2^53 kuruşun (≈ 90 trilyon ₺) üstünde son basamaklar yuvarlanır.
   *    Bu bu turda AÇILMADI; `toMajor`ın kendi yorumu zaten "yalnızca gösterim"
   *    diyor ve hesapta kullanılmıyor.
   */
  it('para parametresi büyük tutarda da kuruşuna kadar doğru', () => {
    const metin = errorMessage('COUPON_MIN_AMOUNT', {
      locale: 'tr',
      params: { minAmount: '123456789' },
    });
    expect(metin.replace(/\u00a0/g, ' ')).toBe(
      'Bu kupon için en az ₺1.234.567,89 tutarında alışveriş yapmalısınız.',
    );
  });

  /**
   * ⚠️ Türkçede sayıdan sonra çoğul eki YOK, İngilizcede VAR. Düz yer
   *    tutucuyla çevrilen metin İngilizcede "1 units" yazar.
   */
  it('İngilizce çoğul sayıya göre seçilir, Türkçe metin değişmez', () => {
    expect(
      errorMessage('INSUFFICIENT_STOCK', { locale: 'en', params: { available: 1 } }),
    ).toContain('at most 1 unit of');
    expect(
      errorMessage('INSUFFICIENT_STOCK', { locale: 'en', params: { available: 3 } }),
    ).toContain('at most 3 units of');
    expect(
      errorMessage('INSUFFICIENT_STOCK', { locale: 'tr', params: { available: 1 } }),
    ).toContain('en fazla 1 adet');
  });

  it('sayı parametresi dizgi olarak gelse de çoğul doğru seçilir', () => {
    // Tel üzerinden JSON sayı da dizgi de taşıyabilir; ikisi aynı cümleyi vermeli.
    expect(errorMessage('BULK_UPLOAD_INVALID', { locale: 'en', params: { count: '1' } })).toBe(
      errorMessage('BULK_UPLOAD_INVALID', { locale: 'en', params: { count: 1 } }),
    );
  });

  /**
   * ⚠️ Eksik parametre BOŞ DİZGE ÜRETMEZ. "en fazla adet alabilirsiniz"
   *    cümlesi hatanın kendisinden daha kafa karıştırıcı; yer tutucu görünür
   *    kalırsa arıza ilk gören kişide belli olur.
   */
  it('eksik parametre yer tutucuyu olduğu gibi bırakır', () => {
    expect(errorMessage('INSUFFICIENT_STOCK', { locale: 'tr' })).toContain('{available}');
  });

  it('locale verilmezse Türkçe', () => {
    expect(errorMessage('CART_EMPTY')).toBe(ERROR_CATALOG.CART_EMPTY.message);
  });
});

describe('wireErrorMessage — sürüm sapması', () => {
  it('bilinen kodda katalogdan okur, sunucunun metnini YOK SAYAR', () => {
    const metin = wireErrorMessage(
      { code: 'CART_EMPTY', message: 'eski sürümden kalma cümle' },
      'en',
    );
    expect(metin).toBe('Your cart is empty.');
  });

  /**
   * ⚠️ Katalogda olmayan kodda BOŞ EKRAN YOK: sunucunun hazır cümlesi
   *    gösterilir. Bedeli açıkça — o tek cümle sunucunun dilinde kalır.
   */
  it('bilinmeyen kodda sunucunun metnine düşer', () => {
    const metin = wireErrorMessage(
      { code: 'GELECEKTEN_GELEN_KOD', message: 'Yeni bir durum oluştu.' },
      'en',
    );
    expect(metin).toBe('Yeni bir durum oluştu.');
  });

  it('bilinmeyen kod VE metin yoksa katalogdaki genel hataya düşer', () => {
    expect(wireErrorMessage({ code: 'YOK' }, 'en')).toContain('Something went wrong');
  });
});

describe('ERROR_MESSAGES.tr — kaynaktan türetiliyor', () => {
  /**
   * ⚠️ Türkçe metin `ERROR_CATALOG`tan TÜRETİLİR, kopyalanmaz. Kopyalansaydı
   *    bir cümle düzeltildiğinde iki dosyanın ikisi de güncellenmek zorunda
   *    kalırdı ve unutulan kopya sessizce eski cümleyi göstermeye devam ederdi.
   */
  it('her kodda ERROR_CATALOG.message ile aynı nesneyi gösterir', () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_MESSAGES.tr[code]).toBe(ERROR_CATALOG[code].message);
    }
  });

  it('LOCALES dışında bir dil anahtarı yok', () => {
    const diller = Object.keys(ERROR_MESSAGES) as Locale[];
    expect(diller.sort()).toEqual([...LOCALES].sort());
  });
});

describe('katalog davranışı dile bağlı DEĞİL', () => {
  /**
   * ⚠️ `error-catalog.en.ts` yalnızca METİN taşır. Bir gün oraya `status` ya da
   *    `retryable` kopyalanırsa iki dosya ayrışabilir hâle gelir ve İngilizce
   *    konuşan kullanıcı farklı bir HTTP davranışı görür. Bu test o kapıyı
   *    tutuyor.
   */
  it('İngilizce katalog yalnızca dizgi tutar', () => {
    for (const code of ERROR_CODES as ErrorCode[]) {
      expect(typeof ERROR_CATALOG_EN[code]).toBe('string');
    }
  });
});
