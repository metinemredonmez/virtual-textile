'use client';

import * as React from 'react';
import type { CartItemWire } from '@vt/contracts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Satir } from './satir';

/**
 * ALINAMAYAN KALEMLER.
 *
 * ⚠️ Bunlar sepetten SİLİNMEZ ve TOPLAMA DA GİRMEZ (`cart.service.ts` →
 *    `BLOCKING_ISSUES` bunları `packages`tan çıkarıp buraya taşıyor). İki
 *    davranışın da sebebi var: silinseydi kullanıcı ürününün nereye gittiğini
 *    anlamazdı, toplama girseydi ödeyemeyeceği bir tutarı görürdü.
 *
 * ⚠️ Bu bölümü GİZLEMEK, `packages` boşaldığında sepeti "boş" göstermek
 *    demektir — oysa sepet dolu, sadece içindekiler alınamıyor. Aynı ayrım
 *    sunucuda `cart-eligibility.ts` içinde ayrı bir karar olarak yazılı
 *    (CART_EMPTY ≠ INSUFFICIENT_STOCK) ve arayüz onu bozmamalı.
 *
 * ⚠️ Adet seçici YOK: bu kalemlerin sorunu adet değil. Adedi düşürmeye çalışan
 *    kullanıcı çözülemeyecek bir işle uğraşırdı; tek anlamlı eylem "çıkar".
 */
export function Alinamayanlar({
  kalemler,
  meshgul,
  onSil,
}: {
  kalemler: CartItemWire[];
  meshgul: string | null;
  onSil: (itemId: string) => void;
}): React.ReactElement {
  return (
    <Card>
      <CardHeader className="border-b border-kenar">
        <CardTitle>Şu anda alınamayan ürünler</CardTitle>
        <p className="text-xs text-metin-soluk">
          Bu ürünler toplama dahil edilmedi. Sepetinizde kalmaya devam ederler; sipariş verebilmek
          için çıkarmanız gerekir.
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="divide-y divide-kenar">
          {kalemler.map((kalem) => (
            <Satir
              key={kalem.id}
              kalem={kalem}
              hata={undefined}
              meshgul={meshgul}
              onAdet={() => undefined}
              onSil={onSil}
              adetSecici={false}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
