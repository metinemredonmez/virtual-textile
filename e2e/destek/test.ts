/**
 * ORTAK TEST TABANI — fixture'lar.
 *
 * Her senaryo `import { test, expect } from '../destek/test.js'` yazar ve
 * şunları hazır bulur:
 *
 *   api          → temiz, izole bir API istemcisi (misafir)
 *   defter       → temizlik kaydı; test bitince otomatik boşaltılır
 *   sahteIyzico  → worker ömürlü sahte ödeme sağlayıcısı
 *
 * ⚠️ `sahteIyzico` WORKER ömürlü, test ömürlü DEĞİL: her testte bir HTTP
 *    sunucusu açıp kapatmak hem yavaş hem de port'un TIME_WAIT'te kalmasına
 *    yol açar. Tek worker çalıştığı için (playwright.config.ts) paylaşımlı
 *    olması güvenli; yine de her testin başında `sifirla()` çağrılıyor ki bir
 *    senaryonun "sonraki ödemeyi reddet" ayarı diğerine sızmasın.
 */
import { test as taban } from '@playwright/test';
import { type Istemci, yeniIstemci } from './istemci.js';
import { AYARLAR, ortamiYukle } from './ortam.js';
import { SahteIyzico } from './sahte-iyzico.js';
import {
  baglantiyiKapat,
  hizLimitiSifirla,
  temizle,
  yeniDefter,
  type TemizlikDefteri,
} from './veritabani.js';

ortamiYukle();

interface TestFixtureleri {
  api: Istemci;
  defter: TemizlikDefteri;
  /** İkinci bir kullanıcı gerektiren senaryolar için ayrı, izole istemci. */
  ikinciApi: Istemci;
  /**
   * İkiden fazla aktör gerektiğinde ek izole istemci açar.
   *
   * ⚠️ Her aktör AYRI bağlam almalı: aynı bağlamı paylaşan iki satıcı
   *    birbirinin refresh çerezini ezer ve testler farkında olmadan yanlış
   *    kimlikle istek atmaya başlar. Açılan bağlamlar test sonunda burada
   *    kapatılıyor — çağıran tarafın hatırlaması gereken bir şey kalmasın.
   */
  ekIstemci: () => Promise<Istemci>;
}

interface WorkerFixtureleri {
  sahteIyzico: SahteIyzico;
}

export const test = taban.extend<TestFixtureleri, WorkerFixtureleri>({
  sahteIyzico: [
    // eslint-disable-next-line no-empty-pattern -- Playwright fixture imzası
    async ({}, kullan) => {
      const sunucu = new SahteIyzico(AYARLAR.sahteIyzicoPort, AYARLAR.webhookSirri);
      await sunucu.baslat();
      await kullan(sunucu);
      await sunucu.durdur();
      // Prisma ve Redis bağlantıları da worker sonunda kapanır; açık kalırsa
      // Playwright süreci bitmez ve komut asılı görünür.
      await baglantiyiKapat();
    },
    { scope: 'worker' },
  ],

  api: async ({ playwright }, kullan) => {
    const istemci = await yeniIstemci(playwright);
    await kullan(istemci);
    await istemci.istekBaglami.dispose();
  },

  ikinciApi: async ({ playwright }, kullan) => {
    const istemci = await yeniIstemci(playwright);
    await kullan(istemci);
    await istemci.istekBaglami.dispose();
  },

  ekIstemci: async ({ playwright }, kullan) => {
    const acilanlar: Istemci[] = [];

    await kullan(async () => {
      const istemci = await yeniIstemci(playwright);
      acilanlar.push(istemci);
      return istemci;
    });

    for (const istemci of acilanlar) await istemci.istekBaglami.dispose();
  },

  defter: async ({ sahteIyzico }, kullan, testBilgisi) => {
    sahteIyzico.sifirla();

    // ⚠️ HIZ LİMİTİ SAYAÇLARI HER TESTTE SIFIRLANIR.
    //
    //    Sebep: limitlerin bir kısmı IP başına anahtarlanıyor (kayıt: saatte 3,
    //    katalog araması: dakikada 60) ve TÜM testler 127.0.0.1'den geliyor.
    //    Sıfırlanmazsa senaryolar birbirinin kotasını tüketir; hangi testin
    //    kırmızı yanacağı ÇALIŞMA SIRASINA bağlı hâle gelir ve gerçek bir
    //    hatayı ayırt etmek imkânsızlaşır.
    //
    //    ⚠️ Limitin KENDİSİNİ ölçen test (`hata-zarfi.spec` → 429) bu
    //    fixture'ı BİLEREK kullanmaz ve kendi temizliğini yapar. Buradaki
    //    sıfırlama oraya sızsaydı, 429 hiç oluşmaz ve test anlamsızlaşırdı.
    await hizLimitiSifirla();

    const defter = yeniDefter();

    await kullan(defter);

    const sorunlar = await temizle(defter);
    if (sorunlar.length > 0) {
      // Temizlik hatası testi DÜŞÜRMEZ — bir ürün hatası değildir. Ama
      // sessiz kalırsa veritabanı yavaşça çöplenir ve sonraki koşularda
      // anlaşılmaz benzersizlik çakışmaları üretir.
      testBilgisi.annotations.push({
        type: 'temizlik-uyarisi',
        description: sorunlar.join(' | '),
      });
    }
  },
});

export { expect } from '@playwright/test';
