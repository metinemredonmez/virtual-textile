'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Banknote,
  BarChart3,
  Boxes,
  ClipboardCheck,
  FolderTree,
  Image as ImageIcon,
  LayoutDashboard,
  Menu,
  Package,
  Percent,
  RotateCcw,
  ScrollText,
  ShieldAlert,
  Store,
  Ticket,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { TemaSecici } from '@/components/tema/tema-secici';

/**
 * PANEL SOL MENÜSÜ — Linear kalıbı. SATICI VE YÖNETİM AYNI BİLEŞENİ KULLANIR.
 *
 * Alınan kararlar (`design-system.md` → "İskelet — Linear"):
 *   • Başlıklı gruplar; grup başlığı küçük, büyük harf, SOLUK.
 *   • Gri ikon + gri metin. Seçili satırda YALNIZCA hafif arka plan —
 *     çerçeve yok, parlak vurgu yok, sol kenar çubuğu yok.
 *   • 36px satır yüksekliği; az öğeyi rahat gösterir.
 *
 * ⚠️ MENÜ İKONLARI RENKSİZ (`text-ikon`, metinden bir ton soluk, çizgi 1.5) ve
 *    seçili satırda da renksiz kalır. Linear'ın asıl inceliği bu: gezinme ikonu
 *    gri, DURUM ikonu renkli. Seçili satırı renklendirmek, tablodaki gerçek
 *    durum rozetleriyle yarışan ikinci bir renk kaynağı üretirdi.
 *
 * ⚠️ TEK BİLEŞEN, İKİ PANEL. Tema artık kullanıcının seçimi ve `<html>`den
 *    geliyor (`lib/tema.ts`); menü yalnızca anlamsal token kullandığı için
 *    (`text-metin-soluk`, `bg-yuzey-vurgulu`) ikisinde de doğru çizilir —
 *    bir dönem "satıcı açık, yönetim koyu" diye sabitti. İki ayrı menü
 *    yazılsaydı ikisi ayrışırdı: bu depoda satıcı menüsü aylarca `<Link>`siz
 *    kaldı, yönetim menüsü bağlantılıydı ve farkı kimse görmedi.
 *
 * ⚠️ KURAL İKİ YÖNLÜ: "olmayan sayfaya bağlantı konmaz" ve "yazılan sayfa
 *    menüde görünür". Bu depoda ikisi de ayrı ayrı yaşandı — bir dönem yedi
 *    panel bağlantısı 404 veriyordu (`AGENTS.md` §10), ve üç kez de sayfa
 *    yazılıp hiçbir yerden çağrılmadı (§9.9). `yol: null` yazan bir satır
 *    tıklanamaz düz metin olarak çıkar; dosyası olan her rota bağlantıdır.
 *
 *    ⚠️ LİSTE ROTA TABLOSUYLA ELLE SENKRON TUTULUYOR ve tek koruması Next'in
 *       üretilmemiş rotayı 404 döndürmesi. Yeni bir panel sayfası ekleyen kişi
 *       ilgili kabuğun `MENU` dizisine de bir satır eklemek zorunda; eklemezse
 *       ekran yazılmış ama ulaşılamaz olur.
 */

/**
 * MENÜ İKONLARI — ADLA TAŞINIR, BİLEŞENLE DEĞİL.
 *
 * ⚠️ BU BİR ÜSLUP TERCİHİ DEĞİL, ÖLÇÜLMÜŞ BİR 500'ÜN KAPISI. `MenuSatiri`
 *    bir dönem `Ikon: LucideIcon` taşıyordu ve menü dizileri SUNUCU
 *    BİLEŞENİ olan kabuklarda (`(satici)/layout.tsx`,
 *    `admin/_kabuk/yan-menu.tsx`) tanımlıydı. Lucide ikonu bir
 *    `forwardRef` NESNESİDİR ve RSC sınırından GEÇEMEZ:
 *
 *      Error: Functions cannot be passed directly to Client Components…
 *        {$$typeof: ..., render: function, displayName: ...}
 *
 *    Sonucu ölçüldü: rolü olan bir oturumla PANELİN 19 ROTASININ 19'U DA
 *    HTTP **500** dönüyordu. `next build` sessizdi, `tsc` sessizdi,
 *    `vitest` yeşildi — arıza yalnızca SELLER_USER/ADMIN rolüne sahip bir
 *    oturumla sayfa gerçekten açıldığında görünüyor ve o oturumu üretecek
 *    kod yolu depoda YOKTU (bkz. `packages/db/scripts/rol-ata.ts`).
 *    "Derleniyor ≠ çalışıyor"un panel karşılığı tam olarak buydu.
 *
 *    Ad bir dizgidir; dizgi her zaman serileşir. Yani kapı artık tipte:
 *    `IKONLAR` tablosunda olmayan bir ad DERLENMEZ.
 */
