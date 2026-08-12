import { aiBudgetFromEnv, checkBudget, env } from '@vt/config';
import type { Logger } from '../../common/logger.js';
// ⚠️ `import type`: bu dosya `CatalogService`i yalnızca TİP olarak kullanır.
//    DI belirteci olarak sınıf referansı `natural-search.module.ts` içinde
//    değer olarak alınır; burada da değer olarak alınsaydı servis testi
//    Prisma istemcisini de yüklemek zorunda kalırdı.
import type { CatalogService, ProductListResult } from './catalog.service.js';
import { NATURAL_SEARCH } from './natural-search.constants.js';
import {
  decideInterpretation,
  fallbackProductListQuery,
  intentToProductListQuery,
  parseIntent,
  sanitizeIntent,
} from './natural-search.intent.js';
import type { InterpretationOutcome, SearchIntent } from './natural-search.schema.js';
import type {
  CatalogVocabulary,
  CatalogVocabularyPort,
  QuotaSubject,
  SearchAiUsagePort,
  SearchIntentProvider,
  SearchQuotaPort,
} from './natural-search.ports.js';

/**
 * DOĞAL DİLDE ARAMA
 *
 * "5000 TL altı iş görüşmesi için sade bir kombin" gibi bir cümleyi
 * YAPILANDIRILMIŞ FİLTREYE çevirir ve filtreyi mevcut `CatalogService`e verir.
 *
 * ⚠️ MODEL ÜRÜN SEÇMEZ. Bu, özelliğin tek mimari kuralıdır. Model yalnızca
 *    niyeti çevirir; hangi ürünlerin döneceğine veritabanı karar verir.
 *    Modele ürün seçtirilseydi katalogda olmayan ürünleri, olmayan fiyatlarla
 *    önerirdi ve kullanıcı bunu ancak tıkladığında anlardı.
 *
 * ⚠️ HİÇBİR YAPAY ZEKÂ ARIZASI KULLANICIYA HATA OLARAK YANSIMAZ. Sağlayıcı
 *    çökse de, kota dolsa da, bütçe bitse de bu uç 200 döner: yalnızca
 *    filtreleme sadeleşir, arama çalışmaya devam eder. Yanıt içindeki
 *    `interpretation.outcome` hangi yoldan geçildiğini söyler.
 *
 * ⚠️ KVKK — bu akışta RIZA KAYDI ARANMAZ, gerekçesi:
 *    Sağlayıcıya giden veri kullanıcının yazdığı arama cümlesi ile katalogun
 *    kendi söz varlığından ibarettir; kimlik, profil, beden, fotoğraf veya
 *    sipariş geçmişi GİTMEZ ve port bunu tip düzeyinde imkânsız kılar (bkz.
 *    natural-search.ports.ts). Bu, stil danışmanının sohbet metniyle aynı
 *    sınıftır ve o akış da ayrı bir rıza kaydı aramaz. Açık rıza gerektiren
 *    veri sınıfı fotoğraf/biyometriktir ve karşılığı `evaluateTryOnConsent`
 *    içindedir — orada kontrol atlanamaz, burada gereksizdir.
 *    Rıza gerektiren bir alan bu akışa eklenirse (ör. kişiselleştirme için
 *    beden), kontrol de BU noktaya, çağrıdan ÖNCE eklenmelidir.
 */

export interface NaturalSearchInput {
  query: string;
  /** Girişli kullanıcı yoksa null — misafir de arayabilir. */
  userId: string | null;
  /** Misafir kotası bunun üzerinden sayılır. */
  clientIp: string;
  /** İstemci bağlantıyı kapatırsa sağlayıcı çağrısı da kesilir. */
  signal?: AbortSignal;
}

/** İstemciye dönen filtre — sayfalama bunun üzerinden yapılır. */
export interface AppliedFilter {
  keywords: string[];
  category: string | null;
  colors: string[];
  maxPriceMinor: bigint | null;
  gender: string | null;
  /** Yalnızca gösterim içindir; filtreye dönüşmez (bkz. intentToProductListQuery). */
  occasion: string | null;
  season: string | null;
}

export interface NaturalSearchResult extends ProductListResult {
  interpretation: {
    outcome: InterpretationOutcome;
    /** Yorumlama yapılmadıysa null. */
    filter: AppliedFilter | null;
  };
}

export class NaturalSearchService {
  /**
   * Bütçe anlık görüntüsü — arama sıcak yol olduğu için önbelleklenir.
   * Gerekçe: NATURAL_SEARCH.budgetSnapshotTtlMs
   */
  private budgetSnapshot: {
    at: number;
    value: { todayMicroUsd: bigint; thisMonthMicroUsd: bigint };
  } | null = null;

