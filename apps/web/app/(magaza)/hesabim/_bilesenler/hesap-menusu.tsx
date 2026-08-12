'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutGrid, Package, Shield, ShieldCheck, Shirt } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * HESAP MENÜSÜ.
 *
 * ⚠️ İKONLAR RENKSİZ (`text-ikon`) ve metinden bir ton soluk. Seçili öğe de
 *    RENKLE değil, KOYULUKLA işaretlenir: renk yalnızca durum taşır ve menüde
 *    gösterilecek bir durum yok. Renkli bir sekme, gerçek durum rozetlerinin
 *    (sipariş durumu, rıza durumu) sinyalini harcar.
 *
 * ⚠️ İstemci Bileşeni olmasının TEK sebebi `usePathname`. Menü verisi ve
 *    kullanıcı bilgisi buraya prop olarak GEÇMEZ; geçseydi hesap bilgisi
 *    gereksiz yere RSC yüküne binerdi.
 */
const MENU = [
  { href: '/hesabim', etiket: 'Genel bakış', Ikon: LayoutGrid },
  { href: '/hesabim/siparisler', etiket: 'Siparişlerim', Ikon: Package },
  { href: '/hesabim/gardirop', etiket: 'Gardırobum', Ikon: Shirt },
  { href: '/hesabim/guvenlik', etiket: 'Güvenlik', Ikon: Shield },
  { href: '/hesabim/gizlilik', etiket: 'Gizlilik ve verilerim', Ikon: ShieldCheck },
] as const;

export function HesapMenusu(): React.ReactElement {
  const yol = usePathname();

  return (
    <nav className="flex flex-col gap-1 text-sm">
      {MENU.map(({ href, etiket, Ikon }) => {
        /**
         * ⚠️ `startsWith` yalnızca ALT SAYFASI OLAN girişler için doğru
         *    (`/hesabim/siparisler/VT-…`). Kök `/hesabim` için kullanılsaydı
         *    bütün alt sayfalarda "Genel bakış" da seçili görünürdü.
         */
        const secili = href === '/hesabim' ? yol === href : yol.startsWith(href);

        return (
          <Link
            key={href}
            href={href}
            aria-current={secili ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2 rounded-sm px-2 py-1.5',
              secili
                ? 'bg-yuzey-vurgulu font-medium text-metin'
                : 'text-metin-soluk hover:bg-yuzey-vurgulu hover:text-metin',
            )}
          >
            <Ikon className="size-4 text-ikon" />
            {etiket}
          </Link>
        );
      })}
    </nav>
  );
}
