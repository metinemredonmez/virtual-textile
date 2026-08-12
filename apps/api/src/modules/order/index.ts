import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import { OrderController } from './order.controller.js';
import { OrderLogisticsController } from './order-logistics.controller.js';
import { OrderService } from './order.service.js';
import { PrismaSellerLedger, SELLER_LEDGER } from './ledger.port.js';

/**
 * SİPARİŞ MODÜLÜ — sipariş, paket, iade.
 *
 * Sahip olduğu tablolar: Order, OrderPackage, OrderItem, OrderEvent,
 * ReturnRequest, ReturnItem. Başka modül bu tablolara doğrudan yazmaz;
 * OrderService üzerinden geçer.
 *
 * SELLER_LEDGER token'ı geçici bir Prisma adaptörüne bağlı; finans modülü
 * geldiğinde yalnızca bu satır değişir (bkz. ledger.port.ts).
 *
 * ⚠️ `OrderLogisticsController` BU LİSTEDE OLMAK ZORUNDA. Bir controller
 *    yazılmış, derlenmiş ve test edilmiş olabilir; onu YAYINA çıkaran tek şey
 *    bu dizidir. Düşerse `POST /v1/logistics/packages/:id/delivered` sessizce
 *    404'e döner ve `package.delivered` olayını üreten kod yolu yeniden
 *    KALMAZ — gardırop, iade penceresi, satıcı hakedişi ve beden öğrenme aynı
 *    anda ölür (bkz. order-logistics.controller.ts başlığı; ölçüm:
 *    order-logistics.controller.test.ts).
 */
@Module({
  controllers: [OrderController, OrderLogisticsController],
  providers: [
    { provide: SELLER_LEDGER, useClass: PrismaSellerLedger },
    {
      provide: OrderService,
      inject: [PrismaService, SELLER_LEDGER, APP_LOGGER],
      useFactory: (...args: ConstructorParameters<typeof OrderService>) =>
        new OrderService(...args),
    },
  ],
  exports: [OrderService, SELLER_LEDGER],
})
export class OrderModule {}

export { OrderService, type OrderActor } from './order.service.js';
export { OrderController } from './order.controller.js';
export { OrderLogisticsController } from './order-logistics.controller.js';
export { SELLER_LEDGER, PrismaSellerLedger, type SellerLedgerPort } from './ledger.port.js';

// Saf çekirdek — checkout, satıcı ve finans modülleri bunları yeniden yazmasın.
export {
  assertOrderCancellable,
  assertPackageCancellable,
  assertPackageTransition,
  canTransitionPackage,
  deriveOrderStatus,
  derivePaymentPhase,
  isPackageCancellable,
  isTerminalOrderStatus,
  TERMINAL_ORDER_STATUSES,
  type OrderDerivationContext,
  type PackageSnapshot,
  type PaymentPhase,
} from './order-status.js';

export {
  buildSaleLedgerEntries,
  computeReturnReversal,
  ledgerBalanceMinor,
  type LedgerEntryDraft,
  type OrderItemMoneySnapshot,
  type ReturnLine,
  type ReturnReversalDraft,
} from './return-ledger.js';

export {
  formatDayKey,
  formatDocumentNumber,
  lockOrder,
  nextOrderNumber,
  nextReturnNumber,
  parseSequence,
  ORDER_NUMBER_PREFIX,
  RETURN_NUMBER_PREFIX,
} from './order-number.js';

export * from './order.schema.js';
