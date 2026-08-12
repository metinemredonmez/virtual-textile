import { unsafeMinorString, type MinorString } from '@vt/contracts';

/**
 * HATA ZARFININ `details` ALANINDAKİ TUTARI OKUMA.
 *
 * Bazı finans hataları tek kullanışlı bilgiyi `message` içinde değil
 * `details` içinde taşıyor ve o bilgi bir PARA TUTARIDIR:
 *
 *   PAYOUT_INSUFFICIENT_BALANCE → `details.availableMinor`
 *   REFUND_EXCEEDS_PAYMENT      → `details.remainingRefundableMinor`
 *
 * ⚠️ NEDEN `unsafeMinorString` BURADA MEŞRU. `wire/money.ts` "uygulama kodunda
 *    çağrılmaz" diyor ve gerekçesi şu: marka, "bu para API yanıtından doğdu"
 *    güvencesidir. Burada değer TAM OLARAK oradan doğuyor — hata zarfı da bir
 *    API yanıtıdır. Tek fark `ApiErrorBody.details` tipinin `unknown` olması,
 *    yani bu bir AYRIŞTIRMA SINIRI. Marka basmadan `<Fiyat>`e verilemez;
 *    alternatif, tutarı ikinci bir yerde elle biçimlemek olurdu ve para
 *    biçiminin ikinci bir uygulaması tam olarak `lib/money.ts`in engellediği şey.
 *
 * ⚠️ DESEN DAR: yalnızca `^-?\d{1,18}$`. Sunucu `minorAmountSchema` ile aynı
 *    deseni kullanıyor. Gevşek bir kontrol, `"1.234,00"` gibi biçimlenmiş bir
 *    metne marka basar ve `BigInt()` çalışma zamanında patlardı — hatayı
 *    göstermeye çalışırken ekranı düşürmek, hatanın kendisinden büyük bir hata.
 *
 * ⚠️ Değer okunamazsa `null` döner ve çağıran taraf O TUTARI HİÇ GÖSTERMEZ.
 *    "0,00 ₺" yazmak, ödenebilir bakiyesi olmayan bir satıcı ile bakiyesi
 *    okunamayan bir satıcıyı aynı gösterirdi.
 */
const TUTAR_DESENI = /^-?\d{1,18}$/;

export function hataTutari(details: unknown, alan: string): MinorString | null {
  if (typeof details !== 'object' || details === null) return null;
  const ham = (details as Record<string, unknown>)[alan];
  if (typeof ham !== 'string' || !TUTAR_DESENI.test(ham)) return null;
  return unsafeMinorString(ham);
}
