import { z } from 'zod';
import { addressSchema, emailSchema, idSchema, phoneSchema } from '@vt/contracts';

/**
 * Adres ya kayıtlıdır (üye) ya da gövdede gelir (misafir).
 * Misafir checkout'u desteklemek zorundayız: kayıt zorunluluğu dönüşümü
 * ölçülebilir biçimde düşürür. Kayıtlı adres kimliğiyle gelen istek için
 * sahiplik AYRICA doğrulanır — kimlik tahmin edilerek başkasının adresi
 * okunamasın.
 */
export const addressRefSchema = z.union([
  z.object({ addressId: idSchema }),
  z.object({ address: addressSchema }),
]);
export type AddressRef = z.infer<typeof addressRefSchema>;

export const checkoutInitSchema = z.object({
  shipping: addressRefSchema,
  /** Verilmezse teslimat adresi fatura adresi olarak da kullanılır. */
  billing: addressRefSchema.optional(),
  /**
   * ⚠️ Üyede de ZORUNLU. Sipariş bildirimi, fatura ve kargo takibi bu adrese
   * gider; access token e-posta taşımadığı için (yetki kararına girmez)
   * kullanıcıdan açıkça istenir ve siparişe SNAPSHOT'lanır.
   */
  email: emailSchema,
  /** Verilmezse teslimat adresindeki telefon kullanılır. */
  phone: phoneSchema.optional(),
  /**
   * Fiyat değiştiğinde istek CART_PRICE_CHANGED ile reddedilir; kullanıcı
   * yeni tutarı onayladığında bu bayrakla tekrar gönderilir.
   * ⚠️ Varsayılanı `true` yapmak, kullanıcının onaylamadığı bir tutarı
   *    çekmek demektir.
   */
  acceptPriceChange: z.boolean().default(false),
});
export type CheckoutInitInput = z.infer<typeof checkoutInitSchema>;

export const checkoutPaySchema = z.object({
  orderId: idSchema,
  /** iyzico TR'de en fazla 12 taksit destekler. */
  installment: z.number().int().min(1).max(12).default(1),
  /**
   * Misafir siparişinde sipariş sahipliğinin kanıtı.
   * Sipariş kimliği tahmin edilse bile e-posta bilinmeden ödeme başlatılamaz.
   */
  email: emailSchema.optional(),
});
export type CheckoutPayInput = z.infer<typeof checkoutPaySchema>;

/**
 * 3DS dönüşü — sağlayıcı form-urlencoded POST eder.
 * Alan adları iyzico'nun gönderdiği adlardır; şema gevşektir çünkü
 * sağlayıcı ek alan eklediğinde ödeme akışı KIRILMAMALIDIR.
 */
export const threeDsCallbackSchema = z
  .object({
    conversationId: z.string().trim().min(1).max(200),
    paymentId: z.string().trim().min(1).max(200).optional(),
    conversationData: z.string().trim().max(4000).optional(),
    mdStatus: z.union([z.string(), z.number()]).optional(),
    status: z.string().trim().max(60).optional(),
  })
  .passthrough();
export type ThreeDsCallbackInput = z.infer<typeof threeDsCallbackSchema>;
