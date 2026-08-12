import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@vt/db';
import { AnthropicLlmProvider, circuitFor } from '@vt/adapters';
import { appError } from '@vt/contracts';
import type { PrismaService } from '../../infra/prisma.service.js';
import type { RedisService } from '../../infra/redis.service.js';
import type { Logger } from '../../common/logger.js';
import { NATURAL_SEARCH } from './natural-search.constants.js';
import {
  SEARCH_FILTER_TOOL,
  SEARCH_INTENT_SYSTEM_PROMPT,
  buildIntentUserMessage,
} from './natural-search.prompt.js';
import type {
  CatalogVocabulary,
  CatalogVocabularyPort,
  IntentRequest,
  IntentResponse,
  QuotaSubject,
  SearchAiUsageEntry,
  SearchAiUsagePort,
  SearchIntentProvider,
  SearchQuotaPort,
} from './natural-search.ports.js';

/**
 * DOĞAL DİL ARAMASININ ADAPTÖRLERİ
 *
 * Sağlayıcıya, Redis'e ve Prisma'ya dokunan TEK dosya budur; servis kodu
 * yalnızca `natural-search.ports.ts` içindeki arayüzleri bilir.
 */

// ── 1. Niyet çözümleyici: Anthropic ────────────────────────────────────────

/**
 * ⚠️ ARAÇ ÇAĞRISI ZORLANIR (`toolChoice`). Serbest metin isteyip JSON ayıklamak
 *    yerine araç şeması kullanılıyor: sağlayıcı çıktıyı şemaya göre üretir,
 *    `additionalProperties: false` sunucu tarafında da uygulanır ve "işte
 *    filtreniz:" gibi bir önsöz ayıklama derdi hiç doğmaz.
 */
export class AnthropicSearchIntentProvider implements SearchIntentProvider {
  readonly name: string;
  readonly model: string;
  readonly isConfigured = true;

  constructor(private readonly upstream: AnthropicLlmProvider) {
    this.name = upstream.name;
    this.model = upstream.model;
  }

  async interpret(request: IntentRequest): Promise<IntentResponse> {
    const response = await this.upstream.complete({
      // ⚠️ Sistem istemi SABİT → sağlayıcı önek önbelleği tutabilir.
      //    Değişken olan söz varlığı kullanıcı mesajındadır.
      system: SEARCH_INTENT_SYSTEM_PROMPT,
      cacheSystemPrompt: true,
      messages: [
        { role: 'user', content: buildIntentUserMessage(request.query, request.vocabulary) },
      ],
      tools: [SEARCH_FILTER_TOOL],
      toolChoice: { name: SEARCH_FILTER_TOOL.name },
      maxOutputTokens: NATURAL_SEARCH.maxOutputTokens,
      // Niyet çıkarımı sınıflandırma işidir, muhakeme değil.
      effort: 'low',
      /**
       * ⚠️ IDEMPOTENCY ANAHTARI BİLİNÇLİ OLARAK VERİLİYOR: `resilient()`
       *    anahtar yoksa retry'ı KAPATIR (bkz. resilient.ts). Bu çağrının
       *    tekrarlanması güvenlidir — hiçbir yan etkisi yoktur, yalnızca metin
       *    okur ve filtre üretir. Anahtar girdinin ÖZETİDİR: aynı cümle +
       *    aynı söz varlığı + aynı model → aynı anahtar, dolayısıyla tekrar
       *    denemede sağlayıcıya aynı istek gider.
       */
      idempotencyKey: intentIdempotencyKey(request, this.model),
      ...(request.signal ? { signal: request.signal } : {}),
    });

    const call = response.toolCalls[0];
    if (!call) {
      // Araç zorlandığı hâlde çağrılmadıysa sözleşme çiğnenmiştir. Servis bunu
      // yakalar ve anahtar kelime aramasına düşer; kullanıcı hata görmez.
      throw appError('STYLIST_UNAVAILABLE', {
        internalMessage: `Arama niyeti modeli araç çağırmadı (stopReason=${response.stopReason})`,
      });
    }

    return {
      raw: call.input,
      usage: {
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
      },
      // ⚠️ İkinci bir fiyat tablosu tutulmaz; maliyet sağlayıcıdan gelir.
      costMicroUsd: response.costMicroUsd,
      latencyMs: response.latencyMs,
      model: response.model,
    };
  }
}

