import { z } from 'zod';
import {
  cursorPaginationSchema,
  emailSchema,
  genderSchema,
  ibanSchema,
  idSchema,
  minorAmountSchema,
  phoneSchema,
  slugSchema,
  taxNumberSchema,
} from '@vt/contracts';
import { MAX_CSV_BYTES } from './seller-csv.js';

// ── Başvuru & mağaza ──────────────────────────────────────────────────────

export const sellerApplySchema = z.object({
  legalName: z.string().trim().min(3, 'Ticari unvan en az 3 karakter olmalı.').max(200),
  displayName: z.string().trim().min(2, 'Mağaza adı en az 2 karakter olmalı.').max(120),
  /** Şifreli saklanır — bkz. seller-crypto.ts */
  taxNumber: taxNumberSchema,
  taxOffice: z.string().trim().min(2).max(80),
  /** Şifreli saklanır. Yalnızca payout akışında çözülür. */
  iban: ibanSchema,
  contactEmail: emailSchema,
  contactPhone: phoneSchema,
  /** Mağaza vitrin adresi: /magaza/<slug> */
  storeSlug: slugSchema,
  storeDescription: z.string().trim().max(1_000).optional(),
});
export type SellerApplyInput = z.infer<typeof sellerApplySchema>;

export const updateStoreSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(1_000).nullable().optional(),
    logoKey: z.string().trim().max(400).nullable().optional(),
    bannerKey: z.string().trim().max(400).nullable().optional(),
    /** Tatil modu: mağaza siparişe kapanır, ürünler vitrinde kalır. */
    vacationMode: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Güncellenecek en az bir alan gönderin.',
  });
export type UpdateStoreInput = z.infer<typeof updateStoreSchema>;

// ── Ürün ──────────────────────────────────────────────────────────────────

export const productStatusSchema = z.enum([
  'DRAFT',
  'PENDING_REVIEW',
  'PUBLISHED',
  'REJECTED',
  'ARCHIVED',
]);

const variantInputSchema = z.object({
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .min(3)
    .max(64)
    .regex(/^[A-Z0-9._-]+$/, 'SKU yalnızca harf, rakam, nokta, tire ve alt çizgi içerebilir.'),
  color: z.string().trim().min(1).max(60),
  colorHex: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^#[0-9A-F]{6}$/, 'Renk kodu #RRGGBB biçiminde olmalı.'),
  size: z.string().trim().min(1).max(20),
  priceMinor: minorAmountSchema,
  listPriceMinor: minorAmountSchema.optional(),
  barcode: z.string().trim().max(64).optional(),
  stock: z.number().int().min(0).max(1_000_000).default(0),
  sortOrder: z.number().int().min(0).max(9_999).default(0),
});

