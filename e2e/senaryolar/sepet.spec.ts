/**
 * SENARYO 4 — SEPET: EKLE/GÜNCELLE/SİL, KUPON, STOK AŞIMI, MİSAFİR BİRLEŞTİRME
 *
 * Sepet modülünün en kırılgan yeri, kendi hesabı değil KATALOGLA olan
 * sınırı: stok ve fiyat bilgisi başka bir modülün tablosundan geliyor.
 * Birim testlerinde bu sınır sahte bir port ile geçiliyor; burada gerçek.
 *
 * ⚠️ Misafir sepeti `X-Session-Id` ile taşınıyor ve bu değer BİR SIRDIR:
 *    bilen sepete erişir. Sunucu, token varsa başlığı BİLEREK yok sayıyor —
 *    aksi hâlde bir üye, başkasının misafir oturum kimliğini başlığa koyup o
 *    sepeti okuyabilirdi. Bu davranış aşağıda ayrıca sınanıyor.
 */
import { randomUUID } from 'node:crypto';
import { basariBekle, hataBekle } from '../destek/istemci.js';
import {
  kategoriOlustur,
  musteriOlustur,
  saticiOlustur,
  sepeteEkle,
  urunYayinla,
  yoneticiOlustur,
} from '../destek/kurulum.js';
import { kurus, lira } from '../destek/para.js';
import { expect, test } from '../destek/test.js';

interface SepetGorunumu {
  id: string | null;
  packages: Array<{
    sellerId: string;
    items: Array<{ id: string; variantId: string; quantity: number; lineTotalMinor: string }>;
    subtotalMinor: string;
  }>;
  unavailableItems: Array<{ variantId: string; issue: string; maxAvailable: number | null }>;
  coupon: { code: string; rejection: string | null } | null;
  subtotalMinor: string;
  discountMinor: string;
  totalMinor: string;
  itemCount: number;
  distinctItemCount: number;
  freeShipping: boolean;
}

