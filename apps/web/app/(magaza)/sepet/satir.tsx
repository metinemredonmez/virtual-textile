'use client';

import * as React from 'react';
import Link from 'next/link';
import { Minus, Plus, Trash2 } from 'lucide-react';
import type { ApiFailure, CartItemWire } from '@vt/contracts';
import { CART } from '@vt/config/constants';
import { mediaUrl } from '@/lib/media';
import { UrunGorseli } from '@/components/urun/urun-gorseli';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Fiyat } from '@/components/fiyat/fiyat';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';

/**
 * SEPET SATIRI.
 *
 * ⚠️ Sabit `@vt/config/constants` ALT YOLUNDAN alınıyor, `@vt/config` kökünden
 *    DEĞİL. Kökten alındığında `env.ts` istemci paketine giriyor ve
 *    `JWT_ACCESS_SECRET` gibi anahtar ADLARI `.next/static`e sızıyor
 *    (`verify:bundle` bunu kırıyor). Gerekçe apps/web/AGENTS.md §8.7.
 */

const ISSUE_METINLERI: Record<NonNullable<CartItemWire['issue']>, string> = {
  // ⚠️ Bu metinler `ERROR_CATALOG` mesajlarının YERİNE GEÇMEZ. `issue` bir hata
  //    kodu değil, sepet görünümünün TAŞIDIĞI bir durum alanı; karşılığında bir
  //    katalog mesajı yok. Bir hata zarfı geldiğinde gösterilen şey daima
  //    `error.message`tir (bkz. aşağıdaki `<HataGosterimi>`).
  UNAVAILABLE: 'Bu ürün artık satışta değil.',
  SELLER_ON_VACATION: 'Mağaza tatilde; bu ürün şu anda gönderilemiyor.',
  OUT_OF_STOCK: 'Bu ürün tükendi.',
  INSUFFICIENT_STOCK: 'Stok, sepetinizdeki adedin altına düştü.',
};

export interface SatirProps {
  kalem: CartItemWire;
  hata: ApiFailure | undefined;
  meshgul: string | null;
  onAdet: (itemId: string, adet: number) => void;
  onSil: (itemId: string) => void;
  /** Alınamayan kalemler bölümünde adet seçici anlamsız — yalnız "çıkar" kalır. */
  adetSecici?: boolean;
}

export function Satir({
  kalem,
  hata,
  meshgul,
  onAdet,
  onSil,
  adetSecici = true,
}: SatirProps): React.ReactElement {
  const gorsel = mediaUrl(kalem.imageKey);
  const kilitli = meshgul === `adet:${kalem.id}` || meshgul === `sil:${kalem.id}`;

  /**
   * Adet tavanı iki kısıttan KÜÇÜĞÜ.
   *
   * ⚠️ `maxAvailable` sunucudan YAPILANDIRILMIŞ olarak geliyor ve YALNIZCA
   *    kalemin adedi stoğun üstüne çıktığında dolu (ÖLÇÜLDÜ: stok 1'e
   *    düşürülünce `issue=INSUFFICIENT_STOCK, maxAvailable=1`; adet stoğun
   *    altındayken `null`). Null olduğunda tavan yalnızca sipariş başına azami
   *    adettir — uydurma bir sayı konmaz.
   */
  const tavan = Math.min(CART.maxQuantityPerVariant, kalem.maxAvailable ?? Number.MAX_SAFE_INTEGER);

  return (
    <li className="flex gap-4 py-4">
      <Link href={`/urun/${kalem.productSlug}`} className="shrink-0">
        <div className="relative aspect-urun w-20 overflow-hidden rounded-md bg-yuzey">
          {/* ⚠️ Ham `next/image` DEĞİL — gerekçe `components/urun/urun-gorseli.tsx`te. */}
          <UrunGorseli src={gorsel} alt={kalem.productTitle} sizes="80px" />
        </div>
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Link href={`/urun/${kalem.productSlug}`} className="block">
              <h3 className="truncate text-sm font-semibold leading-snug">{kalem.productTitle}</h3>
            </Link>
            <p className="text-sm text-metin-soluk">
              {kalem.color} · {kalem.size}
            </p>
          </div>

          {/* Satır toplamı — sunucudan geldiği gibi. */}
          <Fiyat value={kalem.lineTotalMinor} className="shrink-0 text-sm" />
        </div>

        {/*
          ⚠️ FİYAT DEĞİŞİMİ SESSİZ GEÇİLMEZ. Tahsil edilecek tutar sepete
             eklendiği andaki fiyattır (`unitPriceMinor`); katalogdaki güncel
             fiyat `currentUnitPriceMinor`. İkisi ayrıştığında checkout
             `CART_PRICE_CHANGED` ile REDDEDİYOR, yani kullanıcı bunu ödeme
             adımında öğrenmek zorunda kalır. Burada söylenirse orada sürpriz
             olmaz.
        */}
        {kalem.priceChanged ? (
          <p className="text-xs text-uyari">
            Bu ürünün güncel fiyatı değişti. Sepetteki fiyat:{' '}
            <Fiyat value={kalem.unitPriceMinor} className="text-xs" /> · Güncel:{' '}
            <Fiyat value={kalem.currentUnitPriceMinor} className="text-xs" />
          </p>
        ) : null}

        {kalem.issue ? (
          <Badge
            durum={kalem.issue === 'INSUFFICIENT_STOCK' ? 'uyari' : 'tehlike'}
            className="w-fit"
          >
            {ISSUE_METINLERI[kalem.issue]}
          </Badge>
        ) : null}

        <div className="mt-2 flex items-center gap-3">
          {adetSecici ? (
            <div className="flex items-center rounded-md border border-kenar">
              <Button
                variant="sessiz"
                size="icon"
                className="h-8 w-8 rounded-r-none"
                aria-label="Adedi azalt"
                disabled={kilitli || kalem.quantity <= 1}
                onClick={() => onAdet(kalem.id, kalem.quantity - 1)}
              >
                <Minus className="size-4 text-ikon" />
              </Button>
              {/* ⚠️ Adet SUNUCUDAN gelen değerdir; yerel iyimser bir sayaç
                  tutulmuyor. Reddedilen bir istekten sonra ekrandaki sayı
                  gerçekten sepette olan sayıdır. */}
              <span className="rakam w-10 text-center text-sm tabular-nums">{kalem.quantity}</span>
              <Button
                variant="sessiz"
                size="icon"
                className="h-8 w-8 rounded-l-none"
                aria-label="Adedi artır"
                disabled={kilitli || kalem.quantity >= tavan}
                onClick={() => onAdet(kalem.id, kalem.quantity + 1)}
              >
                <Plus className="size-4 text-ikon" />
              </Button>
            </div>
          ) : null}

          <Button
            variant="sessiz"
            size="sm"
            className="text-metin-soluk"
            disabled={kilitli}
            onClick={() => onSil(kalem.id)}
          >
            <Trash2 className="size-4 text-ikon" />
            Çıkar
          </Button>
        </div>

        {/*
          ⚠️ HATA SATIRIN İÇİNDE. Sayfanın tepesine basılsaydı "Bu üründen en
             fazla 3 adet alabilirsiniz" cümlesi HANGİ ürün olduğunu söylemez
             ve dört kalemli bir sepette kullanıcı neyi düzelteceğini bulamazdı.
             Azami adet mesajın İÇİNDE; metinden sayı AYIKLANMAZ, mesaj olduğu
             gibi gösterilir.
        */}
        {hata ? <HataGosterimi error={hata} className="mt-2" /> : null}
      </div>
    </li>
  );
}
