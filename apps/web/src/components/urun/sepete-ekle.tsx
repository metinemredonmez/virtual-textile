'use client';

import * as React from 'react';
import { Check } from 'lucide-react';
import { isApiFailure, type CartWire } from '@vt/contracts';
import { apiFetch } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';

/**
 * SEPETE EKLE.
 *
 * ⚠️ BURAYA `product/_bilesenler/` ALTINDAN TAŞINDI. Vitrindeki afiş kartı
 *    ikinci çağıran oldu; `AGENTS.md` §0'ın kuralı net: `_bilesenler/` o
 *    ekrana özgüdür, ikinci bir ekran aynı şeye ihtiyaç duyduğu anda dosya
 *    paylaşılana taşınır ve ikinci kopya YAZILMAZ. Bu depoda ürün kartının
 *    iki kopyası zaten ayrışmıştı; burada ayrışacak şey stok uyarısı olurdu.
 *
 * ⚠️ "Üzerimde Dene" ile AYNI görsel ağırlıkta — ikisi de `birincil`. Bu bir
 *    stil tercihi değil: try-on ikincil bir özellik değil ürünün kendisidir ve
 *    ikincil düğme gibi çizilirse kullanıcı denemeden satın alır.
 *
 * ⚠️ `INSUFFICIENT_STOCK`ta ADET METİNDEN AYIKLANMAZ. Katalog mesajı
 *    "en fazla {available} adet" diyor ama sayı, sunucuda interpolasyonla
 *    gömülmüş bir METİN; ondan sayı çıkarmak metin bir gün değiştiğinde
 *    sessizce bozulur. Yapılandırılmış bilgi sepette: `items[].maxAvailable`.
 */

export interface SepeteEkleProps {
  /** Kombin ekranında birden fazla parça tek eylemle eklenir. */
  variantIdler: readonly string[];
  etiket?: string;
  className?: string;
}

export function SepeteEkle({
  variantIdler,
  etiket = 'Sepete Ekle',
  className,
}: SepeteEkleProps): React.ReactElement {
  const [gonderiliyor, setGonderiliyor] = React.useState(false);
  const [eklendi, setEklendi] = React.useState(false);
  const [hata, setHata] = React.useState<unknown>(null);
  const [kalanUyarisi, setKalanUyarisi] = React.useState<string | null>(null);

  async function stokUyarisiKur(variantId: string): Promise<void> {
    try {
      const { data } = await apiFetch<CartWire, '/cart'>('/cart');
      const kalem = data.packages
        .flatMap((paket) => paket.items)
        .find((satir) => satir.variantId === variantId);

      if (kalem?.maxAvailable != null) {
        setKalanUyarisi(`Sepetinizde bu üründen en fazla ${kalem.maxAvailable} adet olabilir.`);
      }
    } catch {
      // Sepet okunamadıysa katalog mesajı zaten gösteriliyor; ek uyarı susar.
    }
  }

  async function ekle(): Promise<void> {
    setGonderiliyor(true);
    setHata(null);
    setKalanUyarisi(null);

    try {
      // ⚠️ Sıra korunur ve TEK TEK gidilir: sunucu kalem başına stok ayırıyor,
      //    paralel istek aynı varyantta yarış üretir.
      for (const variantId of variantIdler) {
        await apiFetch<CartWire, '/cart/items'>('/cart/items', {
          method: 'POST',
          json: { variantId, quantity: 1 },
        });
      }
      setEklendi(true);
    } catch (error) {
      setHata(error);
      if (isApiFailure(error) && error.code === 'INSUFFICIENT_STOCK') {
        const ilk = variantIdler[0];
        if (ilk) await stokUyarisiKur(ilk);
      }
    } finally {
      setGonderiliyor(false);
    }
  }

  return (
    <div className={className}>
      <Button
        variant="birincil"
        size="lg"
        className="w-full"
        onClick={() => void ekle()}
        disabled={gonderiliyor || variantIdler.length === 0}
      >
        {eklendi ? (
          <>
            <Check className="size-4" />
            Sepete eklendi
          </>
        ) : (
          etiket
        )}
      </Button>

      {kalanUyarisi ? <p className="mt-2 text-xs text-uyari">{kalanUyarisi}</p> : null}
      {hata ? <HataGosterimi error={hata} className="mt-3" /> : null}
    </div>
  );
}
