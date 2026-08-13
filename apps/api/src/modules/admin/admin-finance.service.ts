import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { appError } from '@vt/contracts';
import { FINANCE } from '@vt/config';
import type { PayoutStatus } from '@vt/db';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import type { Logger } from '../../common/logger.js';
import { AUDIT_ACTION, emitOutbox, writeAuditLog, type AdminActor } from './audit.js';
import {
  ADMIN_ORDER_READER,
  ADMIN_PAYOUT_PORT,
  type AdminOrderReaderPort,
  type AdminPayoutPort,
} from './admin.ports.js';
import type { AdminOrderListQuery, ManualRefundInput, PayoutListQuery } from './admin.schema.js';

/**
 * SİPARİŞ GENEL GÖRÜNÜMÜ, MANUEL İADE VE PAYOUT KARARLARI.
 *
 * ⚠️ Bu servis PARA HAREKETİ YAPMAZ. Ne ödeme sağlayıcısını çağırır ne de
 *    defter (LedgerEntry) yazar. Yaptığı iş: kararı doğrulamak, denetim kaydı
 *    yazmak ve işi sahibine OutboxEvent ile devretmek.
 *
 *    Nedeni: dış servis çağrısı transaction içinde yapılamaz. Transaction
 *    sağlayıcının yanıtını beklerken kilitleri tutar; geri alınsa bile
 *    gönderilmiş para geri gelmez. Sipariş modülü de aynı kuralı izliyor
 *    (bkz. OrderService.cancel).
 */
