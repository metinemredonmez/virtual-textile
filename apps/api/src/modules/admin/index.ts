import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import { AdminController } from './admin.controller.js';
import { AdminFinanceController } from './admin-finance.controller.js';
import { AdminReportController } from './admin-report.controller.js';
import { AdminCommissionService } from './admin-commission.service.js';
import { AdminSellerService } from './admin-seller.service.js';
import { AdminCatalogService } from './admin-catalog.service.js';
import { AdminFinanceService } from './admin-finance.service.js';
import { AdminReportService } from './admin-report.service.js';
import {
  ADMIN_AI_USAGE_READER,
  ADMIN_CATEGORY_PORT,
  ADMIN_FRAUD_PORT,
  ADMIN_MODERATION_PORT,
  ADMIN_ORDER_READER,
  ADMIN_PAYOUT_PORT,
  ADMIN_PHOTO_ACCESS,
  ADMIN_PROMO_PORT,
  ADMIN_SELLER_PORT,
} from './admin.ports.js';
import {
  PrismaAdminOrderReaderBridge,
  PrismaAiUsageReaderBridge,
  PrismaCategoryAdminBridge,
  PrismaFraudSignalBridge,
  PrismaModerationBridge,
  PrismaPayoutAdminBridge,
  PrismaPhotoAccessBridge,
  PrismaPromoAdminBridge,
  PrismaSellerAdminBridge,
} from './admin.bridges.js';

export * from './admin.ports.js';
export * from './admin.schema.js';
export * from './commission-version.js';
export * from './audit.js';
export * from './admin.bridges.js';
export { AdminCommissionService } from './admin-commission.service.js';
export { AdminSellerService } from './admin-seller.service.js';
export { AdminCatalogService } from './admin-catalog.service.js';
export { AdminFinanceService } from './admin-finance.service.js';
export { AdminReportService } from './admin-report.service.js';
export { AdminController } from './admin.controller.js';
export { AdminFinanceController } from './admin-finance.controller.js';
export { AdminReportController } from './admin-report.controller.js';

/**
 * ═══════════════════════════ YÖNETİM MODÜLÜ ═════════════════════════════════
 *
 * Uçlar (hepsi @Roles ile korunur; hiçbiri @Public değildir):
 *
 *   Satıcı başvuruları        GET    /admin/sellers                   (ADMIN, SUPPORT)
 *                             GET    /admin/sellers/:id               (ADMIN, SUPPORT)
 *                             POST   /admin/sellers/:id/approve       (ADMIN)
 *                             POST   /admin/sellers/:id/reject        (ADMIN)
 *                             POST   /admin/sellers/:id/suspend       (ADMIN)
 *                             POST   /admin/sellers/:id/reinstate     (ADMIN)
 *   Ürün moderasyonu          GET    /admin/products/moderation       (ADMIN, SUPPORT)
 *                             POST   /admin/products/:id/approve      (ADMIN)
 *                             POST   /admin/products/:id/reject       (ADMIN)
 *   Kategori                  GET    /admin/categories                (ADMIN, SUPPORT)
 *                             POST   /admin/categories                (ADMIN)
 *                             PATCH  /admin/categories/:id            (ADMIN)
 *   Kupon & kampanya          GET    /admin/coupons                   (ADMIN, SUPPORT)
 *                             POST   /admin/coupons                   (ADMIN)
 *                             POST   /admin/coupons/:id/deactivate    (ADMIN)
 *   Komisyon                  GET    /admin/commission-rules          (ADMIN)
 *                             GET    /admin/commission-rules/:id/versions (ADMIN)
 *                             POST   /admin/commission-rules          (ADMIN)
 *                             POST   /admin/commission-rules/:id/versions (ADMIN)  ⚠️ versiyon
 *   Sipariş                   GET    /admin/orders                    (ADMIN, SUPPORT)
 *                             GET    /admin/orders/:orderNumber       (ADMIN, SUPPORT)
 *                             POST   /admin/orders/:id/refund         (ADMIN) @Idempotent
 *   Payout                    GET    /admin/payouts                   (ADMIN, SUPPORT)
 *                             POST   /admin/payouts/:id/approve       (ADMIN) @Idempotent
 *                             POST   /admin/payouts/:id/reject        (ADMIN)
 *   Raporlar                  GET    /admin/ai/usage                  (ADMIN)
 *                             GET    /admin/reports/gmv               (ADMIN)
 *                             GET    /admin/fraud/alerts              (ADMIN, SUPPORT)
 *                             GET    /admin/audit-log                 (ADMIN)
 *   KVKK break-glass          POST   /admin/users/:userId/photos/break-glass (ADMIN)
 *
 * SAHİP OLDUĞU TABLOLAR: CommissionRule, CommissionRuleVersion, AuditLog.
 * Diğer her şey `admin.ports.ts` içindeki portlar üzerinden okunur/yazılır.
 *
 * ⚠️ ENTEGRASYON AJANI İÇİN İKİ ADIM:
 *
 *  1. `apps/api/src/app.module.ts` → imports listesine `AdminModule`.
 *
 *  2. Satıcı / katalog / promosyon / finans / AI modülleri yayımlandığında
 *     aşağıdaki token bağlamalarını onların servislerine çevirin ve
 *     `admin.bridges.ts` dosyasını SİLİN:
 *
 *       ADMIN_SELLER_PORT     → SellerService
 *       ADMIN_MODERATION_PORT → CatalogService (moderasyon yüzeyi)
 *       ADMIN_CATEGORY_PORT   → CatalogService (kategori yüzeyi)
 *       ADMIN_PROMO_PORT      → PromoService
 *       ADMIN_ORDER_READER    → OrderService (yönetim okuma yüzeyi)
 *       ADMIN_PAYOUT_PORT     → FinanceService
 *       ADMIN_AI_USAGE_READER → AiService
 *       ADMIN_FRAUD_PORT      → FraudService (kalıcı uyarı tablosu geldiğinde)
 *       ADMIN_PHOTO_ACCESS    → MediaService (imzalı URL için)
 *
 *     Yönetim servislerinde tek satır değişmesi gerekmez.
 *
 * ⚠️ `PrismaPhotoAccessBridge` şu an imzalı URL üretemiyor: `signedUrl` null
 *    döner. Bu bir bağımlılık engeli DEĞİLDİR (@vt/adapters artık apps/api
 *    bağımlılığıdır) — iş yalnızca yapılmamıştır; bkz. admin.bridges.ts
 *    içindeki TODO(kod-gerekli).
 *
 *    Eksiklik break-glass denetimini ATLATMAZ — denetim kaydı ve kullanıcı
 *    bildirimi erişim TALEBİ anında yazılır.
 */