  constructor(
    private readonly catalog: CatalogService,
    private readonly intent: SearchIntentProvider,
    private readonly vocabulary: CatalogVocabularyPort,
    private readonly quota: SearchQuotaPort,
    private readonly usage: SearchAiUsagePort,
    private readonly logger: Logger,
  ) {}

  async search(input: NaturalSearchInput): Promise<NaturalSearchResult> {
    const interpreted = await this.interpret(input);

    if (interpreted.intent === null) {
      const result = await this.catalog.listProducts(
        fallbackProductListQuery(input.query, NATURAL_SEARCH.pageSize),
      );
      return { ...result, interpretation: { outcome: interpreted.outcome, filter: null } };
    }

    const result = await this.catalog.listProducts(
      intentToProductListQuery(interpreted.intent, NATURAL_SEARCH.pageSize),
    );

    return {
      ...result,
      interpretation: {
        outcome: 'INTERPRETED',
        filter: toAppliedFilter(interpreted.intent),
      },
    };
  }

  // ── Niyet çözümleme ──────────────────────────────────────────────────────

  /**
   * Cümleyi filtreye çevirmeyi DENER.
   *
   * Dönüşteki `intent === null`, "yorumlanamadı" demektir — hata değil.
   * Tüm kapılar burada, sağlayıcı çağrısından ÖNCE sıralanır:
   *   kısa sorgu → sağlayıcı hazır mı → KOTA → BÜTÇE → çağrı → şema → değerler
   */
  private async interpret(
    input: NaturalSearchInput,
  ): Promise<{ intent: SearchIntent | null; outcome: InterpretationOutcome }> {
    const vocabulary = await this.vocabulary.load();

    // 1. Kısa sorgu / marka adı: LLM'e HİÇ gitmez. Maliyetin en büyük kaldıracı.
    const decision = decideInterpretation(input.query, vocabulary);
    if (!decision.interpret) return { intent: null, outcome: decision.reason };

    // 2. Sağlayıcı yoksa çağrı yapılmadan düşülür — "hazırım" deyip ilk
    //    aramada patlamak yerine (bkz. stylist/index.ts aynı gerekçe).
    if (!this.intent.isConfigured) {
      return { intent: null, outcome: 'PROVIDER_NOT_CONFIGURED' };
    }

    const subject = quotaSubject(input);

    // 3. KOTA — çağrıdan önce ve atomik (Redis INCR). Sayaç okunamıyorsa da
    //    izin verilmez; kota bilinmiyorken harcamak sınırsız harcamaktır.
    if (!(await this.quota.consume(subject))) {
      return { intent: null, outcome: 'QUOTA_EXCEEDED' };
    }

    // 4. BÜTÇE — kota kullanıcıyı, bütçe şirketi korur. Kullanıcının hakkı
    //    dolmamış olsa bile platform tavanı dolduysa yapay zekâ kapanır.
    if (!(await this.withinBudget())) {
      // Çağrı YAPILMADI: hak geri verilir. (Sağlayıcı hatasında verilmez —
      //  o çağrı sağlayıcıya ulaşmış ve para harcamış olabilir.)
      await this.quota.refund(subject);
      return { intent: null, outcome: 'BUDGET_EXCEEDED' };
    }

    const call = await this.callProvider(input, vocabulary);
    if (!call.ok) return { intent: null, outcome: 'PROVIDER_ERROR' };

    // 5. ŞEKİL doğrulaması — model uydurma alan döndüremez (.strict()).
    const parsed = parseIntent(call.raw);
    if (!parsed.ok) {
      this.logger.warn(
        { issues: parsed.issues, model: this.intent.model },
        'Doğal dil arama: model şemaya uymayan çıktı üretti, anahtar kelime aramasına düşüldü',
      );
      return { intent: null, outcome: 'INVALID_OUTPUT' };
    }

    // 6. DEĞER doğrulaması — katalogda karşılığı olmayan kategori/renk elenir.
    return { intent: sanitizeIntent(parsed.draft, vocabulary), outcome: 'INTERPRETED' };
  }

