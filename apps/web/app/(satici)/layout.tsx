import type { ReactNode } from 'react';
import { Boxes, LineChart, Package } from 'lucide-react';
import { requireRole } from '@/lib/session/guard';

/**
 * ⚠️ BU LİSTEDE `<Link>` YOK, ÇÜNKÜ SAYFA YOK.
 *
 *    `/satici/urunler`, `/satici/siparisler` ve `/satici/finans` rotalarının
 *    dosya sistemi karşılığı bulunmuyor (`find app/(satici) -name page.tsx` →
 *    yalnızca `satici/page.tsx`) ve Next'in ürettiği rota tipinde de yoklar.
 *    Bağlantı olarak durdukları sürece bunlar "basınca 404 veren üç düğme"ydi
 *    — `AGENTS.md` §9'un açıkça yasakladığı şey ("olmayan sayfaya bağlantı
 *    konmaz") ve `/stil-danismani` bağlantısının kaldırılma gerekçesinin
 *    aynısı. O ölçüt bu kabuğa hiç uygulanmamıştı.
 *
 *    Adlar SİLİNMEDİ, yalnız tıklanabilirlikleri silindi: `design-system.md`
 *    boş durumun ne olacağını söylemesini istiyor, ve satıcı panelinin neyi
 *    kapsayacağı bilgisi bu listede duruyor. Ekran yazıldığı gün ilgili satır
 *    `<Link>`e döner; o güne kadar liste ile rota tablosu arasındaki fark
 *    GÖRÜNÜR kalır.
 */
const BOLUMLER = [
  { Ikon: Boxes, ad: 'Ürünler' },
  { Ikon: Package, ad: 'Siparişler' },
  { Ikon: LineChart, ad: 'Finans' },
] as const;

/**
 * SATICI PANELİ — açık tema, TAMAMI korumalı.
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
    <div className="flex min-h-dvh">
      <aside className="w-56 shrink-0 border-r border-kenar p-4">
        <p className="mb-4 text-xs font-medium uppercase tracking-wide text-metin-soluk">
          Satıcı paneli
        </p>

        {/* ⚠️ `<nav>` DEĞİL: içinde gezinilecek bir hedef yok. Ekran okuyucuya
            gezinme bölgesi diye sunmak, boş bir menüye yönlendirmek olurdu. */}
        <ul className="flex flex-col gap-1 text-sm">
          {BOLUMLER.map(({ Ikon, ad }) => (
            <li
              key={ad}
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-metin-soluk"
            >
              {/* ⚠️ Menü ikonları RENKSİZ ve metinden soluk. */}
              <Ikon className="size-4 text-ikon" />
              {ad}
              <span className="ml-auto text-xs text-metin-soluk">yakında</span>
            </li>
          ))}
        </ul>
      </aside>

      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
