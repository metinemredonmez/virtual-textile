import { Inject, Injectable } from '@nestjs/common';
import { appError, toAppError, type ErrorCode } from '@vt/contracts';
import { estimateCost, SIGNED_URL_TTL_SECONDS, TRYON, TRYONABLE_CATEGORIES } from '@vt/config';
import {
  isProducibleCategory,
  MAX_OUTFIT_PIECES,
  MIN_OUTFIT_PIECES,
  orderOutfitPieces,
  outfitStepKeys,
  type OrderedOutfitPiece,
  type OutfitLayerCategory,
  type OutfitOrderFailureReason,
} from '@vt/adapters';
import { Prisma } from '@vt/db';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import type { Logger } from '../../common/logger.js';
import { assertTryOnConsent, assertTryOnQuotaAndBudget, loadOwnPhoto } from './tryon.guards.js';
import {
  CONSENT_PORT,
  TRYON_CATALOG_PORT,
  TRYON_STORAGE_PORT,
  type ConsentPort,
  type TryOnCatalogPort,
  type TryOnStoragePort,
} from './ai.ports.js';
import type { OutfitTryOnCreateInput } from './multi-tryon.schema.js';
import type { TryOnActor } from './tryon.service.js';

/**
 * MARKALAR ARASI ÇOKLU ÜRÜN DENEME (API tarafı)
 *
 * Farklı satıcılardan 2-5 parça, katman sırasına göre AYNI kişi görselinde
 * birleşir. Ayrıştırıcı özellik budur (bkz. docs/ozellik-yol-haritasi.md).
 *
 * Sıra tek ürün akışıyla AYNIDIR ve HİÇBİR ADIM ATLANMAZ:
 *   1. RIZA        — hukuki; ihlali para cezası. `tryon.guards.ts` ile ORTAK.
 *   2. UYGUNLUK    — her parça ayrı ayrı try-on'a uygun olmalı.
 *   3. SIRALAMA    — sabit katman tablosu; istemcinin sırası kullanılmaz.
 *   4. ÖNBELLEK    — ÖNEK anahtarları; hazır katmanlar yeniden üretilmez.
 *   5. KOTA/BÜTÇE  — çağrıdan ÖNCE ve ÜRETİLECEK PARÇA SAYISI kadar.
 *   6. KUYRUK      — outbox ile, aynı transaction içinde.
 *
 * ⚠️ HER KATMAN AYRI BİR `TryOnJob` SATIRIDIR ve satırın `cacheKey`i o katmanın
 *    ÖNEK anahtarıdır. Bu, yeni bir tablo açmadan üç şeyi birden çözer:
 *      - kota sayımı kendiliğinden "parça başına" olur,
 *      - `cacheKey` UNIQUE olduğu için aynı önek iki kez üretilemez,
 *      - düşen bir katman yalnızca kendi hakkını iade eder.
 *    Kombini bir BÜTÜN olarak listelemek (geçmiş ekranı, `Outfit.tryOnJobId`
 *    bağlantısı) için gereken şema eklemesi raporda önerilmiştir; bu uç onsuz
 *    da çalışır çünkü istemci adım kimliklerini yanıtta alır.
 */

/**
 * Sıralama reddinin KULLANICI karşılığı.
 *
 * ⚠️ Eşleme burada, katalogda değil: `@vt/adapters` saf sıralama mantığıdır ve
 *    HTTP/hata kataloğunu tanımaz (worker da aynı fonksiyonu çağırır). Ret
 *    sebebini kullanıcı diline çevirmek uygulama katmanının işidir.
 *
 * `satisfies` sayesinde adapters tarafına yeni bir ret sebebi eklendiğinde
 * DERLEME KIRILIR — sessizce genel hataya düşülmez.
 */
const OUTFIT_ORDER_ERROR_CODE = {
  LAYER_CONFLICT: 'OUTFIT_LAYER_CONFLICT',
  /** Alt ve üst sınır aynı koda düşer: kullanıcının eylemi tek — sayıyı düzelt. */
  TOO_FEW_PIECES: 'OUTFIT_PIECE_COUNT_INVALID',
  TOO_MANY_PIECES: 'OUTFIT_PIECE_COUNT_INVALID',
  DUPLICATE_VARIANT: 'OUTFIT_DUPLICATE_PIECE',
} as const satisfies Record<OutfitOrderFailureReason, ErrorCode>;

