import { Inject, Injectable } from '@nestjs/common';
import { appError } from '@vt/contracts';
import { PrismaService } from '../../infra/prisma.service.js';
import { AUDIT_ACTION, emitOutbox, writeAuditLog, type AdminActor } from './audit.js';
import {
  ADMIN_CATEGORY_PORT,
  ADMIN_PROMO_PORT,
  type AdminCategoryPort,
  type AdminCategoryRecord,
  type AdminPromoPort,
} from './admin.ports.js';
import type {
  CategoryCreateInput,
  CategoryUpdateInput,
  CouponCreateInput,
  CouponListQuery,
} from './admin.schema.js';

/**
 * KATEGORİ VE KUPON/KAMPANYA YÖNETİMİ.
 *
 * Kategori ağacı ve kuponlar katalog/promosyon modüllerinin verisidir; admin
 * bunlara portlar üzerinden erişir. Her değişiklik denetim kaydı yazar:
 * kategori ağacı komisyon kuralının kapsamını belirler (kural kategoriye
 * bağlanabilir), kupon ise doğrudan ciroyu etkiler.
 */
@Injectable()
export class AdminCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ADMIN_CATEGORY_PORT) private readonly categories: AdminCategoryPort,
    @Inject(ADMIN_PROMO_PORT) private readonly promos: AdminPromoPort,
  ) {}

  // ── Kategori ─────────────────────────────────────────────────────────────

  async listCategories(): Promise<AdminCategoryRecord[]> {
    return this.categories.list();
  }

  async createCategory(actor: AdminActor, input: CategoryCreateInput): Promise<unknown> {
    const parentId = input.parentId ?? null;

    return this.prisma.$transaction(async (tx) => {
      if (parentId !== null) {
        const parent = await this.categories.findById(parentId);
        if (!parent) {
          throw appError('CATEGORY_NOT_FOUND', {
            internalMessage: `Üst kategori ${parentId} yok`,
          });
        }
      }

      const created = await this.categories.create(tx, {
        parentId,
        slug: input.slug,
        name: input.name,
        tryOnCategory: input.tryOnCategory ?? null,
        sortOrder: input.sortOrder,
        isActive: input.isActive,
      });

      await writeAuditLog(tx, actor, {
        action: AUDIT_ACTION.categoryCreated,
        entityType: 'Category',
        entityId: created.id,
        before: null,
        after: {
          slug: created.slug,
          name: created.name,
          parentId: created.parentId,
          tryOnCategory: created.tryOnCategory,
          isActive: created.isActive,
        },
      });

      return created;
    });
  }

  /**
   * ⚠️ `slug` GÜNCELLENMEZ (şemada da güncelleme alanları arasında yok):
   *    slug kalıcı bağlantıdır; değişirse dış bağlantılar ve arama motoru
   *    indeksleri kırılır. Yeni bir adres gerekiyorsa yeni kategori açılır.
   *
   * ⚠️ Kategoriyi kendi alt ağacına taşımak döngü yaratır ve kategori ağacını
   *    dolaşan özyinelemeli sorguyu (bkz. CatalogService.listProducts)
   *    sonsuza sokar. Bu yüzden ata zinciri kontrol ediliyor.
   */
  async updateCategory(
    actor: AdminActor,
    categoryId: string,
    input: CategoryUpdateInput,
  ): Promise<unknown> {
    const before = await this.categories.findById(categoryId);
    if (!before) throw appError('CATEGORY_NOT_FOUND');

    if (input.parentId !== undefined && input.parentId !== null) {
      if (input.parentId === categoryId) {
        throw appError('VALIDATION_FAILED', {
          internalMessage: `Kategori ${categoryId} kendi üstü yapılamaz`,
          details: { fields: [{ path: 'parentId', message: 'Kategori kendi üstü olamaz.' }] },
        });
      }
      await this.assertNotDescendant(categoryId, input.parentId);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await this.categories.update(tx, categoryId, {
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.tryOnCategory !== undefined ? { tryOnCategory: input.tryOnCategory } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      });

      await writeAuditLog(tx, actor, {
        action: AUDIT_ACTION.categoryUpdated,
        entityType: 'Category',
        entityId: categoryId,
        before: {
          parentId: before.parentId,
          name: before.name,
          tryOnCategory: before.tryOnCategory,
          sortOrder: before.sortOrder,
          isActive: before.isActive,
        },
        after: {
          parentId: updated.parentId,
          name: updated.name,
          tryOnCategory: updated.tryOnCategory,
          sortOrder: updated.sortOrder,
          isActive: updated.isActive,
        },
      });

      return updated;
    });
  }

  /** Hedef üst kategori, taşınan kategorinin altında mı? */
  private async assertNotDescendant(categoryId: string, newParentId: string): Promise<void> {
    const all = await this.categories.list();
    const parentById = new Map(all.map((category) => [category.id, category.parentId]));

    let cursor: string | null = newParentId;
    // Ağaç derinliği küçük; yine de bozuk veride sonsuz döngüye girmemek için
    // adım sayısı düğüm sayısıyla sınırlanıyor.
    for (let step = 0; step <= all.length && cursor !== null; step += 1) {
      if (cursor === categoryId) {
        throw appError('VALIDATION_FAILED', {
          internalMessage: `Kategori ${categoryId} kendi alt ağacına (${newParentId}) taşınamaz`,
          details: {
            fields: [{ path: 'parentId', message: 'Kategori kendi alt kategorisine taşınamaz.' }],
          },
        });
      }
      cursor = parentById.get(cursor) ?? null;
    }
  }

  // ── Kupon & kampanya ─────────────────────────────────────────────────────

  async listCoupons(query: CouponListQuery): Promise<unknown> {
    return this.promos.list({
      scope: query.scope,
      isActive: query.isActive,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  /**
   * Kupon/kampanya oluşturur.
   *
   * `sellerId` boşsa PLATFORM kampanyasıdır (maliyeti platform üstlenir),
   * doluysa mağaza kuponudur. Bu ayrım hakediş hesabını değiştirdiği için
   * denetim kaydına da yazılıyor.
   *
   * ⚠️ Kod benzersizliği veritabanı kısıtıyla garanti altında; yarışta
   *    P2002 döner ve global filter bunu DUPLICATE_RESOURCE'a çevirir.
   */
  async createCoupon(actor: AdminActor, input: CouponCreateInput): Promise<unknown> {
    const sellerId = input.sellerId ?? null;

    return this.prisma.$transaction(async (tx) => {
      const created = await this.promos.create(tx, {
        code: input.code,
        sellerId,
        discountType: input.discountType,
        discountValue: input.discountValue,
        maxDiscountMinor: input.maxDiscountMinor ?? null,
        minCartMinor: input.minCartMinor,
        usageLimit: input.usageLimit ?? null,
        usageLimitPerUser: input.usageLimitPerUser,
        validFrom: input.validFrom,
        validTo: input.validTo,
        isActive: input.isActive,
      });

      await writeAuditLog(tx, actor, {
        action: AUDIT_ACTION.couponCreated,
        entityType: 'Coupon',
        entityId: created.id,
        before: null,
        after: {
          code: created.code,
          scope: created.scope,
          sellerId,
          discountType: created.discountType,
          discountValue: created.discountValue,
          maxDiscountMinor: created.maxDiscountMinor,
          minCartMinor: created.minCartMinor,
          usageLimit: created.usageLimit,
          validFrom: created.validFrom,
          validTo: created.validTo,
        },
      });

      return created;
    });
  }

  /**
   * ⚠️ KUPON SİLİNMEZ, PASİFLEŞTİRİLİR.
   *
   * Silinseydi CouponRedemption kayıtları sahipsiz kalır ve geçmiş
   * siparişlerdeki indirimin dayanağı kaybolurdu.
   */
  async deactivateCoupon(actor: AdminActor, couponId: string): Promise<unknown> {
    const before = await this.promos.findById(couponId);
    if (!before) {
      throw appError('NOT_FOUND', { internalMessage: `Kupon ${couponId} yok` });
    }
    if (!before.isActive) {
      throw appError('DUPLICATE_RESOURCE', {
        internalMessage: `Kupon ${couponId} zaten pasif`,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      await this.promos.deactivate(tx, couponId);

      await writeAuditLog(tx, actor, {
        action: AUDIT_ACTION.couponDeactivated,
        entityType: 'Coupon',
        entityId: couponId,
        before: { code: before.code, isActive: true, usedCount: before.usedCount },
        after: { code: before.code, isActive: false },
      });

      // Sepetinde bu kupon duran kullanıcıların yeniden hesaplanması gerekir.
      await emitOutbox(tx, {
        aggregate: 'coupon',
        aggregateId: couponId,
        type: 'coupon.deactivated',
        payload: { couponId, code: before.code, actorId: actor.id },
      });

      return { couponId, code: before.code, isActive: false };
    });
  }
}
