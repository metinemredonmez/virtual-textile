import type { DiscountKind } from './cart-totals.js';

/**
 * SEPET MODÜLÜNÜN DIŞARIYA BAĞIMLILIKLARI
 *
 * Sepet yalnızca kendi tablolarına (Cart, CartItem, Outfit) sahiptir. Varyant,
 * stok, satıcı ve kupon başka modüllerin verisidir; sepet bunları doğrudan
 * bilmek yerine BURADA tanımlı dar arayüzlerden okur.
 *
 * Neden arayüz: katalog/kampanya modülleri kendi servislerini yayımladığında
 * `index.ts` içindeki tek bir provider satırı değişir; servis, denetleyici ve
 * hesap kodu hiç dokunulmadan kalır. Bağımlılık yönü de doğru kalır — sepet
 * katalog şemasına değil, ihtiyacına ait bir sözleşmeye bağlıdır.
 */

export const VARIANT_PORT = 'CART_VARIANT_PORT';
export const COUPON_PORT = 'CART_COUPON_PORT';

/** Sepetin bir varyant hakkında bilmesi gereken HER ŞEY — fazlası değil. */
export interface VariantSnapshot {
  variantId: string;
  productId: string;
  productSlug: string;
  productTitle: string;
  sellerId: string;
  sellerName: string;
  storeSlug: string;
  color: string;
  size: string;
  imageKey: string | null;
  priceMinor: bigint;
  listPriceMinor: bigint | null;
  /** Varyant aktif ve ürün yayında mı. */
  isPurchasable: boolean;
  sellerApproved: boolean;
  sellerOnVacation: boolean;
  /**
   * Satılabilir stok = onHand − reserved.
   * ⚠️ Bu değer istemciye HAM olarak dönmez; rakip envanter takibi yapabilir.
   * Yalnızca sepet içi doğrulamada ve INSUFFICIENT_STOCK mesajında kullanılır.
   */
  availableQuantity: number;
}

export interface VariantPort {
  /** Tek sorguda toplu okuma — sepet görüntülemede N+1 sorgu kabul edilemez. */
  findByIds(variantIds: readonly string[]): Promise<Map<string, VariantSnapshot>>;
}

export interface CouponSnapshot {
  id: string;
  code: string;
  /** null = platform kuponu, dolu = mağaza kuponu. */
  sellerId: string | null;
  discountType: DiscountKind;
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

export interface CouponPort {
  findByCode(code: string): Promise<CouponSnapshot | null>;
  findById(couponId: string): Promise<CouponSnapshot | null>;
  /** Kullanıcının bu kuponu kaç kez kullandığı — kişi başı limit kontrolü. */
  countUserRedemptions(couponId: string, userId: string): Promise<number>;
}
