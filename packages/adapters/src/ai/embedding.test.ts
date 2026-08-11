import { describe, expect, it, vi } from 'vitest';
import {
  EMBEDDING_DIMENSIONS,
  FalEmbeddingProvider,
  l2Normalize,
  type EmbeddingItem,
} from './embedding.js';

function vector(fill = 1): number[] {
  return new Array<number>(EMBEDDING_DIMENSIONS).fill(fill);
}

function items(count: number): EmbeddingItem[] {
  return Array.from({ length: count }, (_value, index) => ({
    id: `p${index}`,
    modality: 'TEXT' as const,
    text: `ürün ${index}`,
  }));
}

/** Her isteği yakalayan sahte fetch: gövdedeki öğe sayısı kadar vektör döner. */
function batchFetch(respond: (inputCount: number, callIndex: number) => Response): {
  impl: typeof fetch;
  batchSizes: number[];
} {
  const batchSizes: number[] = [];
  const impl = vi.fn((_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { inputs: unknown[] };
    batchSizes.push(body.inputs.length);
    return Promise.resolve(respond(body.inputs.length, batchSizes.length - 1));
  });
  return { impl: impl as unknown as typeof fetch, batchSizes };
}

function embeddingsResponse(count: number, dimensions = EMBEDDING_DIMENSIONS): Response {
  return new Response(
    JSON.stringify({
      embeddings: Array.from({ length: count }, () => new Array<number>(dimensions).fill(0.5)),
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function provider(fetchImpl: typeof fetch, maxBatchSize = 32): FalEmbeddingProvider {
  return new FalEmbeddingProvider({ apiKey: 'test-key', fetchImpl, maxBatchSize });
}

describe('toplu gömme', () => {
  it('⚠️ öğeleri gruplar — tek tek göndermek maliyeti katlar', async () => {
    const { impl, batchSizes } = batchFetch((count) => embeddingsResponse(count));

    const result = await provider(impl, 32).embed(items(70));

    // 70 öğe → 32 + 32 + 6 = 3 istek (70 istek DEĞİL)
    expect(batchSizes).toEqual([32, 32, 6]);
    expect(result.vectors).toHaveLength(70);
  });

  it('girdi sırası korunur', async () => {
    const { impl } = batchFetch((count) => embeddingsResponse(count));
    const result = await provider(impl, 4).embed(items(10));

    expect(result.vectors.map((entry) => entry.id)).toEqual(items(10).map((item) => item.id));
  });

  it('vektörler L2 normalize edilir (pgvector eşiği sabit olduğu için)', async () => {
    const { impl } = batchFetch((count) => embeddingsResponse(count));
    const result = await provider(impl).embed(items(1));

    const first = result.vectors[0];
    expect(first).toBeDefined();
    if (!first) return;

    const magnitude = Math.sqrt(first.vector.reduce((sum, value) => sum + value * value, 0));
    expect(magnitude).toBeCloseTo(1, 10);
  });

  it('⚠️ yanlış boyut YAZILMAZ, öğe başarısız işaretlenir', async () => {
    // Sessizce kırpmak/doldurmak arama sonuçlarını fark edilmeden bozar.
    const { impl } = batchFetch((count) => embeddingsResponse(count, 512));
    const result = await provider(impl).embed(items(3));

    expect(result.vectors).toHaveLength(0);
    expect(result.failed).toHaveLength(3);
    expect(result.failed[0]?.reason).toBe('DIMENSION_MISMATCH');
  });

  it('⚠️ bir grup düşerse diğerlerinin sonucu ÇÖPE ATILMAZ', async () => {
    const { impl } = batchFetch((count, callIndex) =>
      callIndex === 1
        ? new Response('upstream exploded', { status: 400 })
        : embeddingsResponse(count),
    );

    const result = await provider(impl, 4).embed(items(12));

    // 12 öğe → 3 grup; ortadaki düştü, diğer 8 vektör korundu.
    expect(result.vectors).toHaveLength(8);
    expect(result.failed).toHaveLength(4);
    expect(result.failed.every((failure) => failure.reason === 'PROVIDER_ERROR')).toBe(true);
  });

  it('geçersiz öğeler sağlayıcıya HİÇ gönderilmez', async () => {
    const { impl, batchSizes } = batchFetch((count) => embeddingsResponse(count));

    const result = await provider(impl).embed([
      { id: 'ok', modality: 'TEXT', text: 'kırmızı elbise' },
      { id: 'bos', modality: 'TEXT', text: '   ' },
      { id: 'urlsuz', modality: 'IMAGE' },
    ]);

    expect(batchSizes).toEqual([1]); // yalnızca geçerli öğe gitti
    expect(result.vectors).toHaveLength(1);
    expect(result.failed.map((failure) => failure.id)).toEqual(['bos', 'urlsuz']);
    expect(result.failed[0]?.reason).toBe('INVALID_INPUT');
  });

  it('maliyet BAŞARISIZ öğeler için de tahakkuk eder', async () => {
    const { impl } = batchFetch((count) => embeddingsResponse(count, 512));
    const result = await provider(impl).embed(items(4));

    // Sağlayıcı isteği işledi; yalnızca başarılıları saymak bütçeyi eksik gösterir.
    expect(result.costMicroUsd).toBeGreaterThan(0n);
    expect(result.costBasis).toBe('MODEL_ESTIMATE');
  });

  it('boş girdi ağa hiç çıkmaz', async () => {
    const { impl, batchSizes } = batchFetch((count) => embeddingsResponse(count));
    const result = await provider(impl).embed([]);

    expect(batchSizes).toHaveLength(0);
    expect(result.vectors).toHaveLength(0);
    expect(result.costMicroUsd).toBe(0n);
  });
});

describe('l2Normalize', () => {
  it('sıfır vektörü bölmez', () => {
    const zero = new Array<number>(4).fill(0);
    expect(l2Normalize(zero)).toEqual(zero);
  });

  it('yönü korur, uzunluğu 1 yapar', () => {
    const normalized = l2Normalize([3, 4]);
    expect(normalized[0]).toBeCloseTo(0.6, 10);
    expect(normalized[1]).toBeCloseTo(0.8, 10);
  });

  it('girdiyi mutasyona uğratmaz', () => {
    const input = vector(2);
    l2Normalize(input);
    expect(input[0]).toBe(2);
  });
});
