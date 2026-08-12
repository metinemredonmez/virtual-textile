/**
 * ═══════════════ GEÇİCİ KÖPRÜLER — SİLİNMEK ÜZERE YAZILDI ══════════════════
 *
 * Yönetim modülü yalnızca CommissionRule, CommissionRuleVersion ve AuditLog
 * tablolarının sahibidir (kural 3). Satıcı, katalog, promosyon, finans ve AI
 * modülleri henüz servis yayımlamadığı için, `admin.ports.ts` içindeki dar
 * arayüzler burada geçici Prisma köprüleriyle karşılanıyor.
 *
 * ⚠️ ENTEGRASYON AJANI İÇİN: ilgili modüller yayımlandığında `index.ts`
 *    içindeki token bağlamalarını onların servislerine çevirin ve BU DOSYAYI
 *    SİLİN. Yönetim servislerinde tek satır değişmesi gerekmez.
 *
 * Köprülerin çoğu SALT OKUNURDUR. Yazan üçü (satıcı durumu, ürün durumu,
 * kategori/kupon) yalnızca `tx` ile çağrılır ki değişiklik ve denetim kaydı
 * aynı transaction'da olsun.
 */

import { Injectable } from '@nestjs/common';
import { Prisma } from '@vt/db';
import type {
  AiFeature,
  OrderStatus,
  PayoutStatus,
  ProductStatus,
  SellerStatus,
  TryOnCategory,
} from '@vt/db';
import { PrismaService } from '../../infra/prisma.service.js';
import { SIGNED_URL_TTL_SECONDS } from '@vt/config';
import type {
  AdminCategoryPort,
  AdminCategoryRecord,
  AdminCouponRecord,
  AdminModerationPort,
  AdminModerationRecord,
  AdminOrderReaderPort,
  AdminOrderRecord,
  AdminPayoutPort,
  AdminPayoutRecord,
  AdminPromoPort,
  AdminRefundContext,
  AdminSellerPort,
  AdminSellerRecord,
  AiUsageBucket,
  AiUsageByUser,
  AiUsageReaderPort,
  BreakGlassPhoto,
  FraudAlert,
  FraudSignalPort,
  GmvBucket,
  GmvReturnBucket,
  Page,
  PhotoAccessPort,
  Tx,
} from './admin.ports.js';

/**
 * ZAMAN KOVASI — TÜRKİYE SAATİNE GÖRE.
 *
 * ⚠️ ÜÇ ADIMLI DÖNÜŞÜM, ve ilk adım atlanamaz:
 *
 *   1. `AT TIME ZONE 'UTC'`             → timestamptz (gerçek an)
 *   2. `AT TIME ZONE 'Europe/Istanbul'` → timestamp (İstanbul duvar saati)
 *   3. `date_trunc(...)` sonra tekrar `AT TIME ZONE 'Europe/Istanbul'`
 *                                       → timestamptz (kovanın gerçek anı)
 *
 * ⚠️ 1. ADIM NEDEN VAR: Prisma `DateTime` alanlarını PostgreSQL'de
 *    `timestamp WITHOUT time zone` olarak yaratır ve içine UTC yazar
 *    (doğrulandı: order_orders."paidAt" = timestamp without time zone).
 *    Doğrudan `paidAt AT TIME ZONE 'Europe/Istanbul'` yazılsaydı, Postgres
 *    saf değeri İSTANBUL duvar saati sanıp UTC'ye çevirirdi — yani ters yön.
 *    Sonuç 3 saat kaymış, üstelik UTC sınırından kırpılmış bir kova olurdu ve
 *    günlük ciro raporu sessizce yanlış çıkardı. Gece 00:30'daki (İstanbul)
 *    bir sipariş bir önceki güne yazılırdı.
 *
 * ⚠️ Zaman dilimi ve kırpma birimi SQL'e GÖMÜLÜ sabitlerdir, parametre değil:
 *    `date_trunc($1, ...)` biçiminde Postgres tip çözümlemesi belirsiz kalıyor.
 *    Sabit tablo hem bunu çözer hem de kullanıcı girdisinin SQL'e hiç
 *    yaklaşmadığını görünür kılar (birim zaten zod enum ile sınırlı).
 */
const GMV_BUCKET_SQL: Readonly<Record<'day' | 'week' | 'month', Prisma.Sql>> = {
  day: Prisma.sql`(date_trunc('day', o."paidAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul')`,
  week: Prisma.sql`(date_trunc('week', o."paidAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul')`,
  month: Prisma.sql`(date_trunc('month', o."paidAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul')`,
};

function bucketExpr(granularity: 'day' | 'week' | 'month'): Prisma.Sql {
  return GMV_BUCKET_SQL[granularity];
}

// ═══════════════════════════════ SATICI ═════════════════════════════════════

