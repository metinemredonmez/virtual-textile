/**
 * PARA — kuruş (minor unit) ve BigInt. Float ASLA kullanılmaz (şema kural 1).
 */

/** Lira → kuruş. `Math.round` yalnızca GİRDİDE, tabloda yazdığımız insan
 *  sayısını kuruşa çevirmek için; hesaplarda hiçbir yerde `Number` yok. */
export const tl = (lira: number): bigint => BigInt(Math.round(lira * 100));

/** 1250 = %12,50. Yarımlar yukarı yuvarlanır — komisyon lehine değil, KARARLI. */
export function applyBps(amountMinor: bigint, bps: number): bigint {
  const numerator = amountMinor * BigInt(bps);
  const quotient = numerator / 10_000n;
  const remainder = numerator % 10_000n;
  return remainder * 2n >= 10_000n ? quotient + 1n : quotient;
}

/**
 * ⚠️ SİPARİŞ NUMARASI TARİHTEN ÜRETİLMEZ.
 *
 * Eski seed `VT-{bugün}-0001` yazıyordu; bugünün tarihi her gün değiştiği için
 * ikinci çalıştırma İKİNCİ BİR SİPARİŞ üretirdi ve ledger mükerrer SALE
 * satırlarıyla dolardı. Demo siparişlerin numarası SABİT: doğal anahtar olarak
 * kullanılabilsin diye. Gerçek siparişler `checkout.service.ts` tarafında
 * tarihli üretilmeye devam ediyor — burası yalnızca demo verisi.
 */
export const demoSiparisNo = (sira: number): string => `VT-DEMO-${String(sira).padStart(4, '0')}`;

/** Konsol raporu için — para her zaman kuruştan biçimlenir. */
export function kurusYaz(minor: bigint): string {
  const negatif = minor < 0n;
  const mutlak = negatif ? -minor : minor;
  const lira = mutlak / 100n;
  const kurus = mutlak % 100n;
  const govde = `${lira.toLocaleString('tr-TR')},${String(kurus).padStart(2, '0')} ₺`;
  return negatif ? `-${govde}` : govde;
}
