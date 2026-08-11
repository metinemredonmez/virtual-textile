import { env } from '@vt/config';
import type { CircuitBreaker } from '../resilience/circuit-breaker.js';
import { resilient } from '../resilience/resilient.js';
import { embeddingEstimate, meterCost, type CostMetering } from './ai-cost.js';
import { AiHttpError, readArray, readPath, requestJson } from './http.js';

/**
 * GÖMME (EMBEDDING) SAĞLAYICISI
 *
 * Kullanım: görsel benzerliği ("buna benzer ürünler") ve anlamsal arama.
 * Vektörler pgvector'a yazılır ve `SEARCH.maxVectorDistance` (kosinüs mesafesi)
 * eşiğiyle karşılaştırılır.
 *
 * ⚠️ TOPLU ÇALIŞIR. Tek tek çağrı maliyeti ~3 katına çıkarır: ücret büyük
 *    ölçüde çağrı başına sabit (HTTP turu + model yükleme) olduğu için 32
 *    ürünü 32 istekle göndermek 32 kez sabit maliyet ödemektir. Katalog
 *    zenginleştirme binlerce ürün üzerinde çalışır; fark aylık faturada
 *    üç haneli dolardır.
 */

/**
 * ⚠️ 768 BOYUT SÖZLEŞMEDİR. pgvector kolonu bu boyutla oluşturulmuştur;
 * farklı boyutta bir vektör yazmak ya INSERT'te patlar ya da (daha kötüsü)
 * indeks yanlış kurulur ve benzerlik sonuçları sessizce anlamsızlaşır.
 * Model değiştirilecekse ÖNCE migration, sonra bu sabit.
 */
export const EMBEDDING_DIMENSIONS = 768;

/** Sağlayıcının tek istekte kabul ettiği azami öğe. */
export const EMBEDDING_MAX_BATCH_SIZE = 32;

export type EmbeddingModality = 'TEXT' | 'IMAGE';

export interface EmbeddingItem {
  /** Çağıranın kimliği (productId, variantId…). Sonuçlar bununla eşlenir. */
  id: string;
  modality: EmbeddingModality;
  /** modality === 'TEXT' için. */
  text?: string;
  /** modality === 'IMAGE' için — public CDN veya imzalı URL. */
  imageUrl?: string;
}

export interface EmbeddingVector {
  id: string;
  modality: EmbeddingModality;
  /** L2 normalize edilmiş, uzunluğu tam `EMBEDDING_DIMENSIONS`. */
  vector: number[];
  dimensions: number;
}

export type EmbeddingFailureReason =
  'INVALID_INPUT' | 'DIMENSION_MISMATCH' | 'PROVIDER_ERROR' | 'RATE_LIMITED';

export interface EmbeddingFailure {
  id: string;
  reason: EmbeddingFailureReason;
  /** Loglanır, kullanıcıya gösterilmez. */
  detail?: string;
}

export interface EmbeddingBatchResult extends CostMetering {
  /** Girdi SIRASI korunur; başarısız öğeler listede YOKTUR. */
  vectors: EmbeddingVector[];
  failed: EmbeddingFailure[];
  costMicroUsd: bigint;
  model: string;
  latencyMs: number;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  readonly maxBatchSize: number;

  /**
   * ⚠️ Tek öğelik `embedOne` bilinçli olarak YOK. Arayüzde tek öğe uçları
   * açılırsa çağıranlar döngü içinde çağırır ve toplu işlemenin tüm kazancı
   * kaybolur. Tek öğe gerekiyorsa tek elemanlı dizi geçilir.
   */
  embed(items: readonly EmbeddingItem[]): Promise<EmbeddingBatchResult>;
}

/**
 * Sağlayıcı tel biçimi (wire format). SigLIP/CLIP uçları arasında gövde şeması
 * değişir; bu iki fonksiyonu değiştirmek yeni bir sağlayıcıya geçmek için
 * yeterlidir — sınıfın geri kalanı (gruplama, normalize, hata izolasyonu) aynı.
 */
