import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import { OrderModule, OrderService } from '../order/index.js';
import { SellerApplicationController, SellerController } from './seller.controller.js';
import { SellerService } from './seller.service.js';
import { SellerProductService } from './seller-product.service.js';
import { SellerFulfillmentService } from './seller-fulfillment.service.js';
import { SellerFinanceService } from './seller-finance.service.js';
import { SellerAnalyticsService } from './seller-analytics.service.js';
import { SellerCouponService } from './seller-coupon.service.js';
import {
  SELLER_ANALYTICS_READER,
  SELLER_CATALOG,
  SELLER_COUPON,
  SELLER_FULFILLMENT_READER,
} from './seller.ports.js';
import {
  PrismaSellerAnalyticsReaderBridge,
  PrismaSellerCatalogBridge,
  PrismaSellerCouponBridge,
  PrismaSellerFulfillmentReaderBridge,
} from './seller.bridges.js';

/**
 * SATICI MODÜLÜ — satıcı paneli API'si.
 *
 * Sahip olduğu tablolar: Seller, SellerUser, SellerDocument, Store,
 * LedgerEntry, PayoutRequest.
 *
 * Başka modülün verisine erişim:
 *   • Sipariş YAZMA (paket geçişi, iade kararı) → `OrderService` doğrudan
 *     enjekte edilir; `OrderModule` import ediliyor.
 *   • Katalog yazma, sipariş okuma, analitik okuma, kupon yazma → aşağıdaki
 *     dört token, `seller.bridges.ts` içindeki GEÇİCİ Prisma köprülerine
 *     bağlı.
 *
 * ⚠️ ENTEGRASYON AJANI İÇİN — iki iş:
 *
 *   1. Bu modülü `app.module.ts`'e ekleyin (bu ajan o dosyaya dokunmuyor).
 *
 *   2. Defter sahipliği artık bu modülde. `OrderModule` içindeki
 *        { provide: SELLER_LEDGER, useClass: PrismaSellerLedger }
 *      satırı
 *        { provide: SELLER_LEDGER, useExisting: SellerFinanceService }
 *      ile değiştirilip `order/ledger.port.ts`'deki geçici
 *      `PrismaSellerLedger` silinebilir — `SellerFinanceService.append()`
 *      `SellerLedgerPort` ile imza uyumludur. (Bu değişiklik OrderModule'ü
 *      düzenlemeyi gerektirdiği için burada YAPILMADI; iki modül birbirini
 *      import edeceğinden `forwardRef` gerekebilir.)
 *
 * İlgili modüller kendi yüzeylerini yayımladığında yalnızca aşağıdaki token
 * bağlamaları değişir ve `seller.bridges.ts` silinir; servislerde tek satır
 * değişmez.
 */
@Module({
  imports: [OrderModule],
  controllers: [SellerApplicationController, SellerController],
  providers: [
    // ── Geçici köprüler (bkz. seller.bridges.ts) ──
    {
      provide: SELLER_CATALOG,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PrismaSellerCatalogBridge(prisma),
    },
    {
      provide: SELLER_FULFILLMENT_READER,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PrismaSellerFulfillmentReaderBridge(prisma),
    },
    {
      provide: SELLER_ANALYTICS_READER,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PrismaSellerAnalyticsReaderBridge(prisma),
    },
    {
      provide: SELLER_COUPON,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PrismaSellerCouponBridge(prisma),
    },

    // ── Servisler ──
    {
      provide: SellerService,
      inject: [PrismaService, APP_LOGGER],
      useFactory: (...args: ConstructorParameters<typeof SellerService>) =>
        new SellerService(...args),
    },
    {
      provide: SellerProductService,
      inject: [SellerService, SELLER_CATALOG, APP_LOGGER],
      useFactory: (...args: ConstructorParameters<typeof SellerProductService>) =>
        new SellerProductService(...args),
    },
    {
      provide: SellerFulfillmentService,
      inject: [SellerService, OrderService, SELLER_FULFILLMENT_READER],
      useFactory: (...args: ConstructorParameters<typeof SellerFulfillmentService>) =>
        new SellerFulfillmentService(...args),
    },
    {
      provide: SellerFinanceService,
      inject: [PrismaService, SellerService, APP_LOGGER],
      useFactory: (...args: ConstructorParameters<typeof SellerFinanceService>) =>
        new SellerFinanceService(...args),
    },
    {
      provide: SellerAnalyticsService,
      inject: [SELLER_ANALYTICS_READER],
      useFactory: (...args: ConstructorParameters<typeof SellerAnalyticsService>) =>
        new SellerAnalyticsService(...args),
    },
    {
      provide: SellerCouponService,
      inject: [SellerService, SELLER_COUPON],
      useFactory: (...args: ConstructorParameters<typeof SellerCouponService>) =>
        new SellerCouponService(...args),
    },
  ],
  // Admin modülü satıcı onayı ve payout onayı için bunlara ihtiyaç duyacak;
  // Seller/LedgerEntry/PayoutRequest tablolarına doğrudan gitmesin diye
  // servisler dışa açılıyor.
  exports: [SellerService, SellerFinanceService, SellerProductService],
})
export class SellerModule {}

// ── Genel yüzey ───────────────────────────────────────────────────────────

export { SellerService, type SellerProfile } from './seller.service.js';
export { SellerProductService } from './seller-product.service.js';
export { SellerFulfillmentService } from './seller-fulfillment.service.js';
export { SellerFinanceService, type SellerBalanceView } from './seller-finance.service.js';
export { SellerAnalyticsService, type SellerFunnelReport } from './seller-analytics.service.js';
export { SellerCouponService } from './seller-coupon.service.js';
export { SellerApplicationController, SellerController } from './seller.controller.js';
export { SellerId } from './seller.scope.js';

// Saf çekirdek — admin/finans modülleri bu kuralları yeniden yazmasın.
export {
  assertPayoutEligible,
  balanceFromTotals,
  buildPayoutLedgerRow,
  computeBalance,
  isPayoutEligible,
  isPending,
  nextAvailableAt,
  summarizeByType,
  type LedgerRow,
  type PayoutEligibilityInput,
  type SellerBalance,
} from './seller-balance.js';

export {
  analyzeProductFunnels,
  analyzeSizeReturns,
  buildFunnel,
  ratePct,
  type FunnelCounts,
  type FunnelStage,
  type ProductFunnelInsight,
  type SizeReturnInsight,
} from './seller-analytics.js';

export {
  bulkUploadError,
  parseBulkUpload,
  parseCsv,
  CSV_COLUMNS,
  MAX_CSV_BYTES,
  MAX_CSV_ROWS,
  type BulkProductDraft,
  type BulkRowError,
  type BulkVariantDraft,
} from './seller-csv.js';

export { encryptField, decryptField, maskIban, maskTaxNumber } from './seller-crypto.js';

export * from './seller.ports.js';
export * from './seller.schema.js';
export {
  PrismaSellerAnalyticsReaderBridge,
  PrismaSellerCatalogBridge,
  PrismaSellerCouponBridge,
  PrismaSellerFulfillmentReaderBridge,
} from './seller.bridges.js';
