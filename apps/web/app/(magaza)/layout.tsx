import Link from 'next/link';
import type { ReactNode } from 'react';
import { Layers, ShoppingBag, Shirt, User } from 'lucide-react';

/**
 * MÜŞTERİ VİTRİNİ — açık tema, SSR, SEO açık.
 *
 * ⚠️ Gezinme ikonları RENKSİZ ve metinden BİR TON SOLUK (`text-ikon`). Göz önce
 *    yazıyı okur; ikonu metinden parlak yapmak — çoğu panelin yaptığı —
 *    gürültü üretir ve renk sinyalini harcar. Dördü de Lucide çizgi ikon;
 *    aynı çubukta dolu ve çizgi ikon karıştırılmaz.
 *
 * ⚠️ MOBİLDE ETİKETLER GİZLENİR, BAĞLANTILAR GİZLENMEZ. ÖLÇÜLDÜ: dört metin
 *    bağlantısı 375px'te `document.scrollWidth`i 410'a çıkarıyordu, yani TÜM
 *    SAYFA yatay kaydırılabilir hale geliyor ve `inset-x-0` olan mobil filtre
 *    çekmecesinin sağı kırpılıyordu. Bağlantıyı `hidden` yapmak taşmayı
 *    çözerdi ama mobil kullanıcı ürün listesine gezinmeden ulaşamazdı; bu
 *    yüzden gizlenen şey ETİKET, hedef değil — ikon `aria-label` ile erişilebilir
 *    kalıyor.
 *
 * ⚠️ `/stil-danismani` BAĞLANTISI YOK ve bu bilinçli: o ekran henüz YAZILMADI
 *    (akış vekili `app/api/stylist/.../messages/route.ts` hazır, ekranı yok).
 *    Olmayan sayfaya götüren bir menü girdisi, basınca hata veren bir düğmenin
 *    aynısıdır. Ekran açıldığı gün buraya bir satır eklenir.
 */
export default function MagazaLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-kenar">
        <nav className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-4 px-4">
          <Link href="/" className="shrink-0 text-sm font-semibold tracking-tight">
            Virtual Textile
          </Link>

          <div className="flex items-center gap-4 text-sm sm:gap-6">
            <GezinmeBaglantisi href="/urunler" etiket="Ürünler" Ikon={Shirt} />
            <GezinmeBaglantisi href="/koleksiyon" etiket="Koleksiyonlar" Ikon={Layers} />
            <GezinmeBaglantisi href="/sepet" etiket="Sepet" Ikon={ShoppingBag} />
            <GezinmeBaglantisi href="/hesabim" etiket="Hesabım" Ikon={User} />
          </div>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">{children}</main>

      <footer className="border-t border-kenar py-6 text-center text-xs text-metin-soluk">
        Virtual Textile
      </footer>
    </div>
  );
}

function GezinmeBaglantisi({
  href,
  etiket,
  Ikon,
}: {
  href: string;
  etiket: string;
  Ikon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Link
      href={href}
      // ⚠️ `aria-label` ETİKET GİZLİYKEN de gerekli: mobilde ekran okuyucu
      //    yalnızca ikonu görür ve Lucide SVG'leri `aria-hidden` gelir.
      aria-label={etiket}
      className="flex items-center gap-2 text-metin-soluk hover:text-metin"
    >
      <Ikon className="size-4 shrink-0 text-ikon" />
      <span className="hidden sm:inline">{etiket}</span>
    </Link>
  );
}
