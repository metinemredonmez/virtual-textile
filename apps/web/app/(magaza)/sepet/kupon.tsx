'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import type { ApiFailure, CartCouponWire } from '@vt/contracts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { HataGosterimi } from '@/components/hata/hata-gosterimi';

/**
 * KUPON ALANI.
 *
 * ⚠️ ÖLÇÜLDÜ (POST /v1/cart/coupon): kupon nesnesi `{ code, sellerId,
 *    discountType, rejection }`. İNDİRİM TUTARI BURADA YOK — sepetin kökündeki
 *    `discountMinor` alanında ve özet bileşeninde gösteriliyor. Bu tip
 *    `packages/contracts` içinde `{ code, discountMinor }` diye yazılıydı;
 *    ölçümle düzeltildi.
 *
 * ⚠️ `rejection` DOLU olduğunda kupon sepette DURUR ama indirim UYGULANMAZ.
 *    Sunucu kuponu düşürmüyor. Bu durumu göstermemek, kullanıcıyı "kuponu
 *    girdim, tutar değişmedi" ekranıyla baş başa bırakır.
 *
 * ⚠️ Sepette dururken süresi dolan kupon `code: ''` ile gelir (ÖLÇÜLDÜ:
 *    `buildView()` `couponExpired` dalı). Kodu doğrudan basmak boş bir rozet
 *    çizerdi.
 */

const REDDETME_METINLERI: Record<NonNullable<CartCouponWire['rejection']>, string> = {
  NOT_APPLICABLE: 'Bu kupon sepetinizdeki ürünlere uygulanmıyor.',
  MIN_AMOUNT: 'Sepet tutarı bu kuponun alt sınırının altında.',
  EXPIRED: 'Kuponun süresi doldu.',
};

export function Kupon({
  kupon,
  hata,
  calisiyor,
  onUygula,
  onKaldir,
}: {
  kupon: CartCouponWire | null;
  hata: ApiFailure | null;
  calisiyor: boolean;
  onUygula: (kod: string) => void;
  onKaldir: () => void;
}): React.ReactElement {
  const [kod, setKod] = React.useState('');

  const uygulandi = kupon !== null && kupon.rejection === null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Kupon</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {kupon ? (
          <div className="flex items-center justify-between gap-2 rounded-md bg-yuzey px-3 py-2">
            <span className="truncate text-sm font-medium">
              {/* Boş kod = süresi dolmuş kupon; yerine durumu yazıyoruz. */}
              {kupon.code || 'Kupon'}
            </span>
            <Button
              variant="sessiz"
              size="icon"
              className="h-7 w-7"
              aria-label="Kuponu kaldır"
              disabled={calisiyor}
              onClick={onKaldir}
            >
              <X className="size-4 text-ikon" />
            </Button>
          </div>
        ) : (
          <form
            className="flex gap-2"
            onSubmit={(olay) => {
              olay.preventDefault();
              const temiz = kod.trim();
              if (temiz.length > 0) onUygula(temiz);
            }}
          >
            <Input
              value={kod}
              onChange={(olay) => setKod(olay.target.value)}
              placeholder="Kupon kodu"
              aria-label="Kupon kodu"
              aria-invalid={hata !== null}
              autoComplete="off"
              // ⚠️ Sunucu `min(3).max(40)` istiyor; formu aynı sınırla kısmak
              //    kullanıcıyı gereksiz bir 400 turuna sokmaz.
              minLength={3}
              maxLength={40}
            />
            <Button type="submit" variant="ikincil" disabled={calisiyor || kod.trim().length < 3}>
              Uygula
            </Button>
          </form>
        )}

        {/* Kupon sepette ama uygulanmıyor — SEBEBİ söylenir. */}
        {kupon && !uygulandi && kupon.rejection ? (
          <p className="text-sm text-uyari">{REDDETME_METINLERI[kupon.rejection]}</p>
        ) : null}

        {/* ⚠️ Hata sayfanın tepesine DEĞİL, kupon alanının altına. Kullanıcının
            düzeltmesi gereken şey burada. */}
        {hata ? <HataGosterimi error={hata} /> : null}
      </CardContent>
    </Card>
  );
}
