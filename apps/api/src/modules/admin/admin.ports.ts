/**
 * YÖNETİM MODÜLÜ — MODÜL SINIRLARI
 *
 * Kural 3: bir modül yalnızca KENDİ Prisma modellerine dokunur.
 *
 * Yönetim modülünün SAHİP OLDUĞU tablolar:
 *   CommissionRule, CommissionRuleVersion, AuditLog
 *   (+ altyapı: OutboxEvent)
 *
 * Geri kalan her şey — satıcı, ürün, kategori, kupon, sipariş, payout,
 * AI kullanım kayıtları, kullanıcı fotoğrafları — BAŞKA modüllerin verisidir.
 * Admin bunlara yalnızca buradaki dar portlar üzerinden erişir.
 *
 * ⚠️ ENTEGRASYON AJANI İÇİN: satıcı / promosyon / finans / AI modülleri
 *    yayımlandığında `index.ts` içindeki token bağlamalarını onların
 *    servislerine çevirin ve `admin.bridges.ts` dosyasını SİLİN. Yönetim
 *    servislerinde tek satır değişmesi gerekmez.
 *
 * ⚠️ YAZMA İŞLEMLERİ `tx` ALIR. Denetim kaydı (AuditLog) ile değişikliğin
 *    aynı transaction'da olması zorunlu; port kendi transaction'ını açsaydı
 *    değişiklik yazılıp denetim kaydı geri alınabilirdi.
 */

import type {
  AiFeature,
  DiscountType,
  OrderStatus,
  PayoutStatus,
  Prisma,
  ProductStatus,
  SellerStatus,
  TryOnCategory,
} from '@vt/db';

export type Tx = Prisma.TransactionClient;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

// ════════════════════════════ SATICI ════════════════════════════════════════
//
// Ayrı bir "SellerApplication" tablosu YOK: başvuru, `status = PENDING` olan
// Seller kaydının kendisidir (bkz. schema.prisma). Bu yüzden "başvuru
// inceleme" ile "satıcı yönetimi" tek port altında toplandı.

export interface AdminSellerRecord {
  id: string;
  legalName: string;
  displayName: string;
  contactEmail: string;
  contactPhone: string;
  taxOffice: string;
  status: SellerStatus;
  statusReason: string | null;
  qualityScore: number;
  vacationMode: boolean;
  submerchantKeyPresent: boolean;
  storeSlug: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  productCount: number;
  /** Belge İÇERİĞİ değil, yalnızca üst veri. İndirme ayrı bir akıştır. */
  documents: Array<{
    id: string;
    type: string;
    fileName: string;
    approved: boolean | null;
    reviewedAt: Date | null;
  }>;
}

export interface AdminSellerPort {
  list(query: {
    status?: SellerStatus | undefined;
    q?: string | undefined;
    cursor?: string | undefined;
    limit: number;
  }): Promise<Page<AdminSellerRecord>>;

  findById(sellerId: string): Promise<AdminSellerRecord | null>;

  /**
   * Satırı bu transaction boyunca kilitler ve GÜNCEL durumu okur.
   * ⚠️ Kilitsiz okunsaydı iki admin aynı anda onaylayıp iki kez
   *    `seller.approved` olayı üretebilirdi.
   */
  lockAndRead(
    tx: Tx,
    sellerId: string,
  ): Promise<{ id: string; status: SellerStatus; statusReason: string | null } | null>;

  applyStatus(
    tx: Tx,
    sellerId: string,
    patch: { status: SellerStatus; statusReason: string | null; approvedAt?: Date | null },
  ): Promise<void>;
}

export const ADMIN_SELLER_PORT = 'ADMIN_SELLER_PORT';

// ═══════════════════════════ ÜRÜN MODERASYONU ═══════════════════════════════

export interface AdminModerationRecord {
  id: string;
  slug: string;
  title: string;
  brandName: string;
  status: ProductStatus;
  statusReason: string | null;
  sellerId: string;
  sellerName: string;
  categoryName: string;
  aiTagsApproved: boolean;
  tryOnScore: number | null;
  imageCount: number;
  variantCount: number;
  createdAt: Date;
}

