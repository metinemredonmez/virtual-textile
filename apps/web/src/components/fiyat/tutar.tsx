import * as React from 'react';
import { Money } from '@vt/contracts';
import { cn } from '@/lib/utils';

/**
 * KULLANICININ YAZDIĞI TUTAR — `<Fiyat>` DEĞİL, ve bu ayrım kasıtlı.
 *
 * ⚠️ `<Fiyat>` `MinorString` ister ve o marka bir GÜVENCEdir: "bu para API
 *    yanıtından doğdu". Buraya gelen tutar kullanıcının form alanına yazdığı
 *    bir varsayımdır; `unsafeMinorString` ile marka basmak o güvenceyi BÜTÜN
 *    depo için delerdi (AGENTS.md §3). Bu yüzden girdi `bigint` olarak taşınır
 *    ve ekrana buradan çıkar.
 *
 * ⚠️ TELDEN GELEN TUTAR BURAYA VERİLMEZ. Yanıtın `amountMinor` alanı
 *    `<Fiyat>`e gider. Ölçüldü: payout formu bir dönem sunucudan dönen talep
 *    tutarını da bu yoldan basıyordu — aynı ekranda telden gelen para için iki
 *    farklı biçimleme yolu demekti ve biri değişse diğeri eski kalırdı.
 *
 * ⚠️ `rakam` sınıfını BİLEŞEN taşır, çağıran değil — `<Fiyat>` ile aynı
 *    gerekçe: "para gösterilen her yerde tabular-nums" kuralı unutulamaz olmalı.
 *    Bir dönem üç ayrı ekran `<span className="rakam">{Money.formatMoney(...)}`
 *    yazıyordu; dördüncüsü sınıfı unutsa kimse fark etmezdi.
 *
 * ⚠️ İSTEMCİ BİLEŞENLERİNDE KULLANILIR ve `bigint` prop RSC sınırını GEÇMEZ.
 *    Bu bileşen zaten yalnızca istemci tarafındaki form durumundan beslenir;
 *    bir Sunucu Bileşeninden `bigint` geçirmek serileştirmeyi patlatır.
 */
export function Tutar({
  minor,
  className,
}: {
  minor: bigint;
  className?: string;
}): React.ReactElement {
  return <span className={cn('rakam', className)}>{Money.formatMoney(Money.money(minor))}</span>;
}
