import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import { AdminController } from './admin.controller.js';
import { AdminFinanceController } from './admin-finance.controller.js';
import { AdminReportController } from './admin-report.controller.js';
import { AdminSiteImageController, SiteImageController } from './admin-site-image.controller.js';
import { AdminSiteImageService } from './admin-site-image.service.js';
import { MediaModule } from '../media/index.js';
import { MEDIA_IMAGE_PROCESSOR } from '../media/image-processor.js';
import { MEDIA_STORAGE } from '../media/media.ports.js';
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
export * from './admin-site-image.schema.js';
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
export {
  AdminSiteImageService,
  type AdminSiteImageView,
  type SiteImageCardView,
  type SiteImageUploadTicket,
  type SiteImageView,
} from './admin-site-image.service.js';
export { AdminSiteImageController, SiteImageController } from './admin-site-image.controller.js';

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
 *   Site görselleri           POST   /admin/site-images                (ADMIN) bilet
 *                             POST   /admin/site-images/:id/confirm    (ADMIN) @Idempotent
 *                             GET    /admin/site-images                (ADMIN)
 *                             PATCH  /admin/site-images/:id            (ADMIN)
 *                             DELETE /admin/site-images/:id            (ADMIN)
 *                             POST   /admin/site-images/:id/cards      (ADMIN)
 *                             DELETE /admin/site-images/:id/cards/:productId (ADMIN)
 *
 *   ⚠️ BU MODÜLDEKİ TEK GENEL (kimliksiz) YÜZEY — ve tek olduğu için burada
 *      açıkça yazılıyor ki bir dahaki okuyucu "admin modülünde @Public ne
 *      arıyor" diye sormasın:
 *                             GET    /site-images/hero                 (@Public)
 *                             GET    /site-images?slot=…               (@Public)
 *      Sebep: `SiteImage` tablosunun sahibi bu modül ve vitrinin o satırları
 *      okuması gerekiyor. Ayrı bir modül açmak `app.module.ts`e dokunmak
 *      demekti; AdminModule zaten kayıtlı olduğu için bu uçlar yazıldıkları
 *      anda canlı. Uçlar AYRI bir sınıfta (`SiteImageController`) duruyor —
 *      yetki kuralı sınıfın kendisi olsun diye.
 *
 * SAHİP OLDUĞU TABLOLAR: CommissionRule, CommissionRuleVersion, AuditLog,
 * SiteImage, SiteImageCard.
 * Diğer her şey `admin.ports.ts` içindeki portlar üzerinden okunur/yazılır.
 *
 * ⚠️ `MediaModule` İMPORT EDİLİYOR ve bu bilinçli bir YENİDEN KULLANIMdır:
 *    site görseli için ikinci bir yükleme akışı yazılmadı. `MEDIA_STORAGE` ve
 *    `MEDIA_IMAGE_PROCESSOR` oradan geliyor, yani EXIF temizliği, biçim
 *    doğrulaması ve kova seçimi tek yerde kalıyor. Kendi sağlayıcımızı
 *    bağlasaydık iki depolama yapılandırması doğar ve biri bir gün fail-closed
 *    yer tutucuya düşerken diğeri düşmezdi.
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
  imports: [MediaModule],
  controllers: [
    AdminController,
    AdminFinanceController,
    AdminReportController,
    AdminSiteImageController,
    // ⚠️ Genel okuma yüzeyi. Bu dizide OLMAZSA uçlar 404 döner ve derleme
    //    bunu göremez — `controllers` bir dizidir, eksik eleman tip hatası
    //    değildir. `admin-site-image.controller.test.ts` ikisinin de burada
    //    olduğunu ölçüyor.
    SiteImageController,
  ],
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
    {
      provide: AdminSiteImageService,
      // ⚠️ Depolama ve görsel işleyici MediaModule'den geliyor, burada YENİDEN
      //    KURULMUYOR. Kurulsaydı iki ayrı yapılandırma doğar ve biri
      //    fail-closed yer tutucuya düşerken diğeri düşmezdi — "afiş yükleniyor
      //    ama ürün görseli yüklenmiyor" gibi açıklaması olmayan bir durum.
      inject: [PrismaService, MEDIA_STORAGE, MEDIA_IMAGE_PROCESSOR, APP_LOGGER],
      useFactory: (...args: ConstructorParameters<typeof AdminSiteImageService>) =>
        new AdminSiteImageService(...args),
    },
  ],
  exports: [
    AdminCommissionService,
    AdminSellerService,
    AdminCatalogService,
    AdminFinanceService,
    AdminReportService,
    AdminSiteImageService,
  ],
})
export class AdminModule {}
