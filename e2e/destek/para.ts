/**
 * PARA YARDIMCILARI — KURUŞ, bigint.
 *
 * ⚠️ Buradaki `komisyonHesapla` sunucunun `Money.applyBps`'ini ÇAĞIRMAZ,
 *    BAĞIMSIZ olarak yeniden yazar. Gerekçe: aynı fonksiyonu iki tarafta
 *    kullanan bir test, o fonksiyondaki bir yuvarlama hatasını asla
 *    göremez — hem beklenen hem gerçek değer aynı yanlışı üretir. Defter
 *    testinin tek işi bu; bu yüzden hesap ikinci kez, elle yazılıyor.
 *
 * ⚠️ Float YOK. 1250 bps'lik komisyon `tutar * 0.125` ile hesaplansaydı
 *    89.90 ₺'lik bir kalemde 1 kuruşluk sapma üretirdi ve test, sunucu
 *    doğruyken kırmızı yanardı.
 */

/** JSON sınırında tutarlar string taşınır (bkz. serializeBigInts). */
export function kurus(deger: string | number | bigint | null | undefined): bigint {
  if (deger === null || deger === undefined) return 0n;
  if (typeof deger === 'bigint') return deger;
  if (typeof deger === 'number') {
    if (!Number.isInteger(deger)) {
      throw new ParaHatasi(`Kuruş tam sayı olmalı, ${String(deger)} verildi.`);
    }
    return BigInt(deger);
  }
  if (!/^-?\d+$/.test(deger.trim())) {
    throw new ParaHatasi(`Kuruşa çevrilemeyen değer: ${JSON.stringify(deger)}`);
  }
  return BigInt(deger.trim());
}

/** 89.90 ₺ → 8990n. Test verisi yazarken okunabilirlik için. */
export function lira(tutar: number): bigint {
  return BigInt(Math.round(tutar * 100));
}

export function topla(degerler: readonly bigint[]): bigint {
  return degerler.reduce((toplam, deger) => toplam + deger, 0n);
}

const BPS_PAYDA = 10_000n;

/**
 * Basis point uygulaması — YARIM YUKARI yuvarlama.
 * `remainder * 2 >= payda` koşulu, 0,5 kuruşu yukarı yuvarlar.
 */
export function bpsUygula(tutarMinor: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0) {
    throw new ParaHatasi(`Geçersiz basis point: ${String(bps)}`);
  }
  const pay = tutarMinor * BigInt(bps);
  const bolum = pay / BPS_PAYDA;
  const kalan = pay % BPS_PAYDA;
  return kalan * 2n >= BPS_PAYDA ? bolum + 1n : bolum;
}

/**
 * Kalem komisyonu — sunucunun `calculateCommission` sözleşmesinin aynası.
 *
 * ⚠️ Tavan kuralı burada da var: komisyon kalem tutarını AŞAMAZ. Sabit ücret
 *    küçük bir kalemi aştığında satıcı platforma borçlanırdı; sunucu bunu
 *    kırpıyor, test de aynı beklentiyi kurmalı — yoksa doğru davranışı hata
 *    sayardı.
 */
export function komisyonHesapla(
  kalemToplamMinor: bigint,
  kural: { rateBps: number; fixedFeeMinor: bigint },
): { komisyonMinor: bigint; saticiNetMinor: bigint } {
  const oransal = bpsUygula(kalemToplamMinor, kural.rateBps);
  const ham = oransal + kural.fixedFeeMinor;
  const komisyonMinor = ham > kalemToplamMinor ? kalemToplamMinor : ham;
  return { komisyonMinor, saticiNetMinor: kalemToplamMinor - komisyonMinor };
}

/** Hata mesajlarında okunabilir tutar: 8990n → "89,90 ₺" */
export function bicimle(minor: bigint): string {
  const negatif = minor < 0n;
  const mutlak = negatif ? -minor : minor;
  const tam = mutlak / 100n;
  const ondalik = (mutlak % 100n).toString().padStart(2, '0');
  return `${negatif ? '-' : ''}${tam.toString()},${ondalik} ₺`;
}

export class ParaHatasi extends Error {
  override readonly name = 'ParaHatasi';
}