export interface AdminModerationPort {
  queue(query: {
    status?: ProductStatus | undefined;
    sellerId?: string | undefined;
    cursor?: string | undefined;
    limit: number;
  }): Promise<Page<AdminModerationRecord>>;

  lockAndRead(
    tx: Tx,
    productId: string,
  ): Promise<{
    id: string;
    status: ProductStatus;
    statusReason: string | null;
    sellerId: string;
    /** Satıcı onaylı değilse ürün yayına alınmaz — vitrine düşmez, boşuna denenmez. */
    sellerStatus: SellerStatus;
    aiTagsApproved: boolean;
    imageCount: number;
    publishedAt: Date | null;
  } | null>;

  applyStatus(
    tx: Tx,
    productId: string,
    patch: { status: ProductStatus; statusReason: string | null; publishedAt?: Date | null },
  ): Promise<void>;
}

export const ADMIN_MODERATION_PORT = 'ADMIN_MODERATION_PORT';

// ═════════════════════════════ KATEGORİ ═════════════════════════════════════

export interface AdminCategoryRecord {
  id: string;
  parentId: string | null;
  slug: string;
  name: string;
  tryOnCategory: TryOnCategory | null;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
}

export interface AdminCategoryPort {
  list(): Promise<AdminCategoryRecord[]>;
  findById(categoryId: string): Promise<AdminCategoryRecord | null>;
  create(
    tx: Tx,
    data: {
      parentId: string | null;
      slug: string;
      name: string;
      tryOnCategory: TryOnCategory | null;
      sortOrder: number;
      isActive: boolean;
    },
  ): Promise<AdminCategoryRecord>;
  update(
    tx: Tx,
    categoryId: string,
    patch: Partial<{
      parentId: string | null;
      name: string;
      tryOnCategory: TryOnCategory | null;
      sortOrder: number;
      isActive: boolean;
    }>,
  ): Promise<AdminCategoryRecord>;
}

export const ADMIN_CATEGORY_PORT = 'ADMIN_CATEGORY_PORT';

// ═══════════════════════════ KUPON & KAMPANYA ═══════════════════════════════
//
// ⚠️ Ayrı bir "Campaign" tablosu YOK. Şemada kampanya, `sellerId = NULL` olan
//    PLATFORM kuponudur; mağaza kuponunda `sellerId` doludur. Uçlar bu ayrımı
//    `scope` alanıyla gösteriyor.

export interface AdminCouponRecord {
  id: string;
  code: string;
  sellerId: string | null;
  scope: 'PLATFORM' | 'SELLER';
  discountType: DiscountType;
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

export interface AdminPromoPort {
  list(query: {
    scope?: 'PLATFORM' | 'SELLER' | undefined;
    isActive?: boolean | undefined;
    cursor?: string | undefined;
    limit: number;
  }): Promise<Page<AdminCouponRecord>>;

  findById(couponId: string): Promise<AdminCouponRecord | null>;

  create(
    tx: Tx,
    data: {
      code: string;
      sellerId: string | null;
      discountType: DiscountType;
      discountValue: bigint;
      maxDiscountMinor: bigint | null;
      minCartMinor: bigint;
      usageLimit: number | null;
      usageLimitPerUser: number;
      validFrom: Date;
      validTo: Date;
      isActive: boolean;
    },
  ): Promise<AdminCouponRecord>;

