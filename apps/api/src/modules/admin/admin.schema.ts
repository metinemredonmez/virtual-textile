/**
 * YÖNETİM UÇLARININ GİRDİ ŞEMALARI.
 *
 * ⚠️ GEREKÇE ZORUNLULUĞU: askıya alma, red, manuel iade, payout reddi ve
 *    break-glass erişimi serbest metin gerekçe ister. Gerekçe denetim kaydına
 *    yazılır ve sonradan "bu neden yapıldı" sorusunun tek cevabıdır; boş
 *    geçilebilseydi denetim izi biçimsel bir kayıttan ibaret kalırdı.
 */

import { z } from 'zod';
import { idSchema, minorAmountSchema, slugSchema } from '@vt/contracts';
import { FINANCE } from '@vt/config';

// ── Ortak parçalar ────────────────────────────────────────────────────────

export const adminCursorSchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/** İnsan tarafından okunacak kadar uzun, log'u şişirmeyecek kadar kısa. */
const reasonSchema = z
  .string()
  .trim()
  .min(10, 'Gerekçe en az 10 karakter olmalı.')
  .max(500, 'Gerekçe en fazla 500 karakter olabilir.');

/** Break-glass daha ağır bir işlem: gerekçe de daha somut olmalı. */
const breakGlassReasonSchema = z
  .string()
  .trim()
  .min(30, 'Erişim gerekçesi en az 30 karakter olmalı (talep/şikâyet numarası dahil).')
  .max(1000);

export const reasonBodySchema = z.object({ reason: reasonSchema });
export type ReasonBody = z.infer<typeof reasonBodySchema>;

/** Rapor uçlarında varsayılan aralık: `to` yoksa "şimdi", `from` yoksa son 30 gün. */
const DEFAULT_RANGE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// ── Satıcı ────────────────────────────────────────────────────────────────

export const sellerStatusSchema = z.enum(['PENDING', 'APPROVED', 'SUSPENDED', 'REJECTED']);

export const sellerListQuerySchema = adminCursorSchema.extend({
  status: sellerStatusSchema.optional(),
  /** Unvan / mağaza adı / e-posta içinde arar. */
  q: z.string().trim().min(2).max(100).optional(),
});
export type SellerListQuery = z.infer<typeof sellerListQuerySchema>;

export const sellerApproveSchema = z.object({
  /** Onayda gerekçe isteğe bağlı — reddin aksine açıklama gerektirmez. */
  note: z.string().trim().max(500).optional(),
});
export type SellerApproveInput = z.infer<typeof sellerApproveSchema>;

// ── Ürün moderasyonu ──────────────────────────────────────────────────────

export const productStatusSchema = z.enum([
  'DRAFT',
  'PENDING_REVIEW',
  'PUBLISHED',
  'REJECTED',
  'ARCHIVED',
]);

export const moderationQuerySchema = adminCursorSchema.extend({
  /** Varsayılan kuyruk: incelenmeyi bekleyenler. */
  status: productStatusSchema.default('PENDING_REVIEW'),
  sellerId: idSchema.optional(),
});
export type ModerationQuery = z.infer<typeof moderationQuerySchema>;

// ── Kategori ──────────────────────────────────────────────────────────────

export const tryOnCategorySchema = z.enum(['UPPER_BODY', 'LOWER_BODY', 'DRESS', 'OUTERWEAR']);

export const categoryCreateSchema = z.object({
  parentId: idSchema.nullable().optional(),
  slug: slugSchema,
  name: z.string().trim().min(2).max(80),
  /** null → bu kategoride sanal deneme düğmesi gösterilmez. */
  tryOnCategory: tryOnCategorySchema.nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
});
export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;

export const categoryUpdateSchema = z
  .object({
    parentId: idSchema.nullable().optional(),
    name: z.string().trim().min(2).max(80).optional(),
    tryOnCategory: tryOnCategorySchema.nullable().optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Güncellenecek en az bir alan gönderilmeli.',
  });
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;

// ── Kupon & kampanya ──────────────────────────────────────────────────────

