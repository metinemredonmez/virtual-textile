/**
 * SATICI MODÜLÜNÜN DIŞ DÜNYAYA BAKAN YÜZEYİ.
 *
 * Kural 3: bir modül başka modülün Prisma modeline dokunmaz.
 *
 * Satıcı modülünün SAHİP OLDUĞU tablolar: Seller, SellerUser, SellerDocument,
 * Store, LedgerEntry, PayoutRequest. Bunlara doğrudan erişilir.
 *
 * Sahip OLMADIĞI veri üç gruba ayrılıyor:
 *
 *  1. SİPARİŞ YAZMA  → port YOK. `OrderService` yayımlanmış bir servistir ve
 *     doğrudan enjekte edilir (paket geçişi, iade onayı/reddi). Satıcı paket
 *     tablosuna kendi yazsaydı geçiş makinesi ve OrderEvent kaydı atlanırdı.
 *
 *  2. KATALOG YAZMA  → port VAR. `CatalogService` yalnızca vitrin okuması
 *     yayımlıyor; satıcı ürün/varyant/stok yazma yüzeyi yok.
 *
 *  3. OKUMA (sipariş listesi, iade listesi, analitik) → port VAR. İlgili
 *     modüller satıcı kırılımlı okuma yayımlamıyor.
 *
 * ⚠️ ENTEGRASYON AJANI İÇİN: ilgili modüller bu yüzeyleri yayımladığında
 *    `index.ts` içindeki token bağlamaları onlara çevrilir ve
 *    `seller.bridges.ts` SİLİNİR. Bu dosyadaki tipler ve servisler değişmez.
 */
import type { Gender, PackageStatus, ProductStatus, ReturnStatus } from '@vt/db';
import type { BulkProductDraft } from './seller-csv.js';

// ══════════════════════════ KATALOG YAZMA ═══════════════════════════════════

export const SELLER_CATALOG = 'SELLER_CATALOG_PORT';

export interface SellerProductSummary {
  id: string;
  slug: string;
  title: string;
  brandName: string;
  status: ProductStatus;
  gender: Gender;
  categoryId: string;
  tryOnScore: number | null;
  tryOnIssues: unknown;
  aiTagsApproved: boolean;
  variantCount: number;
  /** Satılabilir toplam adet (onHand − reserved). */
  availableStock: number;
  minPriceMinor: bigint | null;
  imageKey: string | null;
  publishedAt: Date | null;
  updatedAt: Date;
}

export interface SellerVariantDetail {
  id: string;
  sku: string;
  color: string;
  colorHex: string;
  size: string;
  priceMinor: bigint;
  listPriceMinor: bigint | null;
  barcode: string | null;
  isActive: boolean;
  sortOrder: number;
  onHand: number;
  reserved: number;
}

export interface SellerProductDetail extends SellerProductSummary {
  description: string;
  season: string | null;
  collection: string | null;
  statusReason: string | null;
  aiTags: unknown;
  sizeChart: unknown;
  variants: SellerVariantDetail[];
  images: Array<{ id: string; storageKey: string; angle: string; isPrimary: boolean }>;
}

export interface CreateProductCommand {
  title: string;
  description: string;
  categoryId: string;
  brandName: string;
  gender: Gender;
  season?: string | undefined;
  collection?: string | undefined;
  sizeChart?: unknown;
  variants: ReadonlyArray<{
    sku: string;
    color: string;
    colorHex: string;
    size: string;
    priceMinor: bigint;
    listPriceMinor?: bigint | undefined;
    barcode?: string | undefined;
    stock: number;
    sortOrder: number;
  }>;
}

export interface UpdateProductCommand {
  title?: string | undefined;
  description?: string | undefined;
  categoryId?: string | undefined;
  brandName?: string | undefined;
  gender?: Gender | undefined;
  season?: string | null | undefined;
  collection?: string | null | undefined;
  sizeChart?: unknown;
  aiTagsApproved?: boolean | undefined;
  status?: 'DRAFT' | 'PENDING_REVIEW' | 'ARCHIVED' | undefined;
}

