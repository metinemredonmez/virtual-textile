import { z } from 'zod';
import { cursorPaginationSchema, idSchema, quantitySchema } from '@vt/contracts';

/** Prisma OrderStatus ile eş tutulur. */
export const orderStatusSchema = z.enum([
  'PENDING_PAYMENT',
  'PAYMENT_FAILED',
  'EXPIRED',
  'PAID',
  'PARTIALLY_SHIPPED',
  'SHIPPED',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
  'REFUNDED',
]);

/** Prisma ReturnReason ile eş tutulur. */
export const returnReasonSchema = z.enum([
  'SIZE_TOO_SMALL',
  'SIZE_TOO_LARGE',
  'NOT_AS_DESCRIBED',
  'DAMAGED',
  'WRONG_ITEM',
  'CHANGED_MIND',
  'QUALITY',
  'OTHER',
]);

export const orderListQuerySchema = cursorPaginationSchema.extend({
  status: orderStatusSchema.optional(),
});
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

/** VT-260811-0042 — gün 6 hane, sıra en az 4 hane (9999 üstü genişler). */
export const orderNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^VT-\d{6}-\d{4,8}$/, 'Geçersiz sipariş numarası.');

export const cancelOrderSchema = z.object({
  /** Serbest metin müşteriye gösterilmez, satıcı ve destek ekranında görünür. */
  reason: z.string().trim().max(300).optional(),
});
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

export const createReturnSchema = z
  .object({
    reason: returnReasonSchema,
    note: z.string().trim().max(1000).optional(),
    /**
     * Kanıt fotoğrafları private bucket'ta durur; burada yalnızca anahtar
     * taşınır. İmzalı URL üretimi medya modülünün işidir.
     */
    photoKeys: z.array(z.string().trim().min(1).max(400)).max(6).default([]),
    items: z
      .array(z.object({ orderItemId: idSchema, quantity: quantitySchema }))
      .min(1, 'En az bir ürün seçin.')
      .max(50),
  })
  .refine(
    (value) => new Set(value.items.map((item) => item.orderItemId)).size === value.items.length,
    { message: 'Aynı ürün listede birden fazla kez olamaz.', path: ['items'] },
  );
export type CreateReturnInput = z.infer<typeof createReturnSchema>;