@Injectable()
export class PrismaSellerAdminBridge implements AdminSellerPort {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: {
    status?: SellerStatus | undefined;
    q?: string | undefined;
    cursor?: string | undefined;
    limit: number;
  }): Promise<Page<AdminSellerRecord>> {
    const rows = await this.prisma.seller.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.q
          ? {
              OR: [
                { legalName: { contains: query.q, mode: 'insensitive' } },
                { displayName: { contains: query.q, mode: 'insensitive' } },
                { contactEmail: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: sellerSelect,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      items: page.map(toSellerRecord),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async findById(sellerId: string): Promise<AdminSellerRecord | null> {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: sellerSelect,
    });
    return seller ? toSellerRecord(seller) : null;
  }

  async lockAndRead(
    tx: Tx,
    sellerId: string,
  ): Promise<{ id: string; status: SellerStatus; statusReason: string | null } | null> {
    // FOR UPDATE: aynı satıcı üzerinde eşzamanlı karar veren ikinci istek,
    // ilkinin sonucunu görmeden ilerleyemez.
    const rows = await tx.$queryRaw<
      Array<{ id: string; status: SellerStatus; statusReason: string | null }>
    >(Prisma.sql`
      SELECT "id", "status", "statusReason"
        FROM seller_sellers
       WHERE "id" = ${sellerId}
       FOR UPDATE`);
    return rows[0] ?? null;
  }

  async applyStatus(
    tx: Tx,
    sellerId: string,
    patch: { status: SellerStatus; statusReason: string | null; approvedAt?: Date | null },
  ): Promise<void> {
    await tx.seller.update({
      where: { id: sellerId },
      data: {
        status: patch.status,
        statusReason: patch.statusReason,
        ...(patch.approvedAt !== undefined ? { approvedAt: patch.approvedAt } : {}),
      },
    });
  }
}

const sellerSelect = {
  id: true,
  legalName: true,
  displayName: true,
  contactEmail: true,
  contactPhone: true,
  taxOffice: true,
  status: true,
  statusReason: true,
  qualityScore: true,
  vacationMode: true,
  submerchantKey: true,
  approvedAt: true,
  createdAt: true,
  store: { select: { slug: true } },
  documents: {
    select: { id: true, type: true, fileName: true, approved: true, reviewedAt: true },
    orderBy: { createdAt: 'asc' },
  },
  _count: { select: { products: true } },
} satisfies Prisma.SellerSelect;

function toSellerRecord(
  seller: Prisma.SellerGetPayload<{ select: typeof sellerSelect }>,
): AdminSellerRecord {
  return {
    id: seller.id,
    legalName: seller.legalName,
    displayName: seller.displayName,
    contactEmail: seller.contactEmail,
    contactPhone: seller.contactPhone,
    taxOffice: seller.taxOffice,
    status: seller.status,
    statusReason: seller.statusReason,
    qualityScore: seller.qualityScore,
    vacationMode: seller.vacationMode,
    // ⚠️ Anahtarın KENDİSİ dışarı verilmez, yalnızca varlığı.
    submerchantKeyPresent: seller.submerchantKey !== null,
    storeSlug: seller.store?.slug ?? null,
    approvedAt: seller.approvedAt,
    createdAt: seller.createdAt,
    productCount: seller._count.products,
    // ⚠️ Belge `storageKey`'i DIŞARI VERİLMEZ; indirme ayrı, denetlenen bir akıştır.
    documents: seller.documents.map((document) => ({
      id: document.id,
      type: document.type,
      fileName: document.fileName,
      approved: document.approved,
      reviewedAt: document.reviewedAt,
    })),
  };
}

// ══════════════════════════ ÜRÜN MODERASYONU ════════════════════════════════

@Injectable()
export class PrismaModerationBridge implements AdminModerationPort {
  constructor(private readonly prisma: PrismaService) {}

  async queue(query: {
    status?: ProductStatus | undefined;
    sellerId?: string | undefined;
    cursor?: string | undefined;
    limit: number;
  }): Promise<Page<AdminModerationRecord>> {
    const rows = await this.prisma.product.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.sellerId ? { sellerId: query.sellerId } : {}),
      },
      // Kuyruk EN ESKİDEN başlar: en uzun bekleyen satıcı ilk sırada.
      orderBy: { id: 'asc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        slug: true,
        title: true,
        brandName: true,
        status: true,
        statusReason: true,
        sellerId: true,
        aiTagsApproved: true,
        tryOnScore: true,
        createdAt: true,
        seller: { select: { displayName: true } },
        category: { select: { name: true } },
        _count: { select: { images: true, variants: true } },
      },
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      items: page.map((product) => ({
        id: product.id,
        slug: product.slug,
        title: product.title,
        brandName: product.brandName,
        status: product.status,
        statusReason: product.statusReason,
        sellerId: product.sellerId,
        sellerName: product.seller.displayName,
        categoryName: product.category.name,
        aiTagsApproved: product.aiTagsApproved,
        tryOnScore: product.tryOnScore,
        imageCount: product._count.images,
        variantCount: product._count.variants,
        createdAt: product.createdAt,
      })),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async lockAndRead(
    tx: Tx,
    productId: string,
  ): Promise<{
    id: string;
    status: ProductStatus;
    statusReason: string | null;
    sellerId: string;
    sellerStatus: SellerStatus;
    aiTagsApproved: boolean;
    imageCount: number;
    publishedAt: Date | null;
  } | null> {
    // ⚠️ Yalnızca ürün satırı kilitleniyor (FOR UPDATE OF p): satıcı satırına
    // kilit konsaydı, aynı satıcının farklı ürünlerini inceleyen iki moderatör
    // gereksiz yere birbirini beklerdi.
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        status: ProductStatus;
        statusReason: string | null;
        sellerId: string;
        sellerStatus: SellerStatus;
        aiTagsApproved: boolean;
        imageCount: bigint;
        publishedAt: Date | null;
      }>
    >(Prisma.sql`
      SELECT p."id", p."status", p."statusReason", p."sellerId",
             s."status" AS "sellerStatus", p."aiTagsApproved", p."publishedAt",
             (SELECT COUNT(*) FROM catalog_product_images i WHERE i."productId" = p."id") AS "imageCount"
        FROM catalog_products p
        JOIN seller_sellers s ON s."id" = p."sellerId"
       WHERE p."id" = ${productId}
       FOR UPDATE OF p`);

    const row = rows[0];
    return row ? { ...row, imageCount: Number(row.imageCount) } : null;
  }

  async applyStatus(
    tx: Tx,
    productId: string,
    patch: { status: ProductStatus; statusReason: string | null; publishedAt?: Date | null },
  ): Promise<void> {
    await tx.product.update({
      where: { id: productId },
      data: {
        status: patch.status,
        statusReason: patch.statusReason,
        ...(patch.publishedAt !== undefined ? { publishedAt: patch.publishedAt } : {}),
      },
    });
  }
}

