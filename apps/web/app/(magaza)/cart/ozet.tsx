'use client';

import * as React from 'react';
import Link from 'next/link';
import type { CartWire } from '@vt/contracts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Fiyat } from '@/components/fiyat/fiyat';
import { paraPozitif } from '@/lib/money';

/**
 * SEPET ÖZETİ.
 *
 * ⚠️ BURADA HİÇBİR TOPLAMA YAPILMIYOR. Üç tutarın üçü de sunucudan geldiği gibi
 *    basılıyor. `cart-totals.ts` indirimi `Money.allocate()` ile kuruş kaybı
 *    olmadan paketlere paylaştırıyor; burada `subtotal - discount` yazmak o
 *    half-up yuvarlamayı ve kalan dağıtımını İKİNCİ kez, farklı şekilde yapmak
 *    olurdu. Fark bir kuruş olsa bile kullanıcı bir tutar görüp başka tutar
 *    öder.
 *
 * ⚠️ KARGO BURADA YOK, ve bu bir eksiklik değil: `GET /v1/cart` kargo
 *    döndürmüyor (ÖLÇÜLDÜ — `CartWire`da böyle bir alan yok). Kargo
 *    `POST /checkout/init` yanıtında paket başına hesaplanıyor. Buraya
 *    "Kargo: ₺0,00" yazmak uydurma olurdu; onun yerine ne zaman
 *    hesaplanacağı SÖYLENİYOR.
 */
export function Ozet({ sepet }: { sepet: CartWire }): React.ReactElement {
  const alinabilirVar = sepet.packages.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Özet</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5 text-sm">
          <div className="flex justify-between text-metin-soluk">
            <span>Ara toplam</span>
            <Fiyat value={sepet.subtotalMinor} />
          </div>

          {paraPozitif(sepet.discountMinor) ? (
            <div className="flex justify-between text-metin-soluk">
              <span>İndirim</span>
              <span className="flex items-baseline gap-1">
                <span aria-hidden>−</span>
                <Fiyat value={sepet.discountMinor} />
              </span>
            </div>
          ) : null}

          <div className="mt-1 flex items-baseline justify-between border-t border-kenar pt-3">
            <span className="font-medium">Toplam</span>
            <Fiyat value={sepet.totalMinor} className="text-base" />
          </div>
        </div>

        {sepet.freeShipping ? (
          // Kargo bedava bir DURUM — rozet rengi burada bilgi taşıyor.
          <Badge durum="olumlu" className="w-fit">
            Kargo bedava
          </Badge>
        ) : (
          <p className="text-xs text-metin-soluk">
            Kargo ücreti ödeme adımında, her mağaza için ayrı hesaplanır.
          </p>
        )}

        {/*
          ⚠️ Fiyat değişimi ödeme adımında `CART_PRICE_CHANGED` ile isteği
             REDDEDİYOR. Burada uyarmak, kullanıcının adres formunu doldurduktan
             sonra duvara toslamasını önler.
        */}
        {sepet.hasPriceChange ? (
          <p className="text-xs text-uyari">
            Sepetinizdeki bazı ürünlerin fiyatı değişti. Ödeme adımında yeni tutarı onaylamanız
            istenecek.
          </p>
        ) : null}

        {sepet.unavailableItems.length > 0 ? (
          <p className="text-xs text-uyari">
            Alınamayan {sepet.unavailableItems.length} ürün sepetinizde. Sipariş verebilmek için
            bunları çıkarın.
          </p>
        ) : null}

        {/*
          ⚠️ `asChild` + `Link`: ödeme adımı bir GEZİNMEDİR, `router.push`
             çağıran bir düğme değil. Gerçek bağlantı olması orta tıklamayı,
             yeni sekmeyi ve tarayıcı geçmişini çalıştırır.

          ⚠️ Alınabilir kalem yokken `asChild` KULLANILMAZ. `disabled` bir
             `<a>` üzerinde HİÇBİR ŞEY yapmaz — Slot prop'u olduğu gibi
             bağlantıya geçirir, bağlantı da tıklanmaya devam eder ve
             kullanıcı ödeme sayfasında `CART_EMPTY` duvarına toslar. Görsel
             olarak kapalı ama gerçekte açık bir düğme, en kötü düğmedir.
             Alınamayan kalemler VARKEN yolu açık bırakıyoruz: hangi kalemin
             neden düştüğünü `cart-eligibility.ts` üç ayrı kodla söylüyor ve o
             cevap sessizce kilitlenmiş bir düğmeden iyidir.
        */}
        {alinabilirVar ? (
          <Button asChild className="w-full" size="lg">
            <Link href="/checkout">Ödemeye geç</Link>
          </Button>
        ) : (
          <Button className="w-full" size="lg" disabled>
            Ödemeye geç
          </Button>
        )}

        <Link href="/products" className="text-center text-sm text-metin-soluk hover:text-metin">
          Alışverişe devam et
        </Link>
      </CardContent>
    </Card>
  );
}
