import { describe, expect, it } from 'vitest';
import {
  baslikTahmini,
  dilDegistir,
  hedefLocale,
  muafMi,
  onekAyir,
  onekEkle,
  yonlendirmeHedefi,
} from './muzakere';

describe('onekAyir', () => {
  it('dil önekini ayırır', () => {
    expect(onekAyir('/en/products')).toEqual({ locale: 'en', kalan: '/products' });
    expect(onekAyir('/tr/account/orders')).toEqual({ locale: 'tr', kalan: '/account/orders' });
  });

  it('yalnız önekten oluşan yolda kalan köktür', () => {
    expect(onekAyir('/en')).toEqual({ locale: 'en', kalan: '/' });
  });

  it('öneksiz yolu olduğu gibi bırakır', () => {
    expect(onekAyir('/products')).toEqual({ locale: null, kalan: '/products' });
    expect(onekAyir('/')).toEqual({ locale: null, kalan: '/' });
  });

  /**
   * ⚠️ `startsWith('/en')` yazılsaydı BU test kırmızı olurdu ve arıza şöyle
   *    görünürdü: `/energy` adresi `/ergy`ye çevrilip 404 verirdi. Segment
   *    sınırı aranmak zorunda.
   */
  it('dil koduyla BAŞLAYAN ama dil OLMAYAN segmenti önek sanmaz', () => {
    expect(onekAyir('/energy')).toEqual({ locale: null, kalan: '/energy' });
    expect(onekAyir('/trend/xyz')).toEqual({ locale: null, kalan: '/trend/xyz' });
  });

  it('desteklenmeyen dil kodunu önek saymaz', () => {
    expect(onekAyir('/de/products')).toEqual({ locale: null, kalan: '/de/products' });
  });
});

describe('onekEkle', () => {
  it('yolun başına dili koyar', () => {
    expect(onekEkle('/products', 'en')).toBe('/en/products');
  });

  it('kök için tek segment üretir — /en/ DEĞİL', () => {
    expect(onekEkle('/', 'tr')).toBe('/tr');
  });
});

describe('baslikTahmini', () => {
  it('en yüksek q değerli desteklenen dili seçer', () => {
    expect(baslikTahmini('tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7')).toBe('tr');
    expect(baslikTahmini('en-US,en;q=0.9,tr;q=0.8')).toBe('en');
  });

  /**
   * ⚠️ SIRAYI YOK SAYAN BİR AYRIŞTIRICI BURADA YANILIR: dizgide `en-US` daha
   *    ÖNDE ama ağırlığı daha düşük. Türk kullanıcıya İngilizce açılırdı.
   */
  it('sırayı değil AĞIRLIĞI okur', () => {
    expect(baslikTahmini('en-US;q=0.3,tr;q=0.9')).toBe('tr');
  });

  it('bölge ekini düşürür', () => {
    expect(baslikTahmini('en-GB')).toBe('en');
    expect(baslikTahmini('tr-CY')).toBe('tr');
  });

  it('q=0 olan dili aday saymaz', () => {
    expect(baslikTahmini('en;q=0,tr;q=0.5')).toBe('tr');
  });

  it('desteklenen dil yoksa null', () => {
    expect(baslikTahmini('de-DE,de;q=0.9,fr;q=0.8')).toBeNull();
    expect(baslikTahmini(null)).toBeNull();
    expect(baslikTahmini('')).toBeNull();
  });
});

describe('hedefLocale', () => {
  /** ⚠️ Çerez başlığı EZER — yoksa kullanıcının seçimi her sekmede geri alınırdı. */
  it('çerez varsa Accept-Language yok sayılır', () => {
    expect(hedefLocale({ cerez: 'en', acceptLanguage: 'tr-TR,tr;q=0.9' })).toBe('en');
  });

  it('çerez yoksa başlıktan tahmin eder', () => {
    expect(hedefLocale({ cerez: null, acceptLanguage: 'en-US,en;q=0.9' })).toBe('en');
  });

  it('geçersiz çerez değeri yok sayılır', () => {
    expect(hedefLocale({ cerez: 'de', acceptLanguage: 'en-US' })).toBe('en');
  });

  it('hiçbiri yoksa Türkçe', () => {
    expect(hedefLocale({})).toBe('tr');
  });
});

describe('yonlendirmeHedefi', () => {
  it('öneksiz yolu tercih edilen dile yönlendirir', () => {
    expect(yonlendirmeHedefi({ pathname: '/products', cerez: 'en' })).toBe('/en/products');
    expect(yonlendirmeHedefi({ pathname: '/', acceptLanguage: 'tr' })).toBe('/tr');
  });

  it('sorgu dizesini korur', () => {
    expect(yonlendirmeHedefi({ pathname: '/products', search: '?sirala=fiyat', cerez: 'tr' })).toBe(
      '/tr/products?sirala=fiyat',
    );
  });

  /**
   * ⚠️ ZATEN ÖNEKLİ ADRESTE YÖNLENDİRME YOK. Olsaydı `/tr/x` → `/tr/tr/x`
   *    döngüsü doğar ve tarayıcı ERR_TOO_MANY_REDIRECTS gösterirdi — sitenin
   *    tamamı kapanırdı.
   */
  it('zaten önekli yolda yönlendirme üretmez', () => {
    expect(yonlendirmeHedefi({ pathname: '/tr/products', cerez: 'en' })).toBeNull();
    expect(yonlendirmeHedefi({ pathname: '/en', cerez: 'tr' })).toBeNull();
  });

  it('muaf yollarda yönlendirme üretmez', () => {
    expect(yonlendirmeHedefi({ pathname: '/api/cart', cerez: 'en' })).toBeNull();
    expect(yonlendirmeHedefi({ pathname: '/_next/static/x.js' })).toBeNull();
    expect(yonlendirmeHedefi({ pathname: '/favicon.ico' })).toBeNull();
    expect(yonlendirmeHedefi({ pathname: '/robots.txt' })).toBeNull();
  });
});

describe('muafMi', () => {
  it('vekil, statik varlık ve uzantılı yollar muaf', () => {
    expect(muafMi('/api/cart')).toBe(true);
    expect(muafMi('/api')).toBe(true);
    expect(muafMi('/_next/image')).toBe(true);
    expect(muafMi('/sitemap.xml')).toBe(true);
  });

  it('normal sayfa yolları muaf DEĞİL', () => {
    expect(muafMi('/products')).toBe(false);
    expect(muafMi('/account/orders')).toBe(false);
    // ⚠️ Ürün slug'ı nokta içerebilir mi? İçermiyor (slug şeması), ama içerseydi
    //    uzantı deseni onu statik varlık sanardı. Bugünkü davranış kayıt altında.
    expect(muafMi('/product/keten-gomlek')).toBe(false);
  });
});

describe('dilDegistir', () => {
  it('mevcut öneki hedefle değiştirir', () => {
    expect(dilDegistir('/en/products', 'tr')).toBe('/tr/products');
    expect(dilDegistir('/tr/account/orders', 'en')).toBe('/en/account/orders');
  });

  it('öneksiz yola önek ekler', () => {
    expect(dilDegistir('/products', 'en')).toBe('/en/products');
  });

  it('kökte tek segment üretir', () => {
    expect(dilDegistir('/tr', 'en')).toBe('/en');
  });
});
