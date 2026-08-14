import { ESTIMATED_UNIT_COST_MICRO_USD, estimateCost } from '@vt/config';

/**
 * AI MALİYET ÖLÇÜMÜ
 *
 * ⚠️ Para kuralı burada da geçerli: kayan noktalı sayı YOK. Maliyet bigint ve
 * mikro-dolar (1e-6 USD). Token fiyatları mikro-dolardan da küçük olabildiği
 * için fiyat tablosu NANO-dolar/token (1e-9 USD) tutulur ve bölme en sonda
 * yapılır — önce çarpıp sonra bölmek kuruş kaybını engeller.
 *
 * ⚠️ EN ÖNEMLİ AYRIM: sağlayıcının BİLDİRDİĞİ maliyet ile bizim TAHMİNİMİZ
 * karıştırılmaz. `TryOnSuccess.costMicroUsd` arayüzü "gerçek maliyet" diyor;
 * sağlayıcı bildirmediğinde oraya tahmin yazmak zorundayız ama tahmin
 * olduğunu ALAN ADIYLA belli ederiz (`estimatedCostMicroUsd` + `costBasis`).
 * Aksi hâlde aylık mutabakatta neyin ölçüm neyin varsayım olduğu anlaşılmaz.
 */

/** 1 mikro-dolar = 1000 nano-dolar. */
export const NANO_PER_MICRO = 1_000n;

export type CostBasis =
  /** Sağlayıcı yanıtında para birimi cinsinden maliyet bildirdi. */
  | 'PROVIDER_REPORTED'
  /** Sağlayıcı token/birim kullanımı bildirdi; parayı biz fiyat tablosundan hesapladık. */
  | 'PROVIDER_USAGE'
  /** Hiçbir sinyal yok; modele göre sabit tahmin. */
  | 'MODEL_ESTIMATE';

/**
 * Maliyet ölçüm bilgisi. Sonuç tiplerine karıştırılır (mixin).
 * `costMicroUsd` her zaman "kullanılacak değer"dir; diğer alanlar onun nereden
 * geldiğini açıklar.
 */
export interface CostMetering {
  /** Sağlayıcının parasal olarak bildirdiği maliyet. Bildirmediyse undefined. */
  reportedCostMicroUsd?: bigint;
  /** Fiyat tablosundan türetilen TAHMİN. Faturayla birebir tutmayabilir. */
  estimatedCostMicroUsd?: bigint;
  costBasis: CostBasis;
}

export interface TokenPriceNanoUsd {
  /** Nano-dolar / giriş tokenı */
  input: bigint;
  /** Nano-dolar / çıkış tokenı */
  output: bigint;
  /** Önbellekten okuma (~0,1x giriş) */
  cacheRead?: bigint;
  /** Önbelleğe yazma (~1,25x giriş) */
  cacheWrite?: bigint;
}

/**
 * Anthropic fiyatları (USD / 1M token → nano-dolar / token, çarpan 1000).
 * ⚠️ Fiyatlar değişir; `docs/ai-costs.md` ile birlikte güncel tutulmalıdır.
 * Tabloda olmayan model DEFAULT'a düşer — sessizce 0 maliyet yazmayız.
 */
export const ANTHROPIC_TOKEN_PRICES: Readonly<Record<string, TokenPriceNanoUsd>> = {
  'claude-opus-5': { input: 5_000n, output: 25_000n, cacheRead: 500n, cacheWrite: 6_250n },
  'claude-opus-4-8': { input: 5_000n, output: 25_000n, cacheRead: 500n, cacheWrite: 6_250n },
  'claude-sonnet-5': { input: 3_000n, output: 15_000n, cacheRead: 300n, cacheWrite: 3_750n },
  'claude-sonnet-4-6': { input: 3_000n, output: 15_000n, cacheRead: 300n, cacheWrite: 3_750n },
  'claude-haiku-4-5': { input: 1_000n, output: 5_000n, cacheRead: 100n, cacheWrite: 1_250n },
};

const ANTHROPIC_DEFAULT_PRICE: TokenPriceNanoUsd = {
  input: 3_000n,
  output: 15_000n,
  cacheRead: 300n,
  cacheWrite: 3_750n,
};

/**
 * Google Gemini görsel modelleri. Görsel çıktısı sabit sayıda çıkış tokenı
 * olarak faturalanır (ör. ~1290 token/görsel), o yüzden token fiyatı yeterlidir.
 */
export const GOOGLE_TOKEN_PRICES: Readonly<Record<string, TokenPriceNanoUsd>> = {
  'gemini-2.5-flash-image': { input: 300n, output: 30_000n },
  'gemini-2.0-flash-preview-image-generation': { input: 100n, output: 30_000n },
};

const GOOGLE_DEFAULT_PRICE: TokenPriceNanoUsd = { input: 300n, output: 30_000n };

