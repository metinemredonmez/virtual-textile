'use client';

import * as React from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  TEMA_NITELIGI,
  TEMA_SECENEKLERI,
  TEMA_VARSAYILAN,
  mevcutTema,
  temaUygula,
  type TemaSecimi,
} from '@/lib/tema';

/**
 * TEMA DEĞİŞTİRİCİ — üç durumlu, tek kaynaklı.
 *
 * ⚠️ RENKSİZ. `design-system.md`: renk yalnızca DURUM taşır ve "hangi tema
 *    seçili" bir durum değil bir TERCİHTİR. Seçili öğe `bg-yuzey-vurgulu` ile
 *    işaretleniyor — yan menüdeki seçili satırla AYNI teknik.
 *
 * ⚠️ İKONLAR `text-ikon` DEĞİL: burada ikon dekorasyon değil, düğmenin
 *    ETİKETİDİR (görünür metin yok). AGENTS.md §7'nin "düğme içi ikon düğme
 *    metniyle aynı renkte" istisnası tam olarak bu.
 *
 * ⚠️ `useSyncExternalStore` — ve `useState`+`useEffect` DEĞİL. Doğru değeri
 *    bilen tek yer `<html>`in `data-tema` niteliği ve onu satır içi betik
 *    yazıyor; sunucu HTML'i ise varsayılanı biliyor. `getServerSnapshot`
 *    ayrımı olmadan React hidrasyonda uyuşmazlık uyarısı basar ya da (daha
 *    kötüsü) bir kare boyunca yanlış düğmeyi seçili gösterir.
 */
const ETIKETLER: Record<
  TemaSecimi,
  { metin: string; Ikon: React.ComponentType<{ className?: string }> }
> = {
  acik: { metin: 'Açık tema', Ikon: Sun },
  koyu: { metin: 'Koyu tema', Ikon: Moon },
  sistem: { metin: 'Sistem teması', Ikon: Monitor },
};

/**
 * ⚠️ Abonelik `<html>`in NİTELİK değişimini dinliyor, bir React state'ini
 *    değil. Sebebi somut: temayı değiştiren üçüncü bir yol var — `sistem`
 *    seçiliyken işletim sistemi temasının değişmesi. O olayı satır içi betik
 *    yakalıyor ve yalnızca DOM'u güncelliyor; değiştirici aynı kaynağı
 *    dinlemeseydi kendi işaretini eski bırakırdı.
 */
function abone(bildir: () => void): () => void {
  const gozlemci = new MutationObserver(bildir);
  gozlemci.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [TEMA_NITELIGI],
  });
  return () => gozlemci.disconnect();
}

export function TemaSecici({ className }: { className?: string }): React.ReactElement {
  const secim = React.useSyncExternalStore(abone, mevcutTema, () => TEMA_VARSAYILAN);

  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md border border-kenar p-0.5',
        className,
      )}
    >
      {TEMA_SECENEKLERI.map((deger) => {
        const { metin, Ikon } = ETIKETLER[deger];
        const secili = secim === deger;

        return (
          <button
            key={deger}
            type="button"
            role="radio"
            aria-checked={secili}
            aria-label={metin}
            title={metin}
            onClick={() => temaUygula(deger)}
            className={cn(
              'flex size-7 items-center justify-center rounded-sm',
              secili
                ? 'bg-yuzey-vurgulu text-metin'
                : 'text-metin-soluk hover:bg-yuzey hover:text-metin',
            )}
          >
            <Ikon className="size-4" />
          </button>
        );
      })}
    </div>
  );
}
