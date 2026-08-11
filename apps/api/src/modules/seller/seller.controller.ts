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
import { Idempotent } from '../../common/interceptors/idempotency.interceptor.js';
import { CurrentUser } from '../auth/auth.guard.js';
import { SellerId, SellerPanel } from './seller.scope.js';
import { SellerService } from './seller.service.js';
import { SellerProductService } from './seller-product.service.js';
import { SellerFulfillmentService } from './seller-fulfillment.service.js';
import { SellerFinanceService } from './seller-finance.service.js';
import { SellerAnalyticsService } from './seller-analytics.service.js';
import { SellerCouponService } from './seller-coupon.service.js';
import {
  analyticsQuerySchema,
  bulkUploadSchema,
  bulkVariantUpdateSchema,
  couponListQuerySchema,
  createCouponSchema,
  createPayoutSchema,
  createProductSchema,
  decideReturnSchema,
  ledgerQuerySchema,
  payoutListQuerySchema,
  productListQuerySchema,
  sellerApplySchema,
  sellerOrderListQuerySchema,
  sellerReturnListQuerySchema,
  shipPackageSchema,
  updateCouponSchema,
  updatePackageStatusSchema,
  updateProductSchema,
  updateStoreSchema,
  type AnalyticsQuery,
  type BulkUploadInput,
  type BulkVariantUpdateInput,
  type CouponListQuery,
  type CreateCouponInput,
  type CreatePayoutInput,
  type CreateProductInput,
  type DecideReturnInput,
  type LedgerQuery,
  type PayoutListQuery,
  type SellerOrderListQuery,
  type SellerProductListQuery,
  type SellerReturnListQuery,
  type ShipPackageInput,
  type UpdateCouponInput,
  type UpdatePackageStatusInput,
  type UpdateProductInput,
  type UpdateStoreInput,
} from './seller.schema.js';

/**
 * ═══════════════════════ SATICI BAŞVURU UCU ═════════════════════════════════
 *
 * ⚠️ DİĞER SATICI UÇLARINDAN AYRI BİR DENETLEYİCİDE ve bilinçli olarak
 *    `@Roles('SELLER_USER')` + `SellerScopeGuard` OLMADAN.
 *
 *    Sebep: başvuran kullanıcı henüz satıcı DEĞİLDİR. Rolü `CUSTOMER`'dır ve
 *    token'ındaki `sellerIds` boştur. Bu uca satıcı guard'ları konsaydı
 *    `SellerScopeGuard` "mağaza seçilmedi" diyerek her başvuruyu reddeder ve
 *    sisteme HİÇ KİMSE satıcı olarak katılamazdı — kilitli bir kapı.
 *
 *    Kapsam güvenliği kaybolmuyor, yer değiştiriyor: başvuru her zaman
 *    OTURUMDAKİ kullanıcı adına açılır (`user.sub`). Gövdeden kullanıcı
 *    kimliği okunmaz, dolayısıyla başkası adına başvuru yapılamaz.
 *
 *    Uç `@Public` DEĞİLDİR: kimlik doğrulaması zorunludur.
 */
@Controller('seller')
export class SellerApplicationController {
  constructor(private readonly sellers: SellerService) {}

  /**
   * @Idempotent: başvuru Seller + Store + üyelik yaratır. Ağ zaman aşımında
   * istemci tekrar denerse anahtar olmadan ikinci istek "zaten başvurunuz var"
   * hatası alır ve kullanıcıya başvuru başarısız görünürdü.
   */
  @Post('apply')
  @Idempotent()
  async apply(
    @CurrentUser() user: JwtPayload,
    @Body(zodBody(sellerApplySchema)) body: unknown,
  ): Promise<unknown> {
    return this.sellers.apply(user.sub, body as Parameters<SellerService['apply']>[1]);
  }
}

/**
 * ═══════════════════════ SATICI PANELİ UÇLARI ═══════════════════════════════
 *
 * ⚠️ SINIF DÜZEYİNDE `@Roles('SELLER_USER')` + `SellerScopeGuard`.
 *
 *    Guard'ların sınıfa konması bilinçlidir: metot metot yazılsaydı, ileride
 *    eklenen bir uçta unutulması an meselesiydi ve o uç korumasız kalırdı.
 *    Sınıf düzeyinde varsayılan KAPALI olur — yeni uç otomatik korunur.
 *
 *    `SellerScopeGuard` olmadan bir satıcı, URL'deki veya `X-Seller-Id`
 *    başlığındaki kimliği değiştirip BAŞKA MAĞAZANIN siparişlerini, cirosunu
 *    ve bakiyesini görebilirdi. Guard, istenen mağazanın token'daki
 *    `sellerIds` listesinde olduğunu doğrular ve `request.sellerId`'ye yazar;
 *    denetleyici o değeri `@SellerId()` ile alır — gövdeden veya sorgudan
 *    ASLA okumaz.
 */
