import { describe, expect, it } from 'vitest';
import {
  apiSorgusu,
  KULLANILABILIR_SIRALAMALAR,
  listeBaglantisi,
  sorguyuOku,
} from './liste-sorgusu';

/**
 * URL AYRIŞTIRMA — kırılırsa sonucu "sayfanın tamamı hata sınırına düşer".
 *
 * ⚠️ Bu dosyanın koruduğu şey bir tarama botunun ya da adres çubuğuna bir şey
 *    yazan kullanıcının siteyi 400/500'e düşürememesi. Ölçülen davranış:
 *    `GET /v1/products?sort=xxx` → 400 VALIDATION_FAILED.
 */
describe('sorguyuOku', () => {
  it('tanınmayan sıralama SESSİZCE varsayılana düşer, hata üretmez', () => {
    expect(sorguyuOku({ sirala: 'xxx' }).sirala).toBe('relevance');
  });

  it('bozuk sıralama listesi boşaldığı için `newest` artık kabul ediliyor', () => {
    // Geri açma koşulu ölçüldü: GET /v1/products?sort=newest&limit=1 → 200.
    expect(KULLANILABILIR_SIRALAMALAR).toContain('newest');
    expect(sorguyuOku({ sirala: 'newest' }).sirala).toBe('newest');
  });

  it('geçersiz imleç ATILIR, KIRPILMAZ — kırpmak geçerli imleci bozardı', () => {
    expect(sorguyuOku({ imlec: 'a'.repeat(501) }).imlec).toBeNull();
    expect(sorguyuOku({ imlec: 'ge çersiz' }).imlec).toBeNull();
    expect(sorguyuOku({ imlec: 'eyJpZCI6Ing' }).imlec).toBe('eyJpZCI6Ing');
  });

  it('slug olmayan kategori düşer', () => {
    expect(sorguyuOku({ kategori: 'Kadın Giyim' }).kategori).toBeNull();
    expect(sorguyuOku({ kategori: 'kadin-giyim' }).kategori).toBe('kadin-giyim');
  });

  it('fiyat yalnızca TAM TL kabul eder', () => {
    expect(sorguyuOku({ minFiyat: '1500' }).minFiyat).toBe('1500');
    expect(sorguyuOku({ minFiyat: '15,00' }).minFiyat).toBeNull();
  });

  it('yinelenen faset değerleri tekilleşir', () => {
    expect(sorguyuOku({ renk: ['Siyah', 'Siyah', 'Bej'] }).renk).toEqual(['Siyah', 'Bej']);
  });

  it('`sabitKategori` sorgu dizesindeki kategoriyi EZER', () => {
    const sorgu = sorguyuOku({ kategori: 'baska' }, { sabitKategori: 'gomlek' });
    expect(sorgu.kategori).toBe('gomlek');
  });
});

describe('apiSorgusu', () => {
  it('TL → kuruş dönüşümü ÇARPMA DEĞİL dizgi ekidir', () => {
    // ⚠️ `Number(tl) * 100` hem kayan nokta hatası üretir hem de lint'in para
    //    korumasını görünmez kılar.
    const cikti = apiSorgusu(sorguyuOku({ minFiyat: '999999999' }));
    expect(cikti.minPriceMinor).toBe('99999999900');
  });

  it('filtre yoksa alan GÖNDERİLMEZ (undefined)', () => {
    const cikti = apiSorgusu(sorguyuOku({}));
    expect(cikti.minPriceMinor).toBeUndefined();
    expect(cikti.brand).toBeUndefined();
    expect(cikti.inStockOnly).toBeUndefined();
  });
});

describe('listeBaglantisi', () => {
  it('İMLEÇ açıkça verilmedikçe DÜŞER — sıralama değişiminde 500 üretiyordu', () => {
    const sorgu = sorguyuOku({ imlec: 'eyJpZCI6Ing', q: 'gomlek' });
    expect(listeBaglantisi('/products', sorgu, { sirala: 'price_asc' })).toBe(
      '/products?q=gomlek&sirala=price_asc',
    );
  });

  it('imleç açıkça verilirse taşınır', () => {
    const sorgu = sorguyuOku({ q: 'gomlek' });
    expect(listeBaglantisi('/products', sorgu, { imlec: 'ABC' })).toBe(
      '/products?q=gomlek&imlec=ABC',
    );
  });

  it('varsayılan sıralama URL’e YAZILMAZ — aynı liste tek adresle paylaşılsın', () => {
    expect(listeBaglantisi('/products', sorguyuOku({}))).toBe('/products');
  });

  it('`ara` ASLA taşınmaz — her tıklama bir LLM çağrısı olurdu', () => {
    const sorgu = sorguyuOku({ ara: 'yazlık keten bir şey' });
    expect(listeBaglantisi('/products', sorgu)).toBe('/products');
  });

  it('`sabitKategori` rotasında kategori sorgu dizesine yazılmaz', () => {
    const sorgu = sorguyuOku({}, { sabitKategori: 'gomlek' });
    expect(listeBaglantisi('/category/gomlek', sorgu, {}, { sabitKategori: 'gomlek' })).toBe(
      '/category/gomlek',
    );
  });
});