export interface VariantUpdateCommand {
  variantId: string;
  priceMinor?: bigint | undefined;
  listPriceMinor?: bigint | null | undefined;
  /** MUTLAK stok — delta değil. Tekrarlanan istek stoku ikiye katlamasın. */
  stock?: number | undefined;
  isActive?: boolean | undefined;
}

export interface BulkUpsertResult {
  createdProducts: number;
  updatedProducts: number;
  createdVariants: number;
  updatedVariants: number;
}

export interface SellerCatalogPort {
  listProducts(
    sellerId: string,
    query: {
      status?: ProductStatus | undefined;
      q?: string | undefined;
      cursor?: string | undefined;
      limit: number;
    },
  ): Promise<{ items: SellerProductSummary[]; nextCursor: string | null }>;

  getProduct(sellerId: string, productId: string): Promise<SellerProductDetail>;

  createProduct(sellerId: string, input: CreateProductCommand): Promise<SellerProductDetail>;

  updateProduct(
    sellerId: string,
    productId: string,
    patch: UpdateProductCommand,
    actorUserId: string,
  ): Promise<SellerProductDetail>;

  archiveProduct(sellerId: string, productId: string): Promise<void>;

  /**
   * Varyant fiyat/stok/aktiflik toplu güncellemesi.
   * ⚠️ TEK transaction: kısmi uygulanırsa satıcı hangi satırın geçtiğini bilemez.
   */
  bulkUpdateVariants(
    sellerId: string,
    updates: readonly VariantUpdateCommand[],
    actorUserId: string,
  ): Promise<{ updated: number }>;

  /**
   * CSV'den gelen ürünleri yazar. ⚠️ HEPSİ YA DA HİÇBİRİ.
   * `skus` çakışması gibi veritabanı düzeyindeki hatalar da satır numarasıyla
   * BULK_UPLOAD_INVALID'e çevrilir.
   */
  bulkUpsertProducts(
    sellerId: string,
    products: readonly BulkProductDraft[],
    actorUserId: string,
  ): Promise<BulkUpsertResult>;
}

// ══════════════════════════ SİPARİŞ OKUMA ═══════════════════════════════════

export const SELLER_FULFILLMENT_READER = 'SELLER_FULFILLMENT_READER_PORT';

export interface SellerPackageSummary {
  id: string;
  orderId: string;
  orderNumber: string;
  status: PackageStatus;
  itemsTotalMinor: bigint;
  shippingMinor: bigint;
  discountShareMinor: bigint;
  carrier: string | null;
  trackingNo: string | null;
  slaDeadline: Date;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
  itemCount: number;
  /** SLA süresi geçti mi — satıcı panelinde kırmızı rozet. */
  slaBreached: boolean;
}

export interface SellerPackageDetail extends SellerPackageSummary {
  /**
   * ⚠️ Müşteri adresinin YALNIZCA kargo için gerekli alanları.
   * Tam adres nesnesi verilmez: satıcı, müşterinin e-postasını ve fatura
   * bilgisini görmek zorunda değildir (veri minimizasyonu, KVKK m.4).
   */
  shipping: {
    contactName: string;
    phone: string;
    city: string;
    district: string;
    neighbourhood: string | null;
    line1: string;
    postalCode: string | null;
  };
  items: Array<{
    id: string;
    productTitle: string;
    variantLabel: string;
    sku: string;
    imageKey: string;
    quantity: number;
    unitPriceMinor: bigint;
    lineTotalMinor: bigint;
    /** Satıcının bu kalemden hakedişi. */
    sellerNetMinor: bigint;
    commissionAmountMinor: bigint;
    commissionRateBps: number;
  }>;
}

