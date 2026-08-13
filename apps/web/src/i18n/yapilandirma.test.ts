import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { INTL_ETIKET, VARSAYILAN_LOCALE, LOCALES } from '@vt/contracts';
import { describe, expect, it } from 'vitest';
import { aktifLocale, istekYapilandirmasi } from './yapilandirma';
import { SOZLUKLER } from './sozluk';

const WEB_KOKU = join(__dirname, '..', '..');

/**
 * DİL SEÇİMİ KAPISI — BU DOSYA BİR ARIZANIN ARDINDAN YAZILDI.
 *
 * ⚠️ YAŞANDI: `request.ts` içinde ölçüm amacıyla yazılan `localeCoz('en')`
 *    satırı yerinde unutuldu. Sonucu — `<html lang="en">`, tüm sözlük metinleri
 *    İngilizce, Türk kullanıcı İngilizce bir vitrin görüyor. Ve HİÇBİR KAPI
 *    GÖRMEDİ: `tsc --noEmit` temiz, `next build` temiz, 1373 test yeşil,
 *    `sozluk.test.ts` yeşil.
 *
 * ⚠️ NEDEN KAÇTIĞI, DERSİN KENDİSİ: var olan kapıların hepsi sözlüğün İÇİNE
 *    bakıyordu (anahtar kümeleri eşit mi, yer tutucular aynı mı, çeviri
 *    yapılmış mı) — hiçbiri HANGİ SÖZLÜĞÜN SEÇİLDİĞİNE bakmıyordu. İçerik
 *    kusursuzdu; yanlış olan seçimdi.
 *
 * ⚠️ BU TESTİ "VARSAYILAN TÜRKÇE" DİYE OKUMAYIN. Asıl iddia daha dar ve
 *    `[locale]` göçünden SAĞ ÇIKACAK olan: seçilen dil ile DÖNEN SÖZLÜK aynı
 *    olmalı. Segment geldiğinde ilk iddia değişir, ikincisi değişmez.
 */
