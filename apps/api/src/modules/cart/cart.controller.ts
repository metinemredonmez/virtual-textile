import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { zodBody } from '../../common/pipes/zod-validation.pipe.js';
import { RateLimit } from '../../common/guards/rate-limit.guard.js';
import { Idempotent } from '../../common/interceptors/idempotency.interceptor.js';
import { CurrentUser, Public } from '../auth/auth.guard.js';
import type { JwtPayload } from '@vt/contracts';
import { CartOwnerParam } from './cart.owner.js';
import { CartService, type CartOwner } from './cart.service.js';
import { OutfitService } from './outfit.service.js';
import {
  addItemSchema,
  applyCouponSchema,
  createOutfitSchema,
  mergeCartSchema,
  updateItemSchema,
  type AddItemInput,
  type ApplyCouponInput,
  type CreateOutfitInput,
  type MergeCartInput,
  type UpdateItemInput,
} from './cart.schema.js';

/**
 * ⚠️ Tüm sepet uçları @Public() — misafir de sepet kullanabilmeli.
 * "Public" burada "kimlik gerekmez" demektir, "yetki gerekmez" değil: sahiplik
 * her istekte kullanıcı kimliği ya da oturum kimliği üzerinden doğrulanır
 * (bkz. CartOwnerParam ve CartService'teki cartId eşleşmeleri).
 */
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Public()
  @Get()
  async view(@CartOwnerParam() owner: CartOwner): Promise<unknown> {
    return this.cart.view(owner);
  }

  @Public()
  @Post('items')
  @HttpCode(200)
  @RateLimit({ name: 'global', scope: 'user' })
  async addItem(
    @CartOwnerParam() owner: CartOwner,
    @Body(zodBody(addItemSchema)) body: AddItemInput,
  ): Promise<unknown> {
    return this.cart.addItem(owner, body);
  }

  @Public()
  @Patch('items/:id')
  async updateItem(
    @CartOwnerParam() owner: CartOwner,
    @Param('id') itemId: string,
    @Body(zodBody(updateItemSchema)) body: UpdateItemInput,
  ): Promise<unknown> {
    return this.cart.updateItem(owner, itemId, body);
  }

  @Public()
  @Delete('items/:id')
  async removeItem(
    @CartOwnerParam() owner: CartOwner,
    @Param('id') itemId: string,
  ): Promise<unknown> {
    return this.cart.removeItem(owner, itemId);
  }

  /**
   * Kupon kodu denemesi hız sınırına tabidir: sınırsız deneme, geçerli kupon
   * kodlarını kaba kuvvetle bulmak demektir.
   */
  @Public()
  @Post('coupon')
  @HttpCode(200)
  @RateLimit({ name: 'search', scope: 'user' })
  async applyCoupon(
    @CartOwnerParam() owner: CartOwner,
    @Body(zodBody(applyCouponSchema)) body: ApplyCouponInput,
  ): Promise<unknown> {
    return this.cart.applyCoupon(owner, body.code);
  }

  @Public()
  @Delete('coupon')
  async removeCoupon(@CartOwnerParam() owner: CartOwner): Promise<unknown> {
    return this.cart.removeCoupon(owner);
  }

  /**
   * Misafir sepetini üye sepetine taşır — giriş/kayıt sonrası çağrılır.
   *
   * ⚠️ @Idempotent(): adetler toplandığı için tekrar çalışması kullanıcının
   * sepetini ikiye katlar. Ağ zaman aşımında istemcinin isteği tekrarlaması
   * normaldir; koruma sunucuda olmalı.
   */
  @Post('merge')
  @HttpCode(200)
  @Idempotent()
  async merge(
    @CurrentUser() user: JwtPayload,
    @Body(zodBody(mergeCartSchema)) body: MergeCartInput,
  ): Promise<unknown> {
    return this.cart.merge(user.sub, body.sessionId);
  }
}

@Controller('outfits')
export class OutfitController {
  constructor(private readonly outfits: OutfitService) {}

  @Public()
  @Get()
  async list(@CartOwnerParam() owner: CartOwner): Promise<unknown> {
    return this.outfits.list(owner);
  }

  @Public()
  @Post()
  async create(
    @CartOwnerParam() owner: CartOwner,
    @Body(zodBody(createOutfitSchema)) body: CreateOutfitInput,
  ): Promise<unknown> {
    return this.outfits.create(owner, body);
  }

  /** Kombinin tamamını tek seferde sepete atar. */
  @Public()
  @Post(':id/items')
  @HttpCode(200)
  async addToCart(
    @CartOwnerParam() owner: CartOwner,
    @Param('id') outfitId: string,
  ): Promise<unknown> {
    return this.outfits.addToCart(owner, outfitId);
  }

  @Public()
  @Delete(':id')
  @HttpCode(204)
  async remove(@CartOwnerParam() owner: CartOwner, @Param('id') outfitId: string): Promise<void> {
    return this.outfits.remove(owner, outfitId);
  }
}