export const createProductSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(10, 'Açıklama en az 10 karakter olmalı.').max(5_000),
  categoryId: idSchema,
  brandName: z.string().trim().min(1).max(120),
  gender: genderSchema,
  season: z.string().trim().max(40).optional(),
  collection: z.string().trim().max(80).optional(),
  /** {"M":{"chest":98,...}} — beden öneri motoru okur. */
  sizeChart: z.record(z.record(z.number())).optional(),
  variants: z
    .array(variantInputSchema)
    .min(1, 'En az bir varyant ekleyin.')
    .max(200)
    .refine(
      (variants) =>
        new Set(variants.map((v) => `${v.color.toLowerCase()}|${v.size.toLowerCase()}`)).size ===
        variants.length,
      { message: 'Aynı renk ve beden birden fazla kez eklenemez.' },
    )
    .refine((variants) => new Set(variants.map((v) => v.sku)).size === variants.length, {
      message: 'SKU değerleri benzersiz olmalı.',
    }),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z
  .object({
    title: z.string().trim().min(3).max(200).optional(),
    description: z.string().trim().min(10).max(5_000).optional(),
    categoryId: idSchema.optional(),
    brandName: z.string().trim().min(1).max(120).optional(),
    gender: genderSchema.optional(),
    season: z.string().trim().max(40).nullable().optional(),
    collection: z.string().trim().max(80).nullable().optional(),
    sizeChart: z.record(z.record(z.number())).nullable().optional(),
    /** AI etiketleri onaylanmadan ürün yayınlanamaz (schema.prisma kuralı). */
    aiTagsApproved: z.boolean().optional(),
    /**
     * Satıcı yalnızca bu geçişleri kendi yapabilir. PUBLISHED'a geçiş
     * doğrudan verilmez: moderasyon admin işidir.
     */
    status: z.enum(['DRAFT', 'PENDING_REVIEW', 'ARCHIVED']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Güncellenecek en az bir alan gönderin.',
  });
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const productListQuerySchema = cursorPaginationSchema.extend({
  status: productStatusSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
export type SellerProductListQuery = z.infer<typeof productListQuerySchema>;

// ── Toplu güncelleme ──────────────────────────────────────────────────────

/**
 * Varyant toplu güncelleme.
 *
 * `stock` MUTLAK değerdir, delta değil. Delta olsaydı ağ tekrarında aynı
 * istek iki kez uygulanıp stok sessizce iki katına çıkardı; mutlak değer
 * idempotenttir.
 */
export const bulkVariantUpdateSchema = z.object({
  updates: z
    .array(
      z
        .object({
          variantId: idSchema,
          priceMinor: minorAmountSchema.optional(),
          listPriceMinor: minorAmountSchema.nullable().optional(),
          stock: z.number().int().min(0).max(1_000_000).optional(),
          isActive: z.boolean().optional(),
        })
        .refine(
          (value) =>
            value.priceMinor !== undefined ||
            value.listPriceMinor !== undefined ||
            value.stock !== undefined ||
            value.isActive !== undefined,
          { message: 'Her satırda güncellenecek en az bir alan olmalı.' },
        ),
    )
    .min(1)
    .max(500)
    .refine((updates) => new Set(updates.map((u) => u.variantId)).size === updates.length, {
      message: 'Aynı varyant listede birden fazla kez olamaz.',
    }),
});
export type BulkVariantUpdateInput = z.infer<typeof bulkVariantUpdateSchema>;

/**
 * CSV toplu yükleme.
 *
 * ⚠️ multipart/form-data DEĞİL: `@types/multer` bu uygulamanın bağımlılıkları
 *    arasında yok ve yeni paket kurmak bu ajanın yetkisi dışında. Dosya içeriği
 *    JSON gövdede metin olarak taşınıyor; alan adı ve boyut sınırı korunuyor.
 *    Multer eklendiğinde yalnızca denetleyicideki bu bağlama değişir, ayrıştırma
 *    ve doğrulama çekirdeği (seller-csv.ts) aynen kalır.
 */
export const bulkUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  content: z
    .string()
    .min(1, 'Dosya boş.')
    // Bayt cinsinden ölçülür: çok baytlı Türkçe karakterlerde karakter sayısı
    // gerçek boyutu olduğundan küçük gösterir.
    .refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_CSV_BYTES, {
      message: `Dosya en fazla ${Math.floor(MAX_CSV_BYTES / (1024 * 1024))} MB olabilir.`,
    }),
});
export type BulkUploadInput = z.infer<typeof bulkUploadSchema>;

// ── Sipariş & paket ───────────────────────────────────────────────────────

export const packageStatusSchema = z.enum([
  'AWAITING_APPROVAL',
  'PREPARING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'RETURN_REQUESTED',
  'RETURNED',
]);

export const sellerOrderListQuerySchema = cursorPaginationSchema.extend({
  status: packageStatusSchema.optional(),
  /** SLA süresi dolmak üzere olan paketleri öne çeker. */
  slaBreached: z.coerce.boolean().optional(),
  orderNumber: z.string().trim().max(40).optional(),
});
export type SellerOrderListQuery = z.infer<typeof sellerOrderListQuerySchema>;

