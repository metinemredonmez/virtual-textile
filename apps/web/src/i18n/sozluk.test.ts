import { LOCALES, yerTutucular, type Locale } from '@vt/contracts';
import { describe, expect, it } from 'vitest';
import { SOZLUKLER, sozluk } from './sozluk';

/**
 * SÖZLÜK KAPISI — DERLEMENİN GÖREMEDİĞİ ÜÇ ŞEY.
 *
 * `en.ts` `satisfies Sozluk` taşıdığı için EKSİK ve FAZLA anahtar zaten
 * derlemeyi kırıyor. Buradaki testler o kapının ARDINDA kalan üç boşluğu
 * kapatıyor — üçü de "tsc temiz, sayfa 200, kullanıcı yanlış metin görür"
 * sınıfından:
 *
 *   1. YER TUTUCU FARKI. `'© {yil} Virtual Textile'` karşısına `'© Virtual
 *      Textile'` yazarsan iki değer de `string`, tip aynı, yıl sessizce kaybolur.
 *   2. ÇEVRİLMEMİŞ KOPYA. Türkçeyi kopyalayıp bırakmak tip düzeyinde kusursuz.
 *   3. BOŞ DEĞER. `''` de bir `string`tir.
 */

type Duz = Record<string, string>;

/** İç içe sözlüğü `panel.sonrakiSayfa` gibi düz anahtarlara indirger. */
function duzlestir(nesne: object, onek = ''): Duz {
  const sonuc: Duz = {};
  for (const [anahtar, deger] of Object.entries(nesne)) {
    const yol = onek ? `${onek}.${anahtar}` : anahtar;
    if (typeof deger === 'string') sonuc[yol] = deger;
    else Object.assign(sonuc, duzlestir(deger as object, yol));
  }
  return sonuc;
}

const DUZ: Record<Locale, Duz> = {
  tr: duzlestir(SOZLUKLER.tr),
  en: duzlestir(SOZLUKLER.en),
};

describe('sözlük — diller arası tutarlılık', () => {
  /**
   * ⚠️ ALT SINIR İDDİASI. Tarama boşalırsa bu dosyanın var olmasıyla olmaması
   *    aynı şey olur — bu depoda tam olarak bu yaşandı (`yan-menu.test.ts`
   *    yokken `vitest` yeşildi ama frontend hiç ölçülmüyordu).
   */
  it('sözlük boş değil', () => {
    expect(Object.keys(DUZ.tr).length).toBeGreaterThan(80);
  });

  it('her dil için sözlük var ve anahtar kümeleri birebir eşit', () => {
    for (const locale of LOCALES) {
      expect(sozluk(locale)).toBeTruthy();
    }
    expect(Object.keys(DUZ.en).sort()).toEqual(Object.keys(DUZ.tr).sort());
  });

  it('hiçbir dilde boş metin yok', () => {
    for (const locale of LOCALES) {
      for (const [anahtar, deger] of Object.entries(DUZ[locale])) {
        expect(deger.trim(), `${locale}/${anahtar}`).not.toBe('');
      }
    }
  });

  /**
   * ⚠️ DERLEMENİN GÖREMEDİĞİ BİRİNCİ ŞEY. `{yil}` yazmayı unutmak tip
   *    düzeyinde görünmez; altbilgi her yıl aynı metni gösterir ve kimse
   *    bakmaz.
   */
  it('yer tutucu kümeleri her anahtarda AYNI', () => {
    for (const [anahtar, trMetin] of Object.entries(DUZ.tr)) {
      expect(yerTutucular(DUZ.en[anahtar] ?? ''), `${anahtar} yer tutucuları`).toEqual(
        yerTutucular(trMetin),
      );
    }
  });

  /**
   * ⚠️ ÇOĞUL DALLARI. Türkçede `one` ve `other` aynı sözcüğü taşıyor (dilde
   *    çoğul eki yok) — bu DOĞRU. İngilizcede aynı olması ise çevirinin yarım
   *    kaldığının işareti: "1 results".
   */
  it('İngilizce çoğul dalları birbirinden farklı', () => {
    const cogulDallari = /\{[^}]*,\s*plural\s*,/;
    for (const [anahtar, enMetin] of Object.entries(DUZ.en)) {
      if (!cogulDallari.test(enMetin)) continue;
      const one = enMetin.match(/\bone \{([^}]*)\}/)?.[1];
      const other = enMetin.match(/\bother \{([^}]*)\}/)?.[1];
      if (one === undefined || other === undefined) continue;
      expect(one, `${anahtar}: one/other dalları aynı — çoğul yarım kalmış`).not.toBe(other);
    }
  });
});

