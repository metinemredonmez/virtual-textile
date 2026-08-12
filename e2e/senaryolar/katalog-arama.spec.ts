/**
 * SENARYO 3 — KATALOG: LİSTELEME, FASET, TÜRKÇE ARAMA, AUTOCOMPLETE
 *
 * Buradaki asıl risk Türkçe'nin kendisi. "gomlek" yazan kullanıcı "Gömlek"
 * bulmalı; bu, `unaccent` + `turkish_stem` yapılandırmasının migrasyonla
 * gerçekten kurulmuş olmasına bağlı. Migrasyon atlanırsa birim testleri hiç
 * fark etmez (SQL'e uğramıyorlar), arama sessizce boş döner.
 *
 * ⚠️ Test verisi ÖZELLİKLE benzersiz bir marka adı etrafında kuruluyor.
 *    Ortak bir kelimeyle ("gömlek") arama yapıp sonuç sayısına iddia kurmak,
 *    seed verisi veya başka bir senaryonun ürünü yüzünden kırılırdı.
 */
import { basariBekle, hataBekle } from '../destek/istemci.js';
import {
  benzersiz,
  kategoriOlustur,
  saticiOlustur,
  urunYayinla,
  yoneticiOlustur,
  type Urun,
} from '../destek/kurulum.js';
import { kurus } from '../destek/para.js';
import { expect, test } from '../destek/test.js';

interface KatalogUrunu {
  id: string;
  slug: string;
  title: string;
  brandName: string;
  priceMinor: string;
  colors: string[];
}

interface ListeYaniti {
  items: KatalogUrunu[];
  facets: {
    colors: Array<{ value: string; count: number }>;
    sizes: Array<{ value: string; count: number }>;
    brands: Array<{ value: string; count: number }>;
    priceRange: { minMinor: string; maxMinor: string } | null;
  };
  didYouMean: string | null;
}