/**
 * Satıcının yapabileceği paket geçişleri.
 *
 * DELIVERED ve RETURNED listede YOK: teslim bilgisi kargo entegrasyonundan,
 * iade kapanışı iade akışından gelir. Satıcıya bırakılsaydı satıcı paketi
 * "teslim edildi" işaretleyip hakediş penceresini erken açabilirdi.
 */
export const updatePackageStatusSchema = z
  .object({
    status: z.enum(['PREPARING', 'SHIPPED', 'CANCELLED']),
    carrier: z.string().trim().min(2).max(60).optional(),
    trackingNo: z.string().trim().min(4).max(64).optional(),
    cancelReason: z.string().trim().min(3).max(300).optional(),
  })
  .refine((value) => value.status !== 'SHIPPED' || (value.carrier && value.trackingNo), {
    message: 'Kargoya verilen pakette kargo firması ve takip numarası zorunludur.',
    path: ['trackingNo'],
  })
  .refine((value) => value.status !== 'CANCELLED' || Boolean(value.cancelReason), {
    message: 'İptal gerekçesi zorunludur.',
    path: ['cancelReason'],
  });
export type UpdatePackageStatusInput = z.infer<typeof updatePackageStatusSchema>;

/** Kargo takip numarası girişi — paketi SHIPPED'a taşır. */
export const shipPackageSchema = z.object({
  carrier: z.string().trim().min(2).max(60),
  trackingNo: z.string().trim().min(4).max(64),
});
export type ShipPackageInput = z.infer<typeof shipPackageSchema>;

// ── İade ──────────────────────────────────────────────────────────────────

export const returnStatusSchema = z.enum([
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'IN_TRANSIT',
  'RECEIVED',
  'REFUNDED',
  'CANCELLED',
]);

export const sellerReturnListQuerySchema = cursorPaginationSchema.extend({
  status: returnStatusSchema.optional(),
});
export type SellerReturnListQuery = z.infer<typeof sellerReturnListQuerySchema>;

export const decideReturnSchema = z
  .object({
    action: z.enum(['APPROVE', 'REJECT']),
    rejectReason: z
      .string()
      .trim()
      .min(10, 'Ret gerekçesi en az 10 karakter olmalı.')
      .max(500)
      .optional(),
  })
  .refine((value) => value.action !== 'REJECT' || Boolean(value.rejectReason), {
    message: 'İadeyi reddederken gerekçe zorunludur.',
    path: ['rejectReason'],
  });
export type DecideReturnInput = z.infer<typeof decideReturnSchema>;

// ── Finans ────────────────────────────────────────────────────────────────

export const ledgerQuerySchema = cursorPaginationSchema.extend({
  type: z
    .enum([
      'SALE',
      'COMMISSION',
      'SHIPPING_SHARE',
      'REFUND',
      'COMMISSION_REVERSAL',
      'SHIPPING_REVERSAL',
      'PAYOUT',
      'ADJUSTMENT',
    ])
    .optional(),
});
export type LedgerQuery = z.infer<typeof ledgerQuerySchema>;

/**
 * Ödeme talebi.
 *
 * Tutar AÇIKÇA istenir, "hepsini çek" kısayolu yoktur: talep anındaki
 * çekilebilir bakiye ile satıcının ekranda gördüğü tutar farklı olabilir
 * (arada bir iade düşmüş olabilir). Açık tutar, idempotency özetini de
 * kararlı kılar.
 */
export const createPayoutSchema = z.object({
  amountMinor: minorAmountSchema.refine((value) => value > 0n, {
    message: 'Tutar sıfırdan büyük olmalı.',
  }),
});
export type CreatePayoutInput = z.infer<typeof createPayoutSchema>;

