import { z } from 'zod';
import {
  bodyProfileSchema,
  cursorPaginationSchema,
  idSchema,
  tryOnModeSchema,
} from '@vt/contracts';

/**
 * ⚠️ İstemci `photoContentHash` veya `cacheKey` GÖNDEREMEZ.
 * Önbellek anahtarı sunucuda, kaydedilmiş fotoğrafın kendi özetinden üretilir.
 * İstemciye bırakılsaydı, uydurulmuş bir anahtarla başka bir kullanıcının
 * üretilmiş görseli çekilebilirdi.
 */
export const tryOnCreateSchema = z.object({
  userPhotoId: idSchema,
  variantId: idSchema,
  /** Varsayılan FAST: ucuz ve hızlı. QUALITY'yi kullanıcı bilinçli seçer. */
  mode: tryOnModeSchema.default('FAST'),
});
export type TryOnCreateInput = z.infer<typeof tryOnCreateSchema>;

export const tryOnHistoryQuerySchema = cursorPaginationSchema;
export type TryOnHistoryQuery = z.infer<typeof tryOnHistoryQuerySchema>;

/**
 * Beden önerisi ürün bazında çalışır — bedenler arası karşılaştırma yapılır,
 * tek varyanta bakılmaz. Varyant verilirse ürünü ondan buluruz.
 */
export const sizeRecommendSchema = z
  .object({
    variantId: idSchema.optional(),
    productId: idSchema.optional(),
    /**
     * Ölçüler isteğe bağlı: verilmezse kayıtlı vücut profili kullanılır.
     * Misafir kullanıcı profil kaydetmeden de öneri alabilsin diye gövdeden
     * kabul ediliyor; ⚠️ bu ölçüler KAYDEDİLMEZ, yalnızca hesapta kullanılır.
     */
    measurements: bodyProfileSchema.optional(),
  })
  .refine((value) => Boolean(value.variantId ?? value.productId), {
    message: 'Ürün veya varyant kimliği gerekli.',
    path: ['productId'],
  });
export type SizeRecommendInput = z.infer<typeof sizeRecommendSchema>;