function intentIdempotencyKey(request: IntentRequest, model: string): string {
  return createHash('sha256')
    .update(
      [
        model,
        request.query,
        request.vocabulary.categorySlugs.join(','),
        request.vocabulary.colors.join(','),
      ].join('|'),
    )
    .digest('hex');
}

/**
 * ANAHTARSIZ YOL.
 *
 * ⚠️ `isConfigured = false` olduğu için servis bu sınıfa HİÇ çağrı yapmaz;
 *    doğal dilde arama sessizce anahtar kelime aramasına düşer. Anahtar
 *    olmadan uygulama açılır, katalog ve ticaret akışı hiç etkilenmez.
 */
export class UnavailableSearchIntentProvider implements SearchIntentProvider {
  readonly name = 'unavailable';
  readonly model = 'none';
  readonly isConfigured = false;

  interpret(_request: IntentRequest): Promise<IntentResponse> {
    return Promise.reject(
      appError('STYLIST_UNAVAILABLE', {
        internalMessage: 'Arama niyeti sağlayıcısı yapılandırılmadı: ANTHROPIC_API_KEY yok',
      }),
    );
  }
}

export function createSearchIntentProvider(config: {
  apiKey: string;
  model: string;
}): SearchIntentProvider {
  if (config.apiKey === '') return new UnavailableSearchIntentProvider();

  return new AnthropicSearchIntentProvider(
    new AnthropicLlmProvider({
      apiKey: config.apiKey,
      model: config.model,
      // ⚠️ Devre kesici sağlayıcı ADIYLA paylaşılır: stil danışmanı Anthropic'i
      //    düşürdüyse arama da ısrar etmesin, doğrudan anahtar kelimeye düşsün.
      circuitBreaker: circuitFor('anthropic'),
    }),
  );
}

// ── 2. Katalog söz varlığı ─────────────────────────────────────────────────

/**
 * Kategori adresleri, renkler ve markalar — hem isteme konur hem de dönüşte
 * doğrulama için kullanılır.
 *
 * ⚠️ ÖNBELLEK SÜREÇ İÇİDİR, Redis'te değil. Liste küçüktür, her sürecin kendi
 *    kopyasını tutması ağ gidiş-gelişinden ucuzdur ve Redis kesintisi aramayı
 *    etkilemez. Bedeli: süreçler arası birkaç dakikalık tutarsızlık —
 *    bir kategori adının geç görünmesinden başka sonucu yok.
 */
