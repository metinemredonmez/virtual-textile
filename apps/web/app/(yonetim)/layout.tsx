import type { ReactNode } from 'react';
import { BadgeCheck, Banknote, BarChart3, Percent } from 'lucide-react';
import { requireRole } from '@/lib/session/guard';

/**
 * ⚠️ BU LİSTEDE `<Link>` YOK, ÇÜNKÜ SAYFA YOK. Gerekçenin tamamı
 *    `app/(satici)/layout.tsx` başındaki yorumda; aynı hata iki kabukta da
 *    vardı ve iki kabukta da aynı şekilde kapatıldı.
 *
 *    `/yonetim/saticilar`, `/yonetim/komisyon`, `/yonetim/payout`,
 *    `/yonetim/raporlar` — dördünün de dosya sistemi karşılığı yok
 *    (`find app/(yonetim) -name page.tsx` → yalnızca `yonetim/page.tsx`).
 */
const BOLUMLER = [
  { Ikon: BadgeCheck, ad: 'Satıcılar' },
  { Ikon: Percent, ad: 'Komisyon' },
  { Ikon: Banknote, ad: 'Payout' },
  { Ikon: BarChart3, ad: 'Raporlar' },
] as const;

/**
 * YÖNETİM PANELİ — KOYU TEMA, TAMAMI korumalı.
 *
 * ⚠️ Koyu tema `.tema-koyu` sınıfıyla YALNIZCA burada açılır, `<html>` üzerinde
 *    değil. Kök düzeyde açılsaydı vitrin de koyulaşır ve beyaz fonlu ürün
 *    fotoğraflarının kesim çizgileri kaybolurdu.
 *
 * ⚠️ Rol Redis'ten değil, her istekte `GET /auth/me`den okunur: yetkisi iptal
 *    edilen bir yönetici 30 gün boyunca paneli görmeye devam ederdi.
 */
export default async function YonetimLayout({ children }: { children: ReactNode }) {
  await requireRole(['ADMIN']);

  return (
    <div className="tema-koyu flex min-h-dvh bg-zemin text-metin">
      <aside className="w-56 shrink-0 border-r border-kenar p-4">
        <p className="mb-4 text-xs font-medium uppercase tracking-wide text-metin-soluk">Yönetim</p>

        {/* ⚠️ `<nav>` DEĞİL: içinde gezinilecek bir hedef yok. */}
        <ul className="flex flex-col gap-1 text-sm">
          {BOLUMLER.map(({ Ikon, ad }) => (
            <li
              key={ad}
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-metin-soluk"
            >
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