test.describe('Sepet akışları', () => {
  test('ekle → güncelle → sil ve toplamlar kuruşu kuruşuna', async ({ api, ikinciApi, defter }) => {
    await yoneticiOlustur(ikinciApi, defter);
    const kategori = await kategoriOlustur(ikinciApi, defter);
    await saticiOlustur(api, ikinciApi, defter);

    const urun = await urunYayinla(api, ikinciApi, {
      kategoriId: kategori.id,
      varyantlar: [
        { renk: 'Siyah', renkHex: '#000000', beden: 'M', fiyat: 250, stok: 20 },
        { renk: 'Bej', renkHex: '#E3D5C0', beden: 'L', fiyat: 100, stok: 20 },
      ],
    });

    const ilkVaryant = urun.varyantlar[0];
    const ikinciVaryant = urun.varyantlar[1];
    expect(ilkVaryant, 'Kurulum iki varyant üretmeliydi').toBeDefined();
    expect(ikinciVaryant).toBeDefined();
    if (!ilkVaryant || !ikinciVaryant) return;

    // Misafir olarak sepet kullanılıyor: sepet uçları @Public.
    const misafir = ikinciApi;
    misafir.kimlikSil();
    misafir.oturumKimligi = randomUUID();

    // ── Boş sepet: okuma satır YAZMAMALI ────────────────────────────────
    const bos = await misafir.get('/v1/cart');
    basariBekle(bos, 200);
    expect(bos.veri<SepetGorunumu>().id, 'Okuma isteği sepet satırı yaratmamalı').toBeNull();

    // ── Ekle ─────────────────────────────────────────────────────────────
    await sepeteEkle(misafir, ilkVaryant.id, 2);
    await sepeteEkle(misafir, ikinciVaryant.id, 3);

    const dolu = await misafir.get('/v1/cart');
    basariBekle(dolu, 200);
    const doluVeri = dolu.veri<SepetGorunumu>();

    expect(doluVeri.itemCount, 'Toplam adet 2 + 3 olmalı').toBe(5);
    expect(doluVeri.distinctItemCount, 'İki farklı varyant').toBe(2);

    // 2 × 250,00 + 3 × 100,00 = 800,00 ₺
    expect(kurus(doluVeri.subtotalMinor), 'Ara toplam kuruşu kuruşuna tutmalı').toBe(lira(800));

    // Aynı satıcının kalemleri TEK pakette toplanmalı — kargo satıcı başına.
    expect(doluVeri.packages, 'Tek satıcı = tek paket').toHaveLength(1);

    // ── Güncelle ─────────────────────────────────────────────────────────
    const kalem = doluVeri.packages[0]?.items.find((k) => k.variantId === ilkVaryant.id);
    expect(kalem).toBeDefined();
    if (!kalem) return;

    const guncelle = await misafir.patch(`/v1/cart/items/${kalem.id}`, {
      govde: { quantity: 1 },
    });
    basariBekle(guncelle, 200);

    // 1 × 250,00 + 3 × 100,00 = 550,00 ₺
    expect(kurus(guncelle.veri<SepetGorunumu>().subtotalMinor)).toBe(lira(550));

    // ── Sil ──────────────────────────────────────────────────────────────
    const sil = await misafir.delete(`/v1/cart/items/${kalem.id}`);
    basariBekle(sil);

    const silSonrasi = sil.veri<SepetGorunumu>();
    expect(kurus(silSonrasi.subtotalMinor), 'Kalan yalnızca 3 × 100,00 ₺').toBe(lira(300));
    expect(silSonrasi.distinctItemCount).toBe(1);

    // Aynı kalemi ikinci kez silmek anlamlı bir hata dönmeli.
    const tekrarSil = await misafir.delete(`/v1/cart/items/${kalem.id}`);
    expect(tekrarSil.basarili, 'Silinmiş kalemin tekrar silinmesi başarı dönmemeli').toBe(false);
  });

  test('stok aşımı reddedilir ve alınabilecek azami adet bildirilir', async ({
    api,
    ikinciApi,
    defter,
  }) => {
    await yoneticiOlustur(ikinciApi, defter);
    const kategori = await kategoriOlustur(ikinciApi, defter);
    await saticiOlustur(api, ikinciApi, defter);

    // Stok BİLEREK 2: tavan kuralıyla (adet başına en fazla 10) karışmasın.
    const urun = await urunYayinla(api, ikinciApi, {
      kategoriId: kategori.id,
      varyantlar: [{ renk: 'Siyah', renkHex: '#000000', beden: 'M', fiyat: 199.9, stok: 2 }],
    });
    const varyant = urun.varyantlar[0];
    expect(varyant).toBeDefined();
    if (!varyant) return;

    const misafir = ikinciApi;
    misafir.kimlikSil();
    misafir.oturumKimligi = randomUUID();

    const asim = await misafir.post('/v1/cart/items', {
      govde: { variantId: varyant.id, quantity: 5 },
    });

    hataBekle(asim, 'INSUFFICIENT_STOCK', 409);
    expect(
      asim.hata.message,
      '⚠️ Mesaj kullanıcıya kaç adet alabileceğini SÖYLEMELİ — yer tutucu doldurulmamışsa "{available}" görünür',
    ).not.toContain('{available}');
    expect(asim.hata.message).toContain('2');

    // Stok kadar eklemek çalışmalı.
    const tamStok = await misafir.post('/v1/cart/items', {
      govde: { variantId: varyant.id, quantity: 2 },
    });
    basariBekle(tamStok, 200);
  });

  test('kupon uygulanır, geçersiz kupon reddedilir, kaldırılabilir', async ({
    api,
    ikinciApi,
    defter,
  }) => {
    const yonetici = await yoneticiOlustur(ikinciApi, defter);
    expect(yonetici.rol).toBe('ADMIN');

    const kategori = await kategoriOlustur(ikinciApi, defter);
    await saticiOlustur(api, ikinciApi, defter);

    const urun = await urunYayinla(api, ikinciApi, {
      kategoriId: kategori.id,
      varyantlar: [{ renk: 'Siyah', renkHex: '#000000', beden: 'M', fiyat: 1000, stok: 10 }],
    });
    const varyant = urun.varyantlar[0];
    expect(varyant).toBeDefined();
    if (!varyant) return;

    const kod = `E2E${String(Date.now()).slice(-8)}`;
    const kupon = await ikinciApi.post('/v1/admin/coupons', {
      govde: {
        code: kod,
        discountType: 'PERCENTAGE',
        // ⚠️ PERCENTAGE'ta değer BASIS POINT ve string taşınır: 1000 = %10.
        //    1.000,00 ₺'lik sepette tam 100,00 ₺ eder — kuruş artığı yok, bu
        //    yüzden indirim iddiası tek bir tam sayıya kurulabiliyor.
        discountValue: '1000',
        // ⚠️ Yüzdesel indirimde tavan ZORUNLU. Sepetin üstünde bir tavan
        //    veriliyor ki kırpma devreye girmesin ve test %10'u ölçsün.
        maxDiscountMinor: '100000',
        minCartMinor: '0',
        validFrom: new Date(Date.now() - 60_000).toISOString(),
        validTo: new Date(Date.now() + 86_400_000).toISOString(),
        isActive: true,
      },
    });

    if (kupon.basarili) {
      const kuponId = kupon.veri<{ id?: string }>().id;
      if (typeof kuponId === 'string') defter.kuponIdleri.push(kuponId);
    }

    const misafir = api;
    misafir.kimlikSil();
    misafir.oturumKimligi = randomUUID();
    await sepeteEkle(misafir, varyant.id, 1);

    // ── Geçersiz kod ────────────────────────────────────────────────────
    const gecersiz = await misafir.post('/v1/cart/coupon', {
      govde: { code: 'KESINLIKLE-YOK-BOYLE-BIR-KOD' },
    });
    hataBekle(gecersiz, 'COUPON_INVALID', 400);

    if (!kupon.basarili) {
      // Kupon uçları bu senaryonun ana konusu değil; oluşturma şeması
      // farklıysa testin kalanı anlamsız olur. Sebep açıkça bildiriliyor.
      expect(
        kupon.basarili,
        `Admin kupon oluşturma başarısız: ${kupon.ozet()} — kupon iddiaları çalıştırılamadı`,
      ).toBe(true);
      return;
    }

    // ── Geçerli kod ─────────────────────────────────────────────────────
    const uygula = await misafir.post('/v1/cart/coupon', { govde: { code: kod } });
    basariBekle(uygula, 200);

    const kuponlu = uygula.veri<SepetGorunumu>();
    expect(kuponlu.coupon?.code, 'Uygulanan kupon sepette görünmeli').toBe(kod);
    expect(kuponlu.coupon?.rejection, 'Uygulanan kupon reddedilmiş olmamalı').toBeNull();
    expect(kurus(kuponlu.discountMinor), '%10 indirim tam 100,00 ₺ olmalı').toBe(lira(100));
    expect(kurus(kuponlu.totalMinor), 'Toplam 900,00 ₺ olmalı').toBe(lira(900));

    // ── Kaldır ──────────────────────────────────────────────────────────
    const kaldir = await misafir.delete('/v1/cart/coupon');
    basariBekle(kaldir);

    const kuponsuz = kaldir.veri<SepetGorunumu>();
    expect(kuponsuz.coupon, 'Kupon kaldırıldıktan sonra null olmalı').toBeNull();
    expect(kurus(kuponsuz.discountMinor), 'İndirim sıfırlanmalı').toBe(0n);
    expect(kurus(kuponsuz.totalMinor)).toBe(lira(1000));
  });

  test('misafir sepeti üye hesabına birleştirilir', async ({ api, ikinciApi, defter }) => {
    await yoneticiOlustur(ikinciApi, defter);
    const kategori = await kategoriOlustur(ikinciApi, defter);
    await saticiOlustur(api, ikinciApi, defter);

    const urun = await urunYayinla(api, ikinciApi, {
      kategoriId: kategori.id,
      varyantlar: [
        { renk: 'Siyah', renkHex: '#000000', beden: 'M', fiyat: 300, stok: 20 },
        { renk: 'Bej', renkHex: '#E3D5C0', beden: 'L', fiyat: 150, stok: 20 },
      ],
    });
    const misafirVaryanti = urun.varyantlar[0];
    const uyeVaryanti = urun.varyantlar[1];
    expect(misafirVaryanti).toBeDefined();
    expect(uyeVaryanti).toBeDefined();
    if (!misafirVaryanti || !uyeVaryanti) return;

    // ── Misafir sepetini doldur ─────────────────────────────────────────
    const misafirOturumu = randomUUID();
    const misafir = ikinciApi;
    misafir.kimlikSil();
    misafir.oturumKimligi = misafirOturumu;

    await sepeteEkle(misafir, misafirVaryanti.id, 2);
    await sepeteEkle(misafir, uyeVaryanti.id, 1);

    // ── Üye kendi sepetini doldurur ─────────────────────────────────────
    const uye = api;
    uye.oturumKimligi = null;
    const musteri = await musteriOlustur(uye, defter);
    expect(musteri.rol).toBe('CUSTOMER');

    await sepeteEkle(uye, uyeVaryanti.id, 2);

    // ── Birleştir ───────────────────────────────────────────────────────
    const birlestir = await uye.post('/v1/cart/merge', {
      govde: { sessionId: misafirOturumu },
      idempotencyKey: randomUUID(),
    });
    basariBekle(birlestir, 200);

    const birlesik = birlestir.veri<SepetGorunumu & { skipped: unknown[] }>();
    const kalemler = birlesik.packages.flatMap((paket) => paket.items);

    const ortakKalem = kalemler.find((k) => k.variantId === uyeVaryanti.id);
    expect(ortakKalem, 'Her iki sepette olan varyant birleşmiş olmalı').toBeDefined();
    expect(ortakKalem?.quantity, 'Ortak varyantın adetleri TOPLANMALI (2 + 1)').toBe(3);

    const yalnizMisafirdeki = kalemler.find((k) => k.variantId === misafirVaryanti.id);
    expect(yalnizMisafirdeki, 'Yalnız misafir sepetindeki kalem taşınmalı').toBeDefined();
    expect(yalnizMisafirdeki?.quantity).toBe(2);

    // ⚠️ Misafir sepeti birleştirmeden sonra ERİMİŞ olmalı; kalsaydı aynı
    //    sepet iki yerden görünür ve ikinci bir birleştirme adetleri tekrar
    //    toplardı.
    const misafirTekrar = await misafir.get('/v1/cart');
    basariBekle(misafirTekrar, 200);
    expect(
      misafirTekrar.veri<SepetGorunumu>().id,
      'Birleştirilen misafir sepeti kaybolmalı',
    ).toBeNull();
  });

  test('üye token’ı varken X-Session-Id başlığı YOK SAYILIR', async ({
    api,
    ikinciApi,
    defter,
  }) => {
    // ⚠️ Bu, sepetin en önemli yetki kuralı: başlık dikkate alınsaydı bir üye,
    //    başkasının misafir oturum kimliğini yazarak o sepeti okuyup
    //    değiştirebilirdi (cart.owner.ts).
    await yoneticiOlustur(ikinciApi, defter);
    const kategori = await kategoriOlustur(ikinciApi, defter);
    await saticiOlustur(api, ikinciApi, defter);

    const urun = await urunYayinla(api, ikinciApi, {
      kategoriId: kategori.id,
      varyantlar: [{ renk: 'Siyah', renkHex: '#000000', beden: 'M', fiyat: 500, stok: 10 }],
    });
    const varyant = urun.varyantlar[0];
    expect(varyant).toBeDefined();
    if (!varyant) return;

    // Kurbanın misafir sepeti
    const kurbanOturumu = randomUUID();
    const kurban = ikinciApi;
    kurban.kimlikSil();
    kurban.oturumKimligi = kurbanOturumu;
    await sepeteEkle(kurban, varyant.id, 4);

    // Saldırgan: giriş yapmış üye, kurbanın oturum kimliğini başlığa koyuyor.
    const saldirgan = api;
    saldirgan.oturumKimligi = null;
    await musteriOlustur(saldirgan, defter);
    saldirgan.oturumKimligi = kurbanOturumu;

    const gorunum = await saldirgan.get('/v1/cart');
    basariBekle(gorunum, 200);

    const sepet = gorunum.veri<SepetGorunumu>();
    expect(
      sepet.itemCount,
      '⚠️ Üye, X-Session-Id başlığıyla başkasının misafir sepetini okuyabildi',
    ).toBe(0);
    expect(sepet.id, 'Saldırgana kurbanın sepet kimliği dönmemeli').toBeNull();

    // Kurbanın sepeti bozulmamış olmalı.
    saldirgan.oturumKimligi = null;
    const kurbanSepeti = await kurban.get('/v1/cart');
    basariBekle(kurbanSepeti, 200);
    expect(kurbanSepeti.veri<SepetGorunumu>().itemCount, 'Kurbanın sepeti değişmemeli').toBe(4);
  });

  test('geçersiz biçimli X-Session-Id reddedilir', async ({ api }) => {
    // Oturum kimliği tahmin edilebilir olmamalı; bu yüzden UUID biçimi zorunlu.
    api.kimlikSil();
    api.oturumKimligi = 'guest-1';

    const yanit = await api.get('/v1/cart');
    hataBekle(yanit, 'VALIDATION_FAILED', 400);
  });
});
