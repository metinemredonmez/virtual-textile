/**
 * SENARYO 7 — İADE: TALEP → ONAY → TERS DEFTER → BAKİYE SIFIRLANIYOR MU
 *
 * Defterin append-only olması, yanlış yazılan bir satırın DÜZELTİLEMEYECEĞİ
 * anlamına gelir; ancak ters kayıtla telafi edilir. Bu yüzden tam iadede ters
 * kayıtların satış kayıtlarını KURUŞU KURUŞUNA sıfırlaması zorunludur. Bir
 * kuruşluk sapma payout'ta satıcıya eksik/fazla ödemeye dönüşür ve fark ancak
 * mutabakatta, günler sonra görülür.
 *
 * Zincirin tamamı gerçek uçlardan geçiyor:
 *   sepet → checkout → ödeme (sahte sağlayıcı) → kargo → teslim → iade
 *   talebi → satıcı onayı → ters defter
 *
 * ⚠️ Paketin DELIVERED'a geçişi de artık GERÇEK UÇTAN geçiyor:
 *    POST /v1/logistics/packages/:id/delivered (ADMIN). Daha önce bu adım
 *    veritabanından atılıyordu ve o kaçış kapısı, `package.delivered` olayını
 *    üreten hiçbir kod yolu olmadığını gizliyordu.
 */
import { randomUUID } from 'node:crypto';
import { basariBekle, hataBekle, type Istemci } from '../destek/istemci.js';
import {
  checkoutBaslat,
  kategoriOlustur,
  komisyonKuraliTanimla,
  musteriOlustur,
  odemeyiTamamla,
  saticiOlustur,
  sepeteEkle,
  urunYayinla,
  paketiTeslimEt,
  yoneticiOlustur,
} from '../destek/kurulum.js';
import { bicimle, komisyonHesapla, kurus, lira, topla } from '../destek/para.js';
import { expect, test } from '../destek/test.js';

interface DefterKaydi {
  id: string;
  type: string;
  amountMinor: string;
  orderItemId: string | null;
}

interface SiparisDetayi {
  id: string;
  orderNumber: string;
  status: string;
  packages: Array<{
    id: string;
    status: string;
    items: Array<{ id: string; quantity: number; lineTotalMinor: string }>;
  }>;
}