const IKONLAR = {
  pano: LayoutDashboard,
  siparis: Package,
  iade: RotateCcw,
  finans: Banknote,
  urun: Boxes,
  kupon: Ticket,
  magaza: Store,
  moderasyon: ClipboardCheck,
  uyari: ShieldAlert,
  kategori: FolderTree,
  // ⚠️ `Image` DEĞİL `ImageIcon` diye alındı: `next/image`in varsayılan dışa
  //    aktarımı da `Image` ve bu dosyaya bir gün o da girerse ad çakışırdı.
  gorsel: ImageIcon,
  komisyon: Percent,
  rapor: BarChart3,
  denetim: ScrollText,
} satisfies Record<string, LucideIcon>;

export type IkonAdi = keyof typeof IKONLAR;

export interface MenuSatiri {
  ad: string;
  ikon: IkonAdi;
  /** `null` → sayfa henüz yok; satır tıklanamaz düz metin olur. */
  yol: string | null;
  /** Alt rotaları da bu satırı seçili sayacak mı. */
  altRotalar?: boolean;
}

export interface MenuGrubu {
  /** `null` → başlıksız grup (menünün tepesindeki pano satırı gibi). */
  baslik: string | null;
  satirlar: readonly MenuSatiri[];
}

function seciliMi(pathname: string, satir: MenuSatiri): boolean {
  if (satir.yol === null) return false;
  if (satir.altRotalar) return pathname === satir.yol || pathname.startsWith(`${satir.yol}/`);
  return pathname === satir.yol;
}

