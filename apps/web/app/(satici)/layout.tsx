import type { ReactNode } from 'react';
import { requireRole } from '@/lib/session/guard';
import { YanMenuKabugu, type MenuGrubu } from '@/components/panel/yan-menu';

/**
 * SATICI PANELİ MENÜSÜ.
 *
 * ⚠️ BU LİSTE BİR DÖNEM `<Link>` TAŞIMIYORDU ve haklı olarak taşımıyordu:
 *    sayfalar yoktu, bağlantı olsalardı "basınca 404 veren üç düğme"ydiler
 *    (`AGENTS.md` §9.9 — "olmayan sayfaya bağlantı konmaz"). Sayfalar YAZILDI;
 *    kuralın ikinci yarısı şimdi geçerli: **yazılan sayfa menüde görünür.**
 *    Aksi hâlde bu deponun klasik hatası olurdu — ekran yazıldı, derlendi,
 *    hiçbir yerden çağrılmadı. Altı rotanın altısı da `find` ile doğrulandı.
 *
 * ⚠️ İKON BİLEŞENİ DEĞİL, İKON ADI YAZILIR. Bu dosya bir SUNUCU BİLEŞENİ
 *    (`requireRole` çağırıyor) ve dizi `'use client'` olan kabuğa prop olarak
 *    geçiyor; Lucide ikonu bir `forwardRef` NESNESİ olduğu için RSC sınırından
 *    geçemiyordu ve rolü olan bir oturumda paneldeki HER rota HTTP 500
 *    dönüyordu (ölçüldü). Tablo ve gerekçe: `components/panel/yan-menu.tsx`
 *    → `IKONLAR`.
 *
 * ⚠️ GRUPLAMA YÖNETİM MENÜSÜYLE AYNI MANTIK: satıcının işi olan kuyruklar
 *    ("Satışlar") üstte, katalog altta. İki panelin gezinmesi aynı bileşenden
 *    (`components/panel/yan-menu.tsx`) çizilir; ikisi ayrı yazılsaydı biri
 *    düzeltildiğinde diğeri eski kalırdı — nitekim kaldı.
 */
const MENU: readonly MenuGrubu[] = [
  {
    baslik: null,
    satirlar: [{ ad: 'Pano', ikon: 'pano', yol: '/satici' }],
  },
  {
    baslik: 'Satışlar',
    satirlar: [
      { ad: 'Siparişler', ikon: 'siparis', yol: '/satici/siparisler', altRotalar: true },
      { ad: 'İadeler', ikon: 'iade', yol: '/satici/iadeler', altRotalar: true },
      { ad: 'Finans', ikon: 'finans', yol: '/satici/finans' },
    ],
  },
  {
    baslik: 'Katalog',
    satirlar: [
      { ad: 'Ürünler', ikon: 'urun', yol: '/satici/urunler', altRotalar: true },
      { ad: 'Kuponlar', ikon: 'kupon', yol: '/satici/kuponlar' },
    ],
  },
];

/**
 * SATICI PANELİ — AÇIK TEMA, TAMAMI korumalı.
 *
 * ⚠️ Koyu tema YALNIZCA `(yonetim)` bölgesinde. Buraya `.tema-koyu` konulsaydı
 *    satıcının ürün fotoğrafları — beyaz fonlu, kesim çizgileri ince — koyu
 *    zeminde okunamaz hale gelirdi. Varyant matrisindeki renk kutucukları da
 *    aynı sebeple açık zemin ister.
 *
 * ⚠️ Bu `requireRole` çağrısı ikinci katmandır, güvenliğin kendisi değil: asıl
 *    garanti API guard'larıdır (`auth.guard.ts` varsayılan KAPALI). Burada
 *    yapılan iş, yetkisi olmayan kullanıcıya boş bir panel kabuğu çizmemek.
 *
 * ⚠️ `requireRole` React `cache()` ile sarılı; layout + sayfa + alt bileşenler
 *    aynı istekte `currentUser()` çağırsa bile API'ye TEK sorgu gider.
 */
export default async function SaticiLayout({ children }: { children: ReactNode }) {
  await requireRole(['SELLER_USER', 'ADMIN']);

  return (
    /*
      ⚠️ MOBİLDE SÜTUN, md'DEN İTİBAREN SATIR — yönetim kabuğuyla AYNI kalıp ve
         aynı ölçülmüş sebep: sabit `w-56` yan sütun + `p-8` içerik, 375px'te
         içerik alanını 87px'e indiriyor ve sabit genişlikli tek bir alan
         SAYFANIN TAMAMINI yatay kaydırtıyordu. Gerekçenin tamamı
         `panel/yan-menu.tsx` → `YanMenuKabugu` başlığında; iki kabuk aynı
         bileşeni çağırıyor ki biri düzeltilip diğeri eski kalmasın.
    */
    <div className="flex min-h-dvh flex-col md:flex-row">
      <YanMenuKabugu baslik="Satıcı paneli" gruplar={MENU} etiket="Satıcı paneli bölümleri" />

      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
