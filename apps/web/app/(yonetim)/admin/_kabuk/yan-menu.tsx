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
    satirlar: [{ ad: 'Pano', ikon: 'pano', yol: '/admin' }],
  },
  {
    baslik: 'İnceleme',
    satirlar: [
      { ad: 'Satıcılar', ikon: 'magaza', yol: '/admin/sellers', altRotalar: true },
      { ad: 'Ürün moderasyonu', ikon: 'moderasyon', yol: '/admin/moderation' },
      { ad: 'Siparişler', ikon: 'siparis', yol: '/admin/orders', altRotalar: true },
      { ad: 'Uyarılar', ikon: 'uyari', yol: '/admin/alerts' },
    ],
  },
  {
    baslik: 'Katalog',
    satirlar: [{ ad: 'Kategoriler', ikon: 'kategori', yol: '/admin/categories' }],
  },
  {
    baslik: 'Finans',
    satirlar: [
      { ad: 'Komisyon', ikon: 'komisyon', yol: '/admin/commission', altRotalar: true },
      { ad: 'Payout', ikon: 'finans', yol: '/admin/payout' },
      { ad: 'Raporlar', ikon: 'rapor', yol: '/admin/reports', altRotalar: true },
    ],
  },
  {
    baslik: 'Kayıt',
    satirlar: [{ ad: 'Denetim izi', ikon: 'denetim', yol: '/admin/audit' }],
  },
];
