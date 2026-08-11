import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service.js';
import type { CouponPort, CouponSnapshot, VariantPort, VariantSnapshot } from './cart.ports.js';
import type { DiscountKind } from './cart-totals.js';

/**
 * GEÇİCİ OKUMA ADAPTÖRLERİ
 *
 * Katalog ve kampanya modülleri sepetin ihtiyacı olan projeksiyonları henüz
 * servis olarak yayımlamıyor. Bu dosya o boşluğu SALT OKUNUR bir adaptörle
 * kapatır: buradaki sorgular hiçbir şey yazmaz, yalnızca sepetin karar vermesi
 * için gereken alanları okur.
 *
 * Katalog `getVariantSnapshots()` ve kampanya `getCoupon()` yayımladığında
 * `index.ts` içindeki iki provider satırı onlara çevrilir ve bu dosya silinir.
 * Sepetin geri kalanı bunu fark etmez — bağımlılık `cart.ports.ts`'e karşıdır.
 */

@Injectable()
export class PrismaVariantAdapter implements VariantPort {
  constructor(private readonly prisma: PrismaService) {}

  async findByIds(variantIds: readonly string[]): Promise<Map<string, VariantSnapshot>> {
    if (variantIds.length === 0) return new Map();

    const rows = await this.prisma.variant.findMany({
      where: { id: { in: [...new Set(variantIds)] } },
      select: {
        id: true,
        color: true,
        size: true,
        priceMinor: true,
        listPriceMinor: true,
        isActive: true,
        inventory: { select: { onHand: true, reserved: true } },
        product: {
          select: {
            id: true,
            slug: true,
            title: true,
            status: true,
            images: {
              orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
              take: 1,
              select: { storageKey: true },
            },
            seller: {
              select: {
                id: true,
                displayName: true,
                status: true,
                vacationMode: true,
                store: { select: { slug: true } },
              },
            },
          },
        },
      },
    });

    return new Map(
      rows.map((row) => [
        row.id,
        {
          variantId: row.id,
          productId: row.product.id,
          productSlug: row.product.slug,
          productTitle: row.product.title,
          sellerId: row.product.seller.id,
          sellerName: row.product.seller.displayName,
          storeSlug: row.product.seller.store?.slug ?? '',
          color: row.color,
          size: row.size,
          imageKey: row.product.images[0]?.storageKey ?? null,
          priceMinor: row.priceMinor,
          listPriceMinor: row.listPriceMinor,
          isPurchasable: row.isActive && row.product.status === 'PUBLISHED',
          sellerApproved: row.product.seller.status === 'APPROVED',
          sellerOnVacation: row.product.seller.vacationMode,
          // Rezerve edilen adet satılabilir değildir: başka bir kullanıcı
          // checkout'ta ve 15 dakika boyunca o stok üzerinde hak sahibi.
          availableQuantity: Math.max(
            0,
            (row.inventory?.onHand ?? 0) - (row.inventory?.reserved ?? 0),
          ),
        } satisfies VariantSnapshot,
      ]),
    );
  }
}

@Injectable()
export class PrismaCouponAdapter implements CouponPort {
  constructor(private readonly prisma: PrismaService) {}

  async findByCode(code: string): Promise<CouponSnapshot | null> {
    // Kupon kodları büyük/küçük harf duyarsız girilir; kullanıcıya "kod yanlış"
    // demeden önce normalize edilir.
    const row = await this.prisma.coupon.findUnique({ where: { code: code.toUpperCase() } });
    return row ? toSnapshot(row) : null;
  }

  async findById(couponId: string): Promise<CouponSnapshot | null> {
    const row = await this.prisma.coupon.findUnique({ where: { id: couponId } });
    return row ? toSnapshot(row) : null;
  }

  async countUserRedemptions(couponId: string, userId: string): Promise<number> {
    return this.prisma.couponRedemption.count({ where: { couponId, userId } });
  }
}

interface CouponRow {
  id: string;
  code: string;
  sellerId: string | null;
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
}

function toSnapshot(row: CouponRow): CouponSnapshot {
  return {
    id: row.id,
    code: row.code,
    sellerId: row.sellerId,
    discountType: row.discountType as DiscountKind,
    discountValue: row.discountValue,
    maxDiscountMinor: row.maxDiscountMinor,
    minCartMinor: row.minCartMinor,
    usageLimit: row.usageLimit,
    usageLimitPerUser: row.usageLimitPerUser,
    usedCount: row.usedCount,
    validFrom: row.validFrom,
    validTo: row.validTo,
    isActive: row.isActive,
  };
}
