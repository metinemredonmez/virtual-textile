import { Inject, Injectable } from '@nestjs/common';
import { appError } from '@vt/contracts';
import type { Prisma } from '@vt/db';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import type { Logger } from '../../common/logger.js';
import { AUDIT_ACTION, writeAuditLog, type AdminActor } from './audit.js';
import { planCommissionVersion, type CommissionVersionSnapshot } from './commission-version.js';
import type {
  CommissionRuleCreateInput,
  CommissionRuleListQuery,
  CommissionVersionCreateInput,
} from './admin.schema.js';

type Tx = Prisma.TransactionClient;

/**
 * Advisory lock ad alanı — sipariş modülündeki LOCK_NAMESPACE ile ÇAKIŞMAZ
 * (orada 8801-8803 kullanılıyor).
 */
const LOCK_NAMESPACE = {
  /** Aynı (kategori, satıcı) çifti için kural yaratımını sıralar. */
  commissionRuleKey: 8811,
  /** Aynı kuralın versiyon zincirini sıralar. */
  commissionRuleVersions: 8812,
} as const;

export interface CommissionRuleView {
  id: string;
  label: string;
  categoryId: string | null;
  categoryName: string | null;
  sellerId: string | null;
  sellerName: string | null;
  scope: 'PLATFORM' | 'CATEGORY' | 'SELLER' | 'SELLER_CATEGORY';
  createdAt: Date;
  currentVersion: {
    id: string;
    rateBps: number;
    fixedFeeMinor: bigint;
    validFrom: Date;
  } | null;
  versionCount: number;
}

/**
 * KOMİSYON KURALI YÖNETİMİ.
 *
 * Bu servis CommissionRule ve CommissionRuleVersion tablolarının SAHİBİDİR.
 * Karar mantığı `commission-version.ts` içindeki saf çekirdektedir; burada
 * yalnızca kilitleme, yazma ve denetim kaydı var.
 *
 * ⚠️ Bu modülde `commissionRuleVersion.update` ile oran/ücret DEĞİŞTİREN tek
 *    bir satır yoktur ve olmamalıdır. İzin verilen tek UPDATE, bir versiyonun
 *    `validTo`'sunu kapatmaktır.
 */
