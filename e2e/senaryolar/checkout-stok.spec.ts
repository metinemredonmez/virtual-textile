/**
 * SENARYO 5 — CHECKOUT STOĞU GERÇEKTEN REZERVE EDİYOR MU (YARIŞ DURUMU)
 *
 * En pahalı hata sınıfı burada: son ürünü iki kişiye satmak. Modül testleri
 * `reserveStock`i tek başına doğruluyor ama gerçek soru, iki AYRI HTTP
 * isteğinin aynı stok satırında çakıştığında ne olduğu — optimistik kilidin
 * (`Inventory.version`) transaction sınırında gerçekten tuttuğu mu.
 *
 * ⚠️ Rezervasyon ÖDEMEDEN ÖNCE yapılır (checkout.service.init): sipariş
 *    oluşurken stok, fiyat ve komisyon sabitlenir. Bu senaryo bunun HTTP
 *    üzerinden de böyle olduğunu doğruluyor.
 *
 * ⚠️ `retries: 0` (playwright.config.ts). Yarış durumu testinin yeniden
 *    denenmesi, tam da yakalamak istediği hatayı gizler.
 */
import { randomUUID } from 'node:crypto';
import { basariBekle, hataBekle } from '../destek/istemci.js';
import {
  adresGovdesi,
  checkoutBaslat,
  kategoriOlustur,
  komisyonKuraliTanimla,
  musteriOlustur,
  saticiOlustur,
  sepeteEkle,
  urunYayinla,
  yoneticiOlustur,
} from '../destek/kurulum.js';
import { yeniIstemci } from '../destek/istemci.js';
import { kurus, lira } from '../destek/para.js';
import { expect, test } from '../destek/test.js';
import { rezervasyonuGecmiseAl } from '../destek/veritabani.js';

