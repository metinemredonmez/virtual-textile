import { Inject, Injectable } from '@nestjs/common';
import { appError } from '@vt/contracts';
import { SIGNED_URL_TTL_SECONDS, TRYON, TRYONABLE_CATEGORIES } from '@vt/config';
import { outfitIntermediateKey } from '@vt/adapters';
import { Prisma } from '@vt/db';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import type { Logger } from '../../common/logger.js';
import { assertTryOnConsent, assertTryOnQuotaAndBudget, loadOwnPhoto } from './tryon.guards.js';
import {
  CONSENT_PORT,
  TRYON_CACHE_KEY_PORT,
  TRYON_CATALOG_PORT,
  TRYON_STORAGE_PORT,
  type ConsentPort,
  type TryOnCacheKeyPort,
  type TryOnCatalogPort,
  type TryOnStoragePort,
} from './ai.ports.js';
import type { TryOnCreateInput, TryOnHistoryQuery } from './ai.schema.js';

/**
 * SANAL DENEME AKIŞI (API tarafı)
 *
 * ⚠️ BU UÇ SENKRON ÜRETİM YAPMAZ. İş kuyruğa alınır, kullanıcı 202 alır ve
 *    gezinmeye devam eder. 25-60 saniye boyunca bir HTTP bağlantısını açık
 *    tutmak hem sunucu kaynağını hem de dönüşüm oranını yakar: kullanıcı
 *    bekleyemez, sekmeyi kapatır, üretilen görsel çöpe gider — parası ödenmiş
 *    olarak.
 *
 * Sıra kasıtlıdır ve HİÇBİR ADIM ATLANMAZ:
 *   1. RIZA        — hukuki; ihlali para cezası.
 *   2. UYGUNLUK    — desteklenmeyen kategoride üretim boşa maliyettir.
 *   3. ÖNBELLEK    — en büyük maliyet kaldıracı; kotadan da düşmez.
 *   4. KOTA/BÜTÇE  — çağrıdan ÖNCE; sonra sorulursa para harcanmıştır.
 *   5. KUYRUK      — outbox ile, aynı transaction içinde.
 */

/** Kuyruk bekleme tahmini için taban süreler. Timeout değil, TİPİK süre. */
const TYPICAL_GENERATION_SECONDS: Record<'FAST' | 'QUALITY', number> = {
  FAST: 12,
  QUALITY: 30,
};

/**
 * Worker'daki try-on eşzamanlılığı (bkz. apps/worker/src/queues.ts → CONCURRENCY).
 * ⚠️ Orada değişirse burası da değişmeli; yalnızca KULLANICIYA GÖSTERİLEN
 *    tahmini etkiler, bir kaynağı sınırlamaz.
 */
const WORKER_CONCURRENCY = 4;

/** Kuyruk tahmininde hesaba katılacak azami bekleyen iş — üstü zaten "uzun". */
const MAX_QUEUE_LOOKAHEAD = 200;

export type TryOnActor = { userId: string };

export interface TryOnCacheHit {
  outcome: 'CACHED';
  jobId: string;
  status: 'SUCCEEDED';
  resultUrl: string | null;
  visualConfidence: number | null;
  lowConfidence: boolean;
}

export interface TryOnQueued {
  outcome: 'QUEUED';
  jobId: string;
  estimatedSeconds: number;
}

export type TryOnCreateResult = TryOnCacheHit | TryOnQueued;

export interface TryOnJobView {
  jobId: string;
  status: string;
  variantId: string;
  mode: string;
  resultUrl: string | null;
  visualConfidence: number | null;
  /** Sonuç düşük güvenli: arayüz uyarı rozeti gösterir. */
  lowConfidence: boolean;
  errorCode: string | null;
  queuedAt: Date;
  finishedAt: Date | null;
}

