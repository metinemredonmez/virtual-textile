import type { MenuGrubu } from '@/components/panel/yan-menu';

/**
 * YÖNETİM MENÜSÜNÜN İÇERİĞİ — Linear kalıbı, başlıklı gruplar.
 *
 * ⚠️ İKON BİLEŞENİ DEĞİL, İKON ADI YAZILIR. Bu dosya bir SUNUCU modülü ve
 *    dizi `'use client'` olan `YanMenu`ya prop olarak geçiyor; Lucide ikonu bir
 *    `forwardRef` NESNESİ olduğu için RSC sınırından geçemiyor ve paneldeki
 *    HER rota HTTP 500 dönüyordu (ölçüldü). Gerekçenin tamamı ve tablonun
 *    kendisi `components/panel/yan-menu.tsx` → `IKONLAR`.
 *
 * ⚠️ ÇİZİM BURADA DEĞİL: `components/panel/yan-menu.tsx`. İki panel AYNI
 *    bileşeni kullanıyor; bu dosyada yalnızca hangi satırların olduğu yazılı.
 *    Bir dönem iki ayrı menü uygulaması vardı ve fark somuttu — yönetim menüsü
 *    bağlantılıydı, satıcı menüsü aylarca düz metindi ve kimse eşitlemedi.
 *
 * ⚠️ LİSTE ROTA TABLOSUYLA ELLE SENKRON. Yeni bir `yonetim/<ad>/page.tsx`
 *    ekleyen kişi buraya da bir satır eklemek zorunda; eklemezse ekran yazılmış
 *    ama ulaşılamaz olur (bu depoda üç kez yaşandı). Tersi de geçerli:
 *    `yol: null` yazan satır tıklanamaz düz metin çıkar — olmayan sayfaya
 *    bağlantı konmaz.
 */
export const YONETIM_MENUSU: readonly MenuGrubu[] = [
  {
    baslik: null,
    satirlar: [{ ad: 'Pano', ikon: 'pano', yol: '/yonetim' }],
  },
  {
    baslik: 'İnceleme',
    satirlar: [
      { ad: 'Satıcılar', ikon: 'magaza', yol: '/yonetim/saticilar', altRotalar: true },
      { ad: 'Ürün moderasyonu', ikon: 'moderasyon', yol: '/yonetim/moderasyon' },
      { ad: 'Siparişler', ikon: 'siparis', yol: '/yonetim/siparisler', altRotalar: true },
      { ad: 'Uyarılar', ikon: 'uyari', yol: '/yonetim/uyarilar' },
    ],
  },
  {
    baslik: 'Katalog',
    satirlar: [{ ad: 'Kategoriler', ikon: 'kategori', yol: '/yonetim/kategoriler' }],
  },
  {
    baslik: 'Finans',
    satirlar: [
      { ad: 'Komisyon', ikon: 'komisyon', yol: '/yonetim/komisyon', altRotalar: true },
      { ad: 'Payout', ikon: 'finans', yol: '/yonetim/payout' },
      { ad: 'Raporlar', ikon: 'rapor', yol: '/yonetim/raporlar', altRotalar: true },
    ],
  },
  {
    baslik: 'Kayıt',
    satirlar: [{ ad: 'Denetim izi', ikon: 'denetim', yol: '/yonetim/denetim' }],
  },
];
