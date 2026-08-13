'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/**
 * VİTRİN GEZİNME BAĞLANTISI.
 *
 * ⚠️ `select-none` — VARLIK SEBEBİ BİR KULLANICI ŞİKAYETİ. Bağlantıya
 *    tıklandığında (özellikle hafif sürüklenirse ya da çift tıklanırsa) tarayıcı
 *    metni SEÇİYORDU: "Ürünler" yazısı mavi bir kutunun içinde kalıyor ve
 *    gezinme öğesi bir düğme gibi değil, kopyalanabilir bir metin gibi
 *    davranıyordu. Dokunmatik ekranda daha kötü: basılı tutmak seçim tutamacı
 *    açıyor.
 *
 *    ⚠️ `select-none` YALNIZCA gezinme öğelerine uygulanır. Sayfa içeriğine
 *       (ürün adı, fiyat, sipariş numarası) uygulanmaz — kullanıcı sipariş
 *       numarasını kopyalayabilmelidir.
 *
 * ⚠️ AKTİF SAYFA — bu yüzden İSTEMCİ BİLEŞENİ.
 *    Gezinme, hangi sayfada olunduğunu göstermezse kullanıcı konumunu
 *    yalnızca adres çubuğundan anlar. `usePathname` istemci tarafı gerektiriyor;
 *    bedeli yalnızca bu küçük bileşenin paketlenmesi, düzenin tamamı SUNUCU
 *    BİLEŞENİ olarak kalıyor.
 *
 * ⚠️ AKTİF DURUM RENKLE DEĞİL KONTRASTLA gösterilir. `design-system.md`:
 *    "renk yalnızca DURUM taşır" — ve orada kastedilen sipariş durumu, stok
 *    uyarısı gibi İŞ durumlarıdır. Gezinmede bulunulan sayfa bir iş durumu
 *    değildir; vurgu rengi harcanırsa ekrandaki gerçek durum sinyalleri
 *    zayıflar. Bu yüzden aktif bağlantı yalnızca tam kontrasta çıkar
 *    (`text-metin`), pasif olanlar solukta kalır.
 *
 * ⚠️ `aria-current="page"` — görsel kontrast farkı ekran okuyucuya ULAŞMAZ.
 *    Renk/ağırlık farkı görmeyen kullanıcı için tek sinyal budur.
 */
export function GezinmeBaglantisi({
  href,
  etiket,
  ikon,
}: {
  href: string;
  etiket: string;
  /**
   * ⚠️ HAZIR DÜĞÜM, bileşen TİPİ DEĞİL. Bir dönem `Ikon: React.ComponentType`
   *    idi ve derleme şu hatayla düştü: "Functions cannot be passed directly to
   *    Client Components". Sunucu Bileşeni sınırından FONKSİYON geçemez;
   *    çizilmiş bir `ReactNode` geçer. İkon bu yüzden çağıran tarafta üretilir.
   */
  ikon: React.ReactNode;
}) {
  /**
   * ⚠️ `usePathname` STATİK ÖN-RENDER SIRASINDA `null` DÖNER — tipi `string`
   *    demesine rağmen. Ölçüldü: koruma olmadan `next build` şu hatayla düştü:
   *    "Error occurred prerendering page /_not-found". `/_not-found` statik
   *    üretilen bir sayfa ve orada henüz bir yol yoktur.
   *
   *    Tip yalan söylediği için derleyici bunu yakalamadı; yalnızca derleme
   *    çıktısı gösterdi. Bu yüzden karşılaştırma null-güvenli yazılır.
   */
  const pathname = usePathname() as string | null;

  /**
   * ⚠️ Alt sayfalar da AKTİF sayılır: `/products/keten-gomlek` üzerindeyken
   *    "Ürünler" sönük durmamalı. Ama `startsWith` tek başına YANLIŞ EŞLEŞİR —
   *    `/product` öneki `/products`e de uyar ve ürün detayındayken iki gezinme
   *    öğesi birden aktif görünürdü. Bu yüzden ya tam eşleşme ya da ardından
   *    `/` gelmesi aranıyor.
   */
  const aktif = pathname === href || (pathname?.startsWith(`${href}/`) ?? false);

  return (
    <Link
      href={href}
      // ⚠️ `aria-label` ETİKET GİZLİYKEN de gerekli: mobilde ekran okuyucu
      //    yalnızca ikonu görür ve Lucide SVG'leri `aria-hidden` gelir.
      aria-label={etiket}
      aria-current={aktif ? 'page' : undefined}
      className={cn(
        // ⚠️ Dikey dolgu DOKUNMA HEDEFİ için: metin yüksekliği tek başına
        //    ~20px kalıyordu, WCAG 2.5.8 asgari 24px istiyor. `-mx-2` ile
        //    dolgu yalnızca tıklanabilir alanı büyütür, hizayı bozmaz.
        'flex select-none items-center gap-2 rounded-md px-2 py-2 -mx-2',
        'transition-colors',
        aktif ? 'text-metin' : 'text-metin-soluk hover:text-metin',
      )}
    >
      {/* ⚠️ İkon metinden bir ton SOLUK kalır (design-system.md → İkonlar).
          Aktif durumda bile: göz önce yazıyı okur, ikon tanımaya yardım eder. */}
      {ikon}
      <span className="hidden sm:inline">{etiket}</span>
    </Link>
  );
}