@Controller('seller')
@SellerPanel()
export class SellerController {
  constructor(
    private readonly sellers: SellerService,
    private readonly products: SellerProductService,
    private readonly fulfillment: SellerFulfillmentService,
    private readonly finance: SellerFinanceService,
    private readonly analytics: SellerAnalyticsService,
    private readonly coupons: SellerCouponService,
  ) {}

  // ── Profil & mağaza ──────────────────────────────────────────────────────

  @Get('me')
  async me(@SellerId() sellerId: string): Promise<unknown> {
    return this.sellers.profile(sellerId);
  }

  @Patch('store')
  async updateStore(
    @SellerId() sellerId: string,
    @Body(zodBody(updateStoreSchema)) body: UpdateStoreInput,
  ): Promise<unknown> {
    return this.sellers.updateStore(sellerId, body);
  }

  // ── Ürünler ──────────────────────────────────────────────────────────────

  @Get('products')
  async listProducts(
    @SellerId() sellerId: string,
    @Query(zodBody(productListQuerySchema)) query: SellerProductListQuery,
  ): Promise<unknown> {
    return this.products.list(sellerId, query);
  }

  @Get('products/:id')
  async getProduct(@SellerId() sellerId: string, @Param('id') productId: string): Promise<unknown> {
    return this.products.get(sellerId, productId);
  }

  @Post('products')
  async createProduct(
    @SellerId() sellerId: string,
    @Body(zodBody(createProductSchema)) body: CreateProductInput,
  ): Promise<unknown> {
    return this.products.create(sellerId, body);
  }

  @Patch('products/:id')
  async updateProduct(
    @SellerId() sellerId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') productId: string,
    @Body(zodBody(updateProductSchema)) body: UpdateProductInput,
  ): Promise<unknown> {
    return this.products.update(sellerId, productId, body, user.sub);
  }

  /**
   * Ürün SİLİNMEZ, arşivlenir — bu yüzden DELETE değil POST.
   * DELETE fiili "kayıt gitti" beklentisi yaratırdı; sipariş geçmişi ve fiyat
   * denetimi için kayıt duruyor.
   */
  @Post('products/:id/archive')
  @HttpCode(HttpStatus.OK)
  async archiveProduct(
    @SellerId() sellerId: string,
    @Param('id') productId: string,
  ): Promise<unknown> {
    return this.products.archive(sellerId, productId);
  }

  /**
   * CSV TOPLU YÜKLEME.
   *
   * @Idempotent: yüzlerce ürün yaratan pahalı bir işlem. Ağ zaman aşımında
   * istemci tekrar denerse anahtar sayesinde ikinci kez işlenmez, ilk yanıt
   * aynen döner.
   */
  @Post('products/bulk-upload')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  async bulkUpload(
    @SellerId() sellerId: string,
    @CurrentUser() user: JwtPayload,
    @Body(zodBody(bulkUploadSchema)) body: BulkUploadInput,
  ): Promise<unknown> {
    return this.products.bulkUpload(sellerId, body, user.sub);
  }

  /** Varyant fiyat / stok / aktiflik toplu güncelleme. */
  @Patch('variants/bulk')
  async bulkUpdateVariants(
    @SellerId() sellerId: string,
    @CurrentUser() user: JwtPayload,
    @Body(zodBody(bulkVariantUpdateSchema)) body: BulkVariantUpdateInput,
  ): Promise<unknown> {
    return this.products.bulkUpdateVariants(sellerId, body, user.sub);
  }

  // ── Siparişler & paketler ────────────────────────────────────────────────

  @Get('orders')
  async listOrders(
    @SellerId() sellerId: string,
    @Query(zodBody(sellerOrderListQuerySchema)) query: SellerOrderListQuery,
  ): Promise<unknown> {
    return this.fulfillment.listPackages(sellerId, query);
  }

  @Get('packages/:id')
  async getPackage(@SellerId() sellerId: string, @Param('id') packageId: string): Promise<unknown> {
    return this.fulfillment.getPackage(sellerId, packageId);
  }