export class PrismaCatalogVocabularyAdapter implements CatalogVocabularyPort {
  private cache: { at: number; value: CatalogVocabulary } | null = null;
  /** Soğuk önbellekte eşzamanlı istekler tek sorguyu paylaşsın. */
  private inFlight: Promise<CatalogVocabulary> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: Logger,
  ) {}

  async load(): Promise<CatalogVocabulary> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < NATURAL_SEARCH.vocabularyTtlMs) {
      return this.cache.value;
    }

    this.inFlight ??= this.query()
      .then((value) => {
        this.cache = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        this.inFlight = null;
      });

    try {
      return await this.inFlight;
    } catch (error) {
      // ⚠️ Söz varlığı okunamazsa arama DURMAZ: boş liste ile devam edilir.
      //    Boş liste, `sanitizeIntent` içinde tüm kategori ve renkleri eler —
      //    yani filtre yalnızca anahtar kelime ve fiyattan ibaret kalır.
      //    Dar ve yanlış bir filtre yerine geniş ve doğru bir sonuç.
      this.logger.error({ err: error }, 'Doğal dil arama: katalog söz varlığı okunamadı');
      return { categorySlugs: [], colors: [], brands: [] };
    }
  }

  private async query(): Promise<CatalogVocabulary> {
    const limits = NATURAL_SEARCH.vocabularyLimits;

    const [categories, colors, brands] = await Promise.all([
      this.prisma.category.findMany({
        where: { isActive: true },
        select: { slug: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        take: limits.categories,
      }),
      // Renk ve marka listeleri ÜRÜN SAYISINA göre sıralanır: liste kesiliyorsa
      // katalogda gerçekten var olan baskın değerler kalsın, kuyruktakiler değil.
      this.prisma.$queryRaw<Array<{ value: string }>>(Prisma.sql`
        SELECT v."color" AS value, COUNT(DISTINCT p.id) AS product_count
        FROM catalog_variants v
        JOIN catalog_products p ON p.id = v."productId"
        WHERE v."isActive" AND p."status" = 'PUBLISHED'
        GROUP BY v."color"
        ORDER BY product_count DESC
        LIMIT ${limits.colors}`),
      this.prisma.$queryRaw<Array<{ value: string }>>(Prisma.sql`
        SELECT p."brandName" AS value, COUNT(*) AS product_count
        FROM catalog_products p
        WHERE p."status" = 'PUBLISHED'
        GROUP BY p."brandName"
        ORDER BY product_count DESC
        LIMIT ${limits.brands}`),
    ]);

    return {
      categorySlugs: categories.map((category) => category.slug),
      colors: colors.map((row) => row.value),
      brands: brands.map((row) => row.value),
    };
  }
}

// ── 3. Kota ────────────────────────────────────────────────────────────────

/**
 * Günlük kota sayacı.
 *
 * ⚠️ YARIŞ DURUMU: "önce oku, sonra yaz" aynı anda gelen beş istekte beşine de
 *    izin verir. Redis INCR atomiktir; önce artırılır, sonra bakılır.
 *
 * ⚠️ Sayaç Redis'tedir, veritabanında değil: bu bir MALİYET FRENİ, muhasebe
 *    kaydı değil. Redis silinirse kota sıfırlanır — kabul edilebilir; gerçek
 *    harcama `ai_usage_logs` tablosunda durur ve bütçe guardrail'i onu okur.
 */
export class RedisSearchQuotaAdapter implements SearchQuotaPort {
  constructor(
    private readonly redis: RedisService,
    private readonly logger: Logger,
  ) {}

  async consume(subject: QuotaSubject): Promise<boolean> {
    const limit =
      subject.kind === 'user' ? NATURAL_SEARCH.dailyPerUser : NATURAL_SEARCH.dailyPerGuest;
    const key = quotaKey(subject);

    try {
      const used = await this.redis.incr(key);
      if (used === 1) {
        // İlk artıştan sonra TTL: anahtar sonsuza kadar kalmasın.
        await this.redis.expire(key, secondsUntilMidnight());
      }
      return used <= limit;
    } catch (error) {
      // ⚠️ Redis yoksa kota bilinemez. Açık bırakmak sınırsız LLM harcaması
      //    demek; kapatmak yalnızca aramayı sadeleştirir. Ticaret akışı
      //    etkilenmediği için kapatmayı seçiyoruz.
      this.logger.error(
        { err: error },
        'Doğal dil arama: kota sayacı okunamadı, yorumlama kapatıldı',
      );
      return false;
    }
  }

  async refund(subject: QuotaSubject): Promise<void> {
    try {
      await this.redis.decr(quotaKey(subject));
    } catch {
      // İade edilemezse kullanıcı bir hak kaybeder; aramayı düşürmeye değmez.
    }
  }
}

function quotaKey(subject: QuotaSubject): string {
  const today = new Date().toISOString().slice(0, 10);
  return `search:nl:quota:${subject.kind}:${subject.id}:${today}`;
}

function secondsUntilMidnight(): number {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return Math.max(60, Math.ceil((midnight.getTime() - now.getTime()) / 1000));
}

// ── 4. AI maliyet defteri ──────────────────────────────────────────────────

