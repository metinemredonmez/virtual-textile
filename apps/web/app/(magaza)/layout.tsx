import type { ReactNode } from 'react';
import { AltBilgi } from '@/components/vitrin/alt-bilgi';
import { UstCubuk } from '@/components/gezinme/ust-cubuk';

/**
 * MÜŞTERİ VİTRİNİ — SSR, SEO açık.
 *
 * ⚠️ ÜST ÇUBUK BU DOSYADAN ÇIKARILDI (`components/gezinme/ust-cubuk.tsx`).
 *    Gerekçe: çubuk artık veri okuyor (kategori ağacı + oturum) ve düzen
 *    dosyasının içinde duran bir `fetch`, bu deponun ölçtüğü bir tuzağa
 *    yakındır — düzen her sayfada koşar, oradaki her gecikme TÜM SİTEYE
 *    yazılır. Ayrı dosya, gerekçeleri de yanına taşıyor.
 *
 * ⚠️ "AÇIK TEMA" ARTIK BURADA YAZMIYOR: tema kullanıcının seçimi ve site
 *    genelinde geçerli (`lib/tema.ts`). Vitrinin açık kalma gerekçesi ürün
 *    fotoğrafının beyaz fonuydu; o itiraz arayüze değil FOTOĞRAFA aitti ve
 *    `--urun-zemin` tokenıyla karşılandı.
 */
export default function MagazaLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <UstCubuk />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">{children}</main>

      <AltBilgi />
    </div>
  );
}