export interface EmbeddingWireAdapter {
  buildBody(items: readonly EmbeddingItem[]): unknown;
  /** Girdiyle AYNI sırada; çözülemeyen öğe için `undefined`. */
  parseVectors(json: unknown, items: readonly EmbeddingItem[]): Array<number[] | undefined>;
}

export const defaultEmbeddingWire: EmbeddingWireAdapter = {
  buildBody(items) {
    return {
      inputs: items.map((item) =>
        item.modality === 'IMAGE' ? { image_url: item.imageUrl } : { text: item.text },
      ),
    };
  },

  /**
   * Yaygın üç yanıt şeması denenir. Sağlayıcı şemasını değiştirdiğinde
   * "hepsi başarısız" yerine sessizce boş dönmemek için hiçbir eşleşme
   * bulunamazsa `undefined` dizisi döner ve öğeler PROVIDER_ERROR ile
   * işaretlenir.
   */
  parseVectors(json, items) {
    const direct = readArray(json, 'embeddings');
    if (direct.length > 0) return items.map((_item, index) => toNumberArray(direct[index]));

    const data = readArray(json, 'data');
    if (data.length > 0) {
      return items.map((_item, index) => toNumberArray(readPath(data[index], 'embedding')));
    }

    const outputs = readArray(json, 'outputs');
    if (outputs.length > 0) {
      return items.map((_item, index) =>
        toNumberArray(readPath(outputs[index], 'embedding') ?? outputs[index]),
      );
    }

    return items.map(() => undefined);
  },
};

export interface FalEmbeddingConfig {
  apiKey: string;
  /** ör. 'fal-ai/siglip' — SigLIP/CLIP ailesinden 768 boyutlu bir uç. */
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  circuitBreaker?: CircuitBreaker;
  now?: () => number;
  maxBatchSize?: number;
  /** Aynı anda kaç grup gönderilsin. Hız limitine karşı bilinçli olarak düşük. */
  maxConcurrentBatches?: number;
  wire?: EmbeddingWireAdapter;
  timeoutMs?: number;
}

const FAL_BASE_URL = 'https://fal.run';
const DEFAULT_EMBEDDING_MODEL = 'fal-ai/siglip';

/**
 * fal üzerinden SigLIP gömme sağlayıcısı.
 *
 * Tasarım kararları:
 *  - Gruplar PARALEL ama SINIRLI gider (varsayılan 3). Sınırsız paralellik
 *    hız limitine çarpar ve 429 fırtınası tüm katalog işini düşürür.
 *  - Bir grup patlarsa yalnızca O GRUBUN öğeleri başarısız işaretlenir.
 *    5000 ürünlük zenginleştirmede tek bozuk görsel yüzünden 4999 vektörü
 *    çöpe atmak, işi baştan çalıştırmak ve maliyeti ikiye katlamak demektir.
 */
