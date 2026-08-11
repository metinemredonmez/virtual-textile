import { Inject, Injectable } from '@nestjs/common';
import { appError } from '@vt/contracts';
import type { AiFeature, Prisma } from '@vt/db';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import type { Logger } from '../../common/logger.js';
import { AUDIT_ACTION, emitOutbox, writeAuditLog, type AdminActor } from './audit.js';
import {
  ADMIN_AI_USAGE_READER,
  ADMIN_FRAUD_PORT,
  ADMIN_ORDER_READER,
  ADMIN_PHOTO_ACCESS,
  type AdminOrderReaderPort,
  type AiUsageReaderPort,
  type FraudSignalPort,
  type PhotoAccessPort,
} from './admin.ports.js';
import type {
  AiUsageQuery,
  AuditLogQuery,
  BreakGlassInput,
  FraudQuery,
  GmvQuery,
} from './admin.schema.js';

/**
 * RAPORLAR: AI maliyeti, GMV, dolandırıcılık sinyalleri, denetim izi
 * ve KVKK break-glass fotoğraf erişimi.
 *
 * AuditLog bu modülün KENDİ tablosudur; doğrudan okunur/yazılır. Diğer tüm
 * veriler portlar üzerinden gelir.
 */
@Injectable()
export class AdminReportService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ADMIN_AI_USAGE_READER) private readonly aiUsage: AiUsageReaderPort,
    @Inject(ADMIN_ORDER_READER) private readonly orders: AdminOrderReaderPort,
    @Inject(ADMIN_FRAUD_PORT) private readonly fraud: FraudSignalPort,
    @Inject(ADMIN_PHOTO_ACCESS) private readonly photos: PhotoAccessPort,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  // ── AI maliyet paneli ────────────────────────────────────────────────────

  /**
   * AI MALİYET PANELİ — AiUsageLog'dan.
   *
   * ⚠️ Başarısız çağrılar da toplama dahildir: sağlayıcı hata dönse bile
   *    çoğu zaman ücret tahakkuk eder. Yalnızca başarılılar sayılsaydı panel
   *    faturadan düşük görünür ve bütçe alarmı geç çalardı.
   *
   * ⚠️ ÖNBELLEK İSABETİ İKİ FARKLI ORTALAMA ÜRETİR:
   *      - `avgCostPerCallMicroUsd`      : önbellek isabetleri DAHİL — gerçek
   *        birim ekonomisi budur, kullanıcıya sunulan her deneme başına maliyet.
   *      - `avgCostPerGeneratedMicroUsd` : yalnızca gerçekten ÜRETİLEN işler —
   *        sağlayıcı fiyatının kendisi budur.
   *    Tek ortalama verilseydi önbellek iyileştirmesinin etkisi görünmezdi.
   *
   * ⚠️ KVKK: panel kullanıcı KİMLİĞİ ve tutar gösterir; fotoğraf, istem
   *    metni veya çıktı GÖSTERMEZ. Maliyet analizi için kimlik yeterlidir.
   */
  async aiCostPanel(query: AiUsageQuery): Promise<unknown> {
    const [buckets, topUsers, tryOn] = await Promise.all([
      this.aiUsage.byDayAndFeature({ from: query.from, to: query.to, feature: query.feature }),
      this.aiUsage.topUsers({ from: query.from, to: query.to, limit: query.topUserLimit }),
      this.aiUsage.tryOnTotals({ from: query.from, to: query.to }),
    ]);

    const totals = buckets.reduce(
      (acc, bucket) => ({
        callCount: acc.callCount + bucket.callCount,
        cacheHitCount: acc.cacheHitCount + bucket.cacheHitCount,
        successCount: acc.successCount + bucket.successCount,
        costMicroUsd: acc.costMicroUsd + bucket.costMicroUsd,
      }),
      { callCount: 0, cacheHitCount: 0, successCount: 0, costMicroUsd: 0n },
    );

    // Özellik bazında toplam — panelin "maliyet nereye gidiyor" kolonu.
    const byFeature = new Map<
      AiFeature,
      { feature: AiFeature; callCount: number; cacheHitCount: number; costMicroUsd: bigint }
    >();
    for (const bucket of buckets) {
      const entry = byFeature.get(bucket.feature) ?? {
        feature: bucket.feature,
        callCount: 0,
        cacheHitCount: 0,
        costMicroUsd: 0n,
      };
      entry.callCount += bucket.callCount;
      entry.cacheHitCount += bucket.cacheHitCount;
      entry.costMicroUsd += bucket.costMicroUsd;
      byFeature.set(bucket.feature, entry);
    }

    const generatedTryOns = tryOn.callCount - tryOn.cacheHitCount;

    return {
      range: { from: query.from, to: query.to },
      totals: {
        ...totals,
        failureCount: totals.callCount - totals.successCount,
        cacheHitRate: ratio(totals.cacheHitCount, totals.callCount),
        avgCostPerCallMicroUsd: divideMicro(totals.costMicroUsd, totals.callCount),
      },
      tryOn: {
        callCount: tryOn.callCount,
        cacheHitCount: tryOn.cacheHitCount,
        generatedCount: generatedTryOns,
        cacheHitRate: ratio(tryOn.cacheHitCount, tryOn.callCount),
        costMicroUsd: tryOn.costMicroUsd,
        avgCostPerCallMicroUsd: divideMicro(tryOn.costMicroUsd, tryOn.callCount),
        avgCostPerGeneratedMicroUsd: divideMicro(tryOn.costMicroUsd, generatedTryOns),
      },
      byFeature: [...byFeature.values()].map((entry) => ({
        ...entry,
        cacheHitRate: ratio(entry.cacheHitCount, entry.callCount),
        avgCostPerCallMicroUsd: divideMicro(entry.costMicroUsd, entry.callCount),
      })),
      byDay: buckets,
      topUsers: topUsers.map((user) => ({
        ...user,
        avgCostPerCallMicroUsd: divideMicro(user.costMicroUsd, user.callCount),
      })),
    };
  }

  // ── GMV raporu ───────────────────────────────────────────────────────────

  /**
   * GMV — Order + OrderItem'dan.
   *
   * ⚠️ Tutarlar bigint kalır; hiçbir aşamada Number'a çevrilmez. Toplam ciro
   *    2^53 kuruşu (≈ 90 trilyon ₺) aşmasa da, float'a çevirme alışkanlığı
   *    kalem bazlı raporlarda kuruş kayması üretir.
   *
   * ⚠️ İADELER AYRI SORGULANIR. Tek sorguda iade tablosuna JOIN yapılsaydı
   *    çok kalemli/çok iadeli siparişlerde satırlar çoğalır (fan-out) ve GMV
   *    olduğundan yüksek çıkardı. İki sonuç kova anahtarıyla birleştiriliyor.
   *
   * ⚠️ Kovalar Türkiye saatine göre; UTC kullanılsaydı gün sonu ciro raporu
   *    muhasebenin gününden 3 saat kayardı.
   */
  async gmv(query: GmvQuery): Promise<unknown> {
    const [sales, returns] = await Promise.all([
      this.orders.gmv({
        from: query.from,
        to: query.to,
        granularity: query.granularity,
        sellerId: query.sellerId,
      }),
      this.orders.gmvReturns({
        from: query.from,
        to: query.to,
        granularity: query.granularity,
        sellerId: query.sellerId,
      }),
    ]);

    const returnsByBucket = new Map(
      returns.map((entry) => [entry.bucket.getTime(), entry] as const),
    );

    const buckets = sales.map((bucket) => {
      const returned = returnsByBucket.get(bucket.bucket.getTime());
      const returnedMinor = returned?.returnedMinor ?? 0n;
      return {
        bucket: bucket.bucket,
        orderCount: bucket.orderCount,
        itemCount: bucket.itemCount,
        gmvMinor: bucket.gmvMinor,
        commissionMinor: bucket.commissionMinor,
        sellerNetMinor: bucket.sellerNetMinor,
        returnedMinor,
        returnedItemCount: returned?.returnedItemCount ?? 0,
        /** Brütten iadeler düşülmüş hâli — "net GMV". */
        netGmvMinor: bucket.gmvMinor - returnedMinor,
      };
    });

    const totals = buckets.reduce(
      (acc, bucket) => ({
        orderCount: acc.orderCount + bucket.orderCount,
        itemCount: acc.itemCount + bucket.itemCount,
        gmvMinor: acc.gmvMinor + bucket.gmvMinor,
        commissionMinor: acc.commissionMinor + bucket.commissionMinor,
        sellerNetMinor: acc.sellerNetMinor + bucket.sellerNetMinor,
        returnedMinor: acc.returnedMinor + bucket.returnedMinor,
        netGmvMinor: acc.netGmvMinor + bucket.netGmvMinor,
      }),
      {
        orderCount: 0,
        itemCount: 0,
        gmvMinor: 0n,
        commissionMinor: 0n,
        sellerNetMinor: 0n,
        returnedMinor: 0n,
        netGmvMinor: 0n,
      },
    );

    return {
      range: { from: query.from, to: query.to },
      granularity: query.granularity,
      currency: 'TRY',
      totals: {
        ...totals,
        /** Ortalama sepet — kuruş bölümü tam sayı, kuruş altı temsil edilmez. */
        averageOrderValueMinor:
          totals.orderCount === 0 ? 0n : totals.gmvMinor / BigInt(totals.orderCount),
        /** Efektif komisyon oranı (bps) — kural tavanıyla kıyaslanabilsin diye. */
        effectiveCommissionBps:
          totals.gmvMinor === 0n ? 0 : Number((totals.commissionMinor * 10_000n) / totals.gmvMinor),
        returnRateBps:
          totals.gmvMinor === 0n ? 0 : Number((totals.returnedMinor * 10_000n) / totals.gmvMinor),
      },
      buckets,
    };
  }

  // ── Dolandırıcılık uyarıları ─────────────────────────────────────────────

  /**
   * ⚠️ Şemada FraudAlert tablosu YOK. Bu uç uyarıları mevcut kayıtlardan
   *    TÜRETİR ve durum tutmaz — "okundu/kapatıldı" işaretlenemez. Kalıcı
   *    uyarı tablosu eklendiğinde port ona bağlanır, uç sözleşmesi değişmez.
   */
  async fraudAlerts(query: FraudQuery): Promise<unknown> {
    const alerts = await this.fraud.alerts({
      from: query.from,
      to: query.to,
      limit: query.limit,
    });

    return {
      range: { from: query.from, to: query.to },
      /** Uyarılar türetilmiştir; kalıcı bir uyarı kaydı değildir. */
      derived: true,
      counts: {
        high: alerts.filter((alert) => alert.severity === 'HIGH').length,
        medium: alerts.filter((alert) => alert.severity === 'MEDIUM').length,
        low: alerts.filter((alert) => alert.severity === 'LOW').length,
      },
      items: alerts,
    };
  }

  // ── Denetim izi ──────────────────────────────────────────────────────────

  /**
   * Denetim izi listesi.
   *
   * ⚠️ Bu uç SUPPORT'a AÇILMAZ. Denetim izi "kim neye baktı"yı da içerir
   *    (break-glass kayıtları) ve kendisi de hassas veridir.
   */
  async auditLog(query: AuditLogQuery): Promise<unknown> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };

    // uuid v7 zaman sıralı olduğu için id, createdAt ile aynı sırayı verir ve
    // kararlı bir imleç anahtarıdır (aynı milisaniyedeki kayıtlar bile ayrışır).
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      items: page,
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  }

  // ── BREAK-GLASS: kullanıcı fotoğrafına erişim (KVKK) ─────────────────────

  /**
   * ⚠️⚠️ KIRILGAN CAM — ÖZEL NİTELİKLİ KİŞİSEL VERİ.
   *
   * Yöneticinin kullanıcı fotoğraflarına SERBEST ERİŞİMİ YOKTUR. Bu uç, tek
   * seferlik ve gerekçeli erişim içindir; üç şartın tamamı sağlanır:
   *
   *   1. GEREKÇE ZORUNLU (en az 30 karakter, talep/şikâyet numarası dahil).
   *   2. AuditLog kaydı — gerekçe, aktör ve IP ile birlikte.
   *   3. KULLANICIYA BİLDİRİM — OutboxEvent ile. Kullanıcı, fotoğrafına
   *      kimin ne zaman ve niçin baktığını öğrenir.
   *
   * ⚠️ Denetim kaydı ve bildirim, erişimle AYNI transaction'da yazılır. Önce
   *    URL üretilip sonra kayıt yazılsaydı, kayıt yazımı başarısız olduğunda
   *    denetlenmemiş bir erişim gerçekleşmiş olurdu.
   *
   * ⚠️ LİSTELEME UCU YOKTUR ve yazılmamalıdır: "hangi kullanıcıların fotoğrafı
   *    var" sorusunun yönetim panelinde bir cevabı olmamalı.
   */
  async breakGlassPhotoAccess(
    actor: AdminActor,
    userId: string,
    input: BreakGlassInput,
  ): Promise<unknown> {
    const exists = await this.photos.userExists(userId);
    if (!exists) {
      throw appError('NOT_FOUND', { internalMessage: `Kullanıcı ${userId} yok` });
    }

    const accessed = await this.photos.listForBreakGlass(userId, input.photoId);
    if (accessed.length === 0) throw appError('PHOTO_NOT_FOUND');

    const accessedAt = new Date();

    return this.prisma.$transaction(async (tx) => {
      await writeAuditLog(tx, actor, {
        action: AUDIT_ACTION.photoBreakGlass,
        entityType: 'UserPhoto',
        entityId: input.photoId ?? userId,
        before: null,
        after: {
          subjectUserId: userId,
          // Fotoğrafın KENDİSİ ya da depolama anahtarı denetim kaydına GİRMEZ.
          photoIds: accessed.map((photo) => photo.id),
          photoCount: accessed.length,
          accessedAt,
        },
        reason: input.reason,
      });

      // Kullanıcı bilgilendirilir — şeffaflık bu erişimin ön koşuludur.
      await emitOutbox(tx, {
        aggregate: 'user',
        aggregateId: userId,
        type: 'user.photo.break_glass_access',
        payload: {
          userId,
          actorId: actor.id,
          actorRole: actor.role,
          reason: input.reason,
          photoCount: accessed.length,
          accessedAt,
        },
      });

      this.logger.warn(
        {
          subjectUserId: userId,
          actorId: actor.id,
          photoCount: accessed.length,
          reason: input.reason,
        },
        'BREAK-GLASS: yönetici kullanıcı fotoğrafına erişti',
      );

      return {
        userId,
        accessedAt,
        reason: input.reason,
        /** Kullanıcıya bildirim gitti — erişim gizli değildir. */
        userNotified: true,
        photos: accessed,
      };
    });
  }
}

/** 0-1 arası oran; payda sıfırsa 0. Yüzde DEĞİL — arayüz biçimlendirir. */
function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Number((numerator / denominator).toFixed(4));
}

/**
 * Micro-USD bölümü bigint kalır (tam sayıya kırpılır).
 * Float'a çevirmek maliyet toplamlarında yuvarlama hatası üretir; micro-USD
 * zaten yeterince ince bir birim, kırpma anlamlı bir kayıp değil.
 */
function divideMicro(total: bigint, count: number): bigint {
  if (count <= 0) return 0n;
  return total / BigInt(count);
}