@Module({
  controllers: [AdminController, AdminFinanceController, AdminReportController],
  providers: [
    // ── Geçici Prisma köprüleri (bkz. admin.bridges.ts) ──
    { provide: ADMIN_SELLER_PORT, useClass: PrismaSellerAdminBridge },
    { provide: ADMIN_MODERATION_PORT, useClass: PrismaModerationBridge },
    { provide: ADMIN_CATEGORY_PORT, useClass: PrismaCategoryAdminBridge },
    { provide: ADMIN_PROMO_PORT, useClass: PrismaPromoAdminBridge },
    { provide: ADMIN_ORDER_READER, useClass: PrismaAdminOrderReaderBridge },
    { provide: ADMIN_PAYOUT_PORT, useClass: PrismaPayoutAdminBridge },
    { provide: ADMIN_AI_USAGE_READER, useClass: PrismaAiUsageReaderBridge },
    { provide: ADMIN_FRAUD_PORT, useClass: PrismaFraudSignalBridge },
    { provide: ADMIN_PHOTO_ACCESS, useClass: PrismaPhotoAccessBridge },

    // ── Servisler ──
    {
      provide: AdminCommissionService,
      inject: [PrismaService, APP_LOGGER],
      useFactory: (...args: ConstructorParameters<typeof AdminCommissionService>) =>
        new AdminCommissionService(...args),
    },
    {
      provide: AdminSellerService,
      inject: [PrismaService, ADMIN_SELLER_PORT, ADMIN_MODERATION_PORT, APP_LOGGER],
      useFactory: (...args: ConstructorParameters<typeof AdminSellerService>) =>
        new AdminSellerService(...args),
    },
    {
      provide: AdminCatalogService,
      inject: [PrismaService, ADMIN_CATEGORY_PORT, ADMIN_PROMO_PORT],
      useFactory: (...args: ConstructorParameters<typeof AdminCatalogService>) =>
        new AdminCatalogService(...args),
    },
    {
      provide: AdminFinanceService,
      inject: [PrismaService, ADMIN_ORDER_READER, ADMIN_PAYOUT_PORT, APP_LOGGER],
      useFactory: (...args: ConstructorParameters<typeof AdminFinanceService>) =>
        new AdminFinanceService(...args),
    },
    {
      provide: AdminReportService,
      inject: [
        PrismaService,
        ADMIN_AI_USAGE_READER,
        ADMIN_ORDER_READER,
        ADMIN_FRAUD_PORT,
        ADMIN_PHOTO_ACCESS,
        APP_LOGGER,
      ],
      useFactory: (...args: ConstructorParameters<typeof AdminReportService>) =>
        new AdminReportService(...args),
    },
  ],
  exports: [
    AdminCommissionService,
    AdminSellerService,
    AdminCatalogService,
    AdminFinanceService,
    AdminReportService,
  ],
})
export class AdminModule {}