export const discountTypeSchema = z.enum(['PERCENTAGE', 'FIXED_AMOUNT', 'FREE_SHIPPING']);

export const couponListQuerySchema = adminCursorSchema.extend({
  scope: z.enum(['PLATFORM', 'SELLER']).optional(),
  isActive: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
});
export type CouponListQuery = z.infer<typeof couponListQuerySchema>;

export const couponCreateSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(3)
      .max(32)
      .regex(/^[A-Z0-9_-]+$/, 'Kupon kodu yalnızca harf, rakam, tire ve alt çizgi içerebilir.'),
    /** null/boş → PLATFORM kampanyası; dolu → mağaza kuponu. */
    sellerId: idSchema.nullable().optional(),
    discountType: discountTypeSchema,
    /** PERCENTAGE için basis point (1000 = %10), FIXED_AMOUNT için kuruş. */
    discountValue: minorAmountSchema,
    maxDiscountMinor: minorAmountSchema.optional(),
    minCartMinor: minorAmountSchema.default('0'),
    usageLimit: z.number().int().min(1).max(1_000_000).nullable().optional(),
    usageLimitPerUser: z.number().int().min(1).max(100).default(1),
    validFrom: z.coerce.date(),
    validTo: z.coerce.date(),
    isActive: z.boolean().default(true),
  })
  .refine((value) => value.validFrom.getTime() < value.validTo.getTime(), {
    message: 'Kupon bitiş tarihi başlangıçtan sonra olmalı.',
    path: ['validTo'],
  })
  .refine(
    (value) =>
      value.discountType !== 'PERCENTAGE' ||
      (value.discountValue > 0n && value.discountValue <= 10_000n),
    {
      // %100 üstü indirim, sepeti negatife düşürüp ödeme tutarını bozardı.
      message: 'Yüzdesel indirim 1 ile 10000 basis point (%0,01 – %100) arasında olmalı.',
      path: ['discountValue'],
    },
  )
  .refine((value) => value.discountType !== 'FIXED_AMOUNT' || value.discountValue > 0n, {
    message: 'Sabit tutarlı indirim sıfırdan büyük olmalı.',
    path: ['discountValue'],
  })
  .refine((value) => value.discountType !== 'PERCENTAGE' || value.maxDiscountMinor !== undefined, {
    // ⚠️ Tavansız yüzdesel indirim, pahalı bir sepette platformun zararına
    // çalışır ve kötüye kullanıma açıktır.
    message: 'Yüzdesel indirimde azami indirim tutarı zorunludur.',
    path: ['maxDiscountMinor'],
  });
export type CouponCreateInput = z.infer<typeof couponCreateSchema>;

// ── Komisyon ──────────────────────────────────────────────────────────────

/**
 * ⚠️ Üst sınır FINANCE.maxCommissionBps'ten okunuyor; şemada da, saf
 *    çekirdekte de aynı sabit kullanılıyor ki iki taraf ayrışmasın.
 */
const rateBpsSchema = z
  .number()
  .int('Komisyon oranı tam sayı basis point olmalı.')
  .min(0)
  .max(
    FINANCE.maxCommissionBps,
    `Komisyon oranı en fazla %${FINANCE.maxCommissionBps / 100} olabilir.`,
  );

export const commissionRuleCreateSchema = z.object({
  /** İkisi de boş → platform varsayılan kuralı. */
  categoryId: idSchema.nullable().optional(),
  sellerId: idSchema.nullable().optional(),
  label: z.string().trim().min(3).max(120),
  rateBps: rateBpsSchema,
  fixedFeeMinor: minorAmountSchema.default('0'),
  /** Verilmezse "şimdi". Geçmiş tarih reddedilir. */
  validFrom: z.coerce.date().optional(),
});
export type CommissionRuleCreateInput = z.infer<typeof commissionRuleCreateSchema>;