  /** ⚠️ Kupon SİLİNMEZ, pasifleştirilir: geçmiş kullanımların dayanağı kalmalı. */
  deactivate(tx: Tx, couponId: string): Promise<void>;
}

export const ADMIN_PROMO_PORT = 'ADMIN_PROMO_PORT';

// ═══════════════════════════ SİPARİŞ (OKUMA) ════════════════════════════════
//
// ⚠️ SALT OKUNUR. Sipariş durumunu yalnızca OrderService değiştirir; admin
//    manuel iadeyi bile doğrudan yazmaz, OutboxEvent ile ödeme modülüne devreder.

export interface AdminOrderRecord {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  email: string;
  itemsTotalMinor: bigint;
  shippingTotalMinor: bigint;
  discountMinor: bigint;
  grandTotalMinor: bigint;
  currency: string;
  createdAt: Date;
  paidAt: Date | null;
  packageCount: number;
  itemCount: number;
  sellerNames: string[];
}

/** Manuel iade kararının dayanağı — tutarlar ÖDEME kayıtlarından gelir. */
export interface AdminRefundContext {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  currency: string;
  paidAt: Date | null;
  /** Sağlayıcıdan gerçekten tahsil edilen tutar. */
  capturedMinor: bigint;
  /** Daha önce iade edilen (başarısızlar hariç). */
  alreadyRefundedMinor: bigint;
}

export interface GmvBucket {
  bucket: Date;
  orderCount: number;
  itemCount: number;
  gmvMinor: bigint;
  commissionMinor: bigint;
  sellerNetMinor: bigint;
}

export interface GmvReturnBucket {
  bucket: Date;
  returnedMinor: bigint;
  returnedItemCount: number;
}

export interface AdminOrderReaderPort {
  list(query: {
    status?: OrderStatus | undefined;
    sellerId?: string | undefined;
    q?: string | undefined;
    from?: Date | undefined;
    to?: Date | undefined;
    cursor?: string | undefined;
    limit: number;
  }): Promise<Page<AdminOrderRecord>>;

  findByOrderNumber(orderNumber: string): Promise<unknown | null>;

  loadRefundContext(orderId: string): Promise<AdminRefundContext | null>;

  gmv(query: {
    from: Date;
    to: Date;
    granularity: 'day' | 'week' | 'month';
    sellerId?: string | undefined;
  }): Promise<GmvBucket[]>;

  /** İade tutarları AYRI sorgulanır — tek sorguda birleştirilirse satırlar çoğalır. */
  gmvReturns(query: {
    from: Date;
    to: Date;
    granularity: 'day' | 'week' | 'month';
    sellerId?: string | undefined;
  }): Promise<GmvReturnBucket[]>;
}

export const ADMIN_ORDER_READER = 'ADMIN_ORDER_READER';

// ═════════════════════════════ PAYOUT ═══════════════════════════════════════

export interface AdminPayoutRecord {
  id: string;
  sellerId: string;
  sellerName: string;
  amountMinor: bigint;
  status: PayoutStatus;
  payoutRef: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  sentAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
}

export interface AdminPayoutPort {
  list(query: {
    status?: PayoutStatus | undefined;
    sellerId?: string | undefined;
    cursor?: string | undefined;
    limit: number;
  }): Promise<Page<AdminPayoutRecord>>;

  lockAndRead(
    tx: Tx,
    payoutId: string,
  ): Promise<{
    id: string;
    sellerId: string;
    amountMinor: bigint;
    status: PayoutStatus;
    payoutRef: string;
  } | null>;

  applyStatus(
    tx: Tx,
    payoutId: string,
    patch: {
      status: PayoutStatus;
      approvedBy?: string | null;
      approvedAt?: Date | null;
      failureReason?: string | null;
    },
  ): Promise<void>;