test.describe('İade ve ters defter', () => {
  test('tam iade satıcı bakiyesini SIFIRLAR', async ({
    api,
    ikinciApi,
    defter,
    sahteIyzico,
    ekIstemci,
  }) => {
    // ══ KURULUM ═══════════════════════════════════════════════════════════
    await yoneticiOlustur(ikinciApi, defter);
    const kategori = await kategoriOlustur(ikinciApi, defter);
    const satici = await saticiOlustur(await ekIstemci(), ikinciApi, defter);

    const oranBps = 1750; // %17,50 — yuvarlama artığı üretsin diye tek sayı.
    const kural = await komisyonKuraliTanimla(ikinciApi, defter, {
      sellerId: satici.sellerId,
      oranBps,
    });

    // 333,33 ₺ × 3 = 999,99 ₺ — hem eşik altı (kargo çıkar) hem de birim
    // dağıtımında kuruş artığı üretir; kısmi iadede en kırılgan durum budur.
    const urun = await urunYayinla(satici.istemci, ikinciApi, {
      kategoriId: kategori.id,
      varyantlar: [{ renk: 'Siyah', renkHex: '#000000', beden: 'M', fiyat: 333.33, stok: 10 }],
    });
    const varyant = urun.varyantlar[0];
    expect(varyant).toBeDefined();
    if (!varyant) return;

    const musteri = api;
    await musteriOlustur(musteri, defter);
    await sepeteEkle(musteri, varyant.id, 3);

    const kalemToplam = lira(333.33) * 3n; // 99.999 kuruş
    const beklenen = komisyonHesapla(kalemToplam, {
      rateBps: kural.oranBps,
      fixedFeeMinor: kural.sabitUcretMinor,
    });

    // ══ SİPARİŞ VE ÖDEME ══════════════════════════════════════════════════
    const siparis = await checkoutBaslat(musteri, defter);
    await odemeyiTamamla(musteri, sahteIyzico, siparis);

    // Ödeme sonrası bakiye = hakediş.
    const odemeSonrasiBakiye = await bakiyeOku(satici.istemci);
    expect(
      odemeSonrasiBakiye,
      `Ödeme sonrası bakiye ${bicimle(beklenen.saticiNetMinor)} olmalı`,
    ).toBe(beklenen.saticiNetMinor);

    // ══ KARGO VE TESLİM ═══════════════════════════════════════════════════
    const detayYaniti = await musteri.get(`/v1/orders/${siparis.orderNumber}`);
    basariBekle(detayYaniti, 200);
    const detay = detayYaniti.veri<SiparisDetayi>();

    const paket = detay.packages[0];
    expect(paket, 'Siparişte bir paket olmalı').toBeDefined();
    if (!paket) return;

    // AWAITING_APPROVAL → PREPARING → SHIPPED (gerçek uçlar)
    const hazirla = await satici.istemci.patch(`/v1/seller/packages/${paket.id}/status`, {
      govde: { status: 'PREPARING' },
    });
    basariBekle(hazirla);

    const kargola = await satici.istemci.post(`/v1/seller/packages/${paket.id}/shipment`, {
      govde: { carrier: 'E2E Kargo', trackingNo: `E2E${String(Date.now()).slice(-10)}` },
      idempotencyKey: randomUUID(),
    });
    basariBekle(kargola, 200);

    // SHIPPED → DELIVERED: gerçek uç (ADMIN), kargo entegrasyonunun yerini
    // bugün operatör tutuyor.
    await paketiTeslimEt(ikinciApi, paket.id);

    // ══ İADE TALEBİ ═══════════════════════════════════════════════════════
    const kalem = paket.items[0];
    expect(kalem).toBeDefined();
    if (!kalem) return;

    const talep = await musteri.post(`/v1/orders/${siparis.orderId}/returns`, {
      govde: {
        reason: 'SIZE_TOO_SMALL',
        note: 'E2E tam iade senaryosu',
        items: [{ orderItemId: kalem.id, quantity: kalem.quantity }],
      },
      idempotencyKey: randomUUID(),
    });
    basariBekle(talep);

    const iade = talep.veri<{ id: string; returnNumber: string; refundAmountMinor: string }>();

    // Müşteriye geri ödenecek tutar BRÜT kalem tutarıdır (indirim yok).
    expect(
      kurus(iade.refundAmountMinor),
      'Tam iadede müşteri iadesi kalem tutarı kadar olmalı',
    ).toBe(kalemToplam);

    // ⚠️ Talep AÇILDI, henüz ONAYLANMADI: defter DEĞİŞMEMELİ. Talep anında
    //    ters kayıt yazılsaydı, reddedilen her iade satıcının bakiyesini
    //    haksız yere düşürürdü.
    expect(
      await bakiyeOku(satici.istemci),
      '⚠️ İade yalnızca TALEP edildi; onaylanmadan defter değişmemeli',
    ).toBe(beklenen.saticiNetMinor);

    // ══ SATICI ONAYI → TERS DEFTER ════════════════════════════════════════
    const onay = await satici.istemci.patch(`/v1/seller/returns/${iade.id}`, {
      govde: { action: 'APPROVE' },
      idempotencyKey: randomUUID(),
    });
    basariBekle(onay);

    // ══ ASIL İDDİA: BAKİYE SIFIR ══════════════════════════════════════════
    const sonBakiye = await bakiyeOku(satici.istemci);
    expect(
      sonBakiye,
      `⚠️ TAM İADEDE BAKİYE SIFIRLANMADI: ${bicimle(sonBakiye)} kaldı. ` +
        'Ters kayıtlar satış kayıtlarını kuruşu kuruşuna karşılamıyor.',
    ).toBe(0n);

    // Defter satırları da tutarlı olmalı: append-only, silme YOK.
    const defterYaniti = await satici.istemci.get('/v1/seller/finance/ledger', {
      sorgu: { limit: 100 },
    });
    basariBekle(defterYaniti, 200);
    const kayitlar = defterYaniti.veri<DefterKaydi[]>();

    const turler = kayitlar.map((k) => k.type);
    expect(turler, 'Satış kaydı silinmemeli — defter append-only').toContain('SALE');
    expect(turler, 'İade ters kaydı yazılmalı').toContain('REFUND');
    expect(turler, 'Komisyon ters kaydı yazılmalı').toContain('COMMISSION_REVERSAL');

    const satisToplami = topla(
      kayitlar.filter((k) => k.type === 'SALE').map((k) => kurus(k.amountMinor)),
    );
    const iadeToplami = topla(
      kayitlar.filter((k) => k.type === 'REFUND').map((k) => kurus(k.amountMinor)),
    );
    expect(satisToplami + iadeToplami, 'REFUND kayıtları SALE kayıtlarını tam karşılamalı').toBe(
      0n,
    );

    const komisyonToplami = topla(
      kayitlar.filter((k) => k.type === 'COMMISSION').map((k) => kurus(k.amountMinor)),
    );
    const komisyonIadesi = topla(
      kayitlar.filter((k) => k.type === 'COMMISSION_REVERSAL').map((k) => kurus(k.amountMinor)),
    );
    expect(
      komisyonToplami + komisyonIadesi,
      '⚠️ Komisyon ters kaydı komisyonu tam karşılamalı — aksi hâlde iade edilen bir üründen platform komisyon almış olur',
    ).toBe(0n);

    expect(
      topla(kayitlar.map((k) => kurus(k.amountMinor))),
      'Defterin tamamının toplamı bakiye ucuyla aynı olmalı',
    ).toBe(sonBakiye);
  });

  test('kısmi iade: 3 adetten 1 iade, kalan bakiye 2 adedin hakedişi', async ({
    api,
    ikinciApi,
    defter,
    sahteIyzico,
    ekIstemci,
  }) => {
    // ⚠️ Kısmi iadede kuruş kaybı en kolay burada olur: orantı çarpımı
    //    kullanılırsa 999,99 / 3 = 333,33 ve üç kısmi iadenin toplamı
    //    999,99'u tutmaz. Sunucu birim dizisi üzerinden dilim alıyor;
    //    burada sonucu ölçüyoruz.
    await yoneticiOlustur(ikinciApi, defter);
    const kategori = await kategoriOlustur(ikinciApi, defter);
    const satici = await saticiOlustur(await ekIstemci(), ikinciApi, defter);
    const kural = await komisyonKuraliTanimla(ikinciApi, defter, {
      sellerId: satici.sellerId,
      oranBps: 1750,
    });

    const urun = await urunYayinla(satici.istemci, ikinciApi, {
      kategoriId: kategori.id,
      varyantlar: [{ renk: 'Siyah', renkHex: '#000000', beden: 'M', fiyat: 333.33, stok: 10 }],
    });
    const varyant = urun.varyantlar[0];
    expect(varyant).toBeDefined();
    if (!varyant) return;

    const musteri = api;
    await musteriOlustur(musteri, defter);
    await sepeteEkle(musteri, varyant.id, 3);

    const kalemToplam = lira(333.33) * 3n;
    const beklenen = komisyonHesapla(kalemToplam, {
      rateBps: kural.oranBps,
      fixedFeeMinor: kural.sabitUcretMinor,
    });

    const siparis = await checkoutBaslat(musteri, defter);
    await odemeyiTamamla(musteri, sahteIyzico, siparis);

    const detay = (await musteri.get(`/v1/orders/${siparis.orderNumber}`)).veri<SiparisDetayi>();
    const paket = detay.packages[0];
    const kalem = paket?.items[0];
    expect(paket).toBeDefined();
    expect(kalem).toBeDefined();
    if (!paket || !kalem) return;

    await satici.istemci.patch(`/v1/seller/packages/${paket.id}/status`, {
      govde: { status: 'PREPARING' },
    });
    await satici.istemci.post(`/v1/seller/packages/${paket.id}/shipment`, {
      govde: { carrier: 'E2E Kargo', trackingNo: `E2E${String(Date.now()).slice(-10)}` },
      idempotencyKey: randomUUID(),
    });
    await paketiTeslimEt(ikinciApi, paket.id);

    const talep = await musteri.post(`/v1/orders/${siparis.orderId}/returns`, {
      govde: {
        reason: 'CHANGED_MIND',
        items: [{ orderItemId: kalem.id, quantity: 1 }],
      },
      idempotencyKey: randomUUID(),
    });
    basariBekle(talep);

    const iade = talep.veri<{ id: string; refundAmountMinor: string }>();
    const onay = await satici.istemci.patch(`/v1/seller/returns/${iade.id}`, {
      govde: { action: 'APPROVE' },
      idempotencyKey: randomUUID(),
    });
    basariBekle(onay);

    const kalanBakiye = await bakiyeOku(satici.istemci);

    // Kalan bakiye pozitif ve tam iadeden BÜYÜK, toplam hakedişten KÜÇÜK olmalı.
    expect(kalanBakiye, 'Kısmi iade sonrası bakiye sıfırlanmamalı').toBeGreaterThan(0n);
    expect(kalanBakiye, 'Kısmi iade sonrası bakiye toplam hakedişten küçük olmalı').toBeLessThan(
      beklenen.saticiNetMinor,
    );

    // ⚠️ Kuruş kontrolü: 1 adet iade edildi, 2 adet kaldı.
    //
    //    BEKLENTİ DÜZELTİLDİ. Burada `saticiNetMinor` doğrudan üçe bölünüyor
    //    ve ilk birimin geri alındığı varsayılıyordu. Sunucu böyle yapmıyor ve
    //    yapmamalı: defterde SALE ve COMMISSION AYRI satırlar, ters kayıt da
    //    ikisini AYRI AYRI çeviriyor (return-ledger.ts → splitPerUnit brüt ve
    //    komisyon için ayrı çağrılıyor). Net, bu iki dilimin FARKI olarak
    //    çıkıyor. Türetilmiş tutarı bölmek ile bileşenleri ayrı bölüp farkı
    //    almak aynı sonucu vermez — iki bağımsız yuvarlama vardır.
    //
    //    Eski beklenti 549,99 ₺, sunucu 550,00 ₺ veriyordu ve hata mesajı bunu
    //    "kuruş kaybı" diye adlandırıyordu. KAYIP YOKTU: iade edilen 274,99 ₺ +
    //    kalan 550,00 ₺ = 824,99 ₺, yani toplam hakedişin tamamı. Aşağıdaki
    //    iddia artık bu KORUNAN BÜYÜKLÜĞÜ de açıkça ölçüyor.
    const brutBirimler = birimlereBol(kalemToplam, 3);
    const komisyonBirimler = birimlereBol(beklenen.komisyonMinor, 3);
    const iadeEdilenNet = (brutBirimler[0] ?? 0n) - (komisyonBirimler[0] ?? 0n);
    const beklenenKalan = beklenen.saticiNetMinor - iadeEdilenNet;

    expect(
      kalanBakiye,
      `⚠️ Kısmi iade beklenmedik bakiye bıraktı: kalan ${bicimle(kalanBakiye)}, beklenen ${bicimle(beklenenKalan)}`,
    ).toBe(beklenenKalan);

    // ⚠️ ASIL KORUNAN BÜYÜKLÜK: iade edilen + kalan = toplam hakediş. Kuruş
    //    kaybı ancak burada görünür; dilim sırası bir politika seçimidir,
    //    toplamın korunması ise pazarlık edilemez.
    expect(
      iadeEdilenNet + kalanBakiye,
      '⚠️ KURUŞ KAYBI: iade edilen ve kalan tutarların toplamı hakedişi vermiyor',
    ).toBe(beklenen.saticiNetMinor);

    // Müşteriye ödenen tutar da bir birim kadar olmalı.
    const birimTutarlar = brutBirimler;
    expect(
      kurus(iade.refundAmountMinor),
      'Tek adetlik iadede müşteriye ödenen tutar birim tutar kadar olmalı',
    ).toBe(birimTutarlar[0] ?? 0n);
  });

  test('teslim edilmemiş siparişten iade talep edilemez', async ({
    api,
    ikinciApi,
    defter,
    sahteIyzico,
    ekIstemci,
  }) => {
    // ⚠️ İade penceresi TESLİM tarihinden işler, sipariş tarihinden değil.
    //    Teslim edilmemiş bir paket için iade açılabilseydi, müşteri henüz
    //    eline geçmemiş ürünün parasını geri alabilirdi.
    await yoneticiOlustur(ikinciApi, defter);
    const kategori = await kategoriOlustur(ikinciApi, defter);
    const satici = await saticiOlustur(await ekIstemci(), ikinciApi, defter);
    await komisyonKuraliTanimla(ikinciApi, defter, { sellerId: satici.sellerId, oranBps: 1200 });

    const urun = await urunYayinla(satici.istemci, ikinciApi, {
      kategoriId: kategori.id,
      varyantlar: [{ renk: 'Siyah', renkHex: '#000000', beden: 'M', fiyat: 200, stok: 5 }],
    });
    const varyant = urun.varyantlar[0];
    expect(varyant).toBeDefined();
    if (!varyant) return;

    const musteri = api;
    await musteriOlustur(musteri, defter);
    await sepeteEkle(musteri, varyant.id, 1);

    const siparis = await checkoutBaslat(musteri, defter);
    await odemeyiTamamla(musteri, sahteIyzico, siparis);

    const detay = (await musteri.get(`/v1/orders/${siparis.orderNumber}`)).veri<SiparisDetayi>();
    const kalem = detay.packages[0]?.items[0];
    expect(kalem).toBeDefined();
    if (!kalem) return;

    const talep = await musteri.post(`/v1/orders/${siparis.orderId}/returns`, {
      govde: { reason: 'DAMAGED', items: [{ orderItemId: kalem.id, quantity: 1 }] },
      idempotencyKey: randomUUID(),
    });

    hataBekle(talep, 'RETURN_NOT_ALLOWED', 422);

    // Defter dokunulmamış olmalı.
    const defterYaniti = await satici.istemci.get('/v1/seller/finance/ledger', {
      sorgu: { limit: 100 },
    });
    basariBekle(defterYaniti, 200);
    expect(
      defterYaniti
        .veri<DefterKaydi[]>()
        .filter((k) => k.type === 'REFUND' || k.type === 'COMMISSION_REVERSAL'),
      'Reddedilen iade talebi ters kayıt üretmemeli',
    ).toHaveLength(0);
  });

  test('başkasının siparişinden iade talep edilemez', async ({
    api,
    ikinciApi,
    defter,
    sahteIyzico,
    ekIstemci,
  }) => {
    await yoneticiOlustur(ikinciApi, defter);
    const kategori = await kategoriOlustur(ikinciApi, defter);
    const satici = await saticiOlustur(await ekIstemci(), ikinciApi, defter);
    await komisyonKuraliTanimla(ikinciApi, defter, { sellerId: satici.sellerId, oranBps: 1200 });

    const urun = await urunYayinla(satici.istemci, ikinciApi, {
      kategoriId: kategori.id,
      varyantlar: [{ renk: 'Siyah', renkHex: '#000000', beden: 'M', fiyat: 200, stok: 5 }],
    });
    const varyant = urun.varyantlar[0];
    expect(varyant).toBeDefined();
    if (!varyant) return;

    const sahip = api;
    await musteriOlustur(sahip, defter);
    await sepeteEkle(sahip, varyant.id, 1);
    const siparis = await checkoutBaslat(sahip, defter);
    await odemeyiTamamla(sahip, sahteIyzico, siparis);

    const detay = (await sahip.get(`/v1/orders/${siparis.orderNumber}`)).veri<SiparisDetayi>();
    const kalem = detay.packages[0]?.items[0];
    expect(kalem).toBeDefined();
    if (!kalem) return;

    // Üçüncü bir kullanıcı, sipariş kimliğini bir şekilde öğrenmiş olsun.
    const yabanci = await ekIstemci();
    await musteriOlustur(yabanci, defter);

    const talep = await yabanci.post(`/v1/orders/${siparis.orderId}/returns`, {
      govde: { reason: 'DAMAGED', items: [{ orderItemId: kalem.id, quantity: 1 }] },
      idempotencyKey: randomUUID(),
    });

    // ⚠️ ORDER_NOT_FOUND doğru cevap: "yetkiniz yok" demek, o siparişin
    //    VAR OLDUĞUNU doğrulardı ve numara taraması mümkün olurdu.
    hataBekle(talep, 'ORDER_NOT_FOUND', 404);

    // Sipariş detayı da görünmemeli.
    const detayDenemesi = await yabanci.get(`/v1/orders/${siparis.orderNumber}`);
    hataBekle(detayDenemesi, 'ORDER_NOT_FOUND', 404);
  });
});