@Injectable()
export class AdminCommissionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  // ── Okuma ────────────────────────────────────────────────────────────────

  async listRules(query: CommissionRuleListQuery): Promise<CommissionRuleView[]> {
    const rules = await this.prisma.commissionRule.findMany({
      where: {
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(query.sellerId ? { sellerId: query.sellerId } : {}),
      },
      orderBy: [{ createdAt: 'desc' }],
      select: {
        id: true,
        label: true,
        categoryId: true,
        sellerId: true,
        createdAt: true,
        category: { select: { name: true } },
        seller: { select: { displayName: true } },
        versions: {
          orderBy: { validFrom: 'desc' },
          select: { id: true, rateBps: true, fixedFeeMinor: true, validFrom: true, validTo: true },
        },
      },
    });

    const now = new Date();
    return rules.map((rule) => {
      const current =
        rule.versions.find(
          (version) =>
            version.validFrom.getTime() <= now.getTime() &&
            (version.validTo === null || now.getTime() < version.validTo.getTime()),
        ) ?? null;

      return {
        id: rule.id,
        label: rule.label,
        categoryId: rule.categoryId,
        categoryName: rule.category?.name ?? null,
        sellerId: rule.sellerId,
        sellerName: rule.seller?.displayName ?? null,
        scope: scopeOf(rule.categoryId, rule.sellerId),
        createdAt: rule.createdAt,
        currentVersion:
          current === null
            ? null
            : {
                id: current.id,
                rateBps: current.rateBps,
                fixedFeeMinor: current.fixedFeeMinor,
                validFrom: current.validFrom,
              },
        versionCount: rule.versions.length,
      };
    });
  }

  /** Versiyon geçmişi — append-only olduğu için bu liste de bir denetim izidir. */
  async listVersions(ruleId: string): Promise<unknown> {
    const rule = await this.prisma.commissionRule.findUnique({
      where: { id: ruleId },
      select: {
        id: true,
        label: true,
        categoryId: true,
        sellerId: true,
        versions: {
          orderBy: { validFrom: 'asc' },
          select: {
            id: true,
            rateBps: true,
            fixedFeeMinor: true,
            validFrom: true,
            validTo: true,
            createdBy: true,
            createdAt: true,
            _count: { select: { orderItems: true } },
          },
        },
      },
    });
    if (!rule) throw appError('COMMISSION_RULE_NOT_FOUND');

    return {
      id: rule.id,
      label: rule.label,
      scope: scopeOf(rule.categoryId, rule.sellerId),
      versions: rule.versions.map((version) => ({
        id: version.id,
        rateBps: version.rateBps,
        fixedFeeMinor: version.fixedFeeMinor,
        validFrom: version.validFrom,
        validTo: version.validTo,
        createdBy: version.createdBy,
        createdAt: version.createdAt,
        /** Bu oranla kesilen sipariş kalemi sayısı — versiyon SİLİNEMEZ olduğunun kanıtı. */
        appliedOrderItemCount: version._count.orderItems,
      })),
    };
  }

  // ── Kural yaratma ────────────────────────────────────────────────────────

  /**
   * Yeni kural + İLK versiyonu.
   *
   * ⚠️ Aynı (kategori, satıcı) çifti için ikinci bir kural olamaz; olsaydı
   *    checkout hangi oranı uygulayacağını bilemezdi. Postgres'te NULL'lar
   *    unique kısıtta birbirinden farklı sayıldığı için asıl kısıt migration'da
   *    `NULLS NOT DISTINCT` ile tanımlı (bkz. schema.prisma). Buradaki kontrol
   *    kullanıcıya anlamlı hata döndürmek için; yarış durumunu advisory lock
   *    kapatıyor, son savunma da veritabanı kısıtı.
   */
  async createRule(actor: AdminActor, input: CommissionRuleCreateInput): Promise<unknown> {
    const now = new Date();
    const categoryId = input.categoryId ?? null;
    const sellerId = input.sellerId ?? null;
    const validFrom = input.validFrom ?? now;

    return this.prisma.$transaction(async (tx) => {
      await lockKey(
        tx,
        LOCK_NAMESPACE.commissionRuleKey,
        `${categoryId ?? '-'}|${sellerId ?? '-'}`,
      );

      const existing = await tx.commissionRule.findFirst({
        where: { categoryId, sellerId },
        select: { id: true, label: true },
      });
      if (existing) {
        throw appError('DUPLICATE_RESOURCE', {
          internalMessage: `Bu kapsam için kural zaten var: ${existing.id} (${existing.label})`,
          details: {
            fields: [
              {
                path: 'categoryId',
                message: 'Bu kategori/satıcı kapsamı için tanımlı bir komisyon kuralı zaten var.',
              },
            ],
          },
        });
      }

      // Saf çekirdek: ilk versiyonda `close` null döner, tavan kontrolü burada yapılır.
      const plan = planCommissionVersion(
        [],
        { rateBps: input.rateBps, fixedFeeMinor: input.fixedFeeMinor, validFrom },
        now,
      );

      const rule = await tx.commissionRule.create({
        data: { categoryId, sellerId, label: input.label },
        select: { id: true, label: true, categoryId: true, sellerId: true, createdAt: true },
      });

      const version = await tx.commissionRuleVersion.create({
        data: {
          ruleId: rule.id,
          rateBps: plan.create.rateBps,
          fixedFeeMinor: plan.create.fixedFeeMinor,
          validFrom: plan.create.validFrom,
          validTo: null,
          createdBy: actor.id,
        },
        select: { id: true, rateBps: true, fixedFeeMinor: true, validFrom: true },
      });

      await writeAuditLog(tx, actor, {
        action: AUDIT_ACTION.commissionRuleCreated,
        entityType: 'CommissionRule',
        entityId: rule.id,
        before: null,
        after: {
          label: rule.label,
          categoryId,
          sellerId,
          versionId: version.id,
          rateBps: version.rateBps,
          fixedFeeMinor: version.fixedFeeMinor,
          validFrom: version.validFrom,
        },
      });

      this.logger.info(
        { ruleId: rule.id, rateBps: version.rateBps, actorId: actor.id },
        'Komisyon kuralı oluşturuldu',
      );

      return {
        id: rule.id,
        label: rule.label,
        scope: scopeOf(categoryId, sellerId),
        createdAt: rule.createdAt,
        currentVersion: version,
      };
    });
  }

  // ── YENİ VERSİYON (kritik akış) ──────────────────────────────────────────

  /**
   * ⚠️ KOMİSYON KURALI GÜNCELLENMEZ — YENİ VERSİYON YAZILIR.
   *
   * Sıralama önemlidir:
   *   1. Kuralın versiyon zinciri advisory lock ile kilitlenir. İki admin aynı
   *      anda zam yaparsa ikisi de "açık versiyon yok/var" kararını aynı anda
   *      verir ve iki açık versiyon doğardı.
   *   2. Mevcut versiyonlar okunur, plan SAF çekirdekte üretilir (tavan, geriye
   *      dönüklük ve çakışma kontrolleri orada).
   *   3. Eski versiyonun yalnızca `validTo`'su kapatılır — koşula
   *      `validTo: null` eklenerek karşılaştır-ve-değiştir yapılır; kilit bir
   *      şekilde atlanmış olsa bile ikinci yazıcı 0 satır günceller ve
   *      CONCURRENCY_CONFLICT alır.
   *   4. Yeni versiyon yazılır.
   *   5. Denetim kaydı AYNI transaction'da yazılır.
   */
  async createVersion(
    actor: AdminActor,
    ruleId: string,
    input: CommissionVersionCreateInput,
  ): Promise<unknown> {
    const now = new Date();
    const validFrom = input.validFrom ?? now;

    return this.prisma.$transaction(async (tx) => {
      await lockKey(tx, LOCK_NAMESPACE.commissionRuleVersions, ruleId);

      const rule = await tx.commissionRule.findUnique({
        where: { id: ruleId },
        select: { id: true, label: true, categoryId: true, sellerId: true },
      });
      if (!rule) throw appError('COMMISSION_RULE_NOT_FOUND');

      const existing = await tx.commissionRuleVersion.findMany({
        where: { ruleId },
        orderBy: { validFrom: 'asc' },
        select: { id: true, rateBps: true, fixedFeeMinor: true, validFrom: true, validTo: true },
      });

      const snapshots: CommissionVersionSnapshot[] = existing.map((version) => ({
        id: version.id,
        rateBps: version.rateBps,
        fixedFeeMinor: version.fixedFeeMinor,
        validFrom: version.validFrom,
        validTo: version.validTo,
      }));

      const plan = planCommissionVersion(
        snapshots,
        { rateBps: input.rateBps, fixedFeeMinor: input.fixedFeeMinor, validFrom },
        now,
      );

      const closed = plan.close;
      if (closed !== null) {
        const result = await tx.commissionRuleVersion.updateMany({
          // ⚠️ `validTo: null` koşulu karşılaştır-ve-değiştir görevi görür.
          where: { id: closed.versionId, validTo: null },
          data: { validTo: closed.validTo },
        });
        if (result.count !== 1) {
          throw appError('CONCURRENCY_CONFLICT', {
            internalMessage: `Versiyon ${closed.versionId} kapatılamadı (etkilenen satır: ${result.count}) — başka bir işlem araya girdi`,
          });
        }
      }

      const created = await tx.commissionRuleVersion.create({
        data: {
          ruleId,
          rateBps: plan.create.rateBps,
          fixedFeeMinor: plan.create.fixedFeeMinor,
          validFrom: plan.create.validFrom,
          validTo: null,
          createdBy: actor.id,
        },
        select: { id: true, rateBps: true, fixedFeeMinor: true, validFrom: true, validTo: true },
      });

      // Yazdıktan SONRA da doğrula: bu kuralda tek açık versiyon kalmalı.
      // Kilit ve karşılaştır-ve-değiştir yeterli olmalı; bu kontrol, sessizce
      // bozulmuş bir çizelgeyle devam etmektense transaction'ı geri almak için.
      const openCount = await tx.commissionRuleVersion.count({
        where: { ruleId, validTo: null },
      });
      if (openCount !== 1) {
        throw appError('CONCURRENCY_CONFLICT', {
          internalMessage: `Kural ${ruleId} için ${openCount} açık versiyon oluştu — işlem geri alındı`,
        });
      }

      const previous = closed
        ? snapshots.find((version) => version.id === closed.versionId)
        : undefined;

      await writeAuditLog(tx, actor, {
        action: AUDIT_ACTION.commissionVersionCreated,
        entityType: 'CommissionRule',
        entityId: ruleId,
        before: previous
          ? {
              versionId: previous.id,
              rateBps: previous.rateBps,
              fixedFeeMinor: previous.fixedFeeMinor,
              validFrom: previous.validFrom,
              // Eski versiyonda değişen TEK alan bu.
              validTo: null,
            }
          : null,
        after: {
          versionId: created.id,
          rateBps: created.rateBps,
          fixedFeeMinor: created.fixedFeeMinor,
          validFrom: created.validFrom,
          closedVersionId: closed?.versionId ?? null,
          closedValidTo: closed?.validTo ?? null,
        },
        reason: input.reason,
      });

      this.logger.warn(
        {
          ruleId,
          label: rule.label,
          previousRateBps: previous?.rateBps ?? null,
          newRateBps: created.rateBps,
          validFrom: created.validFrom.toISOString(),
          actorId: actor.id,
        },
        'Komisyon oranı değişti — yeni versiyon yazıldı',
      );

      return {
        ruleId,
        label: rule.label,
        scope: scopeOf(rule.categoryId, rule.sellerId),
        version: created,
        closedVersionId: closed?.versionId ?? null,
      };
    });
  }
}

function scopeOf(
  categoryId: string | null,
  sellerId: string | null,
): 'PLATFORM' | 'CATEGORY' | 'SELLER' | 'SELLER_CATEGORY' {
  if (categoryId && sellerId) return 'SELLER_CATEGORY';
  if (sellerId) return 'SELLER';
  if (categoryId) return 'CATEGORY';
  return 'PLATFORM';
}

/**
 * Mantıksal anahtar kilidi. Transaction bitince kendiliğinden düşer.
 * `hashtext` metni int4'e indirger; çakışma olsa bile sonuç yalnızca gereksiz
 * bekleme olur, yanlış sonuç değil.
 */
async function lockKey(tx: Tx, namespace: number, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${namespace}::int, hashtext(${key}))`;
}