/** Kuyruk bekleme tahmini için taban süreler. Timeout değil, TİPİK süre. */
const TYPICAL_GENERATION_SECONDS: Record<'FAST' | 'QUALITY', number> = {
  FAST: 12,
  QUALITY: 30,
};

/** Worker'daki try-on eşzamanlılığı (bkz. apps/worker/src/queues.ts → CONCURRENCY). */
const WORKER_CONCURRENCY = 4;

/** Kuyruk tahmininde hesaba katılacak azami bekleyen iş. */
const MAX_QUEUE_LOOKAHEAD = 200;

export interface OutfitStepView {
  /** 0'dan başlayan katman sırası — 0 en alttaki parça. */
  layerIndex: number;
  variantId: string;
  category: OutfitLayerCategory;
  /** Henüz kayıt açılmadıysa null. */
  jobId: string | null;
  status: 'PENDING' | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'FAILED_PERMANENT';
  /** true ise bu katman YENİDEN ÜRETİLMEDİ, hazır sonucu kullanıldı. */
  reused: boolean;
}

interface OutfitResultBase {
  steps: OutfitStepView[];
  /** Yeniden üretilmeyen katman sayısı — maliyet kazancının ölçüsü. */
  reusedStepCount: number;
}

export type OutfitTryOnResult = OutfitResultBase &
  (
    | {
        outcome: 'CACHED';
        jobId: string;
        resultUrl: string | null;
        visualConfidence: number | null;
        lowConfidence: boolean;
      }
    | {
        outcome: 'QUEUED';
        jobId: string;
        estimatedSeconds: number;
        /** Kotadan düşen üretim sayısı. */
        generatedStepCount: number;
      }
    | {
        /** Katmanların bir kısmı giydirildi; gösterilecek yarım kombin var. */
        outcome: 'PARTIAL';
        jobId: string;
        resultUrl: string | null;
        visualConfidence: number | null;
        lowConfidence: boolean;
        appliedCount: number;
        missing: { variantId: string; category: OutfitLayerCategory; errorCode: string | null };
      }
    | {
        /** Hiçbir katman giydirilemedi — gösterilecek görsel yok. */
        outcome: 'FAILED';
        errorCode: string | null;
        failedVariantId: string;
      }
  );

/** Katalogdan gelen, sıralamaya girecek parça. */
interface OutfitPieceSnapshot {
  variantId: string;
  category: OutfitLayerCategory;
  imageKey: string;
}

type StepRow = {
  id: string;
  cacheKey: string;
  status: string;
  attempts: number;
  resultKey: string | null;
  visualConfidence: number | null;
  errorCode: string | null;
};