export const payoutListQuerySchema = cursorPaginationSchema.extend({
  status: z.enum(['REQUESTED', 'APPROVED', 'SENT', 'FAILED', 'CANCELLED']).optional(),
});
export type PayoutListQuery = z.infer<typeof payoutListQuerySchema>;

// ── Analitik ──────────────────────────────────────────────────────────────

const isoDate = z
  .string()
  .datetime({ offset: true })
  .or(z.coerce.date().transform((d) => d.toISOString()));

/** Varsayılan pencere: son 30 gün. Sınırsız aralık raporu veritabanını yorar. */
export const MAX_ANALYTICS_DAYS = 365;

export const analyticsQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .transform((value) => {
    const to = value.to ? new Date(value.to) : new Date();
    const from = value.from
      ? new Date(value.from)
      : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { from, to };
  })
  .refine((value) => value.from.getTime() < value.to.getTime(), {
    message: 'Başlangıç tarihi bitiş tarihinden önce olmalı.',
  })
  .refine(
    (value) =>
      value.to.getTime() - value.from.getTime() <= MAX_ANALYTICS_DAYS * 24 * 60 * 60 * 1000,
    { message: `Rapor aralığı en fazla ${MAX_ANALYTICS_DAYS} gün olabilir.` },
  );
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

// ── Kupon ─────────────────────────────────────────────────────────────────

/**
 * Mağaza kuponu.
 *
 * ⚠️ PERCENTAGE indiriminde `discountValue` BASIS POINT'tir (1000 = %10).
 *    Yüzde float olarak taşınsaydı %12,5 gibi değerlerde kuruş kayardı.
 */
export const createCouponSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(4, 'Kupon kodu en az 4 karakter olmalı.')
      .max(32)
      .regex(/^[A-Z0-9]+$/, 'Kupon kodu yalnızca harf ve rakam içerebilir.'),
    discountType: z.enum(['PERCENTAGE', 'FIXED_AMOUNT', 'FREE_SHIPPING']),
    /** PERCENTAGE için basis point, FIXED_AMOUNT için kuruş. */
    discountValue: minorAmountSchema,
    maxDiscountMinor: minorAmountSchema.optional(),
    minCartMinor: minorAmountSchema.default('0'),
    usageLimit: z.number().int().min(1).max(1_000_000).optional(),
    usageLimitPerUser: z.number().int().min(1).max(100).default(1),
    validFrom: z.coerce.date(),
    validTo: z.coerce.date(),
  })
  .refine((value) => value.validFrom.getTime() < value.validTo.getTime(), {
    message: 'Bitiş tarihi başlangıçtan sonra olmalı.',
    path: ['validTo'],
  })
  .refine((value) => value.discountType !== 'PERCENTAGE' || value.discountValue <= 10_000n, {
    message: 'Yüzdesel indirim %100 (10000 basis point) üzerinde olamaz.',
    path: ['discountValue'],
  })
  .refine((value) => value.discountType !== 'FREE_SHIPPING' || value.discountValue === 0n, {
    message: 'Ücretsiz kargo kuponunda indirim tutarı 0 olmalı.',
    path: ['discountValue'],
  })
  .refine((value) => value.discountType === 'PERCENTAGE' || value.maxDiscountMinor === undefined, {
    message: 'Azami indirim yalnızca yüzdesel kuponlarda kullanılır.',
    path: ['maxDiscountMinor'],
  });
export type CreateCouponInput = z.infer<typeof createCouponSchema>;

export const updateCouponSchema = z
  .object({
    isActive: z.boolean().optional(),
    validTo: z.coerce.date().optional(),
    usageLimit: z.number().int().min(1).max(1_000_000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Güncellenecek en az bir alan gönderin.',
  });
export type UpdateCouponInput = z.infer<typeof updateCouponSchema>;

export const couponListQuerySchema = cursorPaginationSchema.extend({
  isActive: z.coerce.boolean().optional(),
});
export type CouponListQuery = z.infer<typeof couponListQuerySchema>;