export function YanMenu({
  gruplar,
  etiket,
}: {
  gruplar: readonly MenuGrubu[];
  /** `aria-label` — "Yönetim bölümleri" / "Satıcı paneli bölümleri". */
  etiket: string;
}): React.ReactElement {
  const pathname = usePathname();

  return (
    <nav aria-label={etiket} className="flex flex-col gap-5 text-sm">
      {gruplar.map((grup, index) => (
        <div key={grup.baslik ?? `grup-${index}`}>
          {grup.baslik ? (
            <p className="mb-1 px-2 text-xs font-medium uppercase tracking-wide text-metin-soluk">
              {grup.baslik}
            </p>
          ) : null}

          <ul className="flex flex-col gap-0.5">
            {grup.satirlar.map((satir) => {
              const secili = seciliMi(pathname, satir);
              // ⚠️ İkon ADDAN burada çözülüyor — bileşen RSC sınırından
              //    geçmiyor (gerekçe `IKONLAR` başlığında).
              const Ikon = IKONLAR[satir.ikon];

              if (satir.yol === null) {
                return (
                  <li
                    key={satir.ad}
                    className="flex h-9 items-center gap-2 rounded-sm px-2 text-metin-soluk"
                  >
                    <Ikon className="size-4 shrink-0 text-ikon" strokeWidth={1.5} />
                    {satir.ad}
                    <span className="ml-auto text-xs text-metin-soluk">yakında</span>
                  </li>
                );
              }

              return (
                <li key={satir.ad}>
                  <Link
                    href={satir.yol}
                    aria-current={secili ? 'page' : undefined}
                    className={cn(
                      'flex h-9 items-center gap-2 rounded-sm px-2',
                      secili
                        ? 'bg-yuzey-vurgulu text-metin'
                        : 'text-metin-soluk hover:bg-yuzey hover:text-metin',
                    )}
                  >
                    <Ikon className="size-4 shrink-0 text-ikon" strokeWidth={1.5} />
                    {satir.ad}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/**
 * PANEL KABUĞUNUN SOL SÜTUNU — İKİ PANEL İÇİN TEK UYGULAMA.
 *
 * ⚠️ ASIL SEBEP MOBİL TAŞMA, ÖLÇÜLDÜ. İki panel kabuğunda da tek bir duyarlı
 *    ön-ek yoktu (`grep -nE 'sm:|md:|lg:|hidden'` → hiç): `aside` sabit
 *    `w-56 shrink-0` (224px), `main` sabit `p-8` (2×32px). 375px'te içerik
 *    alanına 87px kalıyordu ve `w-72` gibi sabit genişlikli tek bir alan
 *    `document.scrollWidth`i 545'e çıkarıp SAYFANIN TAMAMINI yatay
 *    kaydırılabilir yapıyordu (taşma 170px). Vitrin kabuğu aynı arızayı ölçüp
 *    `hidden sm:inline` ile kapatmıştı; panel kabukları o dersi almamıştı.
 *
 * ⚠️ `Sheet` KULLANILMADI — ama ESKİ GEREKÇESİ ARTIK GEÇERSİZ ve bunu yazmak
 *    önemli. Gerekçe şuydu: `Sheet`/`Dialog` içeriğini `document.body`ye
 *    PORTAL eder, yani `.tema-koyu` kabuğunun DIŞINA, ve yönetim panelinde
 *    açılan ilk çekmece AÇIK temada çizilirdi. Tema sınıfı `<html>`e taşındı
 *    (`lib/tema.ts`), `document.body` zaten onun içinde, o tuzak KAPANDI.
 *    Bugün `Sheet`e geçmemenin sebebi yalnız şu: buradaki açılır menü bir
 *    modal DEĞİL — odak tuzağı istemiyoruz, arkadaki içerik okunabilir kalmalı
 *    ve ESC beklentisi yok. Yani karar artık tema değil ANLAM gerekçesiyle
 *    duruyor.
 *
 * ⚠️ MENÜ `hidden` DEĞİL `hidden md:block`: mobilde gizlenen şey menünün
 *    KENDİSİ değil, VARSAYILAN AÇIKLIĞI. Düğme her zaman orada ve
 *    `aria-expanded` taşıyor; bağlantıların hiçbiri erişilemez hale gelmiyor.
 *
 * ⚠️ Rota değişince menü KAPANIYOR. Kapanmasaydı mobil kullanıcı bir bağlantıya
 *    bastıktan sonra açık menünün altında kalan yeni ekranı göremezdi — ve
 *    "bağlantı çalışmıyor" diye okurdu.
 */
export function YanMenuKabugu({
  baslik,
  gruplar,
  etiket,
}: {
  /** Kabuğun üstündeki bölge adı: "Yönetim", "Satıcı paneli". */
  baslik: string;
  gruplar: readonly MenuGrubu[];
  etiket: string;
}): React.ReactElement {
  const [acik, setAcik] = React.useState(false);
  const kimlik = React.useId();

  return (
    <aside className="shrink-0 border-b border-kenar p-4 md:w-56 md:border-b-0 md:border-r">
      <div className="flex items-center justify-between gap-2">
        <p className="px-2 text-xs font-medium uppercase tracking-wide text-metin-soluk">
          {baslik}
        </p>
        <Button
          type="button"
          variant="sessiz"
          size="sm"
          className="md:hidden"
          aria-expanded={acik}
          aria-controls={kimlik}
          onClick={() => setAcik((onceki) => !onceki)}
        >
          {acik ? (
            <X className="size-4 text-ikon" strokeWidth={1.5} />
          ) : (
            <Menu className="size-4 text-ikon" strokeWidth={1.5} />
          )}
          {acik ? 'Kapat' : 'Menü'}
        </Button>
      </div>

      {/*
        ⚠️ BAĞLANTIYA BASILINCA MENÜ KAPANIYOR (kapsayıcıdaki `onClick`).
           Kapanmasaydı mobil kullanıcı bir bağlantıya bastıktan sonra açık
           menünün altında kalan yeni ekranı göremez ve "bağlantı çalışmıyor"
           diye okurdu. Kapama rota değişimini DİNLEYEREK değil tıklamayla
           yapılıyor: `usePathname` + `useEffect` ile setState, React'in
           "efekt içinde senkron setState" kuralını (ve eslint'i) ihlal ediyor.
           md üstünde menü zaten hep açık, yani bu dal orada hiç çalışmıyor.
      */}
      <div
        id={kimlik}
        className={cn('mt-4', acik ? 'block' : 'hidden md:block')}
        onClick={() => setAcik(false)}
      >
        <YanMenu gruplar={gruplar} etiket={etiket} />

        {/*
          ⚠️ TEMA ANAHTARI PANELDE DE OLMAK ZORUNDA. Yönetim paneli bir dönem
             ZORUNLU koyuydu (`(yonetim)/layout.tsx` üzerindeki `.tema-koyu`);
             o sınıf Portal tuzağını doğurduğu için kaldırıldı ve yerine
             yönetime özel bir varsayılan KONMADI. Anahtar burada olmasaydı
             koyu temayı tercih eden yönetici onu yalnızca vitrinin alt
             bilgisinden seçebilirdi — panelden hiç çıkmayan bir kullanıcı için
             bu, seçeneğin pratikte olmaması demektir.

             ⚠️ Kapsayıcının `onClick`i menüyü kapatıyor, yani mobilde tema
                düğmesine basmak menüyü de kapatır. Bu KABUL EDİLDİ:
                `stopPropagation` "bazı tıklamalar kapatır bazıları kapatmaz"
                diye hatırlanması gereken bir kural doğururdu ve tema seçimi
                zaten tek seferlik.
        */}
        <div className="mt-4 border-t border-kenar px-2 pt-4">
          <TemaSecici />
        </div>
      </div>
    </aside>
  );
}