  @Patch('packages/:id/status')
  async updatePackageStatus(
    @SellerId() sellerId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') packageId: string,
    @Body(zodBody(updatePackageStatusSchema)) body: UpdatePackageStatusInput,
  ): Promise<unknown> {
    return this.fulfillment.updatePackageStatus(sellerId, packageId, body, user.sub);
  }

  /** Kargo takip numarası girişi — paketi SHIPPED'a taşır. */
  @Post('packages/:id/shipment')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  async shipPackage(
    @SellerId() sellerId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') packageId: string,
    @Body(zodBody(shipPackageSchema)) body: ShipPackageInput,
  ): Promise<unknown> {
    return this.fulfillment.shipPackage(sellerId, packageId, body, user.sub);
  }

  // ── İadeler ──────────────────────────────────────────────────────────────

  @Get('returns')
  async listReturns(
    @SellerId() sellerId: string,
    @Query(zodBody(sellerReturnListQuerySchema)) query: SellerReturnListQuery,
  ): Promise<unknown> {
    return this.fulfillment.listReturns(sellerId, query);
  }

  @Get('returns/:id')
  async getReturn(@SellerId() sellerId: string, @Param('id') returnId: string): Promise<unknown> {
    return this.fulfillment.getReturn(sellerId, returnId);
  }

  /**
   * İade kararı — PARA HAREKET EDER (onayda defter ters kayıtları düşer).
   * @Idempotent bu yüzden zorunlu: tekrarlanan istek ikinci kez ters kayıt
   * yazarsa satıcının bakiyesi iki kez düşerdi.
   */
  @Patch('returns/:id')
  @Idempotent()
  async decideReturn(
    @SellerId() sellerId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') returnId: string,
    @Body(zodBody(decideReturnSchema)) body: DecideReturnInput,
  ): Promise<unknown> {
    return this.fulfillment.decideReturn(sellerId, returnId, body, user.sub);
  }

  // ── Analitik ─────────────────────────────────────────────────────────────

  @Get('analytics/funnel')
  async funnel(
    @SellerId() sellerId: string,
    @Query(zodBody(analyticsQuerySchema)) query: AnalyticsQuery,
  ): Promise<unknown> {
    return this.analytics.funnel(sellerId, query);
  }

  // ── Finans ───────────────────────────────────────────────────────────────

  @Get('finance/balance')
  async balance(@SellerId() sellerId: string): Promise<unknown> {
    return this.finance.balance(sellerId);
  }

  @Get('finance/ledger')
  async ledger(
    @SellerId() sellerId: string,
    @Query(zodBody(ledgerQuerySchema)) query: LedgerQuery,
  ): Promise<unknown> {
    return this.finance.ledger(sellerId, query);
  }

  /**
   * ÖDEME TALEBİ — @Idempotent ZORUNLU.
   *
   * Ağ zaman aşımında istemci isteği tekrarlar. Anahtar olmadan ikinci istek
   * ya ikinci bir talep açar (aynı para iki kez ödenir) ya da
   * PAYOUT_PENDING_EXISTS alıp satıcıya "talep başarısız" gösterir — ikisi de
   * yanlış. Anahtarla ilk yanıt aynen döner.
   */
  @Post('finance/payout')
  @Idempotent()
  async requestPayout(
    @SellerId() sellerId: string,
    @CurrentUser() user: JwtPayload,
    @Body(zodBody(createPayoutSchema)) body: CreatePayoutInput,
  ): Promise<unknown> {
    return this.finance.requestPayout(sellerId, body, user.sub);
  }

  @Get('finance/payouts')
  async listPayouts(
    @SellerId() sellerId: string,
    @Query(zodBody(payoutListQuerySchema)) query: PayoutListQuery,
  ): Promise<unknown> {
    return this.finance.listPayouts(sellerId, query);
  }

  // ── Kuponlar ─────────────────────────────────────────────────────────────

  @Get('coupons')
  async listCoupons(
    @SellerId() sellerId: string,
    @Query(zodBody(couponListQuerySchema)) query: CouponListQuery,
  ): Promise<unknown> {
    return this.coupons.list(sellerId, query);
  }

  @Post('coupons')
  async createCoupon(
    @SellerId() sellerId: string,
    @Body(zodBody(createCouponSchema)) body: CreateCouponInput,
  ): Promise<unknown> {
    return this.coupons.create(sellerId, body);
  }

  @Patch('coupons/:id')
  async updateCoupon(
    @SellerId() sellerId: string,
    @Param('id') couponId: string,
    @Body(zodBody(updateCouponSchema)) body: UpdateCouponInput,
  ): Promise<unknown> {
    return this.coupons.update(sellerId, couponId, body);
  }
}
