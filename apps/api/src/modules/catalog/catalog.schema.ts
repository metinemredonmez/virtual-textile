import { z } from 'zod';
import { genderSchema, minorAmountSchema, slugSchema } from '@vt/contracts';

/** Tekrarlanan parametreler dizi olarak gelir: ?color=Siyah&color=Bej */
const stringArray = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]));

export const productListQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  category: slugSchema.optional(),
  gender: genderSchema.optional(),
  brand: stringArray,
  color: stringArray,
  size: stringArray,
  minPriceMinor: minorAmountSchema.optional(),
  maxPriceMinor: minorAmountSchema.optional(),
  /** Varsayılan: yalnızca stokta olanlar. */
  inStockOnly: z.coerce.boolean().optional(),
  sort: z.enum(['relevance', 'price_asc', 'price_desc', 'newest']).default('relevance'),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export type ProductListQuery = z.infer<typeof productListQuerySchema>;

export const suggestQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
});
