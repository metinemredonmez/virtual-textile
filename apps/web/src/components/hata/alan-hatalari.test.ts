import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LOCALES } from '@vt/contracts';
import { describe, expect, it } from 'vitest';
import { fieldErrorMap, fieldMessage } from './alan-hatalari';

const WEB_KOKU = join(__dirname, '..', '..', '..');

/**
 * ALAN HATASI KAPISI — ÖLÇÜLMÜŞ BİR DELİĞİN ÜSTÜNE YAZILDI.
 *
 * Bu tablo bir süre `locale` ALMIYORDU ve yedi metni de doğrudan dosyaya
 * yazılıydı; sözlük iki dilliyken bile İngilizce arayüzde giriş, kayıt, adres
 * ve şifre formlarının HER alan altında Türkçe cümle çıkardı. Derleme, tip
 * kontrolü ve 1245 test yeşildi — çünkü metnin DİLİNE bakan hiçbir kapı yoktu.
 *
 * ⚠️ İDDİA "metin doğru" DEĞİL, "metin GÖSTERİLEN DİLDEN geliyor". Sözlükteki
 *    cümlenin kendisi burada tekrar YAZILMAZ; yazılsaydı sözlüğü değiştiren
 *    kişi testi de değiştirmek zorunda kalır ve kapı bir kopyaya dönüşürdü.
 */
describe('alan hataları — dil', () => {
  it('bilinen kural her dilde O DİLİN sözlüğünden gelir', () => {
    const zodVarsayilani = { path: 'email', message: 'Required', rule: 'invalid_type' };

    expect(fieldMessage(zodVarsayilani, 'tr')).toBe('Bu alan zorunlu.');
    expect(fieldMessage(zodVarsayilani, 'en')).toBe('This field is required.');
  });

  it('bilinmeyen kural son çareye düşer ve o da dile duyarlı', () => {
    const bilinmeyen = { path: 'x', message: 'Invalid input', rule: 'kesinlikle_olmayan_kural' };

    expect(fieldMessage(bilinmeyen, 'tr')).toBe('Girilen değer geçersiz.');
    expect(fieldMessage(bilinmeyen, 'en')).toBe('The value entered is invalid.');
  });

  /**
   * ⚠️ ASIL DELİK BURASIYDI. `packages/contracts/src/schemas/` içindeki 9 Türkçe
   *    `message:` (`"Şifre en az bir harf ve bir rakam içermeli."` …)
   *    `INGILIZCE_KALIP`e uymadığı için "sunucu kazanır" dalından geçiyor ve
   *    İngilizce arayüzde de olduğu gibi basılıyordu. Sözlüğü çevirmek bunu
   *    KAPATMAZ, çünkü o dalda sözlüğe hiç bakılmıyor.
   */
  it('sunucunun Türkçe cümlesi yalnız TÜRKÇE yüzeyde kazanır', () => {
    const sunucuTurkce = {
      path: 'reason',
      message: 'Gerekçe en az 10 karakter olmalı.',
      rule: 'too_small',
    };

    // Türkçede kaç karakter gerektiği KORUNUR — bu bilgi genel metinde yok.
    expect(fieldMessage(sunucuTurkce, 'tr')).toBe('Gerekçe en az 10 karakter olmalı.');
    // İngilizcede o cümle basılamaz; bilgi genelleşir ama dil doğru kalır.
    expect(fieldMessage(sunucuTurkce, 'en')).toBe('The value entered is too short.');
  });

  it('hiçbir dilde çıktı başka bir dilin alfabesini taşımaz', () => {
    const turkceHarf = /[çğıİşöüÇĞŞÖÜ]/;
    const kurallar = [
      'invalid_type',
      'too_small',
      'too_big',
      'invalid_string',
      'invalid_enum_value',
      'invalid_email',
      'custom',
      'bilinmeyen',
    ];

    for (const rule of kurallar) {
      const metin = fieldMessage({ path: 'a', message: 'Required', rule }, 'en');
      expect(turkceHarf.test(metin), `${rule}: ${metin}`).toBe(false);
    }
  });

  it('her dil için tam bir eşleme üretir; `headers.*` yolları forma yazılmaz', () => {
    const alanlar = [
      { path: 'headers.Idempotency-Key', message: 'Required', rule: 'invalid_type' },
      { path: 'password', message: 'Required', rule: 'invalid_type' },
    ];

    for (const locale of LOCALES) {
      const harita = fieldErrorMap(alanlar, locale);
      expect(Object.keys(harita)).toEqual(['password']);
      expect(harita['password']).toBeTruthy();
    }
  });
});

/**
 * ⚠️ ÇAĞRI YERİ KAPISI — asıl regresyon riski burada. Metin sözlüğe taşınsa da
 *    tek bir çağrı yeri `locale` geçirmeyi unutursa o form İngilizce arayüzde
 *    yeniden Türkçeye düşer, ve varsayılan parametre yüzünden derleme SESSİZ
 *    kalır. Bu yüzden varsayılan parametre KALDIRILMADI (kütüphane gibi
 *    kullanılabilir olması için) ama ekran kodunda kullanılması yasak.
 */
describe('alan hataları — çağrı yerleri', () => {
  function tsxDosyalari(kok: string, bulunan: string[] = []): string[] {
    for (const ad of readdirSync(kok)) {
      if (ad === 'node_modules' || ad === '.next') continue;
      const tam = join(kok, ad);
      if (statSync(tam).isDirectory()) tsxDosyalari(tam, bulunan);
      else if (ad.endsWith('.tsx')) bulunan.push(tam);
    }
    return bulunan;
  }

  it('her çağrı yeri `locale` geçiriyor', () => {
    const cagri = /\bfield(?:Message|ErrorMap)\s*\(/g;
    const eksik: string[] = [];
    let toplam = 0;

    for (const dosya of [
      ...tsxDosyalari(join(WEB_KOKU, 'app')),
      ...tsxDosyalari(join(WEB_KOKU, 'src')),
    ]) {
      const kaynak = readFileSync(dosya, 'utf8');
      for (const eslesme of kaynak.matchAll(cagri)) {
        // Çağrının kapanış parantezine kadar olan dilim — `, locale)` orada.
        const dilim = kaynak.slice(eslesme.index, eslesme.index + 220);
        const kapanis = dilim.indexOf(');');
        toplam += 1;
        if (!dilim.slice(0, kapanis === -1 ? dilim.length : kapanis).includes('locale')) {
          eksik.push(`${dosya.slice(WEB_KOKU.length + 1)}: ${dilim.split('\n')[0]}`);
        }
      }
    }

    // ⚠️ ALT SINIR: tarama boşalırsa "eksik yok" çıkar ve kapı sessizce kapanır.
    expect(toplam).toBeGreaterThan(10);
    expect(eksik, '`locale` geçirmeyen çağrı yeri').toEqual([]);
  });
});
