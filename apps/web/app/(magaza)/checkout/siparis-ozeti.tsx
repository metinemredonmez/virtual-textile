'use client';

import * as React from 'react';
import Link from 'next/link';
import type { CartWire } from '@vt/contracts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Fiyat } from '@/components/fiyat/fiyat';
import { paraPozitif } from '@/lib/money';
import type { BekleyenOdeme } from '@/lib/session/bekleyen-odeme';

/**
 * ÖDEME ÖZETİ.
 *
 * ⚠️ TUTARLARIN KAYNAĞI ADIMA GÖRE DEĞİŞİR ve bu bilinçli:
 *      • Sipariş oluşmadan önce elimizde yalnızca SEPET var; kargo dahil değil,
 *        çünkü `GET /v1/cart` kargo döndürmüyor (ölçüldü).
 *      • `checkout/init` çalıştıktan sonra tahsil edilecek tutar SİPARİŞTEDİR
 *        (`grandTotalMinor`) ve kargo orada hesaplanmış olur.
 *    Sipariş varken sepet tutarını göstermek, kullanıcıya ödeyeceğinden FARKLI
 *    bir rakam göstermek olurdu.
 *
 * ⚠️ Hiçbir toplama yapılmıyor; dört alan da sunucudan geldiği gibi basılıyor.
 *    `itemsTotal + shipping − discount` yazmak, sunucunun `Money.allocate()`
 *    ile yaptığı kuruş dağıtımını ikinci kez ve farklı şekilde yapmak olurdu.
 *
 * ⚠️ Satıcı adları SEPETTEN geliyor: `CheckoutInitResultWire.packages` yalnızca
 *    `sellerId` taşıyor (ölçüldü), ad yok.
 */
export function SiparisOzeti({
  sepet,
  siparis,
}: {
  sepet: CartWire;
  /** `null` = sipariş henüz oluşmadı; tutarlar sepetten okunur. */
  siparis: BekleyenOdeme | null;
}): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{siparis ? 'Ödenecek tutar' : 'Sepet özeti'}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="flex flex-col gap-2 text-sm">
          {sepet.packages.map((paket) => (
            <li key={paket.sellerId} className="flex justify-between gap-3">
              <span className="min-w-0 truncate text-metin-soluk">
                {paket.sellerName}
                <span className="rakam"> · {paket.items.length} ürün</span>
              </span>
              <Fiyat value={paket.totalMinor} />
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-1.5 border-t border-kenar pt-3 text-sm">
          {siparis ? (
            <>
              <div className="flex justify-between text-metin-soluk">
                <span>Ürünler</span>
                <Fiyat value={siparis.itemsTotalMinor} />
              </div>
              {paraPozitif(siparis.discountMinor) ? (
                <div className="flex justify-between text-metin-soluk">
                  <span>İndirim</span>
                  <span className="flex items-baseline gap-1">
                    <span aria-hidden>−</span>
                    <Fiyat value={siparis.discountMinor} />
                  </span>
                </div>
              ) : null}
              <div className="flex justify-between text-metin-soluk">
                <span>Kargo</span>
                {paraPozitif(siparis.shippingTotalMinor) ? (
                  <Fiyat value={siparis.shippingTotalMinor} />
                ) : (
                  <span>Ücretsiz</span>
                )}
              </div>
              <div className="mt-1 flex items-baseline justify-between border-t border-kenar pt-3">
                <span className="font-medium">Toplam</span>
                <Fiyat value={siparis.grandTotalMinor} className="text-base" />
              </div>
            </>
          ) : (
            <>
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
                <span className="font-medium">Ürünler toplamı</span>
                <Fiyat value={sepet.totalMinor} className="text-base" />
              </div>
              {/* ⚠️ Kargo burada UYDURULMAZ; satıcı başına hesabı sunucu
                  `checkout/init` içinde yapıyor. */}
              <p className="text-xs text-metin-soluk">
                Kargo, her mağaza için ayrı olmak üzere bir sonraki adımda hesaplanır.
              </p>
            </>
          )}
        </div>

        <Link href="/cart" className="text-sm text-metin-soluk hover:text-metin">
          Sepeti düzenle
        </Link>
      </CardContent>
    </Card>
  );
}
