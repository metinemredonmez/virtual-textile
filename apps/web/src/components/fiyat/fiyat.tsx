import * as React from 'react';
import type { MinorString } from '@vt/contracts';
import { discountPercent, formatMinor } from '@/lib/money';
import { cn } from '@/lib/utils';

/**
 * PARA GÖSTERİMİNİN TEK YOLU.
 *
 * ⚠️ RSC SERİLEŞTİRME SINIRI — üç raporun da kaçırdığı nokta:
 *    `Money` nesnesi `amountMinor: bigint` taşır. Bir Sunucu Bileşeni
 *    `readMinor()` çağırıp sonucu prop olarak bir İstemci Bileşenine geçirirse
 *    bigint RSC yükünden geçmek zorunda kalır ve serileştirme PATLAR.
 *    KURAL: **RSC sınırını yalnızca `MinorString` geçer.** `Money`/`bigint`
 *    asla prop olmaz. Aynı sebeple `FINANCE.minPayoutMinor` (10_000n) da bir
 *    İstemci Bileşenine prop olarak verilmez; gerekiyorsa sunucuda `.toString()`.
 *
 * ⚠️ Ham `formatMinor()` çıktısı doğrudan JSX'e YAZILMAZ. Bu bileşen hem
 *    dönüşümü hem `tabular-nums` sınıfını KENDİ taşır; böylece "para gösterilen
 *    her yerde tabular-nums" kuralı unutulamaz hale gelir.
 */
export interface FiyatProps {
  value: MinorString;
  /** Üstü çizili liste fiyatı — varsa indirim rozetiyle birlikte gösterilir. */
  listValue?: MinorString | null;
  className?: string;
}

export function Fiyat({ value, listValue, className }: FiyatProps): React.ReactElement {
  const indirim = listValue ? discountPercent(value, listValue) : null;

  return (
    /*
     * ⚠️ `flex-wrap` ÇAĞIRANDA DEĞİL, BURADA. ÖLÇÜLDÜ: 375px ekranda iki
     *    sütunlu ızgarada karta ~160px kalıyor ve üç parça (fiyat + üstü çizili
     *    liste fiyatı + yüzde) sığmayınca yüzde KOMŞU KARTIN üzerine biniyordu.
     *    Sınıf çağıranda dururken iki ürün kartından yalnızca birinde vardı:
     *    düzeltme, düzeltildiği ekranda kalıyordu. Sarmalamanın bedeli yok —
     *    sığdığı yerde satır zaten tek satır.
     */
    <span className={cn('rakam inline-flex flex-wrap items-baseline gap-2', className)}>
      <span className="font-semibold">{formatMinor(value)}</span>
      {listValue && indirim !== null ? (
        <>
          <s className="text-metin-soluk">{formatMinor(listValue)}</s>
          {/*
            ⚠️ İNDİRİM YÜZDESİ RENKSİZ. Burada `text-tehlike` yazıyordu ve bu
               bir kural ihlaliydi: `design-system.md`in "renk taşır" tablosunda
               indirim YOK — sipariş durumu, satıcı onayı, payout durumu, try-on
               eşiği ve STOK UYARISI var. İndirim bir durum değil, fiyatın bir
               özelliği ve zaten iki kez söyleniyor (üstü çizili liste fiyatı +
               yüzde). Üstelik harcanan sinyal ucuz değil: `tehlike` tokenı aynı
               ekranda "Tükendi" rozetinin taşıdığı renk. Her kartta kırmızı bir
               yüzde varken kullanıcı gerçek uyarıyı ayırt edemez.
          */}
          <span className="text-metin-soluk">%{indirim}</span>
        </>
      ) : null}
    </span>
  );
}