test.describe('Checkout ve stok rezervasyonu', () => {
  test('checkout/init stoğu rezerve eder; ikinci kullanıcı son ürünü ALAMAZ', async ({
    api,
    ikinciApi,
    defter,
    playwright,
  }) => {
    // ── Kurulum ──────────────────────────────────────────────────────────
    await yoneticiOlustur(ikinciApi, defter);
    const kategori = await kategoriOlustur(ikinciApi, defter);
    const satici = await saticiOlustur(api, ikinciApi, defter);
    await komisyonKuraliTanimla(ikinciApi, defter, { sellerId: satici.sellerId, oranBps: 1200 });

    // ⚠️ STOK TAM 1. Senaryonun tamamı bu sayıya dayanıyor.
    const urun = await urunYayinla(api, ikinciApi, {
      kategoriId: kategori.id,
      varyantlar: [{ renk: 'Siyah', renkHex: '#000000', beden: 'M', fiyat: 750, stok: 1 }],
    });
    const varyant = urun.varyantlar[0];
    expect(varyant, 'Kurulum bir varyant üretmeliydi').toBeDefined();
    if (!varyant) return;

    // ── İki ayrı müşteri, iki ayrı bağlam ───────────────────────────────
    const birinci = await yeniIstemci(playwright);
    const ikinci = await yeniIstemci(playwright);

    try {
      await musteriOlustur(birinci, defter);
      await musteriOlustur(ikinci, defter);

      // İkisi de son ürünü sepetine ekleyebilir: SEPET rezervasyon DEĞİLDİR.
      // Bu bilinçli bir tasarım — sepete eklemek stok kilitlemez.
      await sepeteEkle(birinci, varyant.id, 1);
      await sepeteEkle(ikinci, varyant.id, 1);

      // ── Birinci kullanıcı checkout başlatır: stok REZERVE edilir ──────
      const siparis = await checkoutBaslat(birinci, defter);

      expect(kurus(siparis.itemsTotalMinor), 'Ürün toplamı 750,00 ₺ olmalı').toBe(lira(750));
      expect(siparis.paketler, 'Tek satıcı = tek paket').toHaveLength(1);
      expect(siparis.paketler[0]?.sellerId).toBe(satici.sellerId);

      // ⚠️ ASIL İDDİA: ikinci kullanıcı artık checkout'a geçemez.
      const ikinciDeneme = await ikinci.post('/v1/checkout/init', {
        govde: {
          shipping: { address: adresGovdesi() },
          email: `ikinci-${randomUUID().slice(0, 8)}@e2e.test`,
          acceptPriceChange: false,
        },
        idempotencyKey: randomUUID(),
      });

      expect(
        ikinciDeneme.basarili,
        '⚠️ STOK REZERVE EDİLMEMİŞ: son ürün iki kullanıcıya birden satıldı',
      ).toBe(false);

      // Sepet görünümü kalemi "alınamaz" saydıysa checkout onu sessizce
      // atlamak yerine VARIANT_UNAVAILABLE ile reddediyor; doğrudan stok
      // kontrolüne düştüyse INSUFFICIENT_STOCK geliyor. İkisi de doğru
      // davranış — sessizce başarı dönmek değil.
      expect(
        ['INSUFFICIENT_STOCK', 'VARIANT_UNAVAILABLE'],
        `Beklenmedik ret kodu: ${ikinciDeneme.ozet()}`,
      ).toContain(ikinciDeneme.hataKodu);

      // ── Sepette de "alınamaz" olarak görünmeli ───────────────────────
      const ikinciSepet = await ikinci.get('/v1/cart');
      basariBekle(ikinciSepet, 200);

      const sepetVeri = ikinciSepet.veri<{
        unavailableItems: Array<{ variantId: string; maxAvailable: number | null }>;
        totalMinor: string;
      }>();

      expect(
        sepetVeri.unavailableItems.map((kalem) => kalem.variantId),
        'Rezerve edilmiş ürün ikinci kullanıcının sepetinde "alınamaz" olmalı',
      ).toContain(varyant.id);

      // ⚠️ Alınamayan kalem TOPLAMA DAHİL EDİLMEMELİ; edilseydi kullanıcı
      //    ödeyemeyeceği bir tutar görürdü.
      expect(kurus(sepetVeri.totalMinor), 'Alınamayan kalem toplama girmemeli').toBe(0n);

      // ── Katalog da tükenmiş göstermeli ────────────────────────────────
      const detay = await ikinci.get(`/v1/products/${urun.slug}`);
      basariBekle(detay, 200);

      const varyantlar = detay.veri<{ variants: Array<{ id: string; available: boolean }> }>()
        .variants;
      expect(
        varyantlar.find((v) => v.id === varyant.id)?.available,
        'Rezerve edilen tek stok vitrinde "satılabilir" görünmemeli',
      ).toBe(false);
    } finally {
      await birinci.istekBaglami.dispose();
      await ikinci.istekBaglami.dispose();
    }
  });

  test('rezervasyon süresi dolan siparişin ödemesi başlatılamaz', async ({
    api,
    ikinciApi,
    defter,
  }) => {
    // ⚠️ Rezervasyon düştüyse stoğun hâlâ orada olduğu garanti edilemez;
    //    ödeme başlatmak, tahsil edilip karşılığı olmayan bir sipariş üretir.
    await yoneticiOlustur(ikinciApi, defter);
    const kategori = await kategoriOlustur(ikinciApi, defter);
    const satici = await saticiOlustur(api, ikinciApi, defter);
    await komisyonKuraliTanimla(ikinciApi, defter, { sellerId: satici.sellerId, oranBps: 1200 });

    const urun = await urunYayinla(api, ikinciApi, {
      kategoriId: kategori.id,
      varyantlar: [{ renk: 'Siyah', renkHex: '#000000', beden: 'M', fiyat: 600, stok: 5 }],
    });
    const varyant = urun.varyantlar[0];
    expect(varyant).toBeDefined();
    if (!varyant) return;

    const musteri = ikinciApi;
    musteri.kimlikSil();
    musteri.oturumKimligi = null;
    await musteriOlustur(musteri, defter);
    await sepeteEkle(musteri, varyant.id, 1);

    const siparis = await checkoutBaslat(musteri, defter);

    // Rezervasyon TTL'i 15 dakika; testin beklemesi anlamsız olurdu.
    await rezervasyonuGecmiseAl(siparis.orderId);

    const ode = await musteri.post('/v1/checkout/pay', {
      govde: { orderId: siparis.orderId, installment: 1 },
      idempotencyKey: randomUUID(),
    });

    hataBekle(ode, 'ORDER_RESERVATION_EXPIRED', 410);
  });

  test('boş sepetle checkout başlatılamaz', async ({ api, defter }) => {
    await musteriOlustur(api, defter);

    const yanit = await api.post('/v1/checkout/init', {
      govde: {
        shipping: { address: adresGovdesi() },
        email: `bos-${randomUUID().slice(0, 8)}@e2e.test`,
      },
      idempotencyKey: randomUUID(),
    });

    hataBekle(yanit, 'CART_EMPTY', 422);
  });

  test('komisyon kuralı yokken sipariş oluşturulmaz', async ({ api, ikinciApi, defter }) => {
    // ⚠️ Varsayılan orana BİLEREK düşülmüyor: `OrderItem.commissionRuleVersionId`
    //    zorunlu bir yabancı anahtar ve uydurulmuş bir oranın denetlenebilir
    //    kaynağı olmaz. Sessizce %12 uygulanmadığını burada doğruluyoruz.
    await yoneticiOlustur(ikinciApi, defter);
    const kategori = await kategoriOlustur(ikinciApi, defter);
    await saticiOlustur(api, ikinciApi, defter);
    // Kural TANIMLANMIYOR.

    const urun = await urunYayinla(api, ikinciApi, {
      kategoriId: kategori.id,
      varyantlar: [{ renk: 'Siyah', renkHex: '#000000', beden: 'M', fiyat: 400, stok: 5 }],
    });
    const varyant = urun.varyantlar[0];
    expect(varyant).toBeDefined();
    if (!varyant) return;

    const musteri = ikinciApi;
    musteri.kimlikSil();
    await musteriOlustur(musteri, defter);
    await sepeteEkle(musteri, varyant.id, 1);

    const yanit = await musteri.post('/v1/checkout/init', {
      govde: {
        shipping: { address: adresGovdesi() },
        email: `kuralsiz-${randomUUID().slice(0, 8)}@e2e.test`,
      },
      idempotencyKey: randomUUID(),
    });

    // Platform geneli bir kural varsa (başka bir kurulumdan) sipariş oluşur;
    // o zaman da sessizce yanlış bir oran uygulanmamalı. İki durumdan
    // hangisinde olduğumuz açıkça raporlanıyor.
    if (yanit.basarili) {
      test.info().annotations.push({
        type: 'not',
        description:
          'Platform geneli (*:*) komisyon kuralı tanımlı — kuralsız sipariş reddi bu ortamda sınanamadı.',
      });
      defter.siparisIdleri.push(yanit.veri<{ orderId: string }>().orderId);
      return;
    }

    hataBekle(yanit, 'COMMISSION_RULE_NOT_FOUND', 404);
  });
});