@Injectable()
export class TryOnService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONSENT_PORT) private readonly consents: ConsentPort,
    @Inject(TRYON_CATALOG_PORT) private readonly catalog: TryOnCatalogPort,
    @Inject(TRYON_STORAGE_PORT) private readonly storage: TryOnStoragePort,
    @Inject(TRYON_CACHE_KEY_PORT) private readonly cacheKeys: TryOnCacheKeyPort,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  // ── POST /tryon ──────────────────────────────────────────────────────────

  async create(input: TryOnCreateInput, actor: TryOnActor): Promise<TryOnCreateResult> {
    const startedAt = Date.now();

    // 1) ⚠️ RIZA — sağlayıcıya çağrı yapılmadan ÖNCE, istisnasız.
    //    Kapı mantığı `tryon.guards.ts`tedir: kombin akışı da AYNI kapıdan geçer.
    await assertTryOnConsent(this.consents, this.logger, actor.userId);

    // 2) Fotoğraf: sahiplik + yaşam süresi + kalite.
    const photo = await loadOwnPhoto(this.prisma, input.userPhotoId, actor.userId);

    // 3) Ürün try-on'a uygun mu.
    const variant = await this.loadTryOnableVariant(input.variantId);

    // 4) ⚠️ ÖNBELLEK — kotadan ve bütçeden ÖNCE. Aynı foto + aynı ürün ikinci
    //    kez üretilmez; maliyet 0, kota harcanmaz.
    const cacheKey = this.cacheKeys.build({
      photoContentHash: photo.contentHash,
      variantId: variant.variantId,
      mode: input.mode,
    });

    const cached = await this.prisma.tryOnJob.findFirst({
      where: { cacheKey, status: 'SUCCEEDED', resultKey: { not: null } },
      select: { id: true, resultKey: true, visualConfidence: true },
    });

    if (cached) {
      // ⚠️ Önbellek anahtarı fotoğrafın İÇERİK özetini taşır. Bir isabet,
      // isteği yapanın zaten elinde olan fotoğrafın işlenmiş hâlidir; başka
      // bir kişinin verisi açığa çıkmaz. Anahtar istemciden alınsaydı bu
      // güvence olmazdı — bu yüzden anahtar yalnızca sunucuda üretilir.
      await this.writeUsageLog({
        userId: actor.userId,
        provider: 'cache',
        model: 'cache',
        costMicroUsd: 0n,
        latencyMs: Date.now() - startedAt,
        success: true,
        cacheHit: true,
      });

      return {
        outcome: 'CACHED',
        jobId: cached.id,
        status: 'SUCCEEDED',
        resultUrl: await this.signResult(cached.resultKey),
        visualConfidence: cached.visualConfidence,
        lowConfidence: (cached.visualConfidence ?? 0) < TRYON.lowConfidenceThreshold,
      };
    }

    // 5) KOTA ve BÜTÇE — üretim maliyeti burada doğar.
    //    Tek ürün = 1 birim. (Kombin akışı aynı fonksiyonu parça sayısıyla çağırır.)
    await assertTryOnQuotaAndBudget(this.prisma, this.logger, { userId: actor.userId, units: 1 });

    // 6) İşi ve outbox olayını AYNI transaction'da yaz.
    return this.enqueue({
      userId: actor.userId,
      userPhotoId: photo.id,
      variantId: variant.variantId,
      mode: input.mode,
      cacheKey,
    });
  }

  // ── GET /tryon/:jobId ────────────────────────────────────────────────────

  async findJob(jobId: string, actor: TryOnActor): Promise<TryOnJobView> {
    const job = await this.prisma.tryOnJob.findFirst({
      // ⚠️ userId koşulu zorunlu: kimlik tahmin edilebilir olmasa da yetki
      // kontrolünü "kimse kimliği bilemez" varsayımına dayandırmıyoruz.
      where: { id: jobId, userId: actor.userId },
      select: {
        id: true,
        status: true,
        variantId: true,
        mode: true,
        resultKey: true,
        visualConfidence: true,
        errorCode: true,
        queuedAt: true,
        finishedAt: true,
      },
    });

    if (!job) throw appError('TRYON_JOB_NOT_FOUND');

    return this.toView(job);
  }

  // ── GET /tryon/history ───────────────────────────────────────────────────

  async history(
    query: TryOnHistoryQuery,
    actor: TryOnActor,
  ): Promise<{ items: TryOnJobView[]; nextCursor: string | null }> {
    // uuid v7 zaman sıralıdır: kimliğin kendisi cursor olarak yeterlidir,
    // ayrı bir sıralama anahtarı taşımaya gerek yok.
    const rows = await this.prisma.tryOnJob.findMany({
      where: {
        userId: actor.userId,
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      select: {
        id: true,
        status: true,
        variantId: true,
        mode: true,
        resultKey: true,
        visualConfidence: true,
        errorCode: true,
        queuedAt: true,
        finishedAt: true,
      },
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      items: await Promise.all(page.map((row) => this.toView(row))),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  }

  // ── DELETE /tryon/history ────────────────────────────────────────────────

  /**
   * ⚠️ KVKK SİLME TALEBİ. Kullanıcı "denemelerimi sil" dediğinde görsellerin
   *    de gitmesi gerekir; yalnızca listeyi gizlemek silme değildir.
   *
   * Depo silme işini API yapmaz (nesne deposuna erişimi worker'dadır). Anahtarlar
   * kayıtların silinmesiyle AYNI transaction'da outbox olayına yazılır: böylece
   * "kayıt silindi ama dosya kaldı" durumu oluşamaz — olay kalıcıdır ve en az
   * bir kez işlenir.
   *
   * AiUsageLog SİLİNMEZ: görsel içermez, mali kayıttır ve fatura mutabakatı
   * için tutulması gerekir.
   */
  async deleteHistory(actor: TryOnActor): Promise<{ deleted: number }> {
    return this.prisma.$transaction(async (tx) => {
      const jobs = await tx.tryOnJob.findMany({
        where: { userId: actor.userId },
        select: { id: true, resultKey: true },
      });

      if (jobs.length === 0) return { deleted: 0 };

      /**
       * ⚠️ ARA KATMAN GÖRSELLERİ DE SİLİNİR.
       *
       * Kombin bestesinde her katman, bir sonrakine taban olsun diye
       * FİLİGRANSIZ bir ara nesne bırakır (bkz. multi-tryon.ts →
       * outfitIntermediateKey). Bu nesne de kullanıcının vücut görüntüsüdür;
       * yalnızca `resultKey` silinseydi "denemelerimi sil" dedikten sonra
       * depoda kullanıcının filigransız görselleri kalırdı.
       *
       * Anahtar iş kimliğinden TÜRETİLİR, kolonda tutulmaz: şema değişikliği
       * gerektirmez ve hiçbir kayıt "ara nesnesi olduğunu" unutamaz. Var
       * olmayan bir nesneyi silmek depo tarafında zaten etkisizdir.
       */
      const resultKeys = [
        ...jobs.map((job) => job.resultKey).filter((key): key is string => key !== null),
        ...jobs.map((job) => outfitIntermediateKey(job.id)),
      ];

      await tx.outboxEvent.create({
        data: {
          aggregate: 'tryon',
          aggregateId: actor.userId,
          type: 'tryon.history_deleted',
          payload: { userId: actor.userId, resultKeys },
        },
      });

      const removed = await tx.tryOnJob.deleteMany({ where: { userId: actor.userId } });

      this.logger.info(
        { userId: actor.userId, deleted: removed.count, objects: resultKeys.length },
        'Sanal deneme geçmişi silindi',
      );

      return { deleted: removed.count };
    });
  }

  // ── Yardımcılar ──────────────────────────────────────────────────────────

  private async loadTryOnableVariant(variantId: string): Promise<{ variantId: string }> {
    const variant = await this.catalog.findVariant(variantId);
    if (!variant) throw appError('VARIANT_NOT_FOUND');
    if (!variant.isPurchasable) throw appError('VARIANT_UNAVAILABLE');

    const category = variant.tryOnCategory;
    if (category === null || !TRYONABLE_CATEGORIES.includes(category)) {
      throw appError('PRODUCT_NOT_TRYONABLE');
    }

    // Ürün görseli olmadan sağlayıcıya gönderilecek kıyafet yok.
    if (!variant.imageKey) throw appError('PRODUCT_NOT_TRYONABLE');

    return { variantId: variant.variantId };
  }

  private async enqueue(data: {
    userId: string;
    userPhotoId: string;
    variantId: string;
    mode: 'FAST' | 'QUALITY';
    cacheKey: string;
  }): Promise<TryOnCreateResult> {
    const estimatedSeconds = await this.estimateSeconds(data.mode);

    try {
      const job = await this.prisma.$transaction(async (tx) => {
        const created = await tx.tryOnJob.create({
          data: {
            userId: data.userId,
            userPhotoId: data.userPhotoId,
            variantId: data.variantId,
            mode: data.mode,
            status: 'QUEUED',
            cacheKey: data.cacheKey,
          },
          select: { id: true },
        });

        // ⚠️ Kuyruğa doğrudan yazılmaz. Transaction geri alınırsa var olmayan
        // bir iş için üretim başlar; transaction'dan sonra yazılırsa süreç
        // ölünce iş sonsuza dek QUEUED kalır. Outbox ikisini de çözer.
        await tx.outboxEvent.create({
          data: {
            aggregate: 'tryon',
            aggregateId: created.id,
            type: 'tryon.requested',
            payload: {
              tryOnJobId: created.id,
              userPhotoId: data.userPhotoId,
              variantId: data.variantId,
              mode: data.mode,
              cacheKey: data.cacheKey,
            },
          },
        });

        return created;
      });

      return { outcome: 'QUEUED', jobId: job.id, estimatedSeconds };
    } catch (error) {
      // YARIŞ DURUMU: aynı kullanıcı aynı foto+ürün için iki isteği aynı anda
      // gönderdi. cacheKey UNIQUE olduğu için ikincisi düşer. Hata döndürmek
      // yerine ilk işi buluyoruz — kullanıcı açısından istek başarılıdır ve
      // ikinci bir üretim (ikinci bir maliyet) doğmaz.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.tryOnJob.findUnique({
          where: { cacheKey: data.cacheKey },
          select: { id: true },
        });
        if (existing) return { outcome: 'QUEUED', jobId: existing.id, estimatedSeconds };
      }
      throw error;
    }
  }

  /** Kullanıcıya gösterilen bekleme tahmini — söz değil, tahmindir. */
  private async estimateSeconds(mode: 'FAST' | 'QUALITY'): Promise<number> {
    const pending = await this.prisma.tryOnJob.count({
      where: { status: { in: ['QUEUED', 'RUNNING'] } },
      take: MAX_QUEUE_LOOKAHEAD,
    });

    const base = TYPICAL_GENERATION_SECONDS[mode];
    const waves = Math.floor(pending / WORKER_CONCURRENCY);
    return base + waves * base;
  }

  private async toView(job: {
    id: string;
    status: string;
    variantId: string;
    mode: string;
    resultKey: string | null;
    visualConfidence: number | null;
    errorCode: string | null;
    queuedAt: Date;
    finishedAt: Date | null;
  }): Promise<TryOnJobView> {
    return {
      jobId: job.id,
      status: job.status,
      variantId: job.variantId,
      mode: job.mode,
      resultUrl: await this.signResult(job.resultKey),
      visualConfidence: job.visualConfidence,
      lowConfidence:
        job.visualConfidence !== null && job.visualConfidence < TRYON.lowConfidenceThreshold,
      // ⚠️ Sağlayıcı adı, model adı ve maliyet kullanıcıya GÖSTERİLMEZ:
      // rekabet bilgisidir ve kullanıcı için anlamı yoktur.
      errorCode: job.errorCode,
      queuedAt: job.queuedAt,
      finishedAt: job.finishedAt,
    };
  }

  /** Sonuç görseli private kovadadır; yalnızca kısa ömürlü imzalı URL ile verilir. */
  private async signResult(resultKey: string | null): Promise<string | null> {
    if (!resultKey) return null;
    return this.storage.signedResultUrl(resultKey, SIGNED_URL_TTL_SECONDS.tryOnResult);
  }

  private async writeUsageLog(entry: {
    userId: string;
    provider: string;
    model: string;
    costMicroUsd: bigint;
    latencyMs: number;
    success: boolean;
    cacheHit: boolean;
    errorCode?: string;
  }): Promise<void> {
    await this.prisma.aiUsageLog.create({
      data: {
        userId: entry.userId,
        feature: 'TRYON',
        provider: entry.provider,
        model: entry.model,
        imageCount: 1,
        costMicroUsd: entry.costMicroUsd,
        latencyMs: entry.latencyMs,
        success: entry.success,
        cacheHit: entry.cacheHit,
        errorCode: entry.errorCode ?? null,
      },
    });
  }
}