// ════════════════════════════ KATEGORİ ══════════════════════════════════════

@Injectable()
export class PrismaCategoryAdminBridge implements AdminCategoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<AdminCategoryRecord[]> {
    const rows = await this.prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: categorySelect,
    });
    return rows.map(toCategoryRecord);
  }

  async findById(categoryId: string): Promise<AdminCategoryRecord | null> {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: categorySelect,
    });
    return category ? toCategoryRecord(category) : null;
  }

  async create(
    tx: Tx,
    data: {
      parentId: string | null;
      slug: string;
      name: string;
      tryOnCategory: TryOnCategory | null;
      sortOrder: number;
      isActive: boolean;
    },
  ): Promise<AdminCategoryRecord> {
    const created = await tx.category.create({ data, select: categorySelect });
    return toCategoryRecord(created);
  }

  async update(
    tx: Tx,
    categoryId: string,
    patch: Partial<{
      parentId: string | null;
      name: string;
      tryOnCategory: TryOnCategory | null;
      sortOrder: number;
      isActive: boolean;
    }>,
  ): Promise<AdminCategoryRecord> {
    const updated = await tx.category.update({
      where: { id: categoryId },
      data: patch,
      select: categorySelect,
    });
    return toCategoryRecord(updated);
  }
}

const categorySelect = {
  id: true,
  parentId: true,
  slug: true,
  name: true,
  tryOnCategory: true,
  sortOrder: true,
  isActive: true,
  _count: { select: { products: true } },
} satisfies Prisma.CategorySelect;

function toCategoryRecord(
  category: Prisma.CategoryGetPayload<{ select: typeof categorySelect }>,
): AdminCategoryRecord {
  return {
    id: category.id,
    parentId: category.parentId,
    slug: category.slug,
    name: category.name,
    tryOnCategory: category.tryOnCategory,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    productCount: category._count.products,
  };
}

// ═══════════════════════════ KUPON & KAMPANYA ═══════════════════════════════