test.describe('Katalog ve Türkçe arama', () => {
  test('listeleme, faset, Türkçe arama, autocomplete ve yazım düzeltmesi', async ({
    api,
    ikinciApi,
    defter,
  }) => {
    // ── Kurulum: kendi kategorisi, satıcısı ve ürünleri ──────────────────
    const yonetici = await yoneticiOlustur(ikinciApi, defter);
    expect(yonetici.rol).toBe('ADMIN');

    const kategori = await kategoriOlustur(ikinciApi, defter, { ad: 'E2E Üst Giyim' });
    await saticiOlustur(api, ikinciApi, defter);

    // Markayı benzersiz tutuyoruz: faset ve arama iddiaları yalnızca BU
    // senaryonun ürünlerini görsün.
    const marka = `Ozgun${benzersiz('m').slice(-8).replace(/-/g, '')}`;

    const gomlek: Urun = await urunYayinla(api, ikinciApi, {
      kategoriId: kategori.id,
      baslik: `${marka} Oversize Gömlek`,
      marka,
      varyantlar: [
        { renk: 'Siyah', renkHex: '#000000', beden: 'M', fiyat: 499.9, stok: 5 },
        { renk: 'Siyah', renkHex: '#000000', beden: 'L', fiyat: 499.9, stok: 5 },
        { renk: 'Bej', renkHex: '#E3D5C0', beden: 'M', fiyat: 549.9, stok: 3 },
      ],
    });

    const elbise: Urun = await urunYayinla(api, ikinciApi, {
      kategoriId: kategori.id,
      baslik: `${marka} Midi Elbise`,
      marka,
      varyantlar: [{ renk: 'Lacivert', renkHex: '#102A54', beden: 'S', fiyat: 1299.9, stok: 2 }],
    });

    // ── 1. Kategori ağacı ────────────────────────────────────────────────
    const kategoriler = await ikinciApi.get('/v1/categories');
    basariBekle(kategoriler, 200);

    const agac = kategoriler.veri<Array<{ slug: string; children: unknown[] }>>();
    expect(
      agac.map((dugum) => dugum.slug),
      'Yeni açılan kök kategori ağaçta görünmeli',
    ).toContain(kategori.slug);

    // ── 2. Listeleme + faset ─────────────────────────────────────────────
    const liste = await api.get('/v1/products', { sorgu: { category: kategori.slug, limit: 50 } });
    basariBekle(liste, 200);

    const listeVeri = liste.veri<ListeYaniti>();
    const idler = listeVeri.items.map((urun) => urun.id);
    expect(idler, 'Yayınlanan gömlek listede olmalı').toContain(gomlek.productId);
    expect(idler, 'Yayınlanan elbise listede olmalı').toContain(elbise.productId);

    // Faset sayımları GERÇEK olmalı — sabit bir liste değil.
    const renkFaseti = new Map(listeVeri.facets.colors.map((k) => [k.value, k.count]));
    expect(renkFaseti.has('Siyah'), 'Siyah renk fasette görünmeli').toBe(true);
    expect(renkFaseti.has('Lacivert'), 'Lacivert renk fasette görünmeli').toBe(true);

    const bedenFaseti = listeVeri.facets.sizes.map((k) => k.value);
    expect(bedenFaseti, 'M bedeni fasette olmalı').toContain('M');
    expect(bedenFaseti, 'S bedeni fasette olmalı').toContain('S');

    expect(
      listeVeri.facets.brands.map((k) => k.value),
      'Marka faseti bu senaryonun markasını içermeli',
    ).toContain(marka);

    expect(listeVeri.facets.priceRange, 'Fiyat aralığı hesaplanmalı').not.toBeNull();
    if (listeVeri.facets.priceRange !== null) {
      const enDusuk = kurus(listeVeri.facets.priceRange.minMinor);
      const enYuksek = kurus(listeVeri.facets.priceRange.maxMinor);
      expect(enDusuk, 'En düşük fiyat 499,90 ₺ olmalı').toBe(49_990n);
      expect(enYuksek, 'En yüksek fiyat 1.299,90 ₺ olmalı').toBe(129_990n);
    }

    // ── 3. Renk filtresi fasetle tutarlı olmalı ─────────────────────────
    const lacivertler = await api.get('/v1/products', {
      sorgu: { category: kategori.slug, color: 'Lacivert', limit: 50 },
    });
    basariBekle(lacivertler, 200);

    const lacivertIdler = lacivertlerIdleri(lacivertler.veri<ListeYaniti>());
    expect(lacivertIdler, 'Lacivert filtresi elbiseyi getirmeli').toContain(elbise.productId);
    expect(lacivertIdler, 'Lacivert filtresi gömleği GETİRMEMELİ').not.toContain(gomlek.productId);

    // ── 4. TÜRKÇE ARAMA: aksansız yazım aksanlıyı bulmalı ───────────────
    // ⚠️ Türkçe'de bu bir istisna değil, KURAL: klavyeden "gömlek" yazmak
    //    zahmetli olduğu için kullanıcıların çoğu "gomlek" yazar.
    const aksansiz = await api.get('/v1/products', {
      sorgu: { q: `${marka} gomlek`, limit: 50 },
    });
    basariBekle(aksansiz, 200);

    expect(
      aksansiz.veri<ListeYaniti>().items.map((urun) => urun.id),
      '⚠️ "gomlek" araması "Gömlek" ürününü bulamadı — turkish_unaccent yapılandırması kurulmamış olabilir',
    ).toContain(gomlek.productId);

    // Aksanlı yazım da aynı sonucu vermeli.
    const aksanli = await api.get('/v1/products', { sorgu: { q: `${marka} gömlek`, limit: 50 } });
    basariBekle(aksanli, 200);
    expect(
      aksanli.veri<ListeYaniti>().items.map((urun) => urun.id),
      'Aksanlı yazım da aynı ürünü bulmalı',
    ).toContain(gomlek.productId);

    // ── 5. AUTOCOMPLETE ─────────────────────────────────────────────────
    const oneri = await api.get('/v1/search/suggest', { sorgu: { q: marka.slice(0, 8) } });
    basariBekle(oneri, 200);

    const oneriler = oneri.veri<Array<{ text: string; type: string }>>();
    expect(oneriler.length, 'Autocomplete en az bir öneri dönmeli').toBeGreaterThan(0);
    expect(
      oneriler.some((o) => o.text.includes(marka)),
      'Öneriler bu senaryonun markasını/ürününü içermeli',
    ).toBe(true);
    expect(
      oneriler.every((o) => o.type === 'product' || o.type === 'brand'),
      'Öneri tipi yalnızca product veya brand olabilir',
    ).toBe(true);

    // Tek karakterlik terim şema tarafından reddedilmeli (min 2).
    const cokKisa = await api.get('/v1/search/suggest', { sorgu: { q: 'a' } });
    hataBekle(cokKisa, 'VALIDATION_FAILED', 400);

    // ── 6. YAZIM DÜZELTMESİ (didYouMean) ────────────────────────────────
    // Sonuç dönmeyen ama yakın bir ürüne benzeyen terim.
    const yanlisYazim = await api.get('/v1/products', {
      sorgu: { q: `${marka} gomlekk`, limit: 50 },
    });
    basariBekle(yanlisYazim, 200);

    const yanlisVeri = yanlisYazim.veri<ListeYaniti>();
    if (yanlisVeri.items.length === 0) {
      expect(
        yanlisVeri.didYouMean,
        'Sonuç yokken bir düzeltme önerilmeli (word_similarity > 0.4)',
      ).not.toBeNull();
      expect(yanlisVeri.didYouMean ?? '', 'Öneri gerçek bir ürün başlığı olmalı').toContain(marka);
    }

    // ── 7. Ürün detayı: ham stok DIŞARI SIZMAMALI ───────────────────────
    const detay = await api.get(`/v1/products/${gomlek.slug}`);
    basariBekle(detay, 200);

    const detayVeri = detay.veri<{
      slug: string;
      tryOnable: boolean;
      variants: Array<Record<string, unknown>>;
    }>();

    expect(detayVeri.slug).toBe(gomlek.slug);
    expect(detayVeri.tryOnable, 'tryOnCategory dolu kategoride deneme açık olmalı').toBe(true);

    for (const varyant of detayVeri.variants) {
      // ⚠️ Rakip envanter takibi yapabilir; yalnızca satılabilirlik sinyali
      //    dışarı verilir (catalog.service.ts yorumu).
      expect(Object.keys(varyant), 'Ham stok adedi (onHand) sızmamalı').not.toContain('onHand');
      expect(Object.keys(varyant), 'Rezerve adet sızmamalı').not.toContain('reserved');
      expect(typeof varyant['available'], 'available bayrağı dönmeli').toBe('boolean');
      expect(typeof varyant['lowStock'], 'lowStock bayrağı dönmeli').toBe('boolean');
    }

    // ── 8. Yayında olmayan ürün 404 ─────────────────────────────────────
    const yok = await api.get(`/v1/products/${benzersiz('olmayan')}`);
    hataBekle(yok, 'PRODUCT_NOT_FOUND', 404);

    // ── 9. Bozuk sayfalama imleci anlamlı hata dönmeli ──────────────────
    const bozukImlec = await api.get('/v1/products', { sorgu: { cursor: 'bu-base64-degil!!!' } });
    hataBekle(bozukImlec, 'VALIDATION_FAILED', 400);
  });

  test('arşivlenen ürün vitrinden düşer', async ({ api, ikinciApi, defter }) => {
    // Modül testi ürün durumunu servis üzerinden değiştiriyor; burada
    // sorulan soru KATALOG SORGUSUNUN o durumu gerçekten süzüp süzmediği.
    await yoneticiOlustur(ikinciApi, defter);
    const kategori = await kategoriOlustur(ikinciApi, defter);
    await saticiOlustur(api, ikinciApi, defter);

    const urun = await urunYayinla(api, ikinciApi, { kategoriId: kategori.id });

    const oncesi = await api.get(`/v1/products/${urun.slug}`);
    basariBekle(oncesi, 200);

    const arsivle = await api.post(`/v1/seller/products/${urun.productId}/archive`, {});
    basariBekle(arsivle, 200);

    const sonrasi = await api.get(`/v1/products/${urun.slug}`);
    hataBekle(sonrasi, 'PRODUCT_NOT_FOUND', 404);

    const liste = await api.get('/v1/products', { sorgu: { category: kategori.slug, limit: 50 } });
    basariBekle(liste, 200);
    expect(
      liste.veri<ListeYaniti>().items.map((u) => u.id),
      'Arşivlenen ürün listede kalmamalı',
    ).not.toContain(urun.productId);
  });
});

function lacivertlerIdleri(veri: ListeYaniti): string[] {
  return veri.items.map((urun) => urun.id);
}
