import * as React from 'react';
import type { SizeChartWire } from '@vt/contracts';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';

/**
 * ÖLÇÜ TABLOSU.
 *
 * ⚠️ Tablo GİYSİ ölçüsüdür, vücut ölçüsü değil. 98 cm göğüs ölçülü bir gömlek
 *    98 cm göğüslü birine dar gelir; bolluk payı motorun işidir
 *    (`size-engine.ts` → ease). Buraya "sizin ölçünüz" başlığı yazılmaz.
 *
 * ⚠️ Sıra `orderedSizes`ten gelir, `Object.keys`ten DEĞİL: S/M/L sırası nesne
 *    anahtar sırasına bırakılırsa tablo bir gün L/M/S çıkar.
 */

const OLCU_ETIKETLERI: Record<string, string> = {
  chest: 'Göğüs',
  waist: 'Bel',
  hip: 'Kalça',
  length: 'Boy',
  shoulder: 'Omuz',
  sleeve: 'Kol',
  inseam: 'İç bacak',
};

export interface OlcuTablosuProps {
  tablo: SizeChartWire;
  siralamaBedenleri: readonly string[];
  /** Öne çıkarılacak beden (önerilen) — yoksa hiçbir satır vurgulanmaz. */
  vurgulananBeden?: string | null;
}

export function OlcuTablosu({
  tablo,
  siralamaBedenleri,
  vurgulananBeden = null,
}: OlcuTablosuProps): React.ReactElement | null {
  const bedenler = siralamaBedenleri.filter((beden) => tablo[beden] !== undefined);
  if (bedenler.length === 0) return null;

  // Sütunlar tüm bedenlerin birleşiminden: bir bedende olmayan ölçü boş kalır.
  const olcuAnahtarlari = [
    ...new Set(bedenler.flatMap((beden) => Object.keys(tablo[beden] ?? {}))),
  ];

  return (
    <Table>
      <THead>
        <TR>
          <TH>Beden</TH>
          {olcuAnahtarlari.map((anahtar) => (
            <TH key={anahtar} sayisal>
              {OLCU_ETIKETLERI[anahtar] ?? anahtar} (cm)
            </TH>
          ))}
        </TR>
      </THead>
      <TBody>
        {bedenler.map((beden) => (
          <TR key={beden} className={beden === vurgulananBeden ? 'bg-yuzey' : undefined}>
            <TD className="font-medium">{beden}</TD>
            {olcuAnahtarlari.map((anahtar) => (
              <TD key={anahtar} sayisal>
                {tablo[beden]?.[anahtar] ?? '—'}
              </TD>
            ))}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