@Injectable()
export class PrismaPromoAdminBridge implements AdminPromoPort {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: {
    scope?: 'PLATFORM' | 'SELLER' | undefined;
    isActive?: boolean | undefined;
    cursor?: string | undefined;
    limit: number;
  }): Promise<Page<AdminCouponRecord>> {
    const rows = await this.prisma.coupon.findMany({
      where: {
        ...(query.scope === 'PLATFORM' ? { sellerId: null } : {}),
        ...(query.scope === 'SELLER' ? { sellerId: { not: null } } : {}),
        ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      items: page.map(toCouponRecord),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async findById(couponId: string): Promise<AdminCouponRecord | null> {
    const coupon = await this.prisma.coupon.findUnique({ where: { id: couponId } });
    return coupon ? toCouponRecord(coupon) : null;
  }

  async create(
    tx: Tx,
    data: {
      code: string;
      sellerId: string | null;
      discountType: AdminCouponRecord['discountType'];
      discountValue: bigint;
      maxDiscountMinor: bigint | null;
      minCartMinor: bigint;
      usageLimit: number | null;
      usageLimitPerUser: number;
      validFrom: Date;
      validTo: Date;
      isActive: boolean;
    },
  ): Promise<AdminCouponRecord> {
    const created = await tx.coupon.create({ data });
    return toCouponRecord(created);
  }

  async deactivate(tx: Tx, couponId: string): Promise<void> {
    await tx.coupon.update({ where: { id: couponId }, data: { isActive: false } });
  }
}

function toCouponRecord(coupon: {
  id: string;
  code: string;
  sellerId: string | null;
  discountType: AdminCouponRecord['discountType'];
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
}): AdminCouponRecord {
  return { ...coupon, scope: coupon.sellerId === null ? 'PLATFORM' : 'SELLER' };
}

// ═════════════════════════ SİPARİŞ (SALT OKUNUR) ════════════════════════════

@Injectable()
export class PrismaAdminOrderReaderBridge implements AdminOrderReaderPort {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: {
    status?: OrderStatus | undefined;
    sellerId?: string | undefined;
    q?: string | undefined;
    from?: Date | undefined;
    to?: Date | undefined;
    cursor?: string | undefined;
    limit: number;
  }): Promise<Page<AdminOrderRecord>> {
    const rows = await this.prisma.order.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.sellerId ? { packages: { some: { sellerId: query.sellerId } } } : {}),
        ...(query.q
          ? {
              OR: [
                { orderNumber: { contains: query.q, mode: 'insensitive' } },
                { email: { equals: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(query.from || query.to
          ? {
              createdAt: {
                ...(query.from ? { gte: query.from } : {}),
                ...(query.to ? { lte: query.to } : {}),
              },
            }
          : {}),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        orderNumber: true,
        status: true,
        email: true,
        itemsTotalMinor: true,
        shippingTotalMinor: true,
        discountMinor: true,
        grandTotalMinor: true,
        currency: true,
        createdAt: true,
        paidAt: true,
        packages: { select: { seller: { select: { displayName: true } } } },
        _count: { select: { items: true, packages: true } },
      },
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      items: page.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        email: order.email,
        itemsTotalMinor: order.itemsTotalMinor,
        shippingTotalMinor: order.shippingTotalMinor,
        discountMinor: order.discountMinor,
        grandTotalMinor: order.grandTotalMinor,
        currency: order.currency,
        createdAt: order.createdAt,
        paidAt: order.paidAt,
        packageCount: order._count.packages,
        itemCount: order._count.items,
        sellerNames: [...new Set(order.packages.map((pkg) => pkg.seller.displayName))],
      })),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async findByOrderNumber(orderNumber: string): Promise<unknown | null> {
    return this.prisma.order.findUnique({
      where: { orderNumber },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        email: true,
        phone: true,
        itemsTotalMinor: true,
        shippingTotalMinor: true,
        discountMinor: true,
        grandTotalMinor: true,
        currency: true,
        // ⚠️ Adresler yönetim görünümünde AÇIK gösteriliyor: destek ekibi
        // kargo sorununu ancak adresi görerek çözebilir. Bu erişim rol ile
        // sınırlı (ADMIN/SUPPORT) ve uçlar @Public değil.
        shippingAddress: true,
        createdAt: true,
        paidAt: true,
        completedAt: true,
        cancelledAt: true,
        packages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            status: true,
            carrier: true,
            trackingNo: true,
            slaDeadline: true,
            shippedAt: true,
            deliveredAt: true,
            cancelReason: true,
            itemsTotalMinor: true,
            shippingMinor: true,
            discountShareMinor: true,
            seller: { select: { id: true, displayName: true } },
            items: {
              select: {
                id: true,
                productTitle: true,
                variantLabel: true,
                sku: true,
                quantity: true,
                unitPriceMinor: true,
                lineTotalMinor: true,
                commissionRateBps: true,
                commissionAmountMinor: true,
                sellerNetMinor: true,
                commissionRuleVersionId: true,
              },
            },
          },
        },
        returns: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            returnNumber: true,
            status: true,
            reason: true,
            refundAmountMinor: true,
            decidedBy: true,
            decidedAt: true,
            createdAt: true,
          },
        },
        payment: {
          select: {
            id: true,
            provider: true,
            status: true,
            amountMinor: true,
            installment: true,
            // ⚠️ cardToken ve rawResponse DIŞARI VERİLMEZ.
            cardMask: true,
            cardBrand: true,
            failureCode: true,
            capturedAt: true,
            refunds: {
              select: {
                id: true,
                amountMinor: true,
                status: true,
                refundRef: true,
                createdAt: true,
              },
            },
          },
        },
        events: {
          orderBy: { createdAt: 'asc' },
          select: { type: true, actorType: true, actorId: true, createdAt: true },
        },
      },
    });
  }

  /**
   * ⚠️ Tahsil edilen tutar ÖDEME kaydından okunur (`PaymentIntent.status`
   *    CAPTURED ise `amountMinor`), sipariş toplamından değil. Önceki iadeler
   *    Refund tablosundan toplanır; `status = 'FAILED'` olanlar hariç tutulur
   *    çünkü başarısız iade parayı geri götürmemiştir.
   */
  async loadRefundContext(orderId: string): Promise<AdminRefundContext | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        currency: true,
        paidAt: true,
        payment: {
          select: {
            status: true,
            amountMinor: true,
            refunds: { select: { amountMinor: true, status: true } },
          },
        },
      },
    });
    if (!order) return null;

    const payment = order.payment;
    const captured =
      payment && (payment.status === 'CAPTURED' || payment.status === 'PARTIALLY_REFUNDED')
        ? payment.amountMinor
        : 0n;

    const alreadyRefunded = (payment?.refunds ?? [])
      .filter((refund) => refund.status !== 'FAILED')
      .reduce((sum, refund) => sum + refund.amountMinor, 0n);

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      currency: order.currency,
      paidAt: order.paidAt,
      capturedMinor: captured,
      alreadyRefundedMinor: alreadyRefunded,
    };
  }

  /**
   * GMV — sipariş kalemlerinden.
   *
   * ⚠️ İPTAL/SÜRESİ GEÇMİŞ siparişler hariç. Ödemesi alınmış ama sonradan
   *    tamamen iptal edilmiş sipariş ciro sayılmaz.
   * ⚠️ SUM(...)::bigint — Postgres'te bigint toplamı `numeric` döner ve Prisma
   *    onu Decimal'e çevirir. Cast edilmezse para değeri Decimal olarak
   *    dışarı sızar ve bigint sözleşmesi kırılır.
   */
  async gmv(query: {
    from: Date;
    to: Date;
    granularity: 'day' | 'week' | 'month';
    sellerId?: string | undefined;
  }): Promise<GmvBucket[]> {
    const sellerFilter = query.sellerId
      ? Prisma.sql`AND pk."sellerId" = ${query.sellerId}`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      Array<{
        bucket: Date;
        order_count: bigint;
        item_count: bigint;
        gmv_minor: bigint | null;
        commission_minor: bigint | null;
        seller_net_minor: bigint | null;
      }>
    >(Prisma.sql`
      SELECT ${bucketExpr(query.granularity)} AS bucket,
             COUNT(DISTINCT o."id")::bigint            AS order_count,
             COALESCE(SUM(i."quantity"), 0)::bigint    AS item_count,
             COALESCE(SUM(i."lineTotalMinor"), 0)::bigint        AS gmv_minor,
             COALESCE(SUM(i."commissionAmountMinor"), 0)::bigint AS commission_minor,
             COALESCE(SUM(i."sellerNetMinor"), 0)::bigint        AS seller_net_minor
        FROM order_orders o
        JOIN order_items i    ON i."orderId" = o."id"
        JOIN order_packages pk ON pk."id" = i."packageId"
       WHERE o."paidAt" IS NOT NULL
         AND o."paidAt" >= ${query.from}
         AND o."paidAt" <  ${query.to}
         AND o."status" NOT IN ('CANCELLED', 'EXPIRED', 'PAYMENT_FAILED')
         AND pk."status" <> 'CANCELLED'
         ${sellerFilter}
       GROUP BY bucket
       ORDER BY bucket ASC`);

    return rows.map((row) => ({
      bucket: row.bucket,
      orderCount: Number(row.order_count),
      itemCount: Number(row.item_count),
      gmvMinor: row.gmv_minor ?? 0n,
      commissionMinor: row.commission_minor ?? 0n,
      sellerNetMinor: row.seller_net_minor ?? 0n,
    }));
  }

  /**
   * İade tutarları — GMV ile AYNI kovalara (siparişin ödeme tarihi) düşürülür.
   *
   * ⚠️ Kova anahtarı iade tarihi DEĞİL, siparişin ödendiği tarihtir: amaç "o
   *    dönemin cirosundan ne kadarı geri döndü" sorusunu cevaplamak. İade
   *    tarihine göre kovalansaydı iki seri farklı dönemleri gösterir ve
   *    "net GMV" anlamsız olurdu.
   */
  async gmvReturns(query: {
    from: Date;
    to: Date;
    granularity: 'day' | 'week' | 'month';
    sellerId?: string | undefined;
  }): Promise<GmvReturnBucket[]> {
    const sellerFilter = query.sellerId
      ? Prisma.sql`AND pk."sellerId" = ${query.sellerId}`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      Array<{ bucket: Date; returned_minor: bigint | null; returned_items: bigint | null }>
    >(Prisma.sql`
      SELECT ${bucketExpr(query.granularity)} AS bucket,
             COALESCE(SUM(ri."refundMinor"), 0)::bigint AS returned_minor,
             COALESCE(SUM(ri."quantity"), 0)::bigint    AS returned_items
        FROM return_items ri
        JOIN return_requests rr ON rr."id" = ri."returnId"
        JOIN order_items i      ON i."id" = ri."orderItemId"
        JOIN order_packages pk  ON pk."id" = i."packageId"
        JOIN order_orders o     ON o."id" = rr."orderId"
       WHERE o."paidAt" IS NOT NULL
         AND o."paidAt" >= ${query.from}
         AND o."paidAt" <  ${query.to}
         AND rr."status" = 'REFUNDED'
         ${sellerFilter}
       GROUP BY bucket
       ORDER BY bucket ASC`);

    return rows.map((row) => ({
      bucket: row.bucket,
      returnedMinor: row.returned_minor ?? 0n,
      returnedItemCount: Number(row.returned_items ?? 0n),
    }));
  }
}