@Injectable()
export class MultiTryOnService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONSENT_PORT) private readonly consents: ConsentPort,
    @Inject(TRYON_CATALOG_PORT) private readonly catalog: TryOnCatalogPort,
    @Inject(TRYON_STORAGE_PORT) private readonly storage: TryOnStoragePort,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  // ── POST /tryon/outfit ───────────────────────────────────────────────────

  /**
   * ⚠️ BU UÇ AYNI ZAMANDA YOKLAMA UCUDUR.
   *
   * Aynı gövde ile tekrar çağrılmak, üretimi tekrarlamaz: önek anahtarları
   * aynıdır, hazır katmanlar bulunur, devam eden katmanlar için hiçbir şey
   * yazılmaz. İstemci parça değiştirdiğinde de aynı uca yazar — sunucu
   * hangi katmanların yeniden üretileceğine kendisi karar verir, istemcinin
   * "neyi değiştirdim" bilgisini taşımasına gerek yoktur.
   */
  async create(input: OutfitTryOnCreateInput, actor: TryOnActor): Promise<OutfitTryOnResult> {
    const startedAt = Date.now();

    // 1) ⚠️ RIZA — sağlayıcıya çağrı yapılmadan ÖNCE, istisnasız.
    await assertTryOnConsent(this.consents, this.logger, actor.userId);

    // 2) Fotoğraf: sahiplik + yaşam süresi + kalite.
    const photo = await loadOwnPhoto(this.prisma, input.userPhotoId, actor.userId);

    // 3) Parçalar try-on'a uygun mu — HEPSİ, tek tek.
    const snapshots = await this.loadPieces(input.variantIds);

    // 4) ⚠️ KATMAN SIRASI. İstemcinin gönderdiği sıra KULLANILMAZ.
    const ordered = this.orderOrThrow(snapshots);

    // 5) ÖNEK anahtarları: i. anahtar ilk (i+1) parçanın birlikte giydirilmiş hâli.
    const keys = outfitStepKeys({
      photoContentHash: photo.contentHash,
      orderedVariantIds: ordered.map((piece) => piece.variantId),
      mode: input.mode,
    });

    // 6) ⚠️ ÖNBELLEK — kotadan ve bütçeden ÖNCE.
    //    Anahtar fotoğrafın İÇERİK özetini taşır; bir isabet, isteği yapanın
    //    zaten elinde olan fotoğrafın işlenmiş hâlidir (tek ürün akışındaki
    //    gerekçenin aynısı) — bu yüzden kullanıcıya göre filtrelenmez.
    const rows = await this.prisma.tryOnJob.findMany({
      where: { cacheKey: { in: keys } },
      select: {
        id: true,
        cacheKey: true,
        status: true,
        attempts: true,
        resultKey: true,
        visualConfidence: true,
        errorCode: true,
      },
    });

    const byKey = new Map(rows.map((row) => [row.cacheKey, row]));
    const plan = planFromRows(ordered, keys, byKey);

    // ── Tüm kombin hazır: hiçbir üretim yapılmaz, kota harcanmaz.
    if (plan.steps.length === 0) {
      return this.cached(ordered, keys, byKey, actor.userId, Date.now() - startedAt);
    }

    // ── Zincirin durumu: ilk özel durum kararı belirler (adımlar sıralıdır).
    const blocked = await this.firstBlockingStep({
      ordered,
      keys,
      byKey,
      plan,
      mode: input.mode,
    });
    if (blocked !== null) return blocked;

    // 7) KOTA ve BÜTÇE — ÜRETİLECEK PARÇA SAYISI kadar.
    //
    // ⚠️ ÇOKLU DENEME TEK DENEME SAYILMAZ. Karar: kota PARÇA BAŞINA düşer,
    //    sabit bir çarpanla değil.
    //
    //    Sabit çarpan (ör. "kombin = 2 hak") maliyetten kopar: 5 parçalı bir
    //    kombin 5 sağlayıcı çağrısıdır ve gerçekten 5 kat pahalıdır. Çarpan
    //    kullanılsaydı kota, bütçeyi korumayı bırakırdı — asıl işi budur.
    //
    //    Parça başına saymanın ikinci nedeni davranışsaldır: bu özelliğin tüm
    //    değeri kullanıcının parçaları DEĞİŞTİREREK denemesidir. Parça bazlı
    //    yeniden üretim sayesinde bir parçayı değiştirmek 1 çağrıdır; kota da
    //    1 düşer. Kombin başına sabit ücret alsaydık her değişim tam fiyat
    //    olur ve kullanıcı denemeyi bırakırdı.
    //
    //    ⚠️ Yeniden kullanılan katmanlar ve önbellek isabetleri SIFIR birimdir:
    //    "önbellek isabeti kotadan düşmez" kuralı burada da geçerli.
    await assertTryOnQuotaAndBudget(this.prisma, this.logger, {
      userId: actor.userId,
      units: plan.steps.length,
      // Zincir başlamadan toplam maliyet hesaba katılır: üçüncü adımda bütçe
      // dolarsa ödenmiş iki adım çöpe gider.
      projectedMicroUsd: estimateCost('TRYON', plan.steps.length),
    });

    // 8) Satırları ve outbox olayını AYNI transaction'da yaz.
    return this.enqueue({
      userId: actor.userId,
      userPhotoId: photo.id,
      mode: input.mode,
      ordered,
      keys,
      byKey,
      plan,
    });
  }

  // ── Uygunluk yoklaması (ÜRETİM YOK) ──────────────────────────────────────

  /**
   * Bu varyantlar bir arada denenebilir mi?
   *
   * ⚠️ HİÇBİR ŞEY ÜRETMEZ, HİÇBİR ŞEY YAZMAZ, KOTA HARCAMAZ. Yalnızca
   *    `create()` yolunun ilk iki kapısını —parça uygunluğu ve katman sırası—
   *    çalıştırıp sonucu bir cevaba çevirir. Gardırop ekranı "dene" düğmesini
   *    aktif edip etmeyeceğine buna bakarak karar verir.
   *
   * ⚠️ RIZA ve FOTOĞRAF KAPILARI BURADA YOKTUR ve olmamalıdır: ikisi de
   *    `create()` içinde, sağlayıcıya çağrıdan önce, istisnasız çalışır. Burada
   *    tekrarlansaydı henüz rıza vermemiş bir kullanıcı düğmeyi hiç göremez ve
   *    rıza akışına da yönlendirilemezdi — yoklama, kapıların yerine geçmez.
   *
   * ⚠️ `appError` FIRLATILMAZ, `{ available:false, reason }` DÖNER. Bu bir
   *    hata yolu değil, bir sorudur; 4xx'e çevirmek çağıranı try/catch ile
   *    akış kontrolü yapmaya zorlardı.
   */
  async checkOutfitEligibility(
    variantIds: readonly string[],
  ): Promise<{ available: boolean; reason?: string }> {
    if (variantIds.length === 0) {
      return { available: false, reason: 'Denenecek parça yok.' };
    }

    try {
      const snapshots = await this.loadPieces(variantIds);
      this.orderOrThrow(snapshots);
      return { available: true };
    } catch (error) {
      const appErr = toAppError(error);
      // ⚠️ Kullanıcıya katalogdaki mesaj gösterilir; iç açıklama (varyant
      //    kimlikleri taşır) yalnızca logda kalır.
      this.logger.debug(
        { variantIds, code: appErr.code },
        'Gardırop kombini sanal denemeye uygun değil',
      );
      return { available: false, reason: appErr.message };
    }
  }

  // ── Yardımcılar ──────────────────────────────────────────────────────────

  /**
   * Her parça ayrı ayrı doğrulanır.
   *
   * ⚠️ Bir parça uygun değilse istek TAMAMEN reddedilir; "uygun olanları
   *    giydirelim" denmez. Kullanıcı bir kombin seçti; sessizce eksilterek
   *    üretmek, istemediği bir kombin için para harcamaktır. Kısmi sonuç
   *    yalnızca ÜRETİM SIRASINDA oluşan hatalarda kabul edilir — orada para
   *    zaten harcanmıştır (bkz. composeOutfit → kısmi başarı kararı).
   */
  private async loadPieces(variantIds: readonly string[]): Promise<OutfitPieceSnapshot[]> {
    const variants = await Promise.all(variantIds.map((id) => this.catalog.findVariant(id)));

    return variants.map((variant, index) => {
      if (!variant) throw appError('VARIANT_NOT_FOUND');
      if (!variant.isPurchasable) throw appError('VARIANT_UNAVAILABLE');

      const category = variant.tryOnCategory;
      if (category === null || !TRYONABLE_CATEGORIES.includes(category)) {
        throw appError('PRODUCT_NOT_TRYONABLE');
      }

      // ⚠️ Aksesuar katman tablosunda var ama bugün ÜRETİLEMEZ (katalog enum'u
      //    ve sağlayıcı desteği yok). Sessizce atlanırsa kullanıcı şapkasız bir
      //    görseli tam kombin sanır.
      if (!isProducibleCategory(category)) throw appError('PRODUCT_NOT_TRYONABLE');

      // Ürün görseli olmadan sağlayıcıya gönderilecek kıyafet yok.
      if (!variant.imageKey) throw appError('PRODUCT_NOT_TRYONABLE');

      this.logger.debug(
        { variantId: variantIds[index], category },
        'Kombin parçası sanal denemeye uygun',
      );

      return { variantId: variant.variantId, category, imageKey: variant.imageKey };
    });
  }

  private orderOrThrow(
    pieces: readonly OutfitPieceSnapshot[],
  ): readonly OrderedOutfitPiece<OutfitPieceSnapshot>[] {
    const result = orderOutfitPieces(pieces);
    if (result.ok) return result.pieces;

    this.logger.warn(
      { reason: result.reason, variantIds: result.variantIds },
      'Kombin sıralaması reddedildi',
    );

    // ⚠️ `details.reason` KORUNUYOR: istemci hangi parçayı işaretleyeceğini
    //    buradan bilir, kullanıcı mesajı ise katalogdan gelir. İç açıklama
    //    (`detail`) yalnızca log tarafında kalır — varyant kimlikleri taşır.
    throw appError(OUTFIT_ORDER_ERROR_CODE[result.reason], {
      internalMessage: `Kombin reddedildi (${result.reason}): ${result.detail}`,
      details: { reason: result.reason, variantIds: result.variantIds },
      // Sınırlar tek kaynaktan gelir; mesajdaki rakam ile şemadaki (zod) sınır
      // hiçbir zaman ayrışmaz.
      params: { min: MIN_OUTFIT_PIECES, max: MAX_OUTFIT_PIECES },
    });
  }

  /**
   * Zincirin ilerlemesini ENGELLEYEN ilk adım.
   *
   * Adımlar sıralı olduğu için ilk özel durum sonucu belirler:
   *  - devam eden bir katman varsa istek zaten işleniyordur (yoklama yolu),
   *  - kalıcı olarak düşmüş bir katman varsa zincir orada durur.
   *
   * ⚠️ KALICI HATA OTOMATİK TEKRARLANMAZ. "Fotoğrafta kişi yok" ya da
   *    "içerik engellendi" üçüncü denemede de aynı sonucu verir; her yoklamada
   *    yeniden kuyruğa atmak, kullanıcı ekranda bekledikçe para yakmak olurdu.
   *    Geçici hatalar ise `TRYON.maxAttempts` sınırına kadar tekrar denenir.
   */
  private async firstBlockingStep(context: {
    ordered: readonly OrderedOutfitPiece<OutfitPieceSnapshot>[];
    keys: readonly string[];
    byKey: Map<string, StepRow>;
    plan: OutfitPlanLocal;
    mode: 'FAST' | 'QUALITY';
  }): Promise<OutfitTryOnResult | null> {
    for (const step of context.plan.steps) {
      const row = context.byKey.get(step.key);
      if (!row) continue;

      if (row.status === 'QUEUED' || row.status === 'RUNNING') {
        // Zaten işleniyor: hiçbir şey yazılmaz, ikinci bir üretim doğmaz.
        const remaining = context.ordered.length - context.plan.reusedCount;
        return {
          outcome: 'QUEUED',
          jobId: context.byKey.get(context.keys.at(-1) ?? '')?.id ?? row.id,
          estimatedSeconds: await this.estimateSeconds(context.mode, remaining),
          generatedStepCount: 0,
          reusedStepCount: context.plan.reusedCount,
          steps: this.viewOf(
            context.ordered,
            context.keys,
            context.byKey,
            context.plan.reusedCount,
            {},
          ),
        };
      }

      const retryable = row.status === 'FAILED' && row.attempts < TRYON.maxAttempts;
      if (!retryable) return this.terminal(step, row, context);
    }

    return null;
  }

  private async terminal(
    step: PlanStep,
    row: StepRow,
    context: {
      ordered: readonly OrderedOutfitPiece<OutfitPieceSnapshot>[];
      keys: readonly string[];
      byKey: Map<string, StepRow>;
      plan: OutfitPlanLocal;
    },
  ): Promise<OutfitTryOnResult> {
    const { ordered, keys, byKey, plan } = context;
    const steps = this.viewOf(ordered, keys, byKey, plan.reusedCount, {});

    /**
     * ⚠️ KISMİ BAŞARI KARARI (API karşılığı).
     *
     * Giydirilebilen katmanlar varsa kullanıcıya YARIM KOMBİN gösterilir ve
     * eksik parça AÇIKÇA bildirilir. Gerekçe: üretilmiş katmanların parası
     * ödenmiştir ve kullanıcının seçtiği parçaların çoğu görselde gerçekten
     * vardır; hepsini çöpe atmak hem parayı hem kullanıcının ilgisini yakar.
     *
     * Ama "istediğin kombin bu" DENMEZ: 3 parça seçen kullanıcı kararını 3
     * parçaya göre verir. Eksik parçayı söylemeden görseli sunmak, görmediği
     * bir kombini satın almasına ve iade olarak geri dönmesine yol açar.
     *
     * Hiçbir katman giydirilemediyse gösterilecek yeni bir şey yoktur: FAILED.
     */
    if (plan.reusedCount === 0) {
      return {
        outcome: 'FAILED',
        errorCode: row.errorCode,
        failedVariantId: step.piece.variantId,
        reusedStepCount: 0,
        steps,
      };
    }

    const baseKey = keys[plan.reusedCount - 1];
    const base = baseKey === undefined ? undefined : byKey.get(baseKey);

    return {
      outcome: 'PARTIAL',
      jobId: base?.id ?? '',
      // Yarım kombinin görseli de filigranlıdır ve private kovadadır.
      resultUrl: await this.signResult(base?.resultKey ?? null),
      visualConfidence: base?.visualConfidence ?? null,
      lowConfidence: (base?.visualConfidence ?? 0) < TRYON.lowConfidenceThreshold,
      appliedCount: plan.reusedCount,
      missing: {
        variantId: step.piece.variantId,
        category: step.piece.category,
        errorCode: row.errorCode,
      },
      reusedStepCount: plan.reusedCount,
      steps,
    };
  }

  private async cached(
    ordered: readonly OrderedOutfitPiece<OutfitPieceSnapshot>[],
    keys: readonly string[],
    byKey: Map<string, StepRow>,
    userId: string,
    latencyMs: number,
  ): Promise<OutfitTryOnResult> {
    const finalKey = keys.at(-1);
    const final = finalKey === undefined ? undefined : byKey.get(finalKey);

    if (!final) throw appError('TRYON_JOB_NOT_FOUND');

    // Maliyet 0, kota harcanmadı — ama kayıt yine yazılır ki önbelleğin ne
    // kadar tasarruf ettirdiği panelde görünsün.
    await this.prisma.aiUsageLog.create({
      data: {
        userId,
        feature: 'TRYON',
        provider: 'cache',
        model: 'cache',
        imageCount: ordered.length,
        costMicroUsd: 0n,
        latencyMs,
        success: true,
        cacheHit: true,
        errorCode: null,
      },
    });

    return {
      outcome: 'CACHED',
      jobId: final.id,
      resultUrl: await this.signResult(final.resultKey),
      visualConfidence: final.visualConfidence,
      lowConfidence: (final.visualConfidence ?? 0) < TRYON.lowConfidenceThreshold,
      reusedStepCount: ordered.length,
      steps: this.viewOf(ordered, keys, byKey, ordered.length, {}),
    };
  }

  private async enqueue(data: {
    userId: string;
    userPhotoId: string;
    mode: 'FAST' | 'QUALITY';
    ordered: readonly OrderedOutfitPiece<OutfitPieceSnapshot>[];
    keys: readonly string[];
    byKey: Map<string, StepRow>;
    plan: OutfitPlanLocal;
  }): Promise<OutfitTryOnResult> {
    const estimatedSeconds = await this.estimateSeconds(data.mode, data.plan.steps.length);
    const baseKey = data.plan.baseKey;
    const baseJobId = baseKey === null ? null : (data.byKey.get(baseKey)?.id ?? null);

    try {
      const createdIds = await this.prisma.$transaction(async (tx) => {
        const ids: Record<string, string> = {};

        for (const step of data.plan.steps) {
          const existing = data.byKey.get(step.key);

          if (existing) {
            // GEÇİCİ HATADAN DÖNÜŞ: satır yeniden kuyruğa alınır.
            // ⚠️ `queuedAt` tazelenir — kota "bugün açılmış işler" üzerinden
            //    sayılır; dünkü tarih kalsaydı tekrar deneme kotasız olurdu.
            await tx.tryOnJob.update({
              where: { id: existing.id },
              data: {
                status: 'QUEUED',
                queuedAt: new Date(),
                errorCode: null,
                errorMessage: null,
                finishedAt: null,
              },
            });
            ids[step.key] = existing.id;
            continue;
          }

          const created = await tx.tryOnJob.create({
            data: {
              userId: data.userId,
              userPhotoId: data.userPhotoId,
              // Bu satır, o katmanda EKLENEN parçayı temsil eder; `cacheKey`
              // ise kendisinden önceki tüm parçaları taşır.
              variantId: step.piece.variantId,
              mode: data.mode,
              status: 'QUEUED',
              cacheKey: step.key,
            },
            select: { id: true },
          });

          ids[step.key] = created.id;
        }

        const finalKey = data.keys.at(-1) ?? '';

        /**
         * ⚠️ Kuyruğa doğrudan yazılmaz (tek ürün akışındaki gerekçenin aynısı).
         *
         * Olay TEK'tir ve tüm zinciri taşır: katmanlar sıralı üretilmek
         * zorundadır, her adım bir öncekinin çıktısının üstüne giydirilir.
         * Katman başına ayrı olay yazılsaydı worker'lar aynı kombinin
         * adımlarını paralel çalıştırır ve ikinci adım henüz var olmayan bir
         * tabanı arardı.
         *
         * `baseJobId`: yeniden kullanılan öneğin işi. Worker taban görseli o
         * işin ARA nesnesinden okur (bkz. @vt/adapters → outfitIntermediateKey);
         * null ise taban kullanıcının ham fotoğrafıdır.
         */
        await tx.outboxEvent.create({
          data: {
            aggregate: 'tryon',
            aggregateId: ids[finalKey] ?? '',
            type: 'tryon.outfit_requested',
            payload: {
              userId: data.userId,
              userPhotoId: data.userPhotoId,
              mode: data.mode,
              finalCacheKey: finalKey,
              baseJobId,
              baseCacheKey: baseKey,
              steps: data.plan.steps.map((step) => ({
                tryOnJobId: ids[step.key],
                variantId: step.piece.variantId,
                category: step.piece.category,
                layerIndex: step.piece.layerIndex,
                cacheKey: step.key,
              })),
            },
          },
        });

        return ids;
      });

      const finalKey = data.keys.at(-1) ?? '';

      this.logger.info(
        {
          userId: data.userId,
          pieces: data.ordered.length,
          generated: data.plan.steps.length,
          reused: data.plan.reusedCount,
        },
        'Kombin denemesi kuyruğa alındı',
      );

      return {
        outcome: 'QUEUED',
        jobId: createdIds[finalKey] ?? '',
        estimatedSeconds,
        generatedStepCount: data.plan.steps.length,
        reusedStepCount: data.plan.reusedCount,
        steps: this.viewOf(data.ordered, data.keys, data.byKey, data.plan.reusedCount, createdIds),
      };
    } catch (error) {
      // YARIŞ DURUMU: aynı kombin için iki istek aynı anda geldi. `cacheKey`
      // UNIQUE olduğu için ikincisi düşer. Hata döndürmek yerine var olan
      // zinciri buluyoruz — kullanıcı açısından istek başarılıdır ve ikinci
      // bir üretim (ikinci bir maliyet) doğmaz.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const rows = await this.prisma.tryOnJob.findMany({
          where: { cacheKey: { in: [...data.keys] } },
          select: {
            id: true,
            cacheKey: true,
            status: true,
            attempts: true,
            resultKey: true,
            visualConfidence: true,
            errorCode: true,
          },
        });

        const byKey = new Map(rows.map((row) => [row.cacheKey, row]));
        const finalKey = data.keys.at(-1) ?? '';

        return {
          outcome: 'QUEUED',
          jobId: byKey.get(finalKey)?.id ?? '',
          estimatedSeconds,
          generatedStepCount: 0,
          reusedStepCount: data.plan.reusedCount,
          steps: this.viewOf(data.ordered, data.keys, byKey, data.plan.reusedCount, {}),
        };
      }
      throw error;
    }
  }

  private viewOf(
    ordered: readonly OrderedOutfitPiece<OutfitPieceSnapshot>[],
    keys: readonly string[],
    byKey: Map<string, StepRow>,
    reusedCount: number,
    createdIds: Record<string, string>,
  ): OutfitStepView[] {
    return ordered.map((piece, index) => {
      const key = keys[index] ?? '';
      const row = byKey.get(key);

      return {
        layerIndex: piece.layerIndex,
        variantId: piece.variantId,
        category: piece.category,
        jobId: row?.id ?? createdIds[key] ?? null,
        status: toStepStatus(row?.status, createdIds[key] !== undefined),
        reused: index < reusedCount,
      };
    });
  }

  /** Kullanıcıya gösterilen bekleme tahmini — söz değil, tahmindir. */
  private async estimateSeconds(mode: 'FAST' | 'QUALITY', stepCount: number): Promise<number> {
    const pending = await this.prisma.tryOnJob.count({
      where: { status: { in: ['QUEUED', 'RUNNING'] } },
      take: MAX_QUEUE_LOOKAHEAD,
    });

    const base = TYPICAL_GENERATION_SECONDS[mode];
    const waves = Math.floor(pending / WORKER_CONCURRENCY);

    // ⚠️ Katmanlar SIRAYLA üretilir, paralel değil: süre parça sayısıyla çarpılır.
    return base * stepCount + waves * base;
  }

  /** Sonuç görseli private kovadadır; yalnızca kısa ömürlü imzalı URL ile verilir. */
  private async signResult(resultKey: string | null): Promise<string | null> {
    if (!resultKey) return null;
    return this.storage.signedResultUrl(resultKey, SIGNED_URL_TTL_SECONDS.tryOnResult);
  }
}

