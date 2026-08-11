import { Inject, Injectable } from '@nestjs/common';
import { appError } from '@vt/contracts';
import type { ProductStatus, SellerStatus } from '@vt/db';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import type { Logger } from '../../common/logger.js';
import { AUDIT_ACTION, emitOutbox, writeAuditLog, type AdminActor } from './audit.js';
import {
  ADMIN_MODERATION_PORT,
  ADMIN_SELLER_PORT,
  type AdminModerationPort,
  type AdminSellerPort,
} from './admin.ports.js';
import type { ModerationQuery, SellerApproveInput, SellerListQuery } from './admin.schema.js';

/**
 * İZİN VERİLEN SATICI DURUM GEÇİŞLERİ.
 *
 * Serbest bırakılsaydı bir satıcı REJECTED'dan doğrudan SUSPENDED'a
 * geçirilebilir ve "hiç onaylanmamış ama askıya alınmış" gibi anlamsız bir
 * duruma düşerdi; raporlar ve satıcı bildirimleri bunu açıklayamaz.
 */
const SELLER_TRANSITIONS: Readonly<Record<SellerStatus, readonly SellerStatus[]>> = {
  PENDING: ['APPROVED', 'REJECTED'],
  APPROVED: ['SUSPENDED'],
  // Askı kalkabilir ya da kalıcı redde dönüşebilir.
  SUSPENDED: ['APPROVED', 'REJECTED'],
  // Eksiklerini gideren başvuru yeniden onaylanabilir.
  REJECTED: ['APPROVED'],
};

const PRODUCT_TRANSITIONS: Readonly<Record<ProductStatus, readonly ProductStatus[]>> = {
  DRAFT: [],
  PENDING_REVIEW: ['PUBLISHED', 'REJECTED'],
  // Yayındaki ürün de moderasyondan geçebilir (şikâyet üzerine).
  PUBLISHED: ['REJECTED'],
  REJECTED: ['PUBLISHED'],
  ARCHIVED: [],
};

/**
 * SATICI BAŞVURULARI VE ÜRÜN MODERASYONU.
 *
 * ⚠️ Bu servis Seller ve Product tablolarına DOĞRUDAN dokunmaz; satıcı ve
 *    katalog modüllerinin portları üzerinden geçer (bkz. admin.ports.ts).
 *
 * ⚠️ Her karar AuditLog yazar. Askıya alma ve red ayrıca OutboxEvent üretir —
 *    satıcıya bildirim gitmesi gerekir ve bildirim, kararla aynı transaction'da
 *    kuyruğa DEĞİL outbox'a yazılır (kural 4).
 */
