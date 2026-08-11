import { Inject, Injectable } from '@nestjs/common';
import { SellerService } from './seller.service.js';
import { SELLER_COUPON, type SellerCouponPort, type SellerCouponView } from './seller.ports.js';
import type { CouponListQuery, CreateCouponInput, UpdateCouponInput } from './seller.schema.js';

/**
 * MAĞAZA KUPONLARI.
 *
 * ⚠️ Satıcı yalnızca KENDİ mağazasının kuponunu yönetir. `Coupon.sellerId`
 *    null olan kayıtlar PLATFORM kuponlarıdır ve maliyeti platform üstlenir;
 *    satıcının bunlara dokunabilmesi, satıcının platform bütçesini
 *    harcayabilmesi demek olurdu. Port her sorguya `sellerId` koşulunu
 *    KOYAR — filtre uygulama katmanına bırakılmaz.
 *
 * Kupon SİLİNMEZ, pasifleştirilir: silinen kuponun geçmiş kullanımları
 * (CouponRedemption) öksüz kalır ve kampanya muhasebesi bozulur.
 */
@Injectable()
export class SellerCouponService {
  constructor(
    private readonly sellers: SellerService,
    @Inject(SELLER_COUPON) private readonly coupons: SellerCouponPort,
  ) {}

  async list(
    sellerId: string,
    query: CouponListQuery,
  ): Promise<{ items: SellerCouponView[]; nextCursor: string | null }> {
    return this.coupons.list(sellerId, {
      isActive: query.isActive,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  async create(sellerId: string, input: CreateCouponInput): Promise<SellerCouponView> {
    await this.sellers.requireActive(sellerId);

    return this.coupons.create(sellerId, {
      code: input.code,
      discountType: input.discountType,
      // PERCENTAGE'ta bu değer BASIS POINT'tir (1000 = %10) — şema öyle
      // doğruluyor, sepet motoru öyle okuyor.
      discountValue: input.discountValue,
      maxDiscountMinor: input.maxDiscountMinor,
      minCartMinor: input.minCartMinor,
      usageLimit: input.usageLimit,
      usageLimitPerUser: input.usageLimitPerUser,
      validFrom: input.validFrom,
      validTo: input.validTo,
    });
  }

  async update(
    sellerId: string,
    couponId: string,
    input: UpdateCouponInput,
  ): Promise<SellerCouponView> {
    await this.sellers.requireActive(sellerId);
    return this.coupons.update(sellerId, couponId, input);
  }
}
