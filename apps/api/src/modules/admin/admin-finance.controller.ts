import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import type { JwtPayload } from '@vt/contracts';
import { zodBody } from '../../common/pipes/zod-validation.pipe.js';
import { Idempotent } from '../../common/interceptors/idempotency.interceptor.js';
import { CurrentUser, Roles } from '../auth/auth.guard.js';
import { adminActor } from './audit.js';
import { AdminCommissionService } from './admin-commission.service.js';
import { AdminFinanceService } from './admin-finance.service.js';
import {
  adminOrderListQuerySchema,
  commissionRuleCreateSchema,
  commissionRuleListQuerySchema,
  commissionVersionCreateSchema,
  manualRefundSchema,
  payoutListQuerySchema,
  reasonBodySchema,
  type AdminOrderListQuery,
  type CommissionRuleCreateInput,
  type CommissionRuleListQuery,
  type CommissionVersionCreateInput,
  type ManualRefundInput,
  type PayoutListQuery,
  type ReasonBody,
} from './admin.schema.js';

/**
 * FİNANS YÖNETİM UÇLARI — komisyon, sipariş görünümü, manuel iade, payout.
 *
 * ⚠️ Komisyon ve payout uçları SUPPORT'a KAPALIDIR. Destek ekibinin işi
 *    müşteriye yardım etmek; komisyon oranı ve satıcıya para gönderimi
 *    yalnızca ADMIN yetkisindedir.
 *
 * ⚠️ Para hareketi başlatan iki uç (@Idempotent) — manuel iade ve payout
 *    onayı. Ağ zaman aşımında istemci isteği tekrarlar; anahtar olmadan
 *    ikinci istek ikinci bir para hareketi üretirdi.
 */
@Controller('admin')
export class AdminFinanceController {
  constructor(
    private readonly commissions: AdminCommissionService,
    private readonly finance: AdminFinanceService,
  ) {}

  // ── Komisyon kuralları ───────────────────────────────────────────────────

  @Get('commission-rules')
  @Roles('ADMIN')
  async listRules(
    @Query(zodBody(commissionRuleListQuerySchema)) query: CommissionRuleListQuery,
  ): Promise<unknown> {
    return { items: await this.commissions.listRules(query) };
  }

  /** Versiyon geçmişi append-only'dir; bu liste aynı zamanda bir denetim izidir. */
  @Get('commission-rules/:id/versions')
  @Roles('ADMIN')
  async listVersions(@Param('id') ruleId: string): Promise<unknown> {
    return this.commissions.listVersions(ruleId);
  }

  @Post('commission-rules')
  @Roles('ADMIN')
  async createRule(
    @CurrentUser() user: JwtPayload,
    @Body(zodBody(commissionRuleCreateSchema)) body: CommissionRuleCreateInput,
  ): Promise<unknown> {
    return this.commissions.createRule(adminActor(user), body);
  }

  /**
   * ⚠️ KURAL GÜNCELLENMEZ — YENİ VERSİYON YAZILIR.
   *
   * Bu yüzden uç PATCH /commission-rules/:id değil,
   * POST /commission-rules/:id/versions'tır: HTTP fiili de sözleşmeyi anlatır.
   * PATCH sunulsaydı, arayüz tarafında "oranı düzelt" gibi bir kullanım
   * beklentisi doğar ve er geç birileri UPDATE yazardı.
   */
  @Post('commission-rules/:id/versions')
  @Roles('ADMIN')
  async createVersion(
    @CurrentUser() user: JwtPayload,
    @Param('id') ruleId: string,
    @Body(zodBody(commissionVersionCreateSchema)) body: CommissionVersionCreateInput,
  ): Promise<unknown> {
    return this.commissions.createVersion(adminActor(user), ruleId, body);
  }

  // ── Sipariş genel görünümü ───────────────────────────────────────────────

  @Get('orders')
  @Roles('ADMIN', 'SUPPORT')
  async listOrders(
    @Query(zodBody(adminOrderListQuerySchema)) query: AdminOrderListQuery,
  ): Promise<unknown> {
    return this.finance.listOrders(query);
  }

  @Get('orders/:orderNumber')
  @Roles('ADMIN', 'SUPPORT')
  async orderDetail(@Param('orderNumber') orderNumber: string): Promise<unknown> {
    return this.finance.orderDetail(orderNumber);
  }

  /**
   * MANUEL İADE.
   *
   * ⚠️ Yanıt "para gitti" demez: talep kaydedilir ve ödeme modülüne
   *    OutboxEvent ile devredilir (bkz. AdminFinanceService.manualRefund).
   */
  @Post('orders/:id/refund')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @Roles('ADMIN')
  async manualRefund(
    @CurrentUser() user: JwtPayload,
    @Param('id') orderId: string,
    @Body(zodBody(manualRefundSchema)) body: ManualRefundInput,
  ): Promise<unknown> {
    return this.finance.manualRefund(adminActor(user), orderId, body);
  }

  // ── Payout ───────────────────────────────────────────────────────────────

  @Get('payouts')
  @Roles('ADMIN', 'SUPPORT')
  async listPayouts(
    @Query(zodBody(payoutListQuerySchema)) query: PayoutListQuery,
  ): Promise<unknown> {
    return this.finance.listPayouts(query);
  }

  @Post('payouts/:id/approve')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @Roles('ADMIN')
  async approvePayout(
    @CurrentUser() user: JwtPayload,
    @Param('id') payoutId: string,
  ): Promise<unknown> {
    return this.finance.approvePayout(adminActor(user), payoutId);
  }

  @Post('payouts/:id/reject')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  async rejectPayout(
    @CurrentUser() user: JwtPayload,
    @Param('id') payoutId: string,
    @Body(zodBody(reasonBodySchema)) body: ReasonBody,
  ): Promise<unknown> {
    return this.finance.rejectPayout(adminActor(user), payoutId, body.reason);
  }
}
