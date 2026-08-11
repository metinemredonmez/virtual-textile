import { z } from 'zod';
import { idSchema, quantitySchema } from '@vt/contracts';

export const addItemSchema = z.object({
  variantId: idSchema,
  quantity: quantitySchema.default(1),
  /** Kombin tabanlı sepet: kalem bir kombine bağlanabilir. */
  outfitId: idSchema.optional(),
});

export const updateItemSchema = z.object({
  quantity: quantitySchema,
  /**
   * Kullanıcı, fiyatı değişmiş kalemin YENİ fiyatını açıkça kabul ediyor.
   * Bayrak olmadan `addedPriceMinor` dokunulmaz kalır: adet değiştirmek,
   * araya girmiş bir zammı sessizce onaylamak anlamına gelmemeli.
   */
  acceptPriceChange: z.boolean().default(false),
});

export const applyCouponSchema = z.object({ code: z.string().trim().min(3).max(40) });

/**
 * Misafir sepetini üye hesabına taşır.
 * Misafir oturumu tarayıcıda üretilen tahmin edilemez bir UUID'dir; bilen
 * herkes o sepeti okuyabilir, bu yüzden UUID biçimi zorunlu tutulur.
 */
export const mergeCartSchema = z.object({ sessionId: z.string().uuid() });

export const createOutfitSchema = z.object({
  name: z.string().trim().min(1).max(80),
  /** Kombin oluşturulurken kalemler doğrudan sepete de eklenir. */
  items: z
    .array(z.object({ variantId: idSchema, quantity: quantitySchema.default(1) }))
    .min(1)
    .max(20),
});

export type AddItemInput = z.infer<typeof addItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export type ApplyCouponInput = z.infer<typeof applyCouponSchema>;
export type MergeCartInput = z.infer<typeof mergeCartSchema>;
export type CreateOutfitInput = z.infer<typeof createOutfitSchema>;