/**
 * Bakiye ucundan toplam bakiyeyi okur.
 *
 * ⚠️ Bakiye ayrı bir kolonda tutulmuyor, her okumada defterden TOPLANIYOR
 *    (seller-finance.service.ts). Bu yüzden bu uç, ters kayıtların gerçekten
 *    yazıldığının bağımsız bir kanıtıdır.
 */
async function bakiyeOku(istemci: Istemci): Promise<bigint> {
  const yanit = await istemci.get('/v1/seller/finance/balance');
  basariBekle(yanit, 200);
  return kurus(yanit.veri<{ totalMinor: string }>().totalMinor);
}

/**
 * Bir tutarı adet başına KURUŞ KAYBI OLMADAN böler.
 *
 * ⚠️ Sunucunun `Money.allocate`'i çağrılmıyor, bağımsız yazılıyor: kalan
 *    kuruşlar baştan başlayarak birer birer dağıtılır. İki taraf aynı
 *    fonksiyonu kullansaydı dağıtım hatası görünmezdi.
 */
function birimlereBol(toplamMinor: bigint, adet: number): bigint[] {
  if (adet <= 0) return [];
  const taban = toplamMinor / BigInt(adet);
  const artik = toplamMinor - taban * BigInt(adet);
  return Array.from({ length: adet }, (_, sira) => taban + (BigInt(sira) < artik ? 1n : 0n));
}
