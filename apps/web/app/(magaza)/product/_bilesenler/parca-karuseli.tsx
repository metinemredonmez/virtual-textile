'use client';

import * as React from 'react';
import { AlertTriangle, Ban } from 'lucide-react';
import { mediaUrl } from '@/lib/media';
import { cn } from '@/lib/utils';
import { Fiyat } from '@/components/fiyat/fiyat';
import { UrunGorseli } from '@/components/urun/urun-gorseli';
import type { Parca } from './parca';

/**
 * PARÇA KARUSELİ — "üzerine ne giyeyim".
 *
 * ⚠️ SEÇİM URL'E YAZILMAZ. `router.push`/`replace` App Router'da Sunucu
 *    Bileşenini yeniden çalıştırır; ekran komple yenilenir ve yerel sonuç
 *    önbelleği ile çalışan üretim görünmez olur. Seçim istemci durumudur.
 *
 * ⚠️ ÇAKIŞMA BURADA HESAPLANMAZ. "Elbise + gömlek aynı bölgeyi kaplar" bilgisi
 *    sunucudaki katman tablosunda yaşıyor (@vt/adapters → EXCLUSIVE_SLOTS) ve
 *    `@vt/adapters` tarayıcıya giremez. Kopyalanmış bir kural, sunucudaki tablo
 *    değiştiği gün sessizce ayrışırdı. Sunucu `OUTFIT_LAYER_CONFLICT` döndürür,
 *    burada yalnızca çakışan parça İŞARETLENİR (frontend-mimari.md §6).
 */

export interface ParcaKaruseliProps {
  /** Denenen ürünün kendisi — karuselden çıkarılamaz. */
  taban: Parca;
  adaylar: readonly Parca[];
  /** `null` → yalnız taban ürün deneniyor. */
  seciliVaryantId: string | null;
  onSec: (variantId: string | null) => void;
  cakisanVaryantId: string | null;
}

interface KutuProps {
  parca: Parca;
  secili: boolean;
  cakisiyor: boolean;
  sabit?: boolean;
  onSec?: () => void;
}

function ParcaKutusu({ parca, secili, cakisiyor, sabit, onSec }: KutuProps): React.ReactElement {
  const gorsel = mediaUrl(parca.gorselAnahtari);

  const govde = (
    <>
      <div className="relative aspect-urun w-full overflow-hidden rounded-md bg-urun-zemin">
        {/* ⚠️ Ham `next/image` DEĞİL — gerekçe `components/urun/urun-gorseli.tsx`te. */}
        <UrunGorseli src={gorsel} alt={parca.baslik} sizes="120px" />
        {cakisiyor ? (
          /*
            ⚠️ İKON TEK BAŞINA YETMEZ — bilgi METİNLE de taşınmalı.
               Bindirmenin tek işareti amber bir üçgendi. Lucide SVG'leri
               `aria-hidden="true"` üretiyor (ölçüldü: bu ekrandaki beş ikonun
               beşi de) ve sarmalayan `<button aria-pressed>`in erişilebilir adı
               yalnız başlık + renk + fiyat taşıyor. Yani "bu parça bu kombine
               giremez" bilgisi ekran okuyucuya HİÇ ulaşmıyordu (WCAG 1.1.1) ve
               gören kullanıcıya da yalnız RENK + ŞEKİL ile taşınıyordu
               (WCAG 1.4.1) — renk körü bir kullanıcı amber üçgeni sarı bir
               rozetten ayırt edemez.

               Somut sonucu: kullanıcı çakışan parçayı seçer, "Üzerimde Dene"ye
               basar, sunucudan `OUTFIT_LAYER_CONFLICT` alır ve nedenini ekranda
               bulamaz.

               Metin, düğmenin erişilebilir adına KENDİLİĞİNDEN girer; ayrıca
               `aria-label` yazmak adı ikiye bölerdi. Desen aynı dosyadaki
               `Ban` + "Denenen ürün" ikilisinden alındı — bilgi zaten burada
               biliniyordu, yalnız bu dala uygulanmamıştı.
          */
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-zemin/85 px-1 text-center">
            {/* Renk DURUM taşıyor: bu parça bu kombine giremez. */}
            <AlertTriangle className="size-5 text-uyari" />
            <span className="text-[0.625rem] font-medium leading-tight text-metin">
              Bu kombine giremez
            </span>
          </span>
        ) : null}
      </div>
      <p className="mt-2 line-clamp-1 text-xs font-medium text-metin">{parca.baslik}</p>
      <p className="line-clamp-1 text-xs text-metin-soluk">{parca.renk}</p>
      <Fiyat value={parca.fiyatMinor} className="mt-0.5 text-xs" />
    </>
  );

  const sinif = cn(
    'w-28 shrink-0 rounded-md p-1 text-left',
    secili ? 'ring-2 ring-metin' : 'ring-1 ring-transparent hover:ring-kenar',
  );

  if (sabit) {
    return (
      <div className={sinif} aria-current="true">
        {govde}
        <span className="mt-1 flex items-center gap-1 text-xs text-metin-soluk">
          <Ban className="size-3 text-ikon" />
          Denenen ürün
        </span>
      </div>
    );
  }

  return (
    <button type="button" className={sinif} onClick={onSec} aria-pressed={secili}>
      {govde}
    </button>
  );
}

export function ParcaKaruseli({
  taban,
  adaylar,
  seciliVaryantId,
  onSec,
  cakisanVaryantId,
}: ParcaKaruseliProps): React.ReactElement {
  return (
    <section aria-label="Kombin parçaları">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-metin">Parça değiştir</h2>
        {seciliVaryantId ? (
          <button
            type="button"
            className="text-xs text-vurgu hover:underline"
            onClick={() => onSec(null)}
          >
            Yalnız bu ürünü dene
          </button>
        ) : null}
      </div>

      {/* ⚠️ Yatay kaydırma KENDİ kabında; sayfa gövdesi yatay kaymaz. */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        <ParcaKutusu parca={taban} secili={false} cakisiyor={false} sabit />

        {adaylar.map((aday) => (
          <ParcaKutusu
            key={aday.variantId}
            parca={aday}
            secili={aday.variantId === seciliVaryantId}
            cakisiyor={aday.variantId === cakisanVaryantId}
            onSec={() => onSec(aday.variantId === seciliVaryantId ? null : aday.variantId)}
          />
        ))}
      </div>

      {adaylar.length === 0 ? (
        <p className="text-xs text-metin-soluk">
          Bu ürünle birlikte denenebilecek başka bir parça bulunamadı.
        </p>
      ) : null}
    </section>
  );
}