export const commissionVersionCreateSchema = z.object({
  rateBps: rateBpsSchema,
  fixedFeeMinor: minorAmountSchema.default('0'),
  validFrom: z.coerce.date().optional(),
  /** Komisyon değişikliği denetlenen bir işlemdir — gerekçe zorunlu. */
  reason: reasonSchema,
});
export type CommissionVersionCreateInput = z.infer<typeof commissionVersionCreateSchema>;

export const commissionRuleListQuerySchema = z.object({
  categoryId: idSchema.optional(),
  sellerId: idSchema.optional(),
});
export type CommissionRuleListQuery = z.infer<typeof commissionRuleListQuerySchema>;

// ── Sipariş & manuel iade ─────────────────────────────────────────────────

export const adminOrderListQuerySchema = adminCursorSchema.extend({
  status: z
    .enum([
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
    ])
    .optional(),
  sellerId: idSchema.optional(),
  /** Sipariş numarası veya e-posta. */
  q: z.string().trim().min(3).max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type AdminOrderListQuery = z.infer<typeof adminOrderListQuerySchema>;

export const manualRefundSchema = z.object({
  /** Kuruş. Tahsil edilenden fazlası reddedilir. */
  amountMinor: minorAmountSchema,
  reason: reasonSchema,
});
export type ManualRefundInput = z.infer<typeof manualRefundSchema>;

// ── Payout ────────────────────────────────────────────────────────────────

export const payoutStatusSchema = z.enum(['REQUESTED', 'APPROVED', 'SENT', 'FAILED', 'CANCELLED']);

export const payoutListQuerySchema = adminCursorSchema.extend({
  status: payoutStatusSchema.optional(),
  sellerId: idSchema.optional(),
});
export type PayoutListQuery = z.infer<typeof payoutListQuerySchema>;

// ── Raporlar ──────────────────────────────────────────────────────────────

export const aiFeatureSchema = z.enum([
  'TRYON',
  'STYLIST',
  'TAGGING',
  'DESCRIPTION',
  'EMBEDDING',
  'MODERATION',
]);

export const aiUsageQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    feature: aiFeatureSchema.optional(),
    topUserLimit: z.coerce.number().int().min(1).max(50).default(10),
  })
  .transform((value) => {
    const to = value.to ?? new Date();
    const from = value.from ?? new Date(to.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);
    return { ...value, from, to };
  })
  .refine((value) => value.from.getTime() < value.to.getTime(), {
    message: 'Başlangıç tarihi bitiş tarihinden önce olmalı.',
    path: ['from'],
  });
export type AiUsageQuery = z.infer<typeof aiUsageQuerySchema>;

export const gmvQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    granularity: z.enum(['day', 'week', 'month']).default('day'),
    sellerId: idSchema.optional(),
  })
  .transform((value) => {
    const to = value.to ?? new Date();
    const from = value.from ?? new Date(to.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);
    return { ...value, from, to };
  })
  .refine((value) => value.from.getTime() < value.to.getTime(), {
    message: 'Başlangıç tarihi bitiş tarihinden önce olmalı.',
    path: ['from'],
  });
export type GmvQuery = z.infer<typeof gmvQuerySchema>;

export const fraudQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .transform((value) => {
    const to = value.to ?? new Date();
    const from = value.from ?? new Date(to.getTime() - 7 * DAY_MS);
    return { ...value, from, to };
  });
export type FraudQuery = z.infer<typeof fraudQuerySchema>;

export const auditLogQuerySchema = adminCursorSchema.extend({
  actorId: idSchema.optional(),
  entityType: z.string().trim().min(2).max(60).optional(),
  entityId: z.string().trim().min(2).max(80).optional(),
  action: z.string().trim().min(3).max(80).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

// ── Break-glass (KVKK) ────────────────────────────────────────────────────

export const breakGlassSchema = z.object({
  reason: breakGlassReasonSchema,
  /** Tek bir fotoğrafa erişim — verilmezse kullanıcının tüm fotoğraf ÜST VERİSİ. */
  photoId: idSchema.optional(),
});
export type BreakGlassInput = z.infer<typeof breakGlassSchema>;