// ═══════════════════════════════ PAYOUT ═════════════════════════════════════

@Injectable()
export class PrismaPayoutAdminBridge implements AdminPayoutPort {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: {
    status?: PayoutStatus | undefined;
    sellerId?: string | undefined;
    cursor?: string | undefined;
    limit: number;
  }): Promise<Page<AdminPayoutRecord>> {
    const rows = await this.prisma.payoutRequest.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.sellerId ? { sellerId: query.sellerId } : {}),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        sellerId: true,
        amountMinor: true,
        status: true,
        payoutRef: true,
        approvedBy: true,
        approvedAt: true,
        sentAt: true,
        failureReason: true,
        createdAt: true,
        seller: { select: { displayName: true } },
      },
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      // ⚠️ `ibanEnc` DIŞARI VERİLMEZ — çözülmesi yalnızca gönderim anında,
      // finans işçisinde olur.
      items: page.map((payout) => ({
        id: payout.id,
        sellerId: payout.sellerId,
        sellerName: payout.seller.displayName,
        amountMinor: payout.amountMinor,
        status: payout.status,
        payoutRef: payout.payoutRef,
        approvedBy: payout.approvedBy,
        approvedAt: payout.approvedAt,
        sentAt: payout.sentAt,
        failureReason: payout.failureReason,
        createdAt: payout.createdAt,
      })),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async lockAndRead(
    tx: Tx,
    payoutId: string,
  ): Promise<{
    id: string;
    sellerId: string;
    amountMinor: bigint;
    status: PayoutStatus;
    payoutRef: string;
  } | null> {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        sellerId: string;
        amountMinor: bigint;
        status: PayoutStatus;
        payoutRef: string;
      }>
    >(Prisma.sql`
      SELECT "id", "sellerId", "amountMinor", "status", "payoutRef"
        FROM finance_payout_requests
       WHERE "id" = ${payoutId}
       FOR UPDATE`);
    return rows[0] ?? null;
  }

  async applyStatus(
    tx: Tx,
    payoutId: string,
    patch: {
      status: PayoutStatus;
      approvedBy?: string | null;
      approvedAt?: Date | null;
      failureReason?: string | null;
    },
  ): Promise<void> {
    await tx.payoutRequest.update({
      where: { id: payoutId },
      data: {
        status: patch.status,
        ...(patch.approvedBy !== undefined ? { approvedBy: patch.approvedBy } : {}),
        ...(patch.approvedAt !== undefined ? { approvedAt: patch.approvedAt } : {}),
        ...(patch.failureReason !== undefined ? { failureReason: patch.failureReason } : {}),
      },
    });
  }

  /**
   * ⚠️ Bu satıcının TÜM payout taleplerini kilitler (FOR UPDATE). Yalnızca
   *    onaylanmakta olan talep kilitlenseydi, iki farklı talep paralel
   *    onaylanır ve ikisi de "yeterli bakiye var" görürdü.
   *
   * ⚠️ SENT talepler düşülmez: gönderim anında finans işçisi PAYOUT tipinde
   *    (negatif) defter kaydı yazar, dolayısıyla bakiyeye zaten yansımıştır.
   *    Burada tekrar düşülseydi aynı para iki kez eksilirdi.
   */
  async availableForPayoutMinor(
    tx: Tx,
    sellerId: string,
    excludePayoutId: string,
  ): Promise<{
    ledgerAvailableMinor: bigint;
    approvedInFlightMinor: bigint;
    availableMinor: bigint;
  }> {
    /**
     * ⚠️ KİLİT VE TOPLAM AYRI SORGULARDA.
     *    PostgreSQL toplama fonksiyonu içeren bir sorguda FOR UPDATE'e izin
     *    vermez ("FOR UPDATE is not allowed with aggregate functions").
     *    Bu yüzden önce satırlar kilitleniyor, sonra AYNI transaction içinde
     *    toplanıyor. Sıra önemli: kilit alınmadan toplansaydı, paralel bir
     *    onay araya girip aynı bakiyeyi ikinci kez taahhüt edebilirdi.
     */
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
        FROM finance_payout_requests
       WHERE "sellerId" = ${sellerId}
         AND "status" = 'APPROVED'
         AND "id" <> ${excludePayoutId}
       FOR UPDATE`);

    const inFlightRows = await tx.$queryRaw<Array<{ total: bigint | null }>>(Prisma.sql`
      SELECT COALESCE(SUM("amountMinor"), 0)::bigint AS total
        FROM finance_payout_requests
       WHERE "sellerId" = ${sellerId}
         AND "status" = 'APPROVED'
         AND "id" <> ${excludePayoutId}`);

    const ledgerRows = await tx.$queryRaw<Array<{ total: bigint | null }>>(Prisma.sql`
      SELECT COALESCE(SUM("amountMinor"), 0)::bigint AS total
        FROM finance_ledger_entries
       WHERE "sellerId" = ${sellerId}
         AND "availableAt" IS NOT NULL
         AND "availableAt" <= NOW()`);

    const ledgerAvailableMinor = ledgerRows[0]?.total ?? 0n;
    const approvedInFlightMinor = inFlightRows[0]?.total ?? 0n;

    return {
      ledgerAvailableMinor,
      approvedInFlightMinor,
      availableMinor: ledgerAvailableMinor - approvedInFlightMinor,
    };
  }
}

// ═══════════════════════════ AI KULLANIM LOGU ═══════════════════════════════

@Injectable()
export class PrismaAiUsageReaderBridge implements AiUsageReaderPort {
  constructor(private readonly prisma: PrismaService) {}

  async byDayAndFeature(query: {
    from: Date;
    to: Date;
    feature?: AiFeature | undefined;
  }): Promise<AiUsageBucket[]> {
    const featureFilter = query.feature
      ? Prisma.sql`AND "feature" = ${query.feature}::"AiFeature"`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      Array<{
        bucket: Date;
        feature: AiFeature;
        call_count: bigint;
        cache_hits: bigint;
        success_count: bigint;
        cost_micro_usd: bigint | null;
        avg_latency_ms: number | null;
      }>
    >(Prisma.sql`
      SELECT (date_trunc('day', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul')
                AT TIME ZONE 'Europe/Istanbul') AS bucket,
             "feature",
             COUNT(*)::bigint                                          AS call_count,
             COUNT(*) FILTER (WHERE "cacheHit")::bigint                AS cache_hits,
             COUNT(*) FILTER (WHERE "success")::bigint                 AS success_count,
             COALESCE(SUM("costMicroUsd"), 0)::bigint                  AS cost_micro_usd,
             AVG("latencyMs")::float                                   AS avg_latency_ms
        FROM ai_usage_logs
       WHERE "createdAt" >= ${query.from}
         AND "createdAt" <  ${query.to}
         ${featureFilter}
       GROUP BY bucket, "feature"
       ORDER BY bucket ASC, "feature" ASC`);

    return rows.map((row) => ({
      bucket: row.bucket,
      feature: row.feature,
      callCount: Number(row.call_count),
      cacheHitCount: Number(row.cache_hits),
      successCount: Number(row.success_count),
      costMicroUsd: row.cost_micro_usd ?? 0n,
      avgLatencyMs: Math.round(row.avg_latency_ms ?? 0),
    }));
  }

  /**
   * En pahalı kullanıcılar.
   *
   * ⚠️ KVKK: yalnızca kimlik ve tutar döner. Fotoğraf, istem veya çıktı
   *    bu panelden GÖRÜNMEZ; maliyet analizi için kimlik yeterlidir.
   */
  async topUsers(query: { from: Date; to: Date; limit: number }): Promise<AiUsageByUser[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ userId: string | null; call_count: bigint; cost_micro_usd: bigint | null }>
    >(Prisma.sql`
      SELECT "userId",
             COUNT(*)::bigint                         AS call_count,
             COALESCE(SUM("costMicroUsd"), 0)::bigint AS cost_micro_usd
        FROM ai_usage_logs
       WHERE "createdAt" >= ${query.from}
         AND "createdAt" <  ${query.to}
       GROUP BY "userId"
       ORDER BY cost_micro_usd DESC
       LIMIT ${query.limit}`);

    return rows.map((row) => ({
      userId: row.userId,
      callCount: Number(row.call_count),
      costMicroUsd: row.cost_micro_usd ?? 0n,
    }));
  }

  async tryOnTotals(query: {
    from: Date;
    to: Date;
  }): Promise<{ callCount: number; cacheHitCount: number; costMicroUsd: bigint }> {
    const rows = await this.prisma.$queryRaw<
      Array<{ call_count: bigint; cache_hits: bigint; cost_micro_usd: bigint | null }>
    >(Prisma.sql`
      SELECT COUNT(*)::bigint                           AS call_count,
             COUNT(*) FILTER (WHERE "cacheHit")::bigint AS cache_hits,
             COALESCE(SUM("costMicroUsd"), 0)::bigint   AS cost_micro_usd
        FROM ai_usage_logs
       WHERE "createdAt" >= ${query.from}
         AND "createdAt" <  ${query.to}
         AND "feature" = 'TRYON'::"AiFeature"`);

    const row = rows[0];
    return {
      callCount: Number(row?.call_count ?? 0n),
      cacheHitCount: Number(row?.cache_hits ?? 0n),
      costMicroUsd: row?.cost_micro_usd ?? 0n,
    };
  }
}

// ════════════════════════ DOLANDIRICILIK SİNYALLERİ ═════════════════════════

/** Eşikler tek yerde; ayarlanabilir olması gerektiğinde @vt/config'e taşınır. */
const FRAUD_THRESHOLDS = {
  /** Bu kadar başarısız ödeme denemesi kart deneme (card testing) sinyalidir. */
  failedPaymentAttempts: 5,
  /** Bu orandan fazla iade edilen kullanıcı incelenir (yüzde). */
  returnRatePercent: 60,
  minOrdersForReturnRate: 3,
  /** Bu tutarın üstündeki tek sipariş göz atılmayı hak eder (kuruş). */
  unusualOrderValueMinor: 5_000_000n, // 50.000,00 ₺
} as const;

@Injectable()
export class PrismaFraudSignalBridge implements FraudSignalPort {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ⚠️ TÜRETİLMİŞ UYARILAR — kalıcı FraudAlert tablosu yok.
   *    Üç bağımsız sinyal ayrı sorgularla toplanır ve önem sırasına dizilir.
   *    Tek sorguda birleştirilseydi hem okunamaz olurdu hem de her sinyalin
   *    eşiği ayrı ayarlanamazdı.
   */
  async alerts(query: { from: Date; to: Date; limit: number }): Promise<FraudAlert[]> {
    const [cardTesting, highReturns, bigOrders] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{ userId: string | null; failed_attempts: bigint; last_seen: Date }>
      >(Prisma.sql`
        SELECT o."userId",
               COUNT(*)::bigint  AS failed_attempts,
               MAX(a."createdAt") AS last_seen
          FROM payment_attempts a
          JOIN payment_intents pi ON pi."id" = a."intentId"
          JOIN order_orders o     ON o."id" = pi."orderId"
         WHERE a."status" = 'FAILED'
           AND a."createdAt" >= ${query.from}
           AND a."createdAt" <  ${query.to}
           AND o."userId" IS NOT NULL
         GROUP BY o."userId"
        HAVING COUNT(*) >= ${FRAUD_THRESHOLDS.failedPaymentAttempts}
         ORDER BY failed_attempts DESC
         LIMIT ${query.limit}`),

      this.prisma.$queryRaw<
        Array<{
          userId: string;
          order_count: bigint;
          returned_count: bigint;
          last_seen: Date;
        }>
      >(Prisma.sql`
        SELECT o."userId",
               COUNT(DISTINCT o."id")::bigint  AS order_count,
               COUNT(DISTINCT rr."orderId")::bigint AS returned_count,
               MAX(o."createdAt")              AS last_seen
          FROM order_orders o
          LEFT JOIN return_requests rr
                 ON rr."orderId" = o."id"
                AND rr."status" IN ('APPROVED', 'RECEIVED', 'REFUNDED')
         WHERE o."createdAt" >= ${query.from}
           AND o."createdAt" <  ${query.to}
           AND o."userId" IS NOT NULL
           AND o."paidAt" IS NOT NULL
         GROUP BY o."userId"
        HAVING COUNT(DISTINCT o."id") >= ${FRAUD_THRESHOLDS.minOrdersForReturnRate}
           AND (COUNT(DISTINCT rr."orderId") * 100.0 / COUNT(DISTINCT o."id"))
                 >= ${FRAUD_THRESHOLDS.returnRatePercent}
         ORDER BY returned_count DESC
         LIMIT ${query.limit}`),

      this.prisma.$queryRaw<
        Array<{ id: string; orderNumber: string; grandTotalMinor: bigint; createdAt: Date }>
      >(Prisma.sql`
        SELECT "id", "orderNumber", "grandTotalMinor", "createdAt"
          FROM order_orders
         WHERE "createdAt" >= ${query.from}
           AND "createdAt" <  ${query.to}
           AND "grandTotalMinor" >= ${FRAUD_THRESHOLDS.unusualOrderValueMinor}
         ORDER BY "grandTotalMinor" DESC
         LIMIT ${query.limit}`),
    ]);

    const alerts: FraudAlert[] = [
      ...cardTesting.map((row): FraudAlert => {
        const attempts = Number(row.failed_attempts);
        return {
          type: 'CARD_TESTING',
          // İki kat eşiği aşan deneme sayısı otomatik olarak yüksek önem.
          severity: attempts >= FRAUD_THRESHOLDS.failedPaymentAttempts * 2 ? 'HIGH' : 'MEDIUM',
          subjectType: 'USER',
          subjectId: row.userId ?? 'bilinmiyor',
          metrics: { failedAttempts: attempts },
          observedAt: row.last_seen,
        };
      }),
      ...highReturns.map((row): FraudAlert => {
        const orders = Number(row.order_count);
        const returned = Number(row.returned_count);
        return {
          type: 'HIGH_RETURN_RATE',
          severity: returned >= orders ? 'HIGH' : 'MEDIUM',
          subjectType: 'USER',
          subjectId: row.userId,
          metrics: {
            orderCount: orders,
            returnedOrderCount: returned,
            returnRatePercent: orders === 0 ? 0 : Math.round((returned / orders) * 100),
          },
          observedAt: row.last_seen,
        };
      }),
      ...bigOrders.map((row): FraudAlert => ({
        type: 'UNUSUAL_ORDER_VALUE',
        severity: 'LOW',
        subjectType: 'ORDER',
        subjectId: row.id,
        metrics: {
          orderNumber: row.orderNumber,
          // ⚠️ Tutar STRING olarak taşınıyor: metrics sözlüğü JSON'a gidiyor
          // ve bigint serileşmez.
          grandTotalMinor: row.grandTotalMinor.toString(),
        },
        observedAt: row.createdAt,
      })),
    ];

    const severityRank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
    return alerts
      .sort(
        (a, b) =>
          severityRank[a.severity] - severityRank[b.severity] ||
          b.observedAt.getTime() - a.observedAt.getTime(),
      )
      .slice(0, query.limit);
  }
}

// ═════════════════ KULLANICI FOTOĞRAFI (BREAK-GLASS) ════════════════════════

// TODO(kod-gerekli): İmzalı URL üretimi BAĞLANMADI — `signedUrl` hep null.
//
// ⚠️ ESKİ GEREKÇE ARTIK GEÇERSİZ: bu not "apps/api @vt/adapters'a bağımlı
//    değil" diyordu. Bağımlılık ARTIK VAR (apps/api/package.json →
//    "@vt/adapters": "workspace:*") ve aynı modülün kardeşleri onu kullanıyor
//    (bkz. media/index.ts, checkout/index.ts). Yani bu iş engelli değil,
//    YALNIZCA YAPILMAMIŞ. Engel sanıldığı için kimse eline almıyordu.
//
// Kalan iş:
//   Bu köprüye StorageProvider (ya da MediaService) enjekte edilip
//   SIGNED_URL_TTL_SECONDS.userPhoto ömrüyle imzalı URL üretilecek.
//
// ⚠️ Neden acil DEĞİL: URL üretilememesi denetimi ATLATMAZ — AuditLog ve
//    kullanıcı bildirimi erişim TALEBİ anında yazılır (bkz.
//    AdminReportService). Yani break-glass akışının güvenlik tarafı çalışıyor,
//    eksik olan yalnızca yöneticinin fotoğrafı görebilmesi.

@Injectable()
export class PrismaPhotoAccessBridge implements PhotoAccessPort {
  constructor(private readonly prisma: PrismaService) {}

  async userExists(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    return user !== null;
  }

  /**
   * ⚠️ YALNIZCA break-glass akışından çağrılır.
   *    Silinmiş fotoğraflar (deletedAt dolu) dönmez: KVKK silme talebi yerine
   *    getirilmiş bir veriye yönetici erişimi olamaz.
   */
  async listForBreakGlass(userId: string, photoId?: string): Promise<BreakGlassPhoto[]> {
    const photos = await this.prisma.userPhoto.findMany({
      where: {
        userId,
        deletedAt: null,
        ...(photoId ? { id: photoId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        purpose: true,
        qualityScore: true,
        widthPx: true,
        heightPx: true,
        sizeBytes: true,
        createdAt: true,
        expiresAt: true,
        deletedAt: true,
      },
    });

    void SIGNED_URL_TTL_SECONDS; // İmzalı URL bağlandığında kullanılacak (yukarıdaki TODO).

    return photos.map((photo) => ({
      id: photo.id,
      purpose: photo.purpose,
      qualityScore: photo.qualityScore,
      widthPx: photo.widthPx,
      heightPx: photo.heightPx,
      sizeBytes: photo.sizeBytes,
      createdAt: photo.createdAt,
      expiresAt: photo.expiresAt,
      deletedAt: photo.deletedAt,
      signedUrl: null,
    }));
  }
}