describe('i18n istek yapılandırması', () => {
  it('[locale] segmenti yokken varsayılan dile düşer', () => {
    expect(aktifLocale()).toBe(VARSAYILAN_LOCALE);
    expect(istekYapilandirmasi().locale).toBe(VARSAYILAN_LOCALE);
  });

  /**
   * ⚠️ ASIL İDDİA BU. Yukarıdaki tek başına yetmez: `locale: 'tr'` dönüp
   *    `messages: sozluk('en')` vermek de mümkündü ve o kombinasyon DAHA
   *    sinsi olurdu — `<html lang="tr">` ile İngilizce metin, yani ekran
   *    okuyucu İngilizce cümleleri Türkçe sesletir. Hiçbir tip bunu görmez:
   *    iki sözlüğün tipi aynı.
   */
  it('dönen sözlük, seçilen dilin sözlüğüdür', () => {
    for (const locale of LOCALES) {
      const { locale: secilen, messages } = istekYapilandirmasi(locale);
      expect(secilen).toBe(locale);
      expect(messages).toBe(SOZLUKLER[locale]);
    }
  });

  /**
   * ⚠️ Saat dilimi AÇIKÇA verilmezse sunucu (üretimde UTC) ile tarayıcı farklı
   *    biçimlendirir ve kullanıcı tarihi bir an "11 Ağustos", sonra
   *    "12 Ağustos" görür. Bu depoda yaşanmış bir olay (`lib/tarih.ts` başlığı).
   */
  it('saat dilimi sabit Europe/Istanbul', () => {
    expect(istekYapilandirmasi().timeZone).toBe('Europe/Istanbul');
  });

  /**
   * ⚠️ Eksik anahtarda BOŞLUK değil ANAHTAR YOLU basılır. Boş dizge dönseydi
   *    eksik çeviri ekranda BİR HİÇ olurdu — düğmenin üstünde yazı yok, kimse
   *    fark etmez. `panel.sonrakiSayfa` çirkin ve tam da bu yüzden fark edilir.
   */
  it('eksik anahtarda ham anahtar yolu basılır', () => {
    const { getMessageFallback } = istekYapilandirmasi();
    expect(getMessageFallback({ key: 'yok', namespace: 'panel' })).toBe('panel.yok');
    expect(getMessageFallback({ key: 'yok' })).toBe('yok');
  });

  /**
   * ⚠️ DİL KODU İLE Intl ETİKETİ AYRI ŞEYLER. `'en'` bir `Intl` çağrısına
   *    verilirse ICU `en-US`e düşer ("August 12, 2026") ama `lib/tarih.ts`
   *    `en-GB` üretir ("12 August 2026") — iki biçim aynı ekranda yan yana
   *    görünür. Bu iddia ikisinin karıştırılmadığını sabitliyor.
   */
  it('her dilin Intl etiketi dil kodundan farklı ve geçerli', () => {
    for (const locale of LOCALES) {
      expect(INTL_ETIKET[locale]).not.toBe(locale);
      expect(() => new Intl.DateTimeFormat(INTL_ETIKET[locale])).not.toThrow();
    }
  });

  /**
   * ⚠️ BİÇİMLEME next-intl'e VERİLMEZ — VE BU TEST BİR ÖLÇÜMÜN ÜSTÜNE YAZILDI.
   *
   *    Yapılandırmada `formats: { dateTime: { gun, gunSaat } }` duruyordu ve
   *    başlığı "bağ `INTL_ETIKET`in tek tablo olmasıyla korunuyor" diyordu. Bağ
   *    YOKTU: next-intl etiketi `config.locale`den (`'en'`) türetir,
   *    `lib/tarih.ts` ise `INTL_ETIKET.en` (`'en-GB'`) kullanır. Blok bugüne
   *    kadar SIFIR kez çağrıldığı için ayrışma hiç görünmedi — yani ölü kod bir
   *    değişmezi savunuyordu.
   *
   *    İki yarım da gerekli: `formats` geri konursa BİRİNCİ iddia, biri
   *    `useFormatter` çağırırsa İKİNCİ iddia kırılır.
   */
  it('yapılandırma next-intl’e hiçbir biçim vermiyor', () => {
    expect(
      'formats' in istekYapilandirmasi(),
      'tarih biçiminin tek kapısı lib/tarih.ts — gerekçe yapilandirma.ts başlığında',
    ).toBe(false);
  });

  it('next-intl biçimleyicisi hiçbir yerde kullanılmıyor', () => {
    const yasak = /\buseFormatter\b|\bgetFormatter\b|\bformat\.dateTime\b/;
    const kullanan: string[] = [];

    /**
     * ⚠️ YORUMLAR SÖKÜLÜR. Yasağın GEREKÇESİ yasaklanan adı anmak zorunda
     *    (`yapilandirma.ts` başlığı bunu yapıyor); sökülmeseydi kapıyı geçmenin
     *    tek yolu gerekçeyi silmek olurdu. Aynı gerekçe `gomulu-metin.ts`te de
     *    yazılı: iyileştirmenin en ucuz yolunu "belgeyi sil"e çeviren bir ölçüm,
     *    ölçüm değildir.
     */
    const yorumlariAt = (kaynak: string): string =>
      kaynak
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

    const gez = (kok: string): void => {
      for (const ad of readdirSync(kok)) {
        if (ad === 'node_modules' || ad === '.next') continue;
        const tam = join(kok, ad);
        if (statSync(tam).isDirectory()) {
          gez(tam);
          continue;
        }
        if (!/\.tsx?$/.test(ad) || ad.endsWith('.test.ts') || ad.endsWith('.test.tsx')) continue;
        if (yasak.test(yorumlariAt(readFileSync(tam, 'utf8')))) {
          kullanan.push(tam.slice(WEB_KOKU.length + 1));
        }
      }
    };

    gez(join(WEB_KOKU, 'app'));
    gez(join(WEB_KOKU, 'src'));

    expect(kullanan, 'tarih/sayı biçimi `lib/tarih.ts` ve `lib/sayi-bicim.ts`ten okunur').toEqual(
      [],
    );
  });
});
