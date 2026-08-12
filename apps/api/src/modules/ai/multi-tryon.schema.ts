import { z } from 'zod';
import { idSchema, tryOnModeSchema } from '@vt/contracts';
import { MAX_OUTFIT_PIECES, MIN_OUTFIT_PIECES } from '@vt/adapters';

/**
 * ÇOKLU ÜRÜN (KOMBİN) DENEME İSTEĞİ
 *
 * ⚠️ İstemci `photoContentHash`, `cacheKey` veya KATMAN SIRASI GÖNDEREMEZ.
 *
 *    - Anahtar sunucuda üretilir (tek ürün akışındaki gerekçenin aynısı:
 *      uydurulmuş bir anahtarla başka bir üretimin sonucu çekilebilirdi).
 *    - Sıra ise `variantIds` dizisinin sırası DEĞİLDİR. Dizinin sırası
 *      kullanıcının karuselde parçalara dokunma sırasıdır; giyim fiziğiyle
 *      ilgisi yoktur. Katman sırası sabit tablodan gelir
 *      (bkz. @vt/adapters → OUTFIT_LAYER_ORDER).
 *
 * Sınırların gerekçesi adapters tarafındadır (her parça AYRI bir sağlayıcı
 * çağrısıdır); burada yalnızca uygulanır ki geçersiz bir istek katalog
 * sorgusuna bile ulaşmasın.
 */
export const outfitTryOnCreateSchema = z.object({
  userPhotoId: idSchema,
  variantIds: z
    .array(idSchema)
    .min(MIN_OUTFIT_PIECES, {
      message: `Kombin en az ${MIN_OUTFIT_PIECES} parça içermeli.`,
    })
    .max(MAX_OUTFIT_PIECES, {
      message: `Kombin en fazla ${MAX_OUTFIT_PIECES} parça içerebilir.`,
    }),
  /** Varsayılan FAST: ucuz ve hızlı. Kombinde maliyet parça sayısıyla çarpılır. */
  mode: tryOnModeSchema.default('FAST'),
});

export type OutfitTryOnCreateInput = z.infer<typeof outfitTryOnCreateSchema>;