export interface SellerReturnSummary {
  id: string;
  returnNumber: string;
  orderId: string;
  orderNumber: string;
  status: ReturnStatus;
  reason: string;
  note: string | null;
  refundAmountMinor: bigint;
  createdAt: Date;
  decidedAt: Date | null;
  items: Array<{
    orderItemId: string;
    productTitle: string;
    variantLabel: string;
    quantity: number;
    refundMinor: bigint;
  }>;
  /** İade kanıt fotoğraflarının depolama anahtarları (imzalı URL medya modülünün işi). */
  photoKeys: string[];
}

export interface SellerFulfillmentReaderPort {
  listPackages(
    sellerId: string,
    query: {
      status?: PackageStatus | undefined;
      slaBreached?: boolean | undefined;
      orderNumber?: string | undefined;
      cursor?: string | undefined;
      limit: number;
    },
  ): Promise<{ items: SellerPackageSummary[]; nextCursor: string | null }>;

  getPackage(sellerId: string, packageId: string): Promise<SellerPackageDetail>;

  listReturns(
    sellerId: string,
    query: { status?: ReturnStatus | undefined; cursor?: string | undefined; limit: number },
  ): Promise<{ items: SellerReturnSummary[]; nextCursor: string | null }>;

  getReturn(sellerId: string, returnId: string): Promise<SellerReturnSummary>;
}

// ══════════════════════════ ANALİTİK OKUMA ══════════════════════════════════

export const SELLER_ANALYTICS_READER = 'SELLER_ANALYTICS_READER_PORT';

export interface DateRange {
  readonly from: Date;
  readonly to: Date;
}

export interface SellerAnalyticsReaderPort {
  /** Huninin toplam sayımları + ciro. */
  funnelTotals(
    sellerId: string,
    range: DateRange,
  ): Promise<{
    tryOnCount: number;
    cartAddCount: number;
    purchasedCount: number;
    revenueMinor: bigint;
    orderCount: number;
  }>;

  /** Ürün bazlı huni — en çok denenen ilk N ürün. */
  funnelByProduct(
    sellerId: string,
    range: DateRange,
    limit: number,
  ): Promise<
    Array<{
      productId: string;
      title: string;
      tryOnScore: number | null;
      tryOnCount: number;
      cartAddCount: number;
      purchasedCount: number;
    }>
  >;

  /** Beden bazlı satış ve iade sayımları. */
  returnsBySize(
    sellerId: string,
    range: DateRange,
  ): Promise<
    Array<{
      size: string;
      soldQuantity: number;
      returnedQuantity: number;
      tooSmallQuantity: number;
      tooLargeQuantity: number;
    }>
  >;
}

// ══════════════════════════ KUPON YAZMA ═════════════════════════════════════

export const SELLER_COUPON = 'SELLER_COUPON_PORT';

export interface SellerCouponView {
  id: string;
  code: string;
  discountType: string;
  discountValue: bigint;
  maxDiscountMinor: bigint | null;
  minCartMinor: bigint;
  usageLimit: number | null;
  usageLimitPerUser: number;
  usedCount: number;
  validFrom: Date;
  validTo: Date;
  isActive: boolean;
  createdAt: Date;
}

export interface SellerCouponPort {
  list(
    sellerId: string,
    query: { isActive?: boolean | undefined; cursor?: string | undefined; limit: number },
  ): Promise<{ items: SellerCouponView[]; nextCursor: string | null }>;

  create(
    sellerId: string,
    input: {
      code: string;
      discountType: 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE_SHIPPING';
      discountValue: bigint;
      maxDiscountMinor?: bigint | undefined;
      minCartMinor: bigint;
      usageLimit?: number | undefined;
      usageLimitPerUser: number;
      validFrom: Date;
      validTo: Date;
    },
  ): Promise<SellerCouponView>;

  update(
    sellerId: string,
    couponId: string,
    patch: {
      isActive?: boolean | undefined;
      validTo?: Date | undefined;
      usageLimit?: number | null | undefined;
    },
  ): Promise<SellerCouponView>;
}
