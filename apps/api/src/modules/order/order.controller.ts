import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import type { JwtPayload } from '@vt/contracts';
import { zodBody } from '../../common/pipes/zod-validation.pipe.js';
import { RateLimit } from '../../common/guards/rate-limit.guard.js';
import { Idempotent } from '../../common/interceptors/idempotency.interceptor.js';
import { CurrentUser } from '../auth/auth.guard.js';
import { OrderService } from './order.service.js';
import {
  cancelOrderSchema,
  createReturnSchema,
  orderListQuerySchema,
  orderNumberSchema,
  type CancelOrderInput,
  type CreateReturnInput,
  type OrderListQuery,
} from './order.schema.js';

/**
 * MÜŞTERİ SİPARİŞ UÇLARI.
 *
 * Hiçbiri @Public değil: sipariş kişisel veridir (adres, telefon, ne aldığı).
 * Sahiplik kontrolü servis katmanında sorgu koşulu olarak yapılır — guard'a
 * bırakılsaydı yeni bir uç eklenirken atlanabilirdi.
 *
 * ⚠️ Misafir siparişleri bu uçlardan görünmez; onlar için e-posta + sipariş
 * numarası ile ayrı bir doğrulama akışı gerekir.
 */
@Controller('orders')
export class OrderController {
  constructor(private readonly orders: OrderService) {}

  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query(zodBody(orderListQuerySchema)) query: OrderListQuery,
  ): Promise<unknown> {
    return this.orders.listForUser(user.sub, query);
  }

  @Get(':orderNumber')
  async detail(
    @CurrentUser() user: JwtPayload,
    @Param('orderNumber', zodBody(orderNumberSchema)) orderNumber: string,
  ): Promise<unknown> {
    return this.orders.getByOrderNumber(user.sub, orderNumber);
  }

  /**
   * İptal 200 döner, 201 değil: yeni kaynak yaratılmıyor, var olanın durumu
   * değişiyor.
   *
   * @Idempotent: ağ zaman aşımında istemci tekrar dener; anahtar olmadan
   * ikinci istek "zaten iptal" hatası alır ve kullanıcıya iptal başarısız
   * görünür.
   */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RateLimit({ name: 'checkout', scope: 'user' })
  async cancel(
    @CurrentUser() user: JwtPayload,
    @Param('id') orderId: string,
    @Body(zodBody(cancelOrderSchema.default({}))) body: CancelOrderInput,
  ): Promise<unknown> {
    return this.orders.cancel(user.sub, orderId, body);
  }

  /** İade talebi para hareketi başlatır → idempotency zorunlu. */
  @Post(':id/returns')
  @Idempotent()
  @RateLimit({ name: 'checkout', scope: 'user' })
  async createReturn(
    @CurrentUser() user: JwtPayload,
    @Param('id') orderId: string,
    @Body(zodBody(createReturnSchema)) body: CreateReturnInput,
  ): Promise<unknown> {
    return this.orders.createReturn(user.sub, orderId, body);
  }
}