export class FalEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'fal-embedding';
  readonly dimensions = EMBEDDING_DIMENSIONS;
  readonly maxBatchSize: number;

  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly baseUrl: string;
  private readonly wire: EmbeddingWireAdapter;
  private readonly maxConcurrentBatches: number;

  constructor(private readonly config: FalEmbeddingConfig) {
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    this.now = config.now ?? Date.now;
    this.baseUrl = config.baseUrl ?? FAL_BASE_URL;
    this.wire = config.wire ?? defaultEmbeddingWire;
    this.maxBatchSize = Math.max(1, config.maxBatchSize ?? EMBEDDING_MAX_BATCH_SIZE);
    this.maxConcurrentBatches = Math.max(1, config.maxConcurrentBatches ?? 3);
  }

  get model(): string {
    return this.config.model ?? DEFAULT_EMBEDDING_MODEL;
  }

  async embed(items: readonly EmbeddingItem[]): Promise<EmbeddingBatchResult> {
    const startedAt = this.now();

    if (items.length === 0) {
      return this.result([], [], 0, startedAt);
    }

    // Girdi doğrulaması sağlayıcıya GİTMEDEN yapılır: boş metin/URL göndermek
    // hem para harcar hem grubun tamamını riske atar.
    const valid: EmbeddingItem[] = [];
    const failed: EmbeddingFailure[] = [];

    for (const item of items) {
      const problem = validateItem(item);
      if (problem) failed.push({ id: item.id, reason: 'INVALID_INPUT', detail: problem });
      else valid.push(item);
    }

    const batches = chunk(valid, this.maxBatchSize);
    const outcomes = await mapWithConcurrency(batches, this.maxConcurrentBatches, (batch) =>
      this.embedBatch(batch),
    );

    const vectors: EmbeddingVector[] = [];
    for (const outcome of outcomes) {
      vectors.push(...outcome.vectors);
      failed.push(...outcome.failed);
    }

    // ⚠️ Maliyet, BAŞARISIZ öğeler için de tahakkuk eder: sağlayıcı isteği
    //    işlemiştir. Yalnızca başarılıları saymak bütçeyi eksik gösterir.
    const billedItems = valid.length;

    return this.result(vectors, failed, billedItems, startedAt);
  }

  private async embedBatch(batch: EmbeddingItem[]): Promise<{
    vectors: EmbeddingVector[];
    failed: EmbeddingFailure[];
  }> {
    try {
      const { json } = await resilient<{ json: unknown }>(
        {
          provider: this.name,
          operation: 'embed',
          errorCode: 'UPSTREAM_UNAVAILABLE',
          ...(this.config.timeoutMs === undefined ? {} : { timeoutMs: this.config.timeoutMs }),
          // Gömme İDEMPOTENTTİR: aynı girdi aynı vektörü üretir, yan etkisi yok.
          // Bu yüzden burada yeniden denemek güvenli — try-on/LLM'den farklı.
          // (Anahtar `resilient()` için bir taahhüt işaretidir, ağa gitmez.)
          idempotencyKey: `embed-${this.model}-${batch[0]?.id ?? ''}-${batch.length}`,
          retryAttempts: 3,
          ...(this.config.circuitBreaker ? { circuitBreaker: this.config.circuitBreaker } : {}),
        },
        () =>
          requestJson({
            url: `${this.baseUrl}/${this.model}`,
            provider: this.name,
            fetchImpl: this.fetchImpl,
            headers: {
              Authorization: `Key ${this.config.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: this.wire.buildBody(batch),
          }),
      );

      return this.toVectors(json, batch);
    } catch (error) {
      // Grup düştü → yalnızca bu grubun öğeleri başarısız. Diğer gruplar devam eder.
      // ⚠️ `resilient` hatayı IntegrationError'a sarar; ham HTTP durumu ancak
      //    `cause` zincirinde kalır. Doğrudan `httpStatus` okumak burada her
      //    zaman 503 görür ve hız limitini gerçek kesintiden ayıramaz.
      const reason: EmbeddingFailureReason = isRateLimit(error) ? 'RATE_LIMITED' : 'PROVIDER_ERROR';
      const detail = error instanceof Error ? error.message : String(error);
      return {
        vectors: [],
        failed: batch.map((item) => ({ id: item.id, reason, detail })),
      };
    }
  }

  private toVectors(
    json: unknown,
    batch: EmbeddingItem[],
  ): { vectors: EmbeddingVector[]; failed: EmbeddingFailure[] } {
    const parsed = this.wire.parseVectors(json, batch);
    const vectors: EmbeddingVector[] = [];
    const failed: EmbeddingFailure[] = [];

    batch.forEach((item, index) => {
      const raw = parsed[index];

      if (!raw || raw.length === 0) {
        failed.push({ id: item.id, reason: 'PROVIDER_ERROR', detail: 'vektör yok' });
        return;
      }

      if (raw.length !== this.dimensions) {
        // ⚠️ Yanlış boyut ASLA yazılmaz. Sessizce kırpmak/doldurmak arama
        //    sonuçlarını fark edilmeden bozar — hata vermek her zaman ucuzdur.
        failed.push({
          id: item.id,
          reason: 'DIMENSION_MISMATCH',
          detail: `${raw.length} boyut geldi, ${this.dimensions} bekleniyordu`,
        });
        return;
      }

      vectors.push({
        id: item.id,
        modality: item.modality,
        vector: l2Normalize(raw),
        dimensions: this.dimensions,
      });
    });

    return { vectors, failed };
  }

  private result(
    vectors: EmbeddingVector[],
    failed: EmbeddingFailure[],
    billedItems: number,
    startedAt: number,
  ): EmbeddingBatchResult {
    const metering = meterCost({ estimatedMicroUsd: embeddingEstimate(billedItems) });

    return {
      vectors,
      failed,
      costMicroUsd: metering.costMicroUsd,
      model: this.model,
      latencyMs: this.now() - startedAt,
      ...(metering.reportedCostMicroUsd === undefined
        ? {}
        : { reportedCostMicroUsd: metering.reportedCostMicroUsd }),
      ...(metering.estimatedCostMicroUsd === undefined
        ? {}
        : { estimatedCostMicroUsd: metering.estimatedCostMicroUsd }),
      costBasis: metering.costBasis,
    };
  }
}

// ── Saf yardımcılar ────────────────────────────────────────────────────────

/** Hata zincirinde 429 arar (`resilient` sarmaladığı için `cause`'a bakılır). */
function isRateLimit(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth += 1) {
    if (current instanceof AiHttpError) return current.status === 429;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function validateItem(item: EmbeddingItem): string | undefined {
  if (item.id.trim() === '') return 'id boş';
  if (item.modality === 'TEXT') {
    return item.text === undefined || item.text.trim() === '' ? 'metin boş' : undefined;
  }
  return item.imageUrl === undefined || item.imageUrl.trim() === '' ? 'görsel URL boş' : undefined;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

/**
 * Sınırlı paralellik. `Promise.all` ile hepsini birden göndermek hız limitini
 * anında doldurur; sonuç dizisi girdi SIRASINI korur.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await worker(item, index);
    }
  });

  await Promise.all(runners);
  return results;
}

/**
 * L2 normalize.
 *
 * ⚠️ Neden zorunlu: pgvector'da kosinüs mesafesi eşiğimiz SABİT
 * (`SEARCH.maxVectorDistance`). Normalize edilmemiş vektörlerde aynı eşik
 * farklı ürünler için farklı anlama gelir ve "benzer ürünler" listesi
 * tutarsızlaşır. Normalize sonrası kosinüs mesafesi = 1 − iç çarpım olur ve
 * eşik her yerde aynı şeyi ifade eder.
 */
export function l2Normalize(vector: readonly number[]): number[] {
  let sumOfSquares = 0;
  for (const value of vector) sumOfSquares += value * value;

  const magnitude = Math.sqrt(sumOfSquares);
  // Sıfır vektör: normalize edilemez, olduğu gibi bırakılır (kopyalanarak).
  if (magnitude === 0 || !Number.isFinite(magnitude)) return [...vector];

  return vector.map((value) => value / magnitude);
}

function toNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const numbers: number[] = [];
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) return undefined;
    numbers.push(entry);
  }
  return numbers;
}

/** Ortamdan yapılandırılmış gömme sağlayıcısı (FAL_KEY paylaşılır). */
export function falEmbeddingProviderFromEnv(
  overrides: Partial<FalEmbeddingConfig> = {},
): FalEmbeddingProvider {
  const environment = env();
  return new FalEmbeddingProvider({
    apiKey: environment.FAL_KEY,
    ...overrides,
  });
}

// TODO(kod-gerekli): EMBEDDING_DIMENSION_MISMATCH (500, system) — boyut
// uyuşmazlığı şu an yalnızca öğe bazında `failed` listesine yazılıyor;
// katalog işinin tamamı bu yüzden sessizce eksik kalabiliyor. Kod eklenip
// eşik aşıldığında alarm üretilmeli.
// TODO(kod-gerekli): EMBEDDING_PROVIDER_ERROR (503, integration) — grup
// hataları şu an UPSTREAM_UNAVAILABLE ile raporlanıyor.