  /**
   * Sağlayıcıyı çağırır ve maliyeti deftere yazar.
   *
   * ⚠️ HATA YUKARI FIRLAMAZ. `ok: false` dönmek "yorumlanamadı" demektir ve
   *    çağıran anahtar kelime aramasına düşer. Sağlayıcı kesintisi bir arama
   *    isteğini 503 yapmamalı: kullanıcının aradığı ürünler veritabanında,
   *    yerli yerinde duruyor.
   */
  private async callProvider(
    input: NaturalSearchInput,
    vocabulary: CatalogVocabulary,
  ): Promise<{ ok: true; raw: unknown } | { ok: false }> {
    const startedAt = Date.now();

    try {
      const response = await this.intent.interpret({
        query: input.query,
        vocabulary,
        ...(input.signal ? { signal: input.signal } : {}),
      });

      await this.recordUsage(input.userId, {
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        costMicroUsd: response.costMicroUsd,
        latencyMs: response.latencyMs,
        success: true,
        model: response.model,
      });

      return { ok: true, raw: response.raw };
    } catch (error) {
      // ⚠️ Başarısız çağrı da para harcamış olabilir (model üretime başlayıp
      //    zaman aşımına uğrayabilir); log yine yazılır, yoksa fatura ile
      //    panel arasındaki fark açıklanamaz.
      await this.recordUsage(input.userId, {
        inputTokens: 0,
        outputTokens: 0,
        costMicroUsd: 0n,
        latencyMs: Date.now() - startedAt,
        success: false,
        model: this.intent.model,
        errorCode: errorCodeOf(error),
      });

      this.logger.warn(
        { err: error, provider: this.intent.name },
        'Doğal dil arama: sağlayıcı yanıt vermedi, anahtar kelime aramasına düşüldü',
      );
      return { ok: false };
    }
  }

  private async recordUsage(
    userId: string | null,
    entry: {
      inputTokens: number;
      outputTokens: number;
      costMicroUsd: bigint;
      latencyMs: number;
      success: boolean;
      model: string;
      errorCode?: string;
    },
  ): Promise<void> {
    try {
      await this.usage.record({
        userId,
        provider: this.intent.name,
        model: entry.model,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        costMicroUsd: entry.costMicroUsd,
        latencyMs: entry.latencyMs,
        success: entry.success,
        ...(entry.errorCode === undefined ? {} : { errorCode: entry.errorCode }),
      });
      // Defter değişti; bir sonraki bütçe kontrolü taze okusun.
      this.budgetSnapshot = null;
    } catch (error) {
      // Maliyet defteri yazılamıyorsa bu bir alarm konusudur ama kullanıcının
      // aramasını düşürme sebebi değildir.
      this.logger.error({ err: error }, 'Doğal dil arama: AI kullanım kaydı yazılamadı');
    }
  }

  /**
   * Platform harcama tavanı kontrolü.
   *
   * ⚠️ Defter OKUNAMIYORSA `false` döner: harcamanın nerede olduğunu bilmeden
   *    para harcamak, bütçe guardrail'ini olmamış saymaktır. Kullanıcı yine
   *    sonuç alır, yalnızca cümle çözümlenmez.
   */
  private async withinBudget(): Promise<boolean> {
    try {
      const now = Date.now();
      if (
        this.budgetSnapshot === null ||
        now - this.budgetSnapshot.at > NATURAL_SEARCH.budgetSnapshotTtlMs
      ) {
        this.budgetSnapshot = { at: now, value: await this.usage.spent() };
      }

      const decision = checkBudget(aiBudgetFromEnv(env()), this.budgetSnapshot.value);
      if (!decision.allowed) {
        this.logger.error(
          { reason: decision.reason },
          'AI bütçesi doldu, doğal dil arama anahtar kelimeye düştü',
        );
        return false;
      }
      return true;
    } catch (error) {
      this.logger.error({ err: error }, 'Doğal dil arama: AI bütçesi okunamadı');
      return false;
    }
  }
}

// ── Yardımcılar ────────────────────────────────────────────────────────────

/**
 * ⚠️ Misafir IP ile sayılır. IP paylaşılabilir (kurumsal NAT, mobil operatör);
 *    bu yüzden misafir tavanı düşüktür ve dolduğunda hata değil, sade arama
 *    döner — masum bir kullanıcı komşusu yüzünden aramasız kalmaz.
 */
function quotaSubject(input: NaturalSearchInput): QuotaSubject {
  return input.userId === null
    ? { kind: 'guest', id: input.clientIp }
    : { kind: 'user', id: input.userId };
}

function errorCodeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'UNKNOWN';
}

function toAppliedFilter(intent: SearchIntent): AppliedFilter {
  return {
    keywords: intent.keywords,
    category: intent.category ?? null,
    colors: intent.colors ?? [],
    maxPriceMinor: intent.maxPriceMinor ?? null,
    gender: intent.gender ?? null,
    occasion: intent.occasion ?? null,
    season: intent.season ?? null,
  };
}
