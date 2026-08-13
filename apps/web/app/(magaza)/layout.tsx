import Link from 'next/link';
import type { ReactNode } from 'react';
import { Layers, ShoppingBag, Shirt, Sparkles, User } from 'lucide-react';
import { TemaSecici } from '@/components/tema/tema-secici';

/**
 * MÜŞTERİ VİTRİNİ — SSR, SEO açık.
 *
 * ⚠️ "AÇIK TEMA" ARTIK BURADA YAZMIYOR: tema kullanıcının seçimi ve site
 *    genelinde geçerli (`lib/tema.ts`). Vitrinin açık kalma gerekçesi
 *    ürün fotoğrafının beyaz fonuydu; o itiraz arayüze değil FOTOĞRAFA aitti
 *    ve `--urun-zemin` tokenıyla karşılandı — fotoğraf çerçevesi iki temada da
 *    beyaza yakın kalıyor, kesim çizgileri kaybolmuyor.
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
 * ⚠️ `/stylist` BAĞLANTISI ARTIK VAR. Bir dönem BİLEREK yoktu: ekran
 *    yazılmamıştı (akış vekili hazırdı, çağıranı yoktu) ve olmayan sayfaya
 *    götüren bir menü girdisi basınca hata veren bir düğmedir. Ekran yazıldı;
 *    kuralın ikinci yarısı şimdi geçerli — **yazılan sayfa menüde görünür.**
 *    ⚠️ Vitrin gezinmesi `panel/yan-menu.test.ts`in kapsamında DEĞİL
 *    (bağlantılar burada dizide değil, düz JSX'te); bu kural el ile uygulanıyor.
 *
 * ⚠️ Danışman GİRİŞİN ARKASINDA (uçların hiçbiri `@Public()` değil, kota
 *    kullanıcı başına) ama bağlantı yine de herkese gösteriliyor: sayfa kendi
 *    kapısını taşıyor ve oturumsuz ziyaretçiyi `?next=` ile girişe atıyor.
 *    Bağlantıyı gizlemek, özelliğin varlığını henüz üye olmamış ziyaretçiden
 *    saklamak olurdu — oysa üye olmasının sebeplerinden biri bu.
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
            <GezinmeBaglantisi href="/products" etiket="Ürünler" Ikon={Shirt} />
            <GezinmeBaglantisi href="/collection" etiket="Koleksiyonlar" Ikon={Layers} />
            <GezinmeBaglantisi href="/stylist" etiket="Danışman" Ikon={Sparkles} />
            <GezinmeBaglantisi href="/cart" etiket="Sepet" Ikon={ShoppingBag} />
            <GezinmeBaglantisi href="/account" etiket="Hesabım" Ikon={User} />
          </div>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">{children}</main>

      {/*
        ⚠️ TEMA ANAHTARI ALT BİLGİDE, GEZİNME ÇUBUĞUNDA DEĞİL. Çubuk 375px'te
           zaten ölçülmüş bir taşma sorunu yaşadı (etiketler `hidden sm:inline`
           tam bu yüzden); altıncı bir hedef aynı arızayı geri getirirdi. Tema
           bir gezinme hedefi de değil — tek seferlik bir tercihtir.
      */}
      <footer className="flex items-center justify-center gap-4 border-t border-kenar py-6 text-center text-xs text-metin-soluk">
        <span>Virtual Textile</span>
        <TemaSecici />
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