/** fal.ai model başına üretim ücreti (mikro-dolar). */
export const FAL_TRYON_UNIT_COST_MICRO_USD: Readonly<Record<string, bigint>> = {
  /**
   * ⚠️ VARSAYILAN MODEL. 0,075 $ — fal'ın model sayfasında ilan edilen ücret.
   *    idm-vton'un 0,11 $'ından %32 ucuz.
   */
  'fal-ai/fashn/tryon/v1.6': 75_000n,
  /**
   * ⚠️ 60_000 YANLIŞTI, GERÇEK 110_000. Ölçüldü (14 Ağustos 2026): fal'ın
   *    model sayfası çağrı başına 0,11 $ diyor, defterimiz 0,06 $ yazıyordu.
   *    fal senkron uçta maliyet bildirmediği için bu TAHMİN doğrudan deftere
   *    giriyor — yani günlük bütçe freni (AI_DAILY_BUDGET_USD) yaklaşık %45
   *    GEÇ çalışıyordu. Tavanı aştığımızı ancak fatura gelince görürdük.
   */
  'fal-ai/idm-vton': 110_000n,
  'fal-ai/cat-vton': 40_000n,
  'fal-ai/leffa/virtual-tryon': 40_000n,
};

export interface TokenUsageCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

function toBigIntTokens(value: number | undefined): bigint {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 0n;
  return BigInt(Math.round(value));
}

/** Token sayımından mikro-dolar. Bölme EN SONDA yapılır. */
export function tokenCostMicroUsd(usage: TokenUsageCounts, price: TokenPriceNanoUsd): bigint {
  const nano =
    toBigIntTokens(usage.inputTokens) * price.input +
    toBigIntTokens(usage.outputTokens) * price.output +
    toBigIntTokens(usage.cacheReadInputTokens) * (price.cacheRead ?? price.input) +
    toBigIntTokens(usage.cacheCreationInputTokens) * (price.cacheWrite ?? price.input);

  // Aşağı yuvarlama yerine yukarı: maliyeti eksik göstermek bütçe guardrail'ini
  // sessizce delmek demektir; fazla göstermek yalnızca erken uyarı üretir.
  return (nano + NANO_PER_MICRO - 1n) / NANO_PER_MICRO;
}

export function anthropicPrice(model: string): TokenPriceNanoUsd {
  return ANTHROPIC_TOKEN_PRICES[model] ?? ANTHROPIC_DEFAULT_PRICE;
}

export function googlePrice(model: string): TokenPriceNanoUsd {
  return GOOGLE_TOKEN_PRICES[model] ?? GOOGLE_DEFAULT_PRICE;
}

/** Model bilinmiyorsa @vt/config'teki genel try-on tahminine düşer. */
export function falTryOnEstimate(model: string): bigint {
  return FAL_TRYON_UNIT_COST_MICRO_USD[model] ?? estimateCost('TRYON');
}

export function embeddingEstimate(itemCount: number): bigint {
  return ESTIMATED_UNIT_COST_MICRO_USD.EMBEDDING * BigInt(Math.max(0, itemCount));
}

/**
 * Ölçüm kaydı üretir. `reported` varsa o kullanılır; yoksa tahmin.
 * Her iki alan da sonuçta taşınır ki mutabakat "hangi satır ölçüm, hangisi
 * varsayım" sorusunu cevaplayabilsin.
 */
export function meterCost(input: {
  reportedMicroUsd?: bigint;
  estimatedMicroUsd: bigint;
  /** Tahmin token/birim kullanımından mı türedi, düz sabit mi? */
  fromUsage?: boolean;
}): CostMetering & { costMicroUsd: bigint } {
  if (input.reportedMicroUsd !== undefined) {
    return {
      costMicroUsd: input.reportedMicroUsd,
      reportedCostMicroUsd: input.reportedMicroUsd,
      estimatedCostMicroUsd: input.estimatedMicroUsd,
      costBasis: 'PROVIDER_REPORTED',
    };
  }

  return {
    costMicroUsd: input.estimatedMicroUsd,
    estimatedCostMicroUsd: input.estimatedMicroUsd,
    costBasis: input.fromUsage ? 'PROVIDER_USAGE' : 'MODEL_ESTIMATE',
  };
}

/**
 * Sağlayıcı yanıtından parasal maliyet okumayı dener.
 *
 * Sağlayıcılar bunu standart bir alanda vermiyor; aday alan adları sırayla
 * denenir. Hiçbiri yoksa `undefined` döner ve çağıran tahmine geçer —
 * "0 maliyet" YAZILMAZ, çünkü bedava sanılan bir çağrı bütçe alarmını susturur.
 */
export function readReportedCostMicroUsd(source: unknown): bigint | undefined {
  if (typeof source !== 'object' || source === null) return undefined;
  const record = source as Record<string, unknown>;

  const microCandidates = ['cost_micro_usd', 'costMicroUsd'];
  for (const key of microCandidates) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return BigInt(Math.round(value));
    }
  }

  const usdCandidates = ['cost_usd', 'costUsd', 'billable_cost_usd', 'price_usd', 'cost'];
  for (const key of usdCandidates) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      // Kayan nokta yalnızca SAĞLAYICI SINIRINDA, tek bir çarpma için kullanılır;
      // sonuç anında bigint'e sabitlenir ve bir daha float'a dönmez.
      return BigInt(Math.round(value * 1_000_000));
    }
  }

  return undefined;
}
