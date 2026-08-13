import { describe, expect, it } from 'vitest';
import { imlecYolu, sorguyuOku, suzgecYolu } from './sorgu';

/**
 * ⚠️ BU DOSYA VAR OLMAK ZORUNDA. Satıcı sipariş ekranı bir SELLER_USER oturumu
 *    olmadan uçtan uca ölçülemedi (rapordaki ölçüm bölümü); geriye kalan tek
 *    otomatik kanıt, ekranın saf çekirdeğinin sınanması. Buradaki üç şey —
 *    süzgeç ayıklama, imleç taşıma ve SLA yakınlığı — sessizce yanlış olduğunda
 *    ekran ÇALIŞIYOR görünür: liste dolu gelir ama yanlış siparişleri gösterir.
 */

describe('sorguyuOku', () => {
  it('bilinmeyen durumu düşürür', () => {
    // ⚠️ Süzülmeseydi sorgu API'ye giderdi ve satıcı, düzeltemeyeceği bir
    //    doğrulama hatası ekranı görürdü.
    expect(sorguyuOku({ durum: 'YOK_BOYLE' }).durum).toBeNull();
    expect(sorguyuOku({ durum: 'PREPARING' }).durum).toBe('PREPARING');
  });

  it('gecikmis yalnızca "1" iken açılır', () => {
    // ⚠️ Sunucu tarafında `z.coerce.boolean()` var: boş olmayan HER string
    //    true'dur, `'0'` dâhil. Bu yüzden karar burada veriliyor ve tek bir
    //    değere bağlı.
    expect(sorguyuOku({ gecikmis: '1' }).gecikmis).toBe(true);
    expect(sorguyuOku({ gecikmis: '0' }).gecikmis).toBe(false);
    expect(sorguyuOku({}).gecikmis).toBe(false);
  });

  it('sipariş numarasının boşluklarını kırpar, boşu null yapar', () => {
    // Sunucu TAM EŞLEŞME arıyor; kopyala-yapıştır bir boşlukla gelirse
    // satıcı hiçbir sonuç bulamazdı.
    expect(sorguyuOku({ siparisNo: '  VT-260811-0042 ' }).siparisNo).toBe('VT-260811-0042');
    expect(sorguyuOku({ siparisNo: '   ' }).siparisNo).toBeNull();
  });
});

describe('suzgecYolu', () => {
  it('süzgeç değişince imleci TAŞIMAZ', () => {
    // ⚠️ Taşınsaydı satıcı yeni süzgecin ilk sayfasını değil, eski süzgecin
    //    ortasından devam eden anlamsız bir sayfa görürdü.
    const sorgu = sorguyuOku({ durum: 'PREPARING', imlec: 'abc' });
    expect(suzgecYolu(sorgu, { durum: 'SHIPPED' })).toBe('/seller/orders?durum=SHIPPED');
  });

  it('süzgeçsiz yol sorgu dizesi taşımaz', () => {
    expect(suzgecYolu(sorguyuOku({}), {})).toBe('/seller/orders');
  });

  it('sipariş numarası aramasını korur', () => {
    const sorgu = sorguyuOku({ siparisNo: 'VT-1' });
    expect(suzgecYolu(sorgu, { durum: 'SHIPPED' })).toBe(
      '/seller/orders?durum=SHIPPED&siparisNo=VT-1',
    );
  });
});

describe('imlecYolu', () => {
  it('süzgeçleri koruyarak imleç ekler', () => {
    const sorgu = sorguyuOku({ durum: 'PREPARING' });
    expect(imlecYolu(sorgu, 'im/leç')).toBe('/seller/orders?durum=PREPARING&imlec=im%2Fle%C3%A7');
  });

  it('süzgeç yokken ayracı ? olarak kurar', () => {
    expect(imlecYolu(sorguyuOku({}), 'abc')).toBe('/seller/orders?imlec=abc');
  });
});