describe('sözlük — çevrilmemiş kalıntı', () => {
  /**
   * ⚠️ BEYAZ LİSTE GEREKÇESİYLE BİRLİKTE TUTULUR, `Set` olarak DEĞİL.
   *    Gerekçesiz bir liste, testi susturmanın en kolay yoluna dönüşür: bir
   *    çeviri unutulunca anahtarı listeye eklemek testi yeşile döndürür ve
   *    hiçbir iz bırakmaz. Buraya satır eklemek, o satırın NEDEN aynı kaldığını
   *    yazmayı zorunlu kılıyor.
   */
  const BEYAZ_LISTE: Record<string, string> = {
    'dil.tr': 'Dil adları her dilde KENDİ adıyla yazılır — dilini bilmeyen satırını bulabilsin.',
    'dil.en': 'Aynı gerekçe.',
    'altbilgi.telifHakki':
      'Marka adı + yıl. "Virtual Textile" çevrilmez, © simgesi evrensel; iki dilde de aynı olması doğru.',
  };

  it('hiçbir İngilizce metin Türkçesinin birebir kopyası değil', () => {
    for (const [anahtar, trMetin] of Object.entries(DUZ.tr)) {
      if (anahtar in BEYAZ_LISTE) continue;
      expect(DUZ.en[anahtar], `${anahtar} çevrilmemiş`).not.toBe(trMetin);
    }
  });

  it('beyaz listedeki her anahtar gerçekten var ve gerçekten aynı', () => {
    // ⚠️ Bayat beyaz liste, olmayan bir anahtarı koruyup gerçek bir eksiği
    //    saklayabilir. Liste de taranır.
    for (const anahtar of Object.keys(BEYAZ_LISTE)) {
      expect(DUZ.tr[anahtar], `${anahtar} sözlükte yok — beyaz liste bayat`).toBeDefined();
      expect(DUZ.en[anahtar]).toBe(DUZ.tr[anahtar]);
    }
  });

  it('İngilizce metinlerde Türkçeye özgü harf kalmamış', () => {
    const turkceHarf = /[çğıİşĞÇŞ]/;
    for (const [anahtar, enMetin] of Object.entries(DUZ.en)) {
      if (anahtar in BEYAZ_LISTE) continue;
      expect(turkceHarf.test(enMetin), `${anahtar}: ${enMetin}`).toBe(false);
    }
  });
});

describe('sözlük — durum tablolarının kapsamı', () => {
  /**
   * ⚠️ Wire enum'ıyla eşleşme `lib/durum-etiketleri.ts`te `satisfies` ile
   *    kapalı; burada YALNIZCA iki dilin aynı durum kümesini taşıdığı
   *    doğrulanıyor. İkisi ayrı kapı: biri sunucuya yeni bir durum eklendiğini,
   *    diğeri bir dilde o durumun eksik kaldığını yakalar.
   */
  it('her durum tablosu iki dilde de aynı anahtarları taşır', () => {
    const tablolar = ['urun', 'satici', 'siparis', 'paket', 'iade'] as const;
    for (const tablo of tablolar) {
      expect(Object.keys(SOZLUKLER.en.durum[tablo]).sort(), tablo).toEqual(
        Object.keys(SOZLUKLER.tr.durum[tablo]).sort(),
      );
    }
  });
});
