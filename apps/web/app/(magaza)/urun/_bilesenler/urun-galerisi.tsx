'use client';

import * as React from 'react';
import type { ProductImageWire } from '@vt/contracts';
import { mediaUrl } from '@/lib/media';
import { cn } from '@/lib/utils';
import { UrunGorseli } from '@/components/urun/urun-gorseli';

/**
 * GÖRSEL BLOĞU — ürün detayının üç bloğundan biri.
 *
 * ⚠️ Ürün görselleri GENEL kovadan geliyor ve imza taşımıyor; burada
 *    `next/image` KULLANILIR (try-on sonucunun aksine — o imzalıdır ve
 *    optimize edici ölü bir kopyayı önbelleğe alırdı).
 *
 * ⚠️ Oran 4:5, kenarlık yok, gölge yok. Ürün fotoğrafı zaten renkli; arayüz
 *    çerçeve eklerse ikisi yarışır.
 */

const ACI_ETIKETLERI: Record<string, string> = {
  FRONT: 'Ön',
  BACK: 'Arka',
  SIDE: 'Yan',
  DETAIL: 'Detay',
  MODEL: 'Manken',
  FLATLAY: 'Düz',
};

export interface UrunGalerisiProps {
  gorseller: readonly ProductImageWire[];
  baslik: string;
}

export function UrunGalerisi({ gorseller, baslik }: UrunGalerisiProps): React.ReactElement {
  // `sortOrder` sunucuda uygulanmış olabilir ama garanti değil; birincil öne alınır.
  const sirali = React.useMemo(
    () => [...gorseller].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)),
    [gorseller],
  );

  const [aktifId, setAktifId] = React.useState<string | null>(sirali[0]?.id ?? null);
  const aktif = sirali.find((gorsel) => gorsel.id === aktifId) ?? sirali[0] ?? null;
  const adres = mediaUrl(aktif?.storageKey);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-urun w-full overflow-hidden rounded-lg bg-yuzey">
        {/* ⚠️ Ham `next/image` DEĞİL — kovada olmayan nesne `/_next/image`den
            500 dönüyor ve galeri kırık ikonla doluyordu (ölçüldü). Gerekçe
            `components/urun/urun-gorseli.tsx` başlığında. */}
        <UrunGorseli src={adres} alt={baslik} sizes="(max-width: 1024px) 100vw, 50vw" oncelikli />
      </div>

      {sirali.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto">
          {sirali.map((gorsel) => {
            const kucuk = mediaUrl(gorsel.storageKey);
            if (!kucuk) return null;

            return (
              <button
                key={gorsel.id}
                type="button"
                onClick={() => setAktifId(gorsel.id)}
                aria-pressed={gorsel.id === aktif?.id}
                aria-label={`${ACI_ETIKETLERI[gorsel.angle] ?? gorsel.angle} görsel`}
                className={cn(
                  'relative aspect-urun w-16 shrink-0 overflow-hidden rounded-md bg-yuzey',
                  // ⚠️ Seçili kenarlık RENKSİZ: seçim bir durum değil, gezinmedir.
                  gorsel.id === aktif?.id ? 'ring-2 ring-metin' : 'ring-1 ring-kenar',
                )}
              >
                <UrunGorseli src={kucuk} alt="" sizes="64px" />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