  /**
   * ÖDENEBİLİR BAKİYE.
   *
   * ⚠️ Bakiye ayrı kolonda tutulmaz, defterden (LedgerEntry) toplanır.
   *    Onaylanmış ama HENÜZ GÖNDERİLMEMİŞ talepler defterde görünmez —
   *    PAYOUT satırı para gerçekten çıkarken yazılır. Bu yüzden onaylı
   *    taleplerin toplamı bakiyeden ayrıca düşülür; düşülmezse aynı para
   *    iki farklı talebe onay verilerek iki kez ödenebilir.
   */
  availableForPayoutMinor(
    tx: Tx,
    sellerId: string,
    excludePayoutId: string,
  ): Promise<{
    ledgerAvailableMinor: bigint;
    approvedInFlightMinor: bigint;
    availableMinor: bigint;
  }>;
}

export const ADMIN_PAYOUT_PORT = 'ADMIN_PAYOUT_PORT';

// ═══════════════════════════ AI MALİYET PANELİ ══════════════════════════════

export interface AiUsageBucket {
  bucket: Date;
  feature: AiFeature;
  callCount: number;
  cacheHitCount: number;
  successCount: number;
  costMicroUsd: bigint;
  avgLatencyMs: number;
}

export interface AiUsageByUser {
  userId: string | null;
  callCount: number;
  costMicroUsd: bigint;
}

export interface AiUsageReaderPort {
  byDayAndFeature(query: {
    from: Date;
    to: Date;
    feature?: AiFeature | undefined;
  }): Promise<AiUsageBucket[]>;

  topUsers(query: { from: Date; to: Date; limit: number }): Promise<AiUsageByUser[]>;

  /** Try-on özelinde: üretilen iş sayısı (önbellek isabetleri hariç). */
  tryOnTotals(query: {
    from: Date;
    to: Date;
  }): Promise<{ callCount: number; cacheHitCount: number; costMicroUsd: bigint }>;
}

export const ADMIN_AI_USAGE_READER = 'ADMIN_AI_USAGE_READER';

// ═══════════════════════════ DOLANDIRICILIK ═════════════════════════════════
//
// ⚠️ Şemada FraudAlert tablosu YOK. Bu uç uyarıları mevcut kayıtlardan
//    TÜRETİR (kart deneme, aşırı iade, olağandışı tutar). Kalıcı bir uyarı
//    tablosu geldiğinde bu port ona bağlanır; uç sözleşmesi değişmez.

export type FraudAlertType =
  'CARD_TESTING' | 'HIGH_RETURN_RATE' | 'UNUSUAL_ORDER_VALUE' | 'RAPID_ORDER_CANCELLATION';

export interface FraudAlert {
  type: FraudAlertType;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  subjectType: 'USER' | 'ORDER';
  subjectId: string;
  /** Uyarının sayısal dayanağı — arayüz bunu tabloya döker. */
  metrics: Record<string, number | string>;
  observedAt: Date;
}

export interface FraudSignalPort {
  alerts(query: { from: Date; to: Date; limit: number }): Promise<FraudAlert[]>;
}

export const ADMIN_FRAUD_PORT = 'ADMIN_FRAUD_PORT';

// ═══════════════════ KULLANICI FOTOĞRAFI (BREAK-GLASS) ══════════════════════
//
// ⚠️⚠️ ÖZEL NİTELİKLİ KİŞİSEL VERİ — KVKK.
//    Yöneticinin kullanıcı fotoğraflarına SERBEST ERİŞİMİ YOKTUR. Bu port
//    yalnızca gerekçeli, denetlenen ve kullanıcıya BİLDİRİLEN tek seferlik
//    erişim (break-glass) için vardır. Listeleme/arama ucu YAZILMAZ.

export interface BreakGlassPhoto {
  id: string;
  purpose: string;
  qualityScore: number | null;
  widthPx: number;
  heightPx: number;
  sizeBytes: number;
  createdAt: Date;
  expiresAt: Date;
  deletedAt: Date | null;
  /**
   * Kısa ömürlü imzalı URL. Sağlayıcı bağlı değilse null döner —
   * denetim kaydı yine de yazılır, çünkü ERİŞİM TALEBİ de denetlenir.
   */
  signedUrl: string | null;
}

export interface PhotoAccessPort {
  /** Kullanıcının var olup olmadığını doğrular (bildirim gönderilebilmesi için). */
  userExists(userId: string): Promise<boolean>;
  /** ⚠️ Yalnızca `AdminPrivacyService.breakGlassPhotoAccess` çağırır. */
  listForBreakGlass(userId: string, photoId?: string): Promise<BreakGlassPhoto[]>;
}

export const ADMIN_PHOTO_ACCESS = 'ADMIN_PHOTO_ACCESS';