@Injectable()
export class AdminFinanceService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ADMIN_ORDER_READER) private readonly orders: AdminOrderReaderPort,
    @Inject(ADMIN_PAYOUT_PORT) private readonly payouts: AdminPayoutPort,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  // ── Sipariş genel görünümü (salt okunur) ─────────────────────────────────

  async listOrders(query: AdminOrderListQuery): Promise<unknown> {
    return this.orders.list({
      status: query.status,
      sellerId: query.sellerId,
      q: query.q,
      from: query.from,
      to: query.to,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  async orderDetail(orderNumber: string): Promise<unknown> {
    const order = await this.orders.findByOrderNumber(orderNumber);
    if (!order) throw appError('ORDER_NOT_FOUND');
    return order;
  }

  // ── Manuel iade ──────────────────────────────────────────────────────────

  /**
   * MANUEL İADE — müşteri iade talebi olmadan, destek kararıyla.
   *
   * ⚠️ TUTAR KONTROLÜ: iade, sağlayıcıdan GERÇEKTEN TAHSİL EDİLEN tutardan
   *    önceki iadeler düşüldükten sonra kalan miktarı aşamaz. Aşarsa
   *    sağlayıcı işlemi reddeder ama biz kaydı yazmış oluruz; defter ile
   *    sağlayıcı ebediyen ayrışır.
   *
   * ⚠️ Tahsil edilen tutar ÖDEME kayıtlarından okunur, sipariş toplamından
   *    değil: sipariş kısmen iptal edilmiş veya farklı tutarla çekilmiş
   *    olabilir. Sipariş toplamına güvenilseydi, iptal edilmiş bir siparişte
   *    hiç çekilmemiş para "iade" edilebilirdi.
   *
   * ⚠️ Uç `@Idempotent()`: ağ zaman aşımında istemci tekrar dener; anahtar
   *    olmadan müşteriye iki kez para gider.
   */
  async manualRefund(
    actor: AdminActor,
    orderId: string,
    input: ManualRefundInput,
  ): Promise<unknown> {
    if (input.amountMinor <= 0n) {
      throw appError('VALIDATION_FAILED', {
        internalMessage: `Geçersiz iade tutarı: ${input.amountMinor}`,
        details: {
          fields: [{ path: 'amountMinor', message: 'İade tutarı sıfırdan büyük olmalı.' }],
        },
      });
    }

    const context = await this.orders.loadRefundContext(orderId);
    if (!context) throw appError('ORDER_NOT_FOUND');

    if (context.paidAt === null || context.capturedMinor <= 0n) {
      // Tahsilat HİÇ yok — "iade tutarı ödemeyi aşıyor" demek operatörü
      // tutarı düşürmeye yönlendirirdi; doğru eylem sipariş iptali.
      throw appError('REFUND_NO_CAPTURED_PAYMENT', {
        internalMessage: `Sipariş ${context.orderNumber} için tahsil edilmiş ödeme yok`,
      });
    }

    const remaining = context.capturedMinor - context.alreadyRefundedMinor;
    if (input.amountMinor > remaining) {
      throw appError('REFUND_EXCEEDS_PAYMENT', {
        internalMessage: `İade ${input.amountMinor} > kalan ${remaining} (tahsil ${context.capturedMinor}, önceki iade ${context.alreadyRefundedMinor})`,
        details: {
          remainingRefundableMinor: remaining.toString(),
          currency: context.currency,
        },
      });
    }

    /**
     * ⚠️ Sağlayıcı idempotency anahtarı BURADA üretilir ve olay yüküne konur.
     *    İşçi yeniden denerken AYNI anahtarı gönderir; sağlayıcı ikinci çağrıyı
     *    yeni bir iade olarak işlemez. İşçi kendi üretseydi her denemede yeni
     *    anahtar oluşur ve tekrar eden iadeler mümkün olurdu.
     */
    const refundRef = `adm-${randomUUID()}`;

    return this.prisma.$transaction(async (tx) => {
      await writeAuditLog(tx, actor, {
        action: AUDIT_ACTION.orderRefundRequested,
        entityType: 'Order',
        entityId: orderId,
        before: {
          orderNumber: context.orderNumber,
          status: context.status,
          capturedMinor: context.capturedMinor,
          alreadyRefundedMinor: context.alreadyRefundedMinor,
        },
        after: {
          refundAmountMinor: input.amountMinor,
          refundRef,
          remainingAfterMinor: remaining - input.amountMinor,
        },
        reason: input.reason,
      });

      // Parayı ödeme modülü geri verir; defter ters kaydını finans modülü yazar.
      await emitOutbox(tx, {
        aggregate: 'order',
        aggregateId: orderId,
        type: 'order.refund.manual.requested',
        payload: {
          orderId,
          orderNumber: context.orderNumber,
          amountMinor: input.amountMinor,
          currency: context.currency,
          refundRef,
          reason: input.reason,
          actorId: actor.id,
        },
      });

      this.logger.warn(
        {
          orderNumber: context.orderNumber,
          amountMinor: input.amountMinor.toString(),
          refundRef,
          actorId: actor.id,
        },
        'Manuel iade talebi kaydedildi — ödeme modülüne devredildi',
      );

      return {
        orderId,
        orderNumber: context.orderNumber,
        refundRef,
        amountMinor: input.amountMinor,
        currency: context.currency,
        remainingRefundableMinor: remaining - input.amountMinor,
        /** Para henüz gitmedi: sağlayıcı çağrısı işçi tarafından yapılacak. */
        status: 'REFUND_REQUESTED',
      };
    });
  }

  // ── Payout ───────────────────────────────────────────────────────────────

  async listPayouts(query: PayoutListQuery): Promise<unknown> {
    return this.payouts.list({
      status: query.status,
      sellerId: query.sellerId,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  /**
   * PAYOUT ONAYI.
   *
   * ⚠️ ÇİFT ÖDEME RİSKİ. Satıcı bakiyesi ayrı bir kolonda tutulmaz, defterden
   *    toplanır; PAYOUT satırı ise para gerçekten çıkarken (işçi tarafından)
   *    yazılır. Dolayısıyla "onaylanmış ama gönderilmemiş" talepler bakiyede
   *    HÂLÂ GÖRÜNÜR. İki talep arka arkaya onaylanırsa aynı para iki kez
   *    ödenebilirdi. Bu yüzden onaylı-bekleyen talepler bakiyeden ayrıca
   *    düşülüyor ve talep satırı transaction boyunca kilitleniyor.
   *
   * ⚠️ Asgari tutar ve bakiye kontrolü, satıcı talebi oluştururken de yapılır.
   *    Burada tekrar yapılıyor çünkü talep ile onay arasında geçen sürede
   *    iade gerçekleşip bakiye erimiş olabilir.
   */
  async approvePayout(actor: AdminActor, payoutId: string): Promise<unknown> {
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const payout = await this.payouts.lockAndRead(tx, payoutId);
      if (!payout) {
        throw appError('NOT_FOUND', { internalMessage: `Payout ${payoutId} yok` });
      }
      this.assertPayoutTransition(payout.status, 'APPROVED', payoutId);

      if (payout.amountMinor < FINANCE.minPayoutMinor) {
        // ⚠️ Tutar KURUŞ dizgisi — biçim gösterildiği dilde kurulur.
        throw appError('PAYOUT_BELOW_MINIMUM', {
          params: { minAmount: FINANCE.minPayoutMinor.toString() },
          internalMessage: `Payout ${payoutId} tutarı ${payout.amountMinor} < ${FINANCE.minPayoutMinor}`,
        });
      }

      const balance = await this.payouts.availableForPayoutMinor(tx, payout.sellerId, payoutId);
      if (payout.amountMinor > balance.availableMinor) {
        throw appError('PAYOUT_INSUFFICIENT_BALANCE', {
          internalMessage:
            `Payout ${payoutId}: talep ${payout.amountMinor} > ödenebilir ${balance.availableMinor} ` +
            `(defter ${balance.ledgerAvailableMinor}, onaylı bekleyen ${balance.approvedInFlightMinor})`,
          details: { availableMinor: balance.availableMinor.toString() },
        });
      }

      await this.payouts.applyStatus(tx, payoutId, {
        status: 'APPROVED',
        approvedBy: actor.id,
        approvedAt: now,
      });

      await writeAuditLog(tx, actor, {
        action: AUDIT_ACTION.payoutApproved,
        entityType: 'PayoutRequest',
        entityId: payoutId,
        before: { status: payout.status },
        after: {
          status: 'APPROVED',
          amountMinor: payout.amountMinor,
          sellerId: payout.sellerId,
          approvedBy: actor.id,
          ledgerAvailableMinor: balance.ledgerAvailableMinor,
          approvedInFlightMinor: balance.approvedInFlightMinor,
        },
      });

      // Havale/EFT işçi tarafından yapılır; `payoutRef` idempotency anahtarıdır.
      await emitOutbox(tx, {
        aggregate: 'payout',
        aggregateId: payoutId,
        type: 'payout.approved',
        payload: {
          payoutId,
          sellerId: payout.sellerId,
          amountMinor: payout.amountMinor,
          payoutRef: payout.payoutRef,
          actorId: actor.id,
        },
      });

      this.logger.warn(
        {
          payoutId,
          sellerId: payout.sellerId,
          amountMinor: payout.amountMinor.toString(),
          actorId: actor.id,
        },
        'Payout onaylandı — gönderim işçiye devredildi',
      );

      return { payoutId, status: 'APPROVED' as PayoutStatus, amountMinor: payout.amountMinor };
    });
  }

  /**
   * PAYOUT REDDİ.
   *
   * Talep CANCELLED'a çekilir; defterde hiçbir kayıt oluşmaz çünkü onay
   * aşamasında da oluşmamıştı — bakiye zaten hiç azalmamıştı.
   */
  async rejectPayout(actor: AdminActor, payoutId: string, reason: string): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      const payout = await this.payouts.lockAndRead(tx, payoutId);
      if (!payout) {
        throw appError('NOT_FOUND', { internalMessage: `Payout ${payoutId} yok` });
      }
      this.assertPayoutTransition(payout.status, 'CANCELLED', payoutId);

      await this.payouts.applyStatus(tx, payoutId, {
        status: 'CANCELLED',
        failureReason: reason,
      });

      await writeAuditLog(tx, actor, {
        action: AUDIT_ACTION.payoutRejected,
        entityType: 'PayoutRequest',
        entityId: payoutId,
        before: { status: payout.status },
        after: { status: 'CANCELLED', amountMinor: payout.amountMinor, sellerId: payout.sellerId },
        reason,
      });

      await emitOutbox(tx, {
        aggregate: 'payout',
        aggregateId: payoutId,
        type: 'payout.rejected',
        payload: {
          payoutId,
          sellerId: payout.sellerId,
          amountMinor: payout.amountMinor,
          reason,
          actorId: actor.id,
        },
      });

      return { payoutId, status: 'CANCELLED' as PayoutStatus, reason };
    });
  }

  /**
   * ⚠️ Yalnızca REQUESTED bir talep karara bağlanabilir.
   *    APPROVED/SENT bir talebin yeniden onaylanması ikinci bir havale
   *    olayı üretirdi; FAILED/CANCELLED olan ise satıcının yeni talep
   *    açmasını gerektirir.
   */
  private assertPayoutTransition(
    current: PayoutStatus,
    target: PayoutStatus,
    payoutId: string,
  ): void {
    if (current !== 'REQUESTED') {
      // Bu mesajı ADMİN görür: "bekleyen talebiniz var" satıcıya yazılmış bir
      // cümledir ve burada yanlış kitleye hitap ederdi.
      throw appError('PAYOUT_INVALID_STATE', {
        params: { status: current },
        internalMessage: `Payout ${payoutId} ${current} durumunda, ${target} yapılamaz`,
      });
    }
  }
}
