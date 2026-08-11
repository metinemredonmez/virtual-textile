import { describe, expect, it, vi } from 'vitest';
import { photoContentHash, tryOnCacheKey, TRYON_PROMPT_VERSION } from './cache-key.js';
import {
  generateWithFallback,
  type isPermanentFailure,
  type TryOnProvider,
  type TryOnRequest,
  type TryOnResult,
} from './tryon.provider.js';

const request: TryOnRequest = {
  personImageUrl: 'https://signed/person',
  garmentImageUrl: 'https://signed/garment',
  category: 'UPPER_BODY',
  mode: 'FAST',
  idempotencyKey: 'k1',
};

function provider(name: string, results: TryOnResult[]): TryOnProvider {
  const queue = [...results];
  return {
    name,
    supportedCategories: ['UPPER_BODY', 'LOWER_BODY', 'DRESS', 'OUTERWEAR'],
    generate: vi.fn(() => Promise.resolve(queue.shift()!)),
  };
}

const success = (cost = 60_000n): TryOnResult => ({
  status: 'SUCCEEDED',
  image: Buffer.from('img'),
  contentType: 'image/webp',
  visualConfidence: 88,
  costMicroUsd: cost,
  latencyMs: 8000,
  model: 'test',
});

const failure = (reason: Parameters<typeof isPermanentFailure>[0], cost = 0n): TryOnResult => ({
  status: 'FAILED',
  reason,
  costMicroUsd: cost,
  latencyMs: 500,
});

describe('önbellek anahtarı', () => {
  it('aynı girdi aynı anahtarı üretir — ikinci üretim yapılmaz', () => {
    const input = { photoContentHash: 'abc', variantId: 'v1', mode: 'FAST' } as const;
    expect(tryOnCacheKey(input)).toBe(tryOnCacheKey(input));
  });

  it('renk/beden değişince anahtar değişir', () => {
    expect(tryOnCacheKey({ photoContentHash: 'abc', variantId: 'v1', mode: 'FAST' })).not.toBe(
      tryOnCacheKey({ photoContentHash: 'abc', variantId: 'v2', mode: 'FAST' }),
    );
  });

  it('kalite modu değişince anahtar değişir', () => {
    expect(tryOnCacheKey({ photoContentHash: 'abc', variantId: 'v1', mode: 'FAST' })).not.toBe(
      tryOnCacheKey({ photoContentHash: 'abc', variantId: 'v1', mode: 'QUALITY' }),
    );
  });

  it('pipeline sürümü artınca eski sonuçlar geçersizleşir', () => {
    const now = tryOnCacheKey({ photoContentHash: 'abc', variantId: 'v1', mode: 'FAST' });
    const next = tryOnCacheKey({
      photoContentHash: 'abc',
      variantId: 'v1',
      mode: 'FAST',
      promptVersion: TRYON_PROMPT_VERSION + 1,
    });
    expect(now).not.toBe(next);
  });

  it('anahtar dosya adına değil İÇERİĞE dayanır', () => {
    const bytes = Buffer.from('aynı fotoğraf');
    expect(photoContentHash(bytes)).toBe(photoContentHash(Buffer.from('aynı fotoğraf')));
    expect(photoContentHash(bytes)).not.toBe(photoContentHash(Buffer.from('başka fotoğraf')));
  });
});

describe('fallback zinciri', () => {
  it('birincil başarılıysa yedeğe gitmez', async () => {
    const primary = provider('fal', [success()]);
    const backup = provider('gemini', [success()]);

    const chain = await generateWithFallback([primary, backup], request);

    expect(chain.result.status).toBe('SUCCEEDED');
    expect(chain.attempted).toHaveLength(1);
    expect(backup.generate).not.toHaveBeenCalled();
  });

  it('geçici hatada yedeğe düşer', async () => {
    const primary = provider('fal', [failure('PROVIDER_ERROR')]);
    const backup = provider('gemini', [success()]);

    const chain = await generateWithFallback([primary, backup], request);

    expect(chain.result.status).toBe('SUCCEEDED');
    expect(chain.attempted.map((a) => a.provider)).toEqual(['fal', 'gemini']);
  });

  it('⚠️ kalıcı hatada zinciri KESER — boşuna para yakmaz', async () => {
    const primary = provider('fal', [failure('CONTENT_BLOCKED')]);
    const backup = provider('gemini', [success()]);

    const chain = await generateWithFallback([primary, backup], request);

    expect(chain.result.status).toBe('FAILED');
    expect(backup.generate).not.toHaveBeenCalled();
  });

  it('fotoğrafta kişi yoksa başka sağlayıcı denemez', async () => {
    const primary = provider('fal', [failure('NO_PERSON_DETECTED')]);
    const backup = provider('gemini', [success()]);

    await generateWithFallback([primary, backup], request);

    expect(backup.generate).not.toHaveBeenCalled();
  });

  it('başarısız çağrıların maliyetini de toplar', async () => {
    const primary = provider('fal', [failure('PROVIDER_ERROR', 15_000n)]);
    const backup = provider('gemini', [success(60_000n)]);

    const chain = await generateWithFallback([primary, backup], request);

    // Başarısız çağrı da para harcadı; fatura açıklanabilir olmalı.
    expect(chain.totalCostMicroUsd).toBe(75_000n);
  });

  it('kategoriyi desteklemeyen sağlayıcıyı atlar', async () => {
    const limited: TryOnProvider = {
      name: 'sadece-ust',
      supportedCategories: ['UPPER_BODY'],
      generate: vi.fn(),
    };
    const backup = provider('gemini', [success()]);

    await generateWithFallback([limited, backup], { ...request, category: 'DRESS' });

    expect(limited.generate).not.toHaveBeenCalled();
    expect(backup.generate).toHaveBeenCalled();
  });
});
