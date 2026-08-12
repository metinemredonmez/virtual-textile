/**
 * SENARYO 8 — YETKİ SINIRLARI
 *
 * İki soru:
 *   a) Bir satıcı BAŞKA mağazanın verisine erişebiliyor mu?
 *   b) Bir müşteri admin uçlarına erişebiliyor mu?
 *
 * Bu senaryo modül testlerinin YAPISAL OLARAK göremediği şeyi arıyor: orada
 * `JwtPayload` elle kuruluyor ve "bu kullanıcının rolü SELLER_USER" varsayımı
 * testin kendisi tarafından sağlanıyor. Uçtan uca akışta o rolün gerçekten
 * NEREDEN geldiği sorusu ilk kez burada soruluyor.
 */
import { randomUUID } from 'node:crypto';
import { basariBekle, hataBekle } from '../destek/istemci.js';
import {
  benzersiz,
  girisYap,
  kategoriOlustur,
  komisyonKuraliTanimla,
  musteriOlustur,
  saticiOlustur,
  telefonUret,
  urunYayinla,
  yoneticiOlustur,
} from '../destek/kurulum.js';
import { expect, test } from '../destek/test.js';
import { db, hizLimitiSifirla } from '../destek/veritabani.js';

test.describe('Yetki sınırları', () => {
  test('satıcı BAŞKA mağazanın verisine erişemez', async ({ ikinciApi, defter, ekIstemci }) => {
    await yoneticiOlustur(ikinciApi, defter);
    const kategori = await kategoriOlustur(ikinciApi, defter);

    const saticiA = await saticiOlustur(await ekIstemci(), ikinciApi, defter, {
      magazaAdi: 'Yetki A',
    });
    const saticiB = await saticiOlustur(await ekIstemci(), ikinciApi, defter, {
      magazaAdi: 'Yetki B',
    });

    await komisyonKuraliTanimla(ikinciApi, defter, { sellerId: saticiA.sellerId, oranBps: 1200 });

    const urunA = await urunYayinla(saticiA.istemci, ikinciApi, {
      kategoriId: kategori.id,
      baslik: 'Yetki A Ürünü',
    });

    // ── 1. B, A'nın ürününü satıcı panelinden okuyamamalı ────────────────
    const urunOkuma = await saticiB.istemci.get(`/v1/seller/products/${urunA.productId}`);
    expect(urunOkuma.basarili, '⚠️ B satıcısı A satıcısının ürününü panelinden okuyabildi').toBe(
      false,
    );

    // ── 2. B, A'nın ürününü GÜNCELLEYEMEMELİ ────────────────────────────
    const urunGuncelleme = await saticiB.istemci.patch(`/v1/seller/products/${urunA.productId}`, {
      govde: { title: 'Ele geçirildi' },
    });
    expect(urunGuncelleme.basarili, '⚠️ B satıcısı A satıcısının ürününü değiştirebildi').toBe(
      false,
    );

    // Ürün gerçekten değişmemiş olmalı — hata kodu doğru ama yazma
    // gerçekleşmiş olabilirdi.
    const kontrol = await saticiA.istemci.get(`/v1/seller/products/${urunA.productId}`);
    basariBekle(kontrol, 200);
    expect(kontrol.veri<{ title: string }>().title, 'Ürün başlığı değişmemeli').toBe(urunA.baslik);

    // ── 3. X-Seller-Id BAŞLIĞIYLA kapsam aşımı ──────────────────────────
    // ⚠️ SellerScopeGuard'ın varlık sebebi: başlık doğrulanmasaydı bir satıcı,
    //    başka mağazanın cirosunu ve bakiyesini okuyabilirdi.
    saticiB.istemci.saticiKimligi = saticiA.sellerId;

    const yabanciBakiye = await saticiB.istemci.get('/v1/seller/finance/balance');
    hataBekle(yabanciBakiye, 'AUTH_FORBIDDEN', 403);

    const yabanciDefter = await saticiB.istemci.get('/v1/seller/finance/ledger');
    hataBekle(yabanciDefter, 'AUTH_FORBIDDEN', 403);

    const yabanciSiparisler = await saticiB.istemci.get('/v1/seller/orders');
    hataBekle(yabanciSiparisler, 'AUTH_FORBIDDEN', 403);

    const yabanciProfil = await saticiB.istemci.get('/v1/seller/me');
    hataBekle(yabanciProfil, 'AUTH_FORBIDDEN', 403);

    saticiB.istemci.saticiKimligi = null;

    // ── 4. Kendi kapsamı çalışmaya devam etmeli ─────────────────────────
    const kendiProfil = await saticiB.istemci.get('/v1/seller/me');
    basariBekle(kendiProfil, 200);
    expect(kendiProfil.veri<{ id: string }>().id, 'Satıcı kendi profilini görmeli').toBe(
      saticiB.sellerId,
    );

    // ── 5. B'nin ürün listesi A'nın ürününü İÇERMEMELİ ──────────────────
    const bListesi = await saticiB.istemci.get('/v1/seller/products', { sorgu: { limit: 100 } });
    basariBekle(bListesi, 200);
    expect(
      bListesi.veri<Array<{ id: string }>>().map((urun) => urun.id),
      '⚠️ B satıcısının ürün listesinde A satıcısının ürünü var',
    ).not.toContain(urunA.productId);
  });

  test('müşteri admin uçlarına erişemez', async ({ api, ikinciApi, defter }) => {
    const musteri = await musteriOlustur(api, defter);
    expect(musteri.rol).toBe('CUSTOMER');

    const adminUclari: Array<{ yontem: 'get' | 'post' | 'patch'; yol: string }> = [
      { yontem: 'get', yol: '/v1/admin/sellers' },
      { yontem: 'get', yol: '/v1/admin/orders' },
      { yontem: 'get', yol: '/v1/admin/payouts' },
      { yontem: 'get', yol: '/v1/admin/categories' },
      { yontem: 'get', yol: '/v1/admin/coupons' },
      { yontem: 'get', yol: '/v1/admin/commission-rules' },
      { yontem: 'get', yol: '/v1/admin/reports/gmv' },
      { yontem: 'get', yol: '/v1/admin/ai/usage' },
      { yontem: 'get', yol: '/v1/admin/fraud/alerts' },
      { yontem: 'get', yol: '/v1/admin/audit-log' },
      { yontem: 'get', yol: '/v1/admin/products/moderation' },
    ];

    for (const uc of adminUclari) {
      const yanit = await api[uc.yontem](uc.yol);
      expect(yanit.hataKodu, `⚠️ ${uc.yol} müşteriye açık: ${yanit.ozet()}`).toBe('AUTH_FORBIDDEN');
      expect(yanit.durum, `${uc.yol} 403 dönmeli`).toBe(403);
    }

    // Yazma uçları da kapalı olmalı — okuma kapalıyken yazma açık kalabilir.
    const kategoriYazma = await api.post('/v1/admin/categories', {
      govde: { slug: benzersiz('sizinti'), name: 'Sızıntı', sortOrder: 0 },
    });
    hataBekle(kategoriYazma, 'AUTH_FORBIDDEN', 403);

    const komisyonYazma = await api.post('/v1/admin/commission-rules', {
      govde: { label: 'Sızıntı kuralı', rateBps: 0, fixedFeeMinor: '0' },
    });
    hataBekle(komisyonYazma, 'AUTH_FORBIDDEN', 403);

    // ── Satıcı paneli de kapalı olmalı ──────────────────────────────────
    const saticiPaneli = await api.get('/v1/seller/me');
    expect(saticiPaneli.basarili, '⚠️ Mağazası olmayan müşteri satıcı panelini açabildi').toBe(
      false,
    );
    expect(['AUTH_FORBIDDEN', 'AUTH_TOKEN_MISSING']).toContain(saticiPaneli.hataKodu);

    // ── Kimliksiz istek: 401, 403 değil ─────────────────────────────────
    ikinciApi.kimlikSil();
    const kimliksiz = await ikinciApi.get('/v1/admin/sellers');
    hataBekle(kimliksiz, 'AUTH_TOKEN_MISSING', 401);
  });

  test('SUPPORT rolü okuyabilir ama para hareketi yapamaz', async ({ api, ikinciApi, defter }) => {
    // ⚠️ Rol ayrımının anlamı burada sınanıyor: destek ekibi siparişi
    //    görebilmeli (işini yapabilmesi için) ama komisyon kuralı
    //    değiştirememeli.
    await yoneticiOlustur(ikinciApi, defter, 'ADMIN');
    const destek = await yoneticiOlustur(api, defter, 'SUPPORT');
    expect(destek.rol).toBe('SUPPORT');

    const siparisler = await api.get('/v1/admin/orders');
    basariBekle(siparisler, 200);

    const saticilar = await api.get('/v1/admin/sellers');
    basariBekle(saticilar, 200);

    // Komisyon kuralı yalnızca ADMIN.
    const kuralYazma = await api.post('/v1/admin/commission-rules', {
      govde: { label: 'Destek denemesi', rateBps: 100, fixedFeeMinor: '0' },
    });
    hataBekle(kuralYazma, 'AUTH_FORBIDDEN', 403);

    const kuralOkuma = await api.get('/v1/admin/commission-rules');
    hataBekle(kuralOkuma, 'AUTH_FORBIDDEN', 403);

    // Denetim kaydı da yalnızca ADMIN.
    const denetim = await api.get('/v1/admin/audit-log');
    hataBekle(denetim, 'AUTH_FORBIDDEN', 403);
  });

  test('müşteri başkasının siparişini göremez', async ({ api, ikinciApi, defter }) => {
    const birinci = await musteriOlustur(api, defter);
    await musteriOlustur(ikinciApi, defter);

    const siparisler = await api.get('/v1/orders');
    basariBekle(siparisler, 200);

    // ⚠️ Uydurma bir sipariş numarası da ORDER_NOT_FOUND dönmeli; farklı bir
    //    kod, numaranın var olup olmadığını sızdırırdı.
    const yabanciSiparis = await ikinciApi.get('/v1/orders/VT-260101-9999');
    hataBekle(yabanciSiparis, 'ORDER_NOT_FOUND', 404);

    expect(birinci.id, 'Kurulum iki farklı kullanıcı üretmeliydi').not.toBe('');
  });

  test('⚠️ ONAYLANMIŞ SATICI SATICI PANELİNE GİREBİLMELİ (kod hiçbir yerde SELLER_USER rolü atamıyor)', async ({
    api,
    ikinciApi,
    defter,
  }) => {
    // ═══════════════════════════════════════════════════════════════════════
    // BU TEST BİLİNÇLİ OLARAK KIRMIZI YANAR VE GERÇEK BİR AÇIĞI GÖSTERİR.
    //
    // Akış tamamen gerçek uçlardan geçiyor: kullanıcı kayıt oluyor, satıcı
    // başvurusu yapıyor, admin onaylıyor, kullanıcı tekrar giriş yapıyor.
    // Yani bir satıcının üretimde izleyeceği yolun TAMAMI.
    //
    // Sonuç: `/v1/seller/me` AUTH_FORBIDDEN dönüyor. Sebebi:
    //   • Satıcı panelinin tamamı sınıf düzeyinde `@Roles('SELLER_USER')`
    //     ile korunuyor (seller.scope.ts → SellerPanel).
    //   • `RolesGuard` kararı token'daki `user.role` alanına bakarak veriyor.
    //   • Ancak kod tabanında `role = 'SELLER_USER'` ataması HİÇBİR YERDE yok:
    //     ne `SellerService.apply` içinde, ne admin onayında.
    //   • `AuthService.register` her kullanıcıyı CUSTOMER açıyor.
    //
    // Yani onaylanmış bir satıcı, kendi mağazasının hiçbir ucuna erişemez.
    // Modül testleri bunu göremiyor çünkü `JwtPayload`ı elle kurup rolü
    // kendileri veriyorlar; rolün nereden geldiği hiç sorulmuyor.
    //
    // Diğer senaryolar bu tek hatanın hepsini düşürmemesi için kurulumda
    // rolü veritabanından veriyor (veritabani.ts → rolAta). Buradaki test
    // gerçek yolu kullanır ve düzeltilene kadar kırmızı kalır.
    // ═══════════════════════════════════════════════════════════════════════
    await yoneticiOlustur(ikinciApi, defter);

    const kullanici = await musteriOlustur(api, defter, {
      eposta: `${benzersiz('gercek-satici')}@e2e.test`,
    });

    const magazaSlug = benzersiz('gercek-magaza');
    const basvuru = await api.post('/v1/seller/apply', {
      govde: {
        legalName: `Gerçek Yol Tekstil ${magazaSlug}`,
        displayName: `Gerçek Yol ${magazaSlug.slice(-6)}`,
        taxNumber: '1234567890',
        taxOffice: 'Beşiktaş',
        iban: 'TR330006100519786457841326',
        contactEmail: `${magazaSlug}@e2e.test`,
        contactPhone: telefonUret(),
        storeSlug: magazaSlug,
      },
      idempotencyKey: randomUUID(),
    });
    basariBekle(basvuru);

    const sellerId = basvuru.veri<{ id: string }>().id;
    defter.saticiIdleri.push(sellerId);

    const onay = await ikinciApi.post(`/v1/admin/sellers/${sellerId}/approve`, {
      govde: { note: 'E2E gerçek yol' },
    });
    basariBekle(onay, 200);

    // Onay sonrası tekrar giriş — token'ın güncel rol ve sellerIds taşıması için.
    await hizLimitiSifirla('login');
    await girisYap(api, kullanici);

    const tokenSahibi = await api.get('/v1/auth/me');
    basariBekle(tokenSahibi, 200);
    const benVeri = tokenSahibi.veri<{ role: string; sellerIds: string[] }>();

    expect(benVeri.sellerIds, 'Onaylanan satıcının mağazası token’a işlemeli').toContain(sellerId);

    // Veritabanındaki gerçek durum — hata mesajının somut olması için okunuyor.
    const dbKullanici = await db().user.findUnique({
      where: { id: kullanici.id },
      select: { role: true },
    });

    expect(
      benVeri.role,
      `⚠️ AÇIK: onaylanmış satıcının rolü hâlâ ${dbKullanici?.role ?? 'bilinmiyor'}. ` +
        'Kod tabanında role = SELLER_USER ataması yok; SellerService.apply ve ' +
        'admin onayı rolü değiştirmiyor. Satıcı paneli erişilemez durumda.',
    ).toBe('SELLER_USER');

    const panel = await api.get('/v1/seller/me');
    expect(panel.basarili, `⚠️ Onaylanmış satıcı kendi panelini açamıyor: ${panel.ozet()}`).toBe(
      true,
    );
  });
});
