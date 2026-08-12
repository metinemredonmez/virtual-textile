/**
 * SENARYO 6 — ÇOK SATICILI SİPARİŞ: KOMİSYON VE DEFTER
 *
 * Sorulan soru: iki farklı komisyon oranına sahip iki satıcıdan alışveriş
 * yapıldığında her satıcının defteri doğru mu ve toplam KURUŞU KURUŞUNA
 * tutuyor mu?
 *
 * ⚠️ Beklenen değerler sunucunun `Money.applyBps`'i ÇAĞRILARAK değil,
 *    `destek/para.ts` içinde BAĞIMSIZ olarak yeniden hesaplanıyor. Aynı
 *    fonksiyonu iki tarafta kullanan bir test, o fonksiyondaki yuvarlama
 *    hatasını asla göremez.
 *
 * ⚠️ Tutarlar BİLEREK yuvarlama artığı üretecek şekilde seçildi (899,90 ₺ ×
 *    %12,50 = 112,4875 ₺ → yarım yukarı 112,49 ₺). Yuvarlama yönü yanlış
 *    olsaydı tam sayı tutarlarla yapılan bir test bunu göremezdi.
 *
 * ⚠️ Ödeme GERÇEK üretim zinciriyle tamamlanıyor (sahte iyzico → 3DS geri
 *    dönüşü → confirmPaid). Defter satırlarını test yazmıyor; yazsaydı,
 *    doğrulaması gereken mantığı kendi içinde tekrar üretmiş olurdu.
 */
import { basariBekle } from '../destek/istemci.js';
import {
  checkoutBaslat,
  kategoriOlustur,
  komisyonKuraliTanimla,
  musteriOlustur,
  odemeyiTamamla,
  saticiOlustur,
  sepeteEkle,
  urunYayinla,
  yoneticiOlustur,
} from '../destek/kurulum.js';
import { bicimle, komisyonHesapla, kurus, lira, topla } from '../destek/para.js';
import { expect, test } from '../destek/test.js';

/** Satıcı başına kargo (49,90 ₺) ve ücretsiz kargo eşiği (500,00 ₺). */
const KARGO_UCRETI = 4_990n;
const UCRETSIZ_KARGO_ESIGI = 50_000n;

interface AdminSiparisDetayi {
  orderNumber: string;
  status: string;
  itemsTotalMinor: string;
  shippingTotalMinor: string;
  discountMinor: string;
  grandTotalMinor: string;
  packages: Array<{
    id: string;
    itemsTotalMinor: string;
    shippingMinor: string;
    discountShareMinor: string;
    seller: { id: string; displayName: string };
    items: Array<{
      id: string;
      productTitle: string;
      quantity: number;
      unitPriceMinor: string;
      lineTotalMinor: string;
      commissionRateBps: number;
      commissionAmountMinor: string;
      sellerNetMinor: string;
      commissionRuleVersionId: string;
    }>;
  }>;
}

interface DefterKaydi {
  id: string;
  type: string;
  amountMinor: string;
  orderItemId: string | null;
  availableAt: string | null;
}

