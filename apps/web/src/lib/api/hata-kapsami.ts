import type { ErrorCode } from '@vt/contracts';

/**
 * HATA NEREYE BASILIR — satıra mı, kupon alanına mı, sayfanın tepesine mi?
 *
 * Sepette bir hatanın YERİ, metninden daha çok bilgi taşır: "Yeterli stok
 * kalmadı. Bu üründen en fazla 3 adet alabilirsiniz." cümlesi sayfanın
 * tepesinde HANGİ ürün olduğunu söylemez ve sepette dört ürün varken kullanıcı
 * hangisini düzelteceğini bilemez. Aynı cümle satırın altında tek başına
 * yeterlidir.
 *
 * ⚠️ Burada `satisfies Record<ErrorCode, ...>` KULLANILMIYOR — `retry-policy.ts`
 *    ile bilinçli bir fark. Orada varsayılana düşmek TEHLİKELİ (yeni bir kod
 *    sessizce yanlış yeniden deneme davranışına girer). Burada varsayılan
 *    `sayfa`dır ve `sayfa` GÖRÜNÜR olan taraftır: tanımadığımız bir kod en
 *    kötü ihtimalle doğru yerde değil ama MUTLAKA ekranda çıkar. 130 satırlık
 *    tabloyu ikinci kez yazmanın bedeli, kazandırdığı güvenceden büyük.
 */
export type HataKapsami = 'satir' | 'kupon' | 'sepet' | 'sayfa';

/**
 * Kalemin KENDİSİYLE ilgili, yani o satırın adedini/varlığını değiştirerek
 * çözülebilecek hatalar.
 */
const SATIR_KODLARI = new Set<ErrorCode>([
  // ⚠️ Bu ikisi adet seçicinin hemen altına basılır: kullanıcı adedi
  //    düşürerek çözer, başka hiçbir şey yapması gerekmez.
  'INSUFFICIENT_STOCK',
  'MAX_QUANTITY_EXCEEDED',
  // Adet değil, ürünün kendisi sorunlu — çözüm "satırı çıkar".
  'VARIANT_UNAVAILABLE',
  'VARIANT_NOT_FOUND',
  'PRODUCT_NOT_FOUND',
  'SELLER_ON_VACATION',
  // Adet değişikliği araya girmiş bir zammı sessizce onaylamasın diye sunucu
  // `acceptPriceChange` istiyor; karar o satırda verilir.
  'CART_PRICE_CHANGED',
]);

const KUPON_KODLARI = new Set<ErrorCode>([
  'COUPON_INVALID',
  'COUPON_EXPIRED',
  'COUPON_MIN_AMOUNT',
  'COUPON_ALREADY_USED',
  'COUPON_USAGE_LIMIT_REACHED',
  'COUPON_NOT_APPLICABLE',
]);

/**
 * Sepetin TAMAMI geçersiz — elimizdeki görüntü artık doğru değil.
 * Çağıran taraf hatayı göstermekle kalmaz, sepeti yeniden çeker.
 */
const SEPET_KODLARI = new Set<ErrorCode>(['CART_NOT_FOUND', 'CART_EXPIRED', 'CART_EMPTY']);

export function hataKapsami(code: string): HataKapsami {
  if (SATIR_KODLARI.has(code as ErrorCode)) return 'satir';
  if (KUPON_KODLARI.has(code as ErrorCode)) return 'kupon';
  if (SEPET_KODLARI.has(code as ErrorCode)) return 'sepet';
  return 'sayfa';
}
