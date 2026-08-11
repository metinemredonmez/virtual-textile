import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { JwtPayload } from '@vt/contracts';
import { zodBody } from '../../common/pipes/zod-validation.pipe.js';
import { CurrentUser, Roles } from '../auth/auth.guard.js';
import { adminActor } from './audit.js';
import { AdminSellerService } from './admin-seller.service.js';
import { AdminCatalogService } from './admin-catalog.service.js';
import {
  categoryCreateSchema,
  categoryUpdateSchema,
  couponCreateSchema,
  couponListQuerySchema,
  moderationQuerySchema,
  reasonBodySchema,
  sellerApproveSchema,
  sellerListQuerySchema,
  type CategoryCreateInput,
  type CategoryUpdateInput,
  type CouponCreateInput,
  type CouponListQuery,
  type ModerationQuery,
  type ReasonBody,
  type SellerApproveInput,
  type SellerListQuery,
} from './admin.schema.js';

/**
 * YÖNETİM UÇLARI — satıcı başvuruları, ürün moderasyonu, kategori, kupon.
 *
 * ⚠️ @Roles HER UCA AYRI AYRI yazılır, sınıf düzeyinde değil. Sınıfa
 *    yazılsaydı yeni bir uç eklenirken rolü düşünmek gerekmez, varsayılan
 *    olarak "admin her şeyi yapar" haline gelirdi. Burada okuma ile karar
 *    ayrımı açık: SUPPORT inceler, ADMIN karar verir.
 *
 * Hiçbiri @Public değil; JwtAuthGuard varsayılan olarak token ister.
 */
@Controller('admin')
export class AdminController {
  constructor(
    private readonly sellers: AdminSellerService,
    private readonly catalog: AdminCatalogService,
  ) {}

  // ── Satıcı başvuruları ───────────────────────────────────────────────────

  /** Destek ekibi başvuruları görebilir; karar veremez. */
  @Get('sellers')
  @Roles('ADMIN', 'SUPPORT')
  async listSellers(
    @Query(zodBody(sellerListQuerySchema)) query: SellerListQuery,
  ): Promise<unknown> {
    return this.sellers.list(query);
  }

  @Get('sellers/:id')
  @Roles('ADMIN', 'SUPPORT')
  async sellerDetail(@Param('id') sellerId: string): Promise<unknown> {
    return this.sellers.detail(sellerId);
  }

  @Post('sellers/:id/approve')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  async approveSeller(
    @CurrentUser() user: JwtPayload,
    @Param('id') sellerId: string,
    @Body(zodBody(sellerApproveSchema.default({}))) body: SellerApproveInput,
  ): Promise<unknown> {
    return this.sellers.approve(adminActor(user), sellerId, body);
  }

  /** Red kalıcı sonuç doğurur → gerekçe zorunlu, denetim kaydına yazılır. */
  @Post('sellers/:id/reject')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  async rejectSeller(
    @CurrentUser() user: JwtPayload,
    @Param('id') sellerId: string,
    @Body(zodBody(reasonBodySchema)) body: ReasonBody,
  ): Promise<unknown> {
    return this.sellers.reject(adminActor(user), sellerId, body.reason);
  }

  /** ⚠️ Askıya alma: mağaza vitrinden düşer. Gerekçe zorunlu. */
  @Post('sellers/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  async suspendSeller(
    @CurrentUser() user: JwtPayload,
    @Param('id') sellerId: string,
    @Body(zodBody(reasonBodySchema)) body: ReasonBody,
  ): Promise<unknown> {
    return this.sellers.suspend(adminActor(user), sellerId, body.reason);
  }

  @Post('sellers/:id/reinstate')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  async reinstateSeller(
    @CurrentUser() user: JwtPayload,
    @Param('id') sellerId: string,
    @Body(zodBody(reasonBodySchema)) body: ReasonBody,
  ): Promise<unknown> {
    return this.sellers.reinstate(adminActor(user), sellerId, body.reason);
  }

  // ── Ürün moderasyonu ─────────────────────────────────────────────────────

  @Get('products/moderation')
  @Roles('ADMIN', 'SUPPORT')
  async moderationQueue(
    @Query(zodBody(moderationQuerySchema)) query: ModerationQuery,
  ): Promise<unknown> {
    return this.sellers.moderationQueue(query);
  }

  @Post('products/:id/approve')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  async approveProduct(
    @CurrentUser() user: JwtPayload,
    @Param('id') productId: string,
  ): Promise<unknown> {
    return this.sellers.approveProduct(adminActor(user), productId);
  }

  @Post('products/:id/reject')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  async rejectProduct(
    @CurrentUser() user: JwtPayload,
    @Param('id') productId: string,
    @Body(zodBody(reasonBodySchema)) body: ReasonBody,
  ): Promise<unknown> {
    return this.sellers.rejectProduct(adminActor(user), productId, body.reason);
  }

  // ── Kategori ─────────────────────────────────────────────────────────────

  @Get('categories')
  @Roles('ADMIN', 'SUPPORT')
  async listCategories(): Promise<unknown> {
    return { items: await this.catalog.listCategories() };
  }

  @Post('categories')
  @Roles('ADMIN')
  async createCategory(
    @CurrentUser() user: JwtPayload,
    @Body(zodBody(categoryCreateSchema)) body: CategoryCreateInput,
  ): Promise<unknown> {
    return this.catalog.createCategory(adminActor(user), body);
  }

  @Patch('categories/:id')
  @Roles('ADMIN')
  async updateCategory(
    @CurrentUser() user: JwtPayload,
    @Param('id') categoryId: string,
    @Body(zodBody(categoryUpdateSchema)) body: CategoryUpdateInput,
  ): Promise<unknown> {
    return this.catalog.updateCategory(adminActor(user), categoryId, body);
  }

  // ── Kupon & kampanya ─────────────────────────────────────────────────────

  @Get('coupons')
  @Roles('ADMIN', 'SUPPORT')
  async listCoupons(
    @Query(zodBody(couponListQuerySchema)) query: CouponListQuery,
  ): Promise<unknown> {
    return this.catalog.listCoupons(query);
  }

  @Post('coupons')
  @Roles('ADMIN')
  async createCoupon(
    @CurrentUser() user: JwtPayload,
    @Body(zodBody(couponCreateSchema)) body: CouponCreateInput,
  ): Promise<unknown> {
    return this.catalog.createCoupon(adminActor(user), body);
  }

  /** Silme YOK — pasifleştirme. Geçmiş kullanımların dayanağı korunur. */
  @Post('coupons/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  async deactivateCoupon(
    @CurrentUser() user: JwtPayload,
    @Param('id') couponId: string,
  ): Promise<unknown> {
    return this.catalog.deactivateCoupon(adminActor(user), couponId);
  }
}