// ── Saf yardımcılar ─────────────────────────────────────────────────────────

interface PlanStep {
  piece: OrderedOutfitPiece<OutfitPieceSnapshot>;
  key: string;
}

interface OutfitPlanLocal {
  reusedCount: number;
  baseKey: string | null;
  steps: readonly PlanStep[];
}

/**
 * ⚠️ MALİYETİN KALBİNİN API KARŞILIĞI.
 *
 * Hazır sonucu olan EN DERİN önek bulunur ve üretim oradan devam eder.
 * Bir katman "hazır" sayılması için SUCCEEDED olmalıdır: worker başarılı her
 * katman için hem kullanıcıya gösterilecek (filigranlı) sonucu hem de bir
 * sonraki katmana taban olacak ara nesneyi yazar.
 *
 * Planlama mantığı `@vt/adapters → planOutfitComposition` ile aynıdır; burada
 * satır durumlarından "hazır mı" sorusuna cevap üretilir.
 */
function planFromRows(
  ordered: readonly OrderedOutfitPiece<OutfitPieceSnapshot>[],
  keys: readonly string[],
  byKey: Map<string, StepRow>,
): OutfitPlanLocal {
  let reusedCount = 0;
  let baseKey: string | null = null;

  for (let index = keys.length - 1; index >= 0; index -= 1) {
    const key = keys[index];
    if (key === undefined) continue;

    const row = byKey.get(key);
    if (row?.status === 'SUCCEEDED') {
      reusedCount = index + 1;
      baseKey = key;
      break;
    }
  }

  const steps: PlanStep[] = [];
  for (let index = reusedCount; index < ordered.length; index += 1) {
    const piece = ordered[index];
    const key = keys[index];
    if (piece === undefined || key === undefined) continue;

    steps.push({ piece, key });
  }

  return { reusedCount, baseKey, steps };
}

function toStepStatus(status: string | undefined, justCreated: boolean): OutfitStepView['status'] {
  if (status === undefined) return justCreated ? 'QUEUED' : 'PENDING';

  switch (status) {
    case 'QUEUED':
    case 'RUNNING':
    case 'SUCCEEDED':
    case 'FAILED':
    case 'FAILED_PERMANENT':
      return status;
    default:
      // CANCELLED ve bilinmeyen durumlar arayüz için "beklemede" değildir;
      // yeniden üretilecekleri için kuyruk durumuyla gösterilir.
      return justCreated ? 'QUEUED' : 'PENDING';
  }
}