/**
 * ⚠️ ŞEMA BAĞIMLILIĞI: `AiFeature` enum'unda `SEARCH_NL` değeri HENÜZ YOK.
 *
 * Kayıt bilinçli olarak ham SQL ile yazılıyor — Prisma'nın ürettiği TypeScript
 * enum'u olmayan bir değeri kabul etmez ve derleme kırılırdı. Ham SQL bugün
 * DERLENİR, migration uygulandığı an da ÇALIŞIR; tek satır kod değişmez.
 *
 * Migration uygulanana kadar INSERT bir kez denenir, başarısız olur ve adaptör
 * kalıcı olarak "yapısal log" moduna geçer: maliyet kaybolmaz, `ai_usage_logs`
 * yerine log akışına yazılır. Her aramada hata loglamamak için uyarı YALNIZCA
 * BİR KEZ basılır — aksi hâlde asıl uyarı gürültüde kaybolurdu.
 *
 * Gereken migration (bu ajan YAZMADI, uygulamadı — raporda gerekçesiyle var):
 *   ALTER TYPE "AiFeature" ADD VALUE IF NOT EXISTS 'SEARCH_NL';
 * ve `schema.prisma` içindeki `enum AiFeature` bloğuna aynı değer.
 *
 * ⚠️ Neden mevcut bir değere (ör. STYLIST) yazılmıyor: maliyet paneli
 *    özellik bazlı okunuyor. Aramanın harcaması danışmana yazılsaydı,
 *    "danışman pahalılaştı" diye bakılan yerde hiçbir şey bulunamazdı.
 */
export class PrismaSearchAiUsageAdapter implements SearchAiUsagePort {
  private ledgerUnavailable = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: Logger,
  ) {}

  async record(entry: SearchAiUsageEntry): Promise<void> {
    if (!this.ledgerUnavailable) {
      try {
        await this.prisma.$executeRaw(Prisma.sql`
          INSERT INTO ai_usage_logs
            (id, "userId", feature, provider, model, "inputTokens", "outputTokens",
             "costMicroUsd", "latencyMs", success, "errorCode")
          VALUES (
            ${randomUUID()}, ${entry.userId}, 'SEARCH_NL'::"AiFeature", ${entry.provider},
            ${entry.model}, ${entry.inputTokens}, ${entry.outputTokens},
            ${entry.costMicroUsd}, ${entry.latencyMs}, ${entry.success},
            ${entry.errorCode ?? null})`);
        return;
      } catch (error) {
        this.ledgerUnavailable = true;
        this.logger.error(
          { err: error },
          'ai_usage_logs yazılamadı (AiFeature.SEARCH_NL migration bekliyor). ' +
            'Doğal dil arama maliyeti bundan sonra yalnızca log akışına yazılacak.',
        );
      }
    }

    // ⚠️ bigint log'a string olarak yazılır: JSON serileştirmesi bigint taşımaz.
    this.logger.info(
      {
        ledger: 'ai_usage_pending',
        feature: 'SEARCH_NL',
        userId: entry.userId,
        provider: entry.provider,
        model: entry.model,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        costMicroUsd: entry.costMicroUsd.toString(),
        latencyMs: entry.latencyMs,
        success: entry.success,
      },
      'Doğal dil arama AI maliyeti',
    );
  }

  /**
   * ⚠️ Bütün özelliklerin toplamını okur, yalnızca aramanınkini değil:
   *    `checkBudget` PLATFORM tavanını denetler. Bu yüzden `SEARCH_NL`
   *    değeri henüz olmasa da bu sorgu bugün doğru çalışır.
   */
  async spent(): Promise<{ todayMicroUsd: bigint; thisMonthMicroUsd: bigint }> {
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [today, month] = await Promise.all([
      this.prisma.aiUsageLog.aggregate({
        where: { createdAt: { gte: dayStart } },
        _sum: { costMicroUsd: true },
      }),
      this.prisma.aiUsageLog.aggregate({
        where: { createdAt: { gte: monthStart } },
        _sum: { costMicroUsd: true },
      }),
    ]);

    return {
      todayMicroUsd: today._sum.costMicroUsd ?? 0n,
      thisMonthMicroUsd: month._sum.costMicroUsd ?? 0n,
    };
  }
}
