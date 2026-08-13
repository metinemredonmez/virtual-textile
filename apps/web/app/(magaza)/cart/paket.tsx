'use client';

import * as React from 'react';
import { Store } from 'lucide-react';
import type { ApiFailure, CartPackageWire } from '@vt/contracts';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Fiyat } from '@/components/fiyat/fiyat';
import { paraPozitif } from '@/lib/money';
import { Satir } from './satir';

/**
 * SATICI PAKETİ.
 *
 * ⚠️ Gruplama kozmetik DEĞİL. Kargo ücreti, kargo bedava eşiği ve komisyon
 *    SATICI BAŞINA işliyor (`checkout.constants.ts` → `SHIPPING`:
 *    `flatFeePerSellerMinor`, eşik PAKET bazında). Tek liste çizilseydi
 *    kullanıcı ödeme adımında "neden iki kargo ücreti var" sorusuyla
 *    karşılaşırdı; ürünler farklı mağazalardan gidiyor ve maliyet de ayrı
 *    doğuyor.
 *
 * ⚠️ Paket başlığı RENKSİZ ve ikon metinden bir ton SOLUK. Mağaza adı bir
 *    DURUM değil, bir etiket (design-system.md → renk yalnızca durum taşır).
 */
export function Paket({
  paket,
  satirHatalari,
  meshgul,
  onAdet,
  onSil,
}: {
  paket: CartPackageWire;
  satirHatalari: Record<string, ApiFailure>;
  meshgul: string | null;
  onAdet: (itemId: string, adet: number) => void;
  onSil: (itemId: string) => void;
}): React.ReactElement {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between border-b border-kenar">
        {/*
          ⚠️ BAĞLANTI DEĞİL, DÜZ METİN. `/magaza/[slug]` (satıcı vitrini) bu
             depoda YOK — `next build` rota listesinde `/magaza` diye bir giriş
             bulunmuyor ve adres canlıda 404 dönüyordu (ölçüldü: sepette
             `href="/magaza/atolye-nord"` basılıyor, adres 404).
             `apps/web/AGENTS.md` §9 bunu zaten yazıyor: "olmayan sayfaya
             bağlantı konmaz" — ve §10 mağaza adının ürün detayında bağlantı
             OLMADIĞINI söylüyor; sepet o kuralın dışında kalmıştı.

             Metin KALIYOR: paket başlığı hangi mağazadan kaç kargo çıktığını
             açıklayan tek işaret. Kaldırılan yalnız bağlantı.
             `paket.storeSlug` alanı wire tipinde duruyor; vitrin ekranı
             yazıldığı gün buraya tek satırla geri gelir.
        */}
        <p className="flex items-center gap-2 text-sm font-medium">
          <Store className="size-4 text-ikon" />
          {paket.sellerName}
        </p>
        <span className="text-xs text-metin-soluk">Ayrı kargo</span>
      </CardHeader>

      <CardContent className="pt-0">
        <ul className="divide-y divide-kenar">
          {paket.items.map((kalem) => (
            <Satir
              key={kalem.id}
              kalem={kalem}
              hata={satirHatalari[kalem.id]}
              meshgul={meshgul}
              onAdet={onAdet}
              onSil={onSil}
            />
          ))}
        </ul>

        {/* Paket toplamı — sunucunun paylaştırdığı indirim dahil. */}
        <div className="flex flex-col gap-1 border-t border-kenar pt-3 text-sm">
          <div className="flex justify-between text-metin-soluk">
            <span>Ara toplam</span>
            <Fiyat value={paket.subtotalMinor} />
          </div>
          {paraPozitif(paket.discountMinor) ? (
            <div className="flex justify-between text-metin-soluk">
              <span>Kupon indirimi</span>
              {/* ⚠️ "−" işareti METİNDE; tutar sunucudan pozitif geliyor ve
                  burada aritmetik YAPILMIYOR. */}
              <span className="flex items-baseline gap-1">
                <span aria-hidden>−</span>
                <Fiyat value={paket.discountMinor} />
              </span>
            </div>
          ) : null}
          <div className="flex justify-between font-medium">
            <span>Paket toplamı</span>
            <Fiyat value={paket.totalMinor} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