@Injectable()
export class AdminSellerService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ADMIN_SELLER_PORT) private readonly sellers: AdminSellerPort,
    @Inject(ADMIN_MODERATION_PORT) private readonly moderation: AdminModerationPort,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  // ── Başvuru / satıcı okuma ───────────────────────────────────────────────

  async list(query: SellerListQuery): Promise<unknown> {
    return this.sellers.list({
      status: query.status,
      q: query.q,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  async detail(sellerId: string): Promise<unknown> {
    const seller = await this.sellers.findById(sellerId);
    if (!seller) throw appError('SELLER_NOT_FOUND');
    return seller;
  }

  // ── Başvuru kararı ───────────────────────────────────────────────────────

  /**
   * Başvuru onayı. Satıcı bu andan itibaren ürün yayınlayabilir ve sipariş alır.
   *
   * ⚠️ `submerchantKey` (ödeme sağlayıcısındaki alt üye işyeri) bu akışta
   *    OLUŞTURULMAZ: dış servis çağrısı transaction içinde yapılamaz. Onay
   *    olayını dinleyen finans işçisi alt üye işyerini açar. Anahtar
   *    oluşmadan satıcıya hakediş aktarılamaz — checkout bunu ayrıca kontrol
   *    eder (bkz. CheckoutVariant.sellerSubmerchantKey).
   */
  async approve(
    actor: AdminActor,
    sellerId: string,
    input: SellerApproveInput,
  ): Promise<{ sellerId: string; status: SellerStatus }> {
    return this.changeSellerStatus(actor, sellerId, {
      target: 'APPROVED',
      reason: input.note ?? null,
      action: AUDIT_ACTION.sellerApproved,
      eventType: 'seller.approved',
      setApprovedAt: true,
    });
  }

  async reject(
    actor: AdminActor,
    sellerId: string,
    reason: string,
  ): Promise<{ sellerId: string; status: SellerStatus }> {
    return this.changeSellerStatus(actor, sellerId, {
      target: 'REJECTED',
      reason,
      action: AUDIT_ACTION.sellerRejected,
      eventType: 'seller.rejected',
    });
  }

  /**
   * ⚠️ ASKIYA ALMA — hassas işlem, denetlenir.
   *
   * Ürünler AYRICA arşivlenmez: katalog sorguları zaten yalnızca
   * `seller.status = APPROVED` mağazaları listeler, dolayısıyla askı anında
   * vitrinden düşerler. Ürün durumlarını toplu değiştirmek, askı kalktığında
   * hangi ürünün neden yayında olmadığını geri getirilemez hâle sokardı.
   *
   * Açık siparişler devam eder: satıcı askıya alındı diye müşterinin ödediği
   * paket teslim edilmeden bırakılamaz.
   */
  async suspend(
    actor: AdminActor,
    sellerId: string,
    reason: string,
  ): Promise<{ sellerId: string; status: SellerStatus }> {
    return this.changeSellerStatus(actor, sellerId, {
      target: 'SUSPENDED',
      reason,
      action: AUDIT_ACTION.sellerSuspended,
      eventType: 'seller.suspended',
    });
  }

  async reinstate(
    actor: AdminActor,
    sellerId: string,
    reason: string,
  ): Promise<{ sellerId: string; status: SellerStatus }> {
    return this.changeSellerStatus(actor, sellerId, {
      target: 'APPROVED',
      reason,
      action: AUDIT_ACTION.sellerReinstated,
      eventType: 'seller.reinstated',
      setApprovedAt: true,
    });
  }

  private async changeSellerStatus(
    actor: AdminActor,
    sellerId: string,
    options: {
      target: SellerStatus;
      reason: string | null;
      action: (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];
      eventType: string;
      setApprovedAt?: boolean;
    },
  ): Promise<{ sellerId: string; status: SellerStatus }> {
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      // Kilitli okuma: iki admin aynı anda "onayla"ya basarsa ikinci istek
      // güncel durumu görür ve geçersiz geçişte durur.
      const current = await this.sellers.lockAndRead(tx, sellerId);
      if (!current) throw appError('SELLER_NOT_FOUND');

      if (current.status === options.target) {
        throw appError('DUPLICATE_RESOURCE', {
          internalMessage: `Satıcı ${sellerId} zaten ${options.target} durumunda`,
        });
      }
      if (!SELLER_TRANSITIONS[current.status].includes(options.target)) {
        throw appError('VALIDATION_FAILED', {
          internalMessage: `Geçersiz satıcı geçişi: ${current.status} → ${options.target}`,
          details: {
            fields: [
              {
                path: 'status',
                message: `Bu mağaza ${current.status} durumundayken bu işlem yapılamaz.`,
              },
            ],
          },
        });
      }

      await this.sellers.applyStatus(tx, sellerId, {
        status: options.target,
        statusReason: options.reason,
        ...(options.setApprovedAt ? { approvedAt: now } : {}),
      });

      await writeAuditLog(tx, actor, {
        action: options.action,
        entityType: 'Seller',
        entityId: sellerId,
        before: { status: current.status, statusReason: current.statusReason },
        after: { status: options.target, statusReason: options.reason },
        reason: options.reason,
      });

      await emitOutbox(tx, {
        aggregate: 'seller',
        aggregateId: sellerId,
        type: options.eventType,
        payload: {
          sellerId,
          from: current.status,
          to: options.target,
          reason: options.reason,
          actorId: actor.id,
        },
      });

      this.logger.warn(
        { sellerId, from: current.status, to: options.target, actorId: actor.id },
        'Satıcı durumu değişti',
      );

      return { sellerId, status: options.target };
    });
  }

  // ── Ürün moderasyonu ─────────────────────────────────────────────────────

  async moderationQueue(query: ModerationQuery): Promise<unknown> {
    return this.moderation.queue({
      status: query.status,
      sellerId: query.sellerId,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  /**
   * Ürünü yayına alır.
   *
   * ⚠️ İki ön koşul burada da kontrol ediliyor (satıcı arayüzü de kontrol
   *    ediyor olsa bile):
   *      - `aiTagsApproved`: satıcı AI etiketlerini onaylamadan ürün
   *        yayınlanamaz — yanlış etiket, yanlış aramaya ve yanlış beden
   *        önerisine yol açar.
   *      - en az bir görsel: görselsiz ürün vitrine düşerse boş kart görünür.
   */
  async approveProduct(actor: AdminActor, productId: string): Promise<unknown> {
    return this.decideProduct(actor, productId, { target: 'PUBLISHED', reason: null });
  }

  async rejectProduct(actor: AdminActor, productId: string, reason: string): Promise<unknown> {
    return this.decideProduct(actor, productId, { target: 'REJECTED', reason });
  }

  private async decideProduct(
    actor: AdminActor,
    productId: string,
    options: { target: ProductStatus; reason: string | null },
  ): Promise<unknown> {
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const product = await this.moderation.lockAndRead(tx, productId);
      if (!product) throw appError('PRODUCT_NOT_FOUND');

      if (product.status === options.target) {
        throw appError('DUPLICATE_RESOURCE', {
          internalMessage: `Ürün ${productId} zaten ${options.target} durumunda`,
        });
      }
      if (!PRODUCT_TRANSITIONS[product.status].includes(options.target)) {
        throw appError('VALIDATION_FAILED', {
          internalMessage: `Geçersiz ürün geçişi: ${product.status} → ${options.target}`,
          details: {
            fields: [
              {
                path: 'status',
                message: `Bu ürün ${product.status} durumundayken bu işlem yapılamaz.`,
              },
            ],
          },
        });
      }

      if (options.target === 'PUBLISHED') {
        if (product.sellerStatus !== 'APPROVED') {
          throw appError('SELLER_NOT_APPROVED', {
            internalMessage: `Ürün ${productId} sahibi satıcı ${product.sellerId} ${product.sellerStatus} durumunda`,
          });
        }
        if (!product.aiTagsApproved) {
          throw appError('VALIDATION_FAILED', {
            internalMessage: `Ürün ${productId} AI etiketleri satıcı tarafından onaylanmamış`,
            details: {
              fields: [
                {
                  path: 'aiTagsApproved',
                  message: 'Satıcı yapay zekâ etiketlerini onaylamadan ürün yayınlanamaz.',
                },
              ],
            },
          });
        }
        if (product.imageCount === 0) {
          throw appError('VALIDATION_FAILED', {
            internalMessage: `Ürün ${productId} görselsiz`,
            details: {
              fields: [{ path: 'images', message: 'Yayınlanacak üründe en az bir görsel olmalı.' }],
            },
          });
        }
      }

      await this.moderation.applyStatus(tx, productId, {
        status: options.target,
        statusReason: options.reason,
        // İlk yayına alma tarihi bir daha ezilmez: "yeni ürün" sıralaması
        // yeniden yayınlanan eski ürünlerle bozulmamalı.
        ...(options.target === 'PUBLISHED' && product.publishedAt === null
          ? { publishedAt: now }
          : {}),
      });

      await writeAuditLog(tx, actor, {
        action:
          options.target === 'PUBLISHED'
            ? AUDIT_ACTION.productApproved
            : AUDIT_ACTION.productRejected,
        entityType: 'Product',
        entityId: productId,
        before: { status: product.status, statusReason: product.statusReason },
        after: { status: options.target, statusReason: options.reason },
        reason: options.reason,
      });

      await emitOutbox(tx, {
        aggregate: 'product',
        aggregateId: productId,
        type: options.target === 'PUBLISHED' ? 'product.published' : 'product.rejected',
        payload: {
          productId,
          sellerId: product.sellerId,
          from: product.status,
          to: options.target,
          reason: options.reason,
          actorId: actor.id,
        },
      });

      return { productId, status: options.target, reason: options.reason };
    });
  }
}