test.describe('Çok satıcılı sipariş — komisyon ve defter', () => {
  test('her satıcının defteri kendi oranıyla, toplam kuruşu kuruşuna tutar', async ({
    api,
    ikinciApi,
    defter,
    sahteIyzico,
    ekIstemci,
  }) => {
    // ══ KURULUM ═══════════════════════════════════════════════════════════
    const yoneticiIstemcisi = ikinciApi;
    await yoneticiOlustur(yoneticiIstemcisi, defter);

    const kategori = await kategoriOlustur(yoneticiIstemcisi, defter);

    // İki satıcı, iki AYRI istemci: satıcı panelleri birbirine karışmasın.
    const saticiA = await saticiOlustur(await ekIstemci(), yoneticiIstemcisi, defter, {
      magazaAdi: 'E2E Satici A',
    });
    const saticiB = await saticiOlustur(await ekIstemci(), yoneticiIstemcisi, defter, {
      magazaAdi: 'E2E Satici B',
    });

    // ⚠️ FARKLI ORANLAR. Aynı oran verilseydi, "hangi satıcıya hangi kural
    //    uygulandı" sorusu sınanamaz, karışıklık görünmezdi.
    const kuralA = await komisyonKuraliTanimla(yoneticiIstemcisi, defter, {
      sellerId: saticiA.sellerId,
      oranBps: 1250, // %12,50
    });
    const kuralB = await komisyonKuraliTanimla(yoneticiIstemcisi, defter, {
      sellerId: saticiB.sellerId,
      oranBps: 1800, // %18,00
    });

    // A: 899,90 ₺ × 1 → eşiğin ALTINDA, kargo çıkar. Yuvarlama artığı üretir.
    const urunA = await urunYayinla(saticiA.istemci, yoneticiIstemcisi, {
      kategoriId: kategori.id,
      baslik: 'E2E A Gömlek',
      varyantlar: [{ renk: 'Siyah', renkHex: '#000000', beden: 'M', fiyat: 899.9, stok: 5 }],
    });

    // B: 749,95 ₺ × 2 = 1.499,90 ₺ → eşiğin ÜSTÜNDE, kargo bedava.
    const urunB = await urunYayinla(saticiB.istemci, yoneticiIstemcisi, {
      kategoriId: kategori.id,
      baslik: 'E2E B Elbise',
      varyantlar: [{ renk: 'Lacivert', renkHex: '#102A54', beden: 'S', fiyat: 749.95, stok: 5 }],
    });

    const varyantA = urunA.varyantlar[0];
    const varyantB = urunB.varyantlar[0];
    expect(varyantA).toBeDefined();
    expect(varyantB).toBeDefined();
    if (!varyantA || !varyantB) return;

    // ══ SEPET ═════════════════════════════════════════════════════════════
    const musteri = api;
    musteri.oturumKimligi = null;
    await musteriOlustur(musteri, defter);

    await sepeteEkle(musteri, varyantA.id, 1);
    await sepeteEkle(musteri, varyantB.id, 2);

    // ══ BEKLENEN DEĞERLER — bağımsız hesap ════════════════════════════════
    const kalemToplamA = lira(899.9) * 1n; // 89.990
    const kalemToplamB = lira(749.95) * 2n; // 149.990

    const beklenenA = komisyonHesapla(kalemToplamA, {
      rateBps: kuralA.oranBps,
      fixedFeeMinor: kuralA.sabitUcretMinor,
    });
    const beklenenB = komisyonHesapla(kalemToplamB, {
      rateBps: kuralB.oranBps,
      fixedFeeMinor: kuralB.sabitUcretMinor,
    });

    // 89.990 × 1250 / 10.000 = 11.248,75 → yarım yukarı → 11.249
    expect(
      beklenenA.komisyonMinor,
      'Test hesabı hatalı — yuvarlama beklentisi yarım yukarı olmalı',
    ).toBe(11_249n);
    expect(beklenenB.komisyonMinor, '149.990 × %18 = 26.998,2 → 26.998').toBe(26_998n);

    const kargoA = kalemToplamA >= UCRETSIZ_KARGO_ESIGI ? 0n : KARGO_UCRETI;
    const kargoB = kalemToplamB >= UCRETSIZ_KARGO_ESIGI ? 0n : KARGO_UCRETI;
    expect(kargoA, 'A paketi eşiğin altında — kargo alınmalı').toBe(KARGO_UCRETI);
    expect(kargoB, 'B paketi eşiğin üstünde — kargo bedava olmalı').toBe(0n);

    const beklenenGenelToplam = kalemToplamA + kalemToplamB + kargoA + kargoB;

    // ══ CHECKOUT ══════════════════════════════════════════════════════════
    const siparis = await checkoutBaslat(musteri, defter);

    expect(siparis.paketler, 'İki satıcı = iki paket').toHaveLength(2);
    expect(siparis.itemsTotalMinor).toBe(kalemToplamA + kalemToplamB);
    expect(siparis.shippingTotalMinor, 'Kargo yalnızca eşik altı paketten').toBe(kargoA + kargoB);
    expect(siparis.grandTotalMinor, `Genel toplam ${bicimle(beklenenGenelToplam)} olmalı`).toBe(
      beklenenGenelToplam,
    );

    const paketA = siparis.paketler.find((p) => p.sellerId === saticiA.sellerId);
    const paketB = siparis.paketler.find((p) => p.sellerId === saticiB.sellerId);
    expect(paketA?.itemsTotalMinor).toBe(kalemToplamA);
    expect(paketA?.shippingMinor).toBe(kargoA);
    expect(paketB?.itemsTotalMinor).toBe(kalemToplamB);
    expect(paketB?.shippingMinor).toBe(kargoB);

    // ══ ÖDEME ÖNCESİ: DEFTER BOŞ OLMALI ══════════════════════════════════
    // ⚠️ Tahsilat yapılmadan satıcıya hakediş yazılırsa, ödemesi başarısız
    //    olan her sipariş satıcıya karşılıksız alacak üretir.
    for (const satici of [saticiA, saticiB]) {
      const bakiye = await satici.istemci.get('/v1/seller/finance/balance');
      basariBekle(bakiye, 200);
      const bakiyeVeri = bakiye.veri<{ totalMinor: string }>();
      expect(
        kurus(bakiyeVeri.totalMinor),
        `⚠️ ${satici.storeSlug}: ödeme yapılmadan bakiye oluşmuş`,
      ).toBe(0n);
    }

    // ══ KOMİSYON SNAPSHOT'I — admin görünümü ═════════════════════════════
    const detayYaniti = await yoneticiIstemcisi.get(`/v1/admin/orders/${siparis.orderNumber}`);
    basariBekle(detayYaniti, 200);
    const detay = detayYaniti.veri<AdminSiparisDetayi>();

    const adminPaketA = detay.packages.find((p) => p.seller.id === saticiA.sellerId);
    const adminPaketB = detay.packages.find((p) => p.seller.id === saticiB.sellerId);
    expect(adminPaketA, 'A satıcısının paketi admin görünümünde olmalı').toBeDefined();
    expect(adminPaketB, 'B satıcısının paketi admin görünümünde olmalı').toBeDefined();
    if (!adminPaketA || !adminPaketB) return;

    const kalemA = adminPaketA.items[0];
    const kalemB = adminPaketB.items[0];
    expect(kalemA).toBeDefined();
    expect(kalemB).toBeDefined();
    if (!kalemA || !kalemB) return;

    // Oran, siparişe SNAPSHOT'lanmış olmalı — kural sonradan değişse bile
    // bu sipariş bozulmaz.
    expect(kalemA.commissionRateBps, 'A kaleminde A satıcısının oranı olmalı').toBe(kuralA.oranBps);
    expect(kalemB.commissionRateBps, 'B kaleminde B satıcısının oranı olmalı').toBe(kuralB.oranBps);
    expect(
      kalemA.commissionRuleVersionId,
      'İki satıcı aynı kural versiyonuna bağlanmamalı',
    ).not.toBe(kalemB.commissionRuleVersionId);

    expect(kurus(kalemA.commissionAmountMinor), 'A komisyonu').toBe(beklenenA.komisyonMinor);
    expect(kurus(kalemB.commissionAmountMinor), 'B komisyonu').toBe(beklenenB.komisyonMinor);
    expect(kurus(kalemA.sellerNetMinor), 'A hakedişi').toBe(beklenenA.saticiNetMinor);
    expect(kurus(kalemB.sellerNetMinor), 'B hakedişi').toBe(beklenenB.saticiNetMinor);

    // ⚠️ KURUŞU KURUŞUNA: komisyon + hakediş, kalem tutarını TAM etmeli.
    //    Bir kuruş kaçarsa mutabakat açığı doğar ve haftalar sonra fark edilir.
    for (const paket of detay.packages) {
      for (const kalem of paket.items) {
        expect(
          kurus(kalem.commissionAmountMinor) + kurus(kalem.sellerNetMinor),
          `${kalem.productTitle}: komisyon + hakediş = kalem tutarı olmalı`,
        ).toBe(kurus(kalem.lineTotalMinor));
      }

      const paketKalemToplami = topla(paket.items.map((k) => kurus(k.lineTotalMinor)));
      expect(
        paketKalemToplami,
        'Paket kalem toplamı, paketin itemsTotal değerine eşit olmalı',
      ).toBe(kurus(paket.itemsTotalMinor));
    }

    const tumKalemler = detay.packages.flatMap((p) => p.items);
    expect(
      topla(tumKalemler.map((k) => kurus(k.lineTotalMinor))),
      'Kalemlerin toplamı siparişin itemsTotal değerine eşit olmalı',
    ).toBe(kurus(detay.itemsTotalMinor));

    expect(
      kurus(detay.itemsTotalMinor) + kurus(detay.shippingTotalMinor) - kurus(detay.discountMinor),
      'Genel toplam = ürünler + kargo − indirim',
    ).toBe(kurus(detay.grandTotalMinor));

    // ══ ÖDEME — gerçek zincir ═════════════════════════════════════════════
    await odemeyiTamamla(musteri, sahteIyzico, siparis);

    // Sağlayıcıya bildirilen dağılım da doğru olmalı: `subMerchantPrice`
    // satıcıya kalan tutardır, komisyon platformda kalır.
    const odemeBaglami = sahteIyzico.odemeBaglamiBul(siparis.orderId);
    expect(odemeBaglami, 'Sahte sağlayıcıya ödeme isteği ulaşmış olmalı').not.toBeNull();
    if (odemeBaglami !== null) {
      expect(
        odemeBaglami.tutarMinor,
        'Sağlayıcıya bildirilen tutar sipariş toplamıyla aynı olmalı',
      ).toBe(beklenenGenelToplam);

      expect(
        topla(odemeBaglami.kalemler.map((k) => k.tutarMinor)),
        '⚠️ Sağlayıcıya giden kalem toplamı ödenen tutarı tutmalı (kargo ilk kaleme katlanır)',
      ).toBe(beklenenGenelToplam);

      // ⚠️ Kargo bedeli SATICIYA ÖDENMEMELİ: kalemlere katlanan kargo,
      //    aynı tutarda komisyona da eklendiği için satıcıya kalan değişmez.
      expect(
        topla(odemeBaglami.kalemler.map((k) => k.saticiyaKalanMinor)),
        'Satıcılara giden toplam, hakedişlerin toplamı olmalı — kargo platformda kalmalı',
      ).toBe(beklenenA.saticiNetMinor + beklenenB.saticiNetMinor);
    }

    // ══ DEFTER — ödeme sonrası ════════════════════════════════════════════
    const beklenenBakiyeler = new Map<string, bigint>([
      [saticiA.sellerId, beklenenA.saticiNetMinor],
      [saticiB.sellerId, beklenenB.saticiNetMinor],
    ]);

    for (const satici of [saticiA, saticiB]) {
      const beklenen = beklenenBakiyeler.get(satici.sellerId) ?? 0n;

      const defterYaniti = await satici.istemci.get('/v1/seller/finance/ledger', {
        sorgu: { limit: 100 },
      });
      basariBekle(defterYaniti, 200);

      const kayitlar = defterYaniti.veri<DefterKaydi[]>();
      expect(
        kayitlar.length,
        `${satici.storeSlug}: ödeme sonrası defter kaydı yazılmalı`,
      ).toBeGreaterThan(0);

      const satis = kayitlar.filter((k) => k.type === 'SALE');
      const komisyon = kayitlar.filter((k) => k.type === 'COMMISSION');

      expect(satis.length, 'Her kalem için bir SALE kaydı').toBe(1);
      expect(komisyon.length, 'Her kalem için bir COMMISSION kaydı').toBe(1);

      // ⚠️ İŞARETLER: satış ALACAK (+), komisyon BORÇ (−). Ters yazılırsa
      //    bakiye toplamı tesadüfen doğru çıkabilir ama payout tutarı olmaz.
      expect(kurus(satis[0]?.amountMinor ?? '0'), 'SALE pozitif olmalı').toBeGreaterThan(0n);
      expect(kurus(komisyon[0]?.amountMinor ?? '0'), 'COMMISSION negatif olmalı').toBeLessThan(0n);

      const defterBakiyesi = topla(kayitlar.map((k) => kurus(k.amountMinor)));
      expect(
        defterBakiyesi,
        `⚠️ ${satici.storeSlug}: defter toplamı ${bicimle(defterBakiyesi)}, beklenen ${bicimle(beklenen)}`,
      ).toBe(beklenen);

      // ⚠️ Hakediş HEMEN ödenebilir olmamalı: iade penceresi kapanmadan
      //    ödenen para, iade durumunda satıcıdan geri tahsil edilmek zorunda
      //    kalır ve bu pratikte çoğu zaman mümkün olmaz.
      for (const kayit of kayitlar) {
        if (kayit.availableAt === null) continue;
        expect(
          new Date(kayit.availableAt).getTime(),
          'Hakediş tarihi gelecekte olmalı (iade penceresi)',
        ).toBeGreaterThan(Date.now());
      }

      const bakiyeYaniti = await satici.istemci.get('/v1/seller/finance/balance');
      basariBekle(bakiyeYaniti, 200);
      const bakiye = bakiyeYaniti.veri<{ totalMinor: string; availableMinor?: string }>();

      expect(
        kurus(bakiye.totalMinor),
        `${satici.storeSlug}: bakiye ucu defterle aynı sonucu vermeli`,
      ).toBe(beklenen);

      if (bakiye.availableMinor !== undefined) {
        expect(
          kurus(bakiye.availableMinor),
          'İade penceresi kapanmadan çekilebilir bakiye 0 olmalı',
        ).toBe(0n);
      }
    }

    // ══ SIZINTI KONTROLÜ: A satıcısı B'nin kaydını görmemeli ═════════════
    const aDefteri = await saticiA.istemci.get('/v1/seller/finance/ledger', {
      sorgu: { limit: 100 },
    });
    basariBekle(aDefteri, 200);
    expect(
      topla(aDefteri.veri<DefterKaydi[]>().map((k) => kurus(k.amountMinor))),
      '⚠️ A satıcısının defterinde B satıcısının kaydı var',
    ).toBe(beklenenA.saticiNetMinor);

    // ══ PLATFORM KOMİSYONU ════════════════════════════════════════════════
    const toplamKomisyon = beklenenA.komisyonMinor + beklenenB.komisyonMinor;
    const toplamHakedis = beklenenA.saticiNetMinor + beklenenB.saticiNetMinor;
    expect(
      toplamKomisyon + toplamHakedis,
      'Komisyon + hakediş = ürün toplamı (kargo hariç). Bir kuruş kaybolmamalı.',
    ).toBe(kalemToplamA + kalemToplamB);
  });

  test('ödemesi başarısız siparişte defter yazılmaz ve stok geri döner', async ({
    api,
    ikinciApi,
    defter,
    sahteIyzico,
    ekIstemci,
  }) => {
    // ⚠️ Reddedilen bir ödemenin defter yazması, satıcıya karşılıksız alacak
    //    üretir. Reddin de stoğu serbest bırakması gerekir; bırakmazsa ürün
    //    "tükendi" görünür ama satılmamıştır.
    await yoneticiOlustur(ikinciApi, defter);
    const kategori = await kategoriOlustur(ikinciApi, defter);
    const satici = await saticiOlustur(await ekIstemci(), ikinciApi, defter);
    await komisyonKuraliTanimla(ikinciApi, defter, { sellerId: satici.sellerId, oranBps: 1500 });

    const urun = await urunYayinla(satici.istemci, ikinciApi, {
      kategoriId: kategori.id,
      varyantlar: [{ renk: 'Siyah', renkHex: '#000000', beden: 'M', fiyat: 400, stok: 1 }],
    });
    const varyant = urun.varyantlar[0];
    expect(varyant).toBeDefined();
    if (!varyant) return;

    const musteri = api;
    await musteriOlustur(musteri, defter);
    await sepeteEkle(musteri, varyant.id, 1);

    const siparis = await checkoutBaslat(musteri, defter);

    // Sahte sağlayıcı bir sonraki ödemeyi reddedecek.
    sahteIyzico.sonrakiOdemeyiReddet();

    const ode = await musteri.post('/v1/checkout/pay', {
      govde: { orderId: siparis.orderId, installment: 1 },
      idempotencyKey: `e2e-${siparis.orderId}`,
    });
    basariBekle(ode);

    const baglam = sahteIyzico.odemeBaglamiBul(siparis.orderId);
    expect(baglam).not.toBeNull();
    if (baglam === null) return;

    const geriDonus = await musteri.post('/v1/payments/3ds/callback', {
      govde: {
        conversationId: baglam.conversationId,
        paymentId: baglam.paymentId,
        mdStatus: '1',
        status: 'failure',
      },
    });
    basariBekle(geriDonus, 200);
    expect(geriDonus.veri<{ status: string }>().status, 'Ödeme başarısız olmalı').toBe('FAILED');

    // ── Defter BOŞ kalmalı ────────────────────────────────────────────────
    const defterYaniti = await satici.istemci.get('/v1/seller/finance/ledger', {
      sorgu: { limit: 100 },
    });
    basariBekle(defterYaniti, 200);
    expect(
      defterYaniti.veri<DefterKaydi[]>(),
      '⚠️ Başarısız ödemede satıcı defterine kayıt düşmüş',
    ).toHaveLength(0);

    // ── Stok serbest bırakılmalı ─────────────────────────────────────────
    const detay = await musteri.get(`/v1/products/${urun.slug}`);
    basariBekle(detay, 200);
    expect(
      detay
        .veri<{ variants: Array<{ id: string; available: boolean }> }>()
        .variants.find((v) => v.id === varyant.id)?.available,
      '⚠️ Ödeme başarısız oldu ama stok hâlâ rezerve — ürün satılmadan tükenmiş görünüyor',
    ).toBe(true);
  });
});
