'use client';

import * as React from 'react';
import Link from 'next/link';
import type { ProductVariantWire, SizeChartWire } from '@vt/contracts';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Fiyat } from '@/components/fiyat/fiyat';
import { BedenOnerisi } from './beden-onerisi';
import { SepeteEkle } from '@/components/urun/sepete-ekle';

/**
 * EYLEM BLOĞU — ürün detayının üç bloğundan biri.
 *
 * ⚠️ "ÜZERİMDE DENE" DÜĞMESİ, KATEGORİ DESTEKLENMİYORSA HİÇ ÇİZİLMEZ —
 *    devre dışı da çizilmez, gri de çizilmez. Basılınca hata veren bir düğme,
 *    olmayan bir düğmeden kötüdür: kullanıcı denemeyi bekler, hata alır ve
 *    ürüne olan güveni değil platforma olan güveni azalır. Kapının iki yarısı
 *    (ürün bayrağı + sağlayıcı yeteneği) SUNUCU BİLEŞENİNDE kapanır; buraya
 *    yalnızca sonucu (`denemeYolu`) geliyor.
 *
 * ⚠️ "Üzerimde Dene" ile "Sepete Ekle" AYNI ağırlıkta: ikisi de `birincil`,
 *    ikisi de `lg`, ikisi de tam genişlik.
 */

export interface UrunEylemleriProps {
  varyantlar: readonly ProductVariantWire[];
  sizeChart: SizeChartWire | null;
  girisYapildi: boolean;
  /** ⚠️ `null` → deneme kapalı, düğme HİÇ oluşmaz. */
  denemeYolu: string | null;
}

export function UrunEylemleri({
  varyantlar,
  sizeChart,
  girisYapildi,
  denemeYolu,
}: UrunEylemleriProps): React.ReactElement {
  const renkler = React.useMemo(
    () => [...new Set(varyantlar.map((varyant) => varyant.color))],
    [varyantlar],
  );

  const [renk, setRenk] = React.useState<string>(() => renkler[0] ?? '');

  const renginVaryantlari = React.useMemo(
    () => varyantlar.filter((varyant) => varyant.color === renk),
    [varyantlar, renk],
  );

  const [varyantId, setVaryantId] = React.useState<string | null>(
    () => varyantlar.find((varyant) => varyant.available)?.id ?? varyantlar[0]?.id ?? null,
  );

  const secili =
    renginVaryantlari.find((varyant) => varyant.id === varyantId) ?? renginVaryantlari[0] ?? null;

  function rengiDegistir(yeniRenk: string): void {
    setRenk(yeniRenk);
    // Beden seçimi renkle birlikte taşınır: aynı beden yeni renkte varsa korunur.
    const ayniBeden = varyantlar.find(
      (varyant) => varyant.color === yeniRenk && varyant.size === secili?.size,
    );
    const ilkUygun = varyantlar.find((varyant) => varyant.color === yeniRenk && varyant.available);
    setVaryantId(ayniBeden?.id ?? ilkUygun?.id ?? null);
  }

  return (
    <div className="flex flex-col gap-6">
      {secili ? (
        <div className="flex items-center gap-3">
          <Fiyat value={secili.priceMinor} listValue={secili.listPriceMinor} className="text-lg" />
          {/* Renk BURADA durum taşıyor: stok bir uyarıdır. */}
          {!secili.available ? (
            <Badge durum="tehlike">Tükendi</Badge>
          ) : secili.lowStock ? (
            <Badge durum="uyari">Son birkaç adet</Badge>
          ) : null}
        </div>
      ) : null}

      {renkler.length > 1 ? (
        <fieldset>
          <legend className="text-sm font-medium text-metin">Renk</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {renkler.map((secenek) => (
              <button
                key={secenek}
                type="button"
                onClick={() => rengiDegistir(secenek)}
                aria-pressed={secenek === renk}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-sm',
                  secenek === renk
                    ? 'border-metin text-metin'
                    : 'border-kenar text-metin-soluk hover:border-metin',
                )}
              >
                {secenek}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

      <fieldset>
        <legend className="text-sm font-medium text-metin">Beden</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {renginVaryantlari.map((varyant) => (
            <button
              key={varyant.id}
              type="button"
              onClick={() => setVaryantId(varyant.id)}
              aria-pressed={varyant.id === secili?.id}
              // ⚠️ Satılamayan beden gizlenmez, ERİŞİLEMEZ yapılır: kullanıcı
              //    bedenin var olduğunu ama bugün alınamadığını bilmeli.
              disabled={!varyant.available}
              className={cn(
                'rakam min-w-12 rounded-md border px-3 py-1.5 text-sm',
                varyant.id === secili?.id
                  ? 'border-metin text-metin'
                  : 'border-kenar text-metin-soluk hover:border-metin',
                !varyant.available && 'cursor-not-allowed line-through opacity-40',
              )}
            >
              {varyant.size}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {denemeYolu && secili ? (
          <Button asChild variant="birincil" size="lg" className="w-full">
            {/* Deneme AYRI bir ekran: ürün detayının üç bloğuna sığmaz ve
                sığdırılmaya çalışılırsa görsel ekranın çoğunu kaplayamaz. */}
            <Link href={`${denemeYolu}?varyant=${secili.id}`}>Üzerimde Dene</Link>
          </Button>
        ) : null}

        <SepeteEkle
          variantIdler={secili && secili.available ? [secili.id] : []}
          className={denemeYolu ? undefined : 'sm:col-span-2'}
        />
      </div>

      <BedenOnerisi
        variantId={secili?.id ?? null}
        sizeChart={sizeChart}
        girisYapildi={girisYapildi}
      />
    </div>
  );
}
