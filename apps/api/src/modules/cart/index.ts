import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import { CartController, OutfitController } from './cart.controller.js';
import { CartService } from './cart.service.js';
import { OutfitService } from './outfit.service.js';
import { PrismaCouponAdapter, PrismaVariantAdapter } from './cart.gateway.js';
import { COUPON_PORT, VARIANT_PORT } from './cart.ports.js';

/**
 * SEPET MODÜLÜ
 *
 * Sahip olduğu tablolar: Cart, CartItem, Outfit.
 * Katalog (varyant/stok/satıcı) ve kampanya (kupon) verisine yalnızca
 * `cart.ports.ts`'deki dar arayüzler üzerinden erişir. Bu modüller kendi
 * servislerini yayımladığında AŞAĞIDAKİ İKİ PROVIDER değişir, başka hiçbir
 * dosyaya dokunulmaz.
 */
@Module({
  controllers: [CartController, OutfitController],
  providers: [
    {
      provide: VARIANT_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PrismaVariantAdapter(prisma),
    },
    {
      provide: COUPON_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PrismaCouponAdapter(prisma),
    },
    {
      provide: CartService,
      inject: [PrismaService, VARIANT_PORT, COUPON_PORT, APP_LOGGER],
      useFactory: (...args: ConstructorParameters<typeof CartService>) => new CartService(...args),
    },
    {
      provide: OutfitService,
      inject: [PrismaService, CartService],
      useFactory: (...args: ConstructorParameters<typeof OutfitService>) =>
        new OutfitService(...args),
    },
  ],
  // Checkout modülü sepeti okuyup siparişe çevirecek: sepet tablolarına
  // doğrudan erişmesin diye servis dışa açılıyor.
  exports: [CartService, OutfitService],
})
export class CartModule {}

export { CartService } from './cart.service.js';
export { OutfitService } from './outfit.service.js';
export { calculateCartTotals } from './cart-totals.js';
export type {
  CartOwner,
  CartView,
  CartItemView,
  CartPackageView,
  ItemIssue,
  SkippedItem,
} from './cart.service.js';
export type { OutfitView } from './outfit.service.js';
export type { CartTotals, CartLineInput, CouponInput } from './cart-totals.js';
export type { CouponPort, VariantPort, VariantSnapshot, CouponSnapshot } from './cart.ports.js';
export { COUPON_PORT, VARIANT_PORT } from './cart.ports.js';
