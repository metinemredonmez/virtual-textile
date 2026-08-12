/**
 * TELDEKİ PARA — `Money` nesnesi DEĞİL, sonu `Minor` ile biten düz string alan.
 *
 * `serializeBigInts` her bigint'i string'e çeviriyor; telde `currency` alanı hiç
 * yok (tek para birimi TRY). Yani `{"unitPriceMinor":"129000"}` görüyoruz,
 * `{"amountMinor":...,"currency":...}` değil.
 *
 * Marka (brand) tipi KÖKEN denetimidir: `const f: MinorString = '129000'` derlenmez,
 * çünkü para yalnızca ayrıştırma sınırından (API yanıtı) doğabilir. Elle yazılmış
 * bir tutarın ekrana para diye sızmasını tip sistemi engeller.
 *
 * ⚠️ Marka `Number()`'ı ENGELLEYEMEZ: `NumberConstructor` imzası `(value?: any)`
 *    olduğu için `Number(w.totalMinor)` tip hatası VERMEZ. Ölçüldü. Bu yüzden
 *    ikinci katman (apps/web eslint `no-restricted-syntax`) ve üçüncü katman
 *    (`lib/money.ts` tek okuma noktası) vazgeçilmezdir — marka tek başına yeterli
 *    olsaydı diğer ikisi yazılmazdı.
 */

declare const minorBrand: unique symbol;

export type MinorString = string & { readonly [minorBrand]: 'minor' };

/**
 * Ayrıştırma sınırı. Yalnızca API yanıtını tiplerken kullanılır.
 *
 * ⚠️ Uygulama kodunda çağrılmaz: çağrıldığı an markanın verdiği köken güvencesi
 *    biter ve rastgele bir string para olur.
 */
export function unsafeMinorString(raw: string): MinorString {
  return raw as MinorString;
}
