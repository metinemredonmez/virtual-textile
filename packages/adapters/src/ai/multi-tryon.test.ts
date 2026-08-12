import { describe, expect, it, vi } from 'vitest';
import { multiTryOnCacheKey, tryOnCacheKey, TRYON_PROMPT_VERSION } from './cache-key.js';
import {
  composeOutfit,
  isProducibleCategory,
  MAX_OUTFIT_PIECES,
  orderOutfitPieces,
  outfitStepKeys,
  planOutfitComposition,
  type IntermediateImagePublisher,
  type OrderedOutfitPiece,
  type OutfitComposeStep,
  type OutfitPieceLike,
} from './multi-tryon.js';
import type { TryOnProvider, TryOnResult } from './tryon.provider.js';

/**
 * ÇOKLU ÜRÜN DENEME — üç güvence sınanır:
 *   1. Katman sırası SABİT tablodan gelir, çağıranın sırasından değil.
 *   2. Önbellek anahtarı sıralı ve önek yapısındadır; tek ürün anahtarı BOZULMAZ.
 *   3. Bir parça değişince yalnızca ilgili katman (ve üstü) yeniden üretilir.
 */

const PANTOLON = { variantId: 'v-pantolon', category: 'LOWER_BODY' } as const;
const GOMLEK = { variantId: 'v-gomlek', category: 'UPPER_BODY' } as const;
const CEKET = { variantId: 'v-ceket', category: 'OUTERWEAR' } as const;
const ELBISE = { variantId: 'v-elbise', category: 'DRESS' } as const;

function ids<T extends OutfitPieceLike>(pieces: readonly OrderedOutfitPiece<T>[]): string[] {
  return pieces.map((piece) => piece.variantId);
}

function orderedOrThrow<T extends OutfitPieceLike>(
  pieces: readonly T[],
): readonly OrderedOutfitPiece<T>[] {
  const result = orderOutfitPieces(pieces);
  if (!result.ok) throw new Error(`beklenmedik sıralama hatası: ${result.reason}`);
  return result.pieces;
}

describe('katman sırası', () => {
  it('çağıranın gönderdiği sırayı DEĞİL sabit tabloyu kullanır', () => {
    // İstemci ceketi ilk göndermiş; ceket yine de en üstte kalmalı.
    const result = orderOutfitPieces([CEKET, PANTOLON, GOMLEK]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ids(result.pieces)).toEqual(['v-pantolon', 'v-gomlek', 'v-ceket']);
  });

  it('⚠️ ceket gömleğin ALTINDA kalmaz — dış giyim üst giyimden sonra giydirilir', () => {
    const pieces = orderedOrThrow([CEKET, GOMLEK]);

    const gomlek = pieces.find((piece) => piece.variantId === 'v-gomlek');
    const ceket = pieces.find((piece) => piece.variantId === 'v-ceket');

    expect(gomlek?.layerIndex).toBeLessThan(ceket?.layerIndex ?? -1);
  });

  it('alt giyim → üst giyim → dış giyim sırası her girdi permütasyonunda aynıdır', () => {
    const expected = ['v-pantolon', 'v-gomlek', 'v-ceket'];

    expect(ids(orderedOrThrow([PANTOLON, GOMLEK, CEKET]))).toEqual(expected);
    expect(ids(orderedOrThrow([GOMLEK, CEKET, PANTOLON]))).toEqual(expected);
    expect(ids(orderedOrThrow([CEKET, GOMLEK, PANTOLON]))).toEqual(expected);
  });

  it('layerIndex 0’dan başlar ve boşluksuz artar', () => {
    expect(orderedOrThrow([CEKET, PANTOLON, GOMLEK]).map((piece) => piece.layerIndex)).toEqual([
      0, 1, 2,
    ]);
  });

  it('elbise + pantolon reddedilir — aynı bölgeyi iki parça kaplayamaz', () => {
    const result = orderOutfitPieces([ELBISE, PANTOLON]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('LAYER_CONFLICT');
  });

  it('elbise + gömlek reddedilir — elbise üst bölgeyi de tutar', () => {
    const result = orderOutfitPieces([ELBISE, GOMLEK]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('LAYER_CONFLICT');
  });

  it('iki üst giyim reddedilir — ikincisi birincinin ÜRETİMİNİ çöpe atardı', () => {
    const result = orderOutfitPieces([GOMLEK, { variantId: 'v-tisort', category: 'UPPER_BODY' }]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('LAYER_CONFLICT');
  });

  it('aynı varyant iki kez gönderilirse reddedilir', () => {
    const result = orderOutfitPieces([GOMLEK, { ...GOMLEK }]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('DUPLICATE_VARIANT');
  });

  it('tek parça kombin değildir — tek ürün boru hattı daha ucuzdur', () => {
    const result = orderOutfitPieces([GOMLEK]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('TOO_FEW_PIECES');
  });

  it(`${MAX_OUTFIT_PIECES} parçadan fazlası reddedilir — her parça ayrı bir çağrıdır`, () => {
    const many = Array.from({ length: MAX_OUTFIT_PIECES + 1 }, (_, index) => ({
      variantId: `v-${index}`,
      category: 'ACCESSORY' as const,
    }));

    const result = orderOutfitPieces(many);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('TOO_MANY_PIECES');
  });

  it('aynı katmandaki parçalar (aksesuar) kararlı sırada dizilir — anahtar kaymasın', () => {
    const a = { variantId: 'v-sapka', category: 'ACCESSORY' as const };
    const b = { variantId: 'v-canta', category: 'ACCESSORY' as const };

    expect(ids(orderedOrThrow([a, b]))).toEqual(ids(orderedOrThrow([b, a])));
  });

  it('aksesuar bugün üretilemez — katalog ve sağlayıcı desteği yok', () => {
    expect(isProducibleCategory('ACCESSORY')).toBe(false);
    expect(isProducibleCategory('OUTERWEAR')).toBe(true);
  });
});

describe('çoklu kombin önbellek anahtarı', () => {
  const base = { photoContentHash: 'hash-1', mode: 'FAST' } as const;

  it('⚠️ TEK ÜRÜN ANAHTARI BOZULMADI — mevcut önbellek geçersizleşmemeli', () => {
    // Bu vektör apps/api tarafındaki cache-key.test.ts ile aynı sözleşmedir.
    expect(
      tryOnCacheKey({ photoContentHash: 'hash-1', variantId: 'variant-1', mode: 'FAST' }),
    ).toBe('146f06596474957ecfa5dcf785e2004d65355cae8d7d32a461a4ecd44e727eb1');
  });

  it('parça SIRASI anahtarı etkiler — farklı sıra farklı görseldir', () => {
    expect(multiTryOnCacheKey({ ...base, orderedVariantIds: ['a', 'b'] })).not.toBe(
      multiTryOnCacheKey({ ...base, orderedVariantIds: ['b', 'a'] }),
    );
  });

  it('aynı sıralı liste her zaman aynı anahtarı verir', () => {
    expect(multiTryOnCacheKey({ ...base, orderedVariantIds: ['a', 'b', 'c'] })).toBe(
      multiTryOnCacheKey({ ...base, orderedVariantIds: ['a', 'b', 'c'] }),
    );
  });

  it('tek parçalı kombin anahtarı, tek ürün anahtarından FARKLIDIR', () => {
    // Besteleme boru hattı farklı bir görsel üretir; sonuçlar birbirinin
    // yerine geçemez.
    expect(multiTryOnCacheKey({ ...base, orderedVariantIds: ['variant-1'] })).not.toBe(
      tryOnCacheKey({ photoContentHash: 'hash-1', variantId: 'variant-1', mode: 'FAST' }),
    );
  });

  it('ayırıcı karakter kimliğin içine sızsa bile anahtarlar çakışmaz', () => {
    expect(multiTryOnCacheKey({ ...base, orderedVariantIds: ['a', 'b|c'] })).not.toBe(
      multiTryOnCacheKey({ ...base, orderedVariantIds: ['a|b', 'c'] }),
    );
  });

  it('mode farkı farklı anahtar üretir', () => {
    expect(multiTryOnCacheKey({ ...base, orderedVariantIds: ['a', 'b'] })).not.toBe(
      multiTryOnCacheKey({ ...base, orderedVariantIds: ['a', 'b'], mode: 'QUALITY' }),
    );
  });

  it('fotoğraf değişince anahtar değişir', () => {
    expect(multiTryOnCacheKey({ ...base, orderedVariantIds: ['a', 'b'] })).not.toBe(
      multiTryOnCacheKey({ ...base, photoContentHash: 'hash-2', orderedVariantIds: ['a', 'b'] }),
    );
  });

  it('promptVersion artınca eski kombinler geçersizleşir', () => {
    expect(multiTryOnCacheKey({ ...base, orderedVariantIds: ['a', 'b'] })).not.toBe(
      multiTryOnCacheKey({
        ...base,
        orderedVariantIds: ['a', 'b'],
        promptVersion: TRYON_PROMPT_VERSION + 1,
      }),
    );
  });

  it('composeVersion artınca eski kombinler geçersizleşir', () => {
    expect(multiTryOnCacheKey({ ...base, orderedVariantIds: ['a', 'b'] })).not.toBe(
      multiTryOnCacheKey({ ...base, orderedVariantIds: ['a', 'b'], composeVersion: 2 }),
    );
  });

  it('adım anahtarları ÖNEK yapısındadır — i. anahtar ilk i+1 parçayı temsil eder', () => {
    const keys = outfitStepKeys({ ...base, orderedVariantIds: ['a', 'b', 'c'] });

    expect(keys).toHaveLength(3);
    expect(keys[0]).toBe(multiTryOnCacheKey({ ...base, orderedVariantIds: ['a'] }));
    expect(keys[1]).toBe(multiTryOnCacheKey({ ...base, orderedVariantIds: ['a', 'b'] }));
    expect(keys[2]).toBe(multiTryOnCacheKey({ ...base, orderedVariantIds: ['a', 'b', 'c'] }));
  });

  it('son parça değişince ÖNEK anahtarları aynı kalır — yeniden üretimi engelleyen budur', () => {
    const once = outfitStepKeys({ ...base, orderedVariantIds: ['a', 'b', 'c'] });
    const swapped = outfitStepKeys({ ...base, orderedVariantIds: ['a', 'b', 'd'] });

    expect(swapped.slice(0, 2)).toEqual(once.slice(0, 2));
    expect(swapped[2]).not.toBe(once[2]);
  });
});

describe('parça bazlı yeniden üretim planı', () => {
  const pieces = orderedOrThrow([PANTOLON, GOMLEK, CEKET]);
  const keys = outfitStepKeys({
    photoContentHash: 'hash-1',
    orderedVariantIds: pieces.map((piece) => piece.variantId),
    mode: 'FAST',
  });

  const plan = (ready: readonly string[]) =>
    planOutfitComposition({ pieces, keys, hasResult: (key) => ready.includes(key) });

  it('hiçbir önek hazır değilse tüm katmanlar üretilir', () => {
    const result = plan([]);

    expect(result.reusedCount).toBe(0);
    expect(result.baseKey).toBeNull();
    expect(result.steps.map((step) => step.piece.variantId)).toEqual([
      'v-pantolon',
      'v-gomlek',
      'v-ceket',
    ]);
  });

  it('⚠️ EN ÜSTTEKİ parça değişince YALNIZCA o katman üretilir', () => {
    // Pantolon + gömlek öneki hazır; ceket yeni. 3 üretim yerine 1 üretim.
    const result = plan([keys[0]!, keys[1]!]);

    expect(result.reusedCount).toBe(2);
    expect(result.baseKey).toBe(keys[1]);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.piece.variantId).toBe('v-ceket');
  });

  it('ara katman değişince o katman VE ÜSTÜ üretilir — üsttekiler eskisinin üstüne çizilmişti', () => {
    // Yalnızca pantolon öneki hazır: gömlek ve ceket yeniden.
    const result = plan([keys[0]!]);

    expect(result.reusedCount).toBe(1);
    expect(result.baseKey).toBe(keys[0]);
    expect(result.steps.map((step) => step.piece.variantId)).toEqual(['v-gomlek', 'v-ceket']);
  });

  it('en alttaki parça değişince zincirin tamamı üretilir', () => {
    // Önek anahtarlarının hiçbiri tutmaz: taban kullanıcının ham fotoğrafıdır.
    const result = plan(['baska-bir-kombinin-anahtari']);

    expect(result.reusedCount).toBe(0);
    expect(result.steps).toHaveLength(3);
  });

  it('kombinin tamamı hazırsa hiç üretim yapılmaz', () => {
    const result = plan(keys);

    expect(result.reusedCount).toBe(3);
    expect(result.baseKey).toBe(keys[2]);
    expect(result.steps).toHaveLength(0);
  });

  it('en derin hazır önek seçilir — ara kayıtlar eksik olsa bile', () => {
    // Yalnızca iki parçalık önek hazır (ilk adımın kaydı silinmiş olabilir);
    // önek anahtarı kendinden öncekileri zaten taşır.
    const result = plan([keys[1]!]);

    expect(result.reusedCount).toBe(2);
    expect(result.steps).toHaveLength(1);
  });

  it('anahtar sayısı parça sayısıyla uyuşmazsa sessizce yanlış katman üretmez', () => {
    expect(() =>
      planOutfitComposition({ pieces, keys: keys.slice(0, 2), hasResult: () => false }),
    ).toThrowError();
  });
});

// ── Besteleme ───────────────────────────────────────────────────────────────

const success = (marker: string, cost = 60_000n): TryOnResult => ({
  status: 'SUCCEEDED',
  image: Buffer.from(marker),
  contentType: 'image/webp',
  visualConfidence: 88,
  costMicroUsd: cost,
  latencyMs: 8000,
  model: 'test',
});

const failure = (
  reason: 'PROVIDER_ERROR' | 'CONTENT_BLOCKED' | 'TIMEOUT',
  cost = 0n,
): TryOnResult => ({ status: 'FAILED', reason, costMicroUsd: cost, latencyMs: 400 });

function provider(name: string, results: TryOnResult[]): TryOnProvider {
  const queue = [...results];
  return {
    name,
    supportedCategories: ['UPPER_BODY', 'LOWER_BODY', 'DRESS', 'OUTERWEAR'],
    generate: vi.fn(() => Promise.resolve(queue.shift()!)),
  };
}

function publisher(): IntermediateImagePublisher & { revoked: number } {
  const state = {
    revoked: 0,
    publish: vi.fn((input: { cacheKey: string }) =>
      Promise.resolve({
        url: `https://signed/ara/${input.cacheKey}`,
        revoke: () => {
          state.revoked += 1;
          return Promise.resolve();
        },
      }),
    ),
  };
  return state;
}

const step = (variantId: string, category: OutfitComposeStep['category']): OutfitComposeStep => ({
  variantId,
  category,
  garmentImageUrl: `https://signed/urun/${variantId}`,
  cacheKey: `key-${variantId}`,
});

describe('kombin bestesi', () => {
  it('her katman bir öncekinin ÇIKTISININ üstüne giydirilir', async () => {
    const fal = provider('fal', [success('alt'), success('ust')]);
    const store = publisher();

    await composeOutfit(
      [fal],
      {
        baseImageUrl: 'https://signed/kisi',
        steps: [step('v-pantolon', 'LOWER_BODY'), step('v-gomlek', 'UPPER_BODY')],
        mode: 'FAST',
      },
      store,
    );

    const calls = (fal.generate as ReturnType<typeof vi.fn>).mock.calls;
    // İlk adım kullanıcının fotoğrafını, ikinci adım BİRİNCİ ADIMIN çıktısını alır.
    expect(calls[0]?.[0]).toMatchObject({ personImageUrl: 'https://signed/kisi' });
    expect(calls[1]?.[0]).toMatchObject({ personImageUrl: 'https://signed/ara/key-v-pantolon' });
  });

  it('yalnızca verilen adımlar üretilir — yeniden kullanılan önek çağrı yapmaz', async () => {
    const fal = provider('fal', [success('ceket')]);
    const store = publisher();

    const result = await composeOutfit(
      [fal],
      {
        // Pantolon + gömlek öneki hazır olduğu için taban ONUN çıktısıdır.
        baseImageUrl: 'https://signed/ara/onceki-onek',
        steps: [step('v-ceket', 'OUTERWEAR')],
        mode: 'FAST',
      },
      store,
    );

    expect(fal.generate).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('SUCCEEDED');
    expect(result.totalCostMicroUsd).toBe(60_000n);
  });

  it('önek anahtarı sağlayıcıya idempotency anahtarı olarak gider', async () => {
    const fal = provider('fal', [success('alt')]);

    await composeOutfit(
      [fal],
      {
        baseImageUrl: 'https://signed/kisi',
        steps: [step('v-pantolon', 'LOWER_BODY')],
        mode: 'FAST',
      },
      publisher(),
    );

    expect((fal.generate as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatchObject({
      idempotencyKey: 'key-v-pantolon',
    });
  });

  it('son adımın çıktısı da yayımlanır — yarın eklenecek parça öneki bulsun', async () => {
    const fal = provider('fal', [success('alt'), success('ust')]);
    const store = publisher();

    await composeOutfit(
      [fal],
      {
        baseImageUrl: 'https://signed/kisi',
        steps: [step('v-pantolon', 'LOWER_BODY'), step('v-gomlek', 'UPPER_BODY')],
        mode: 'FAST',
      },
      store,
    );

    expect(store.publish).toHaveBeenCalledTimes(2);
  });

  it('ara görsel adresleri her durumda kapatılır', async () => {
    const fal = provider('fal', [success('alt'), failure('PROVIDER_ERROR')]);
    const store = publisher();

    await composeOutfit(
      [fal],
      {
        baseImageUrl: 'https://signed/kisi',
        steps: [step('v-pantolon', 'LOWER_BODY'), step('v-gomlek', 'UPPER_BODY')],
        mode: 'FAST',
      },
      store,
    );

    expect(store.revoked).toBe(1);
  });

  it('⚠️ KISMİ BAŞARI: 3 parçadan 2’si giydirildiyse yarım kombin gösterilir ama TAM sayılmaz', async () => {
    const fal = provider('fal', [success('alt'), success('ust'), failure('PROVIDER_ERROR')]);

    const result = await composeOutfit(
      [fal],
      {
        baseImageUrl: 'https://signed/kisi',
        steps: [
          step('v-pantolon', 'LOWER_BODY'),
          step('v-gomlek', 'UPPER_BODY'),
          step('v-ceket', 'OUTERWEAR'),
        ],
        mode: 'FAST',
      },
      publisher(),
    );

    expect(result.status).toBe('PARTIAL');
    expect(result.appliedCount).toBe(2);
    // Gösterilecek görsel son BAŞARILI adımın çıktısıdır.
    expect(result.image?.toString()).toBe('ust');
    // Eksik parça açıkça bildirilir; kullanıcı görmediği kombini satın almasın.
    expect(result.failure).toMatchObject({ variantId: 'v-ceket', reason: 'PROVIDER_ERROR' });
  });

  it('bir katman düşünce zincir KESİLİR — üstteki katmanlar boşuna para yakmaz', async () => {
    const fal = provider('fal', [failure('PROVIDER_ERROR'), success('ust'), success('dis')]);

    const result = await composeOutfit(
      [fal],
      {
        baseImageUrl: 'https://signed/kisi',
        steps: [
          step('v-pantolon', 'LOWER_BODY'),
          step('v-gomlek', 'UPPER_BODY'),
          step('v-ceket', 'OUTERWEAR'),
        ],
        mode: 'FAST',
      },
      publisher(),
    );

    expect(fal.generate).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('FAILED');
    expect(result.image).toBeUndefined();
  });

  it('kalıcı hata işaretlenir — tekrar denemek aynı sonucu ikinci kez ödemektir', async () => {
    const fal = provider('fal', [success('alt'), failure('CONTENT_BLOCKED')]);

    const result = await composeOutfit(
      [fal],
      {
        baseImageUrl: 'https://signed/kisi',
        steps: [step('v-pantolon', 'LOWER_BODY'), step('v-gomlek', 'UPPER_BODY')],
        mode: 'FAST',
      },
      publisher(),
    );

    expect(result.failure).toMatchObject({ reason: 'CONTENT_BLOCKED', permanent: true });
  });

  it('başarısız adımın maliyeti de toplama girer — fatura açıklanabilir olmalı', async () => {
    const fal = provider('fal', [success('alt', 60_000n), failure('TIMEOUT', 15_000n)]);

    const result = await composeOutfit(
      [fal],
      {
        baseImageUrl: 'https://signed/kisi',
        steps: [step('v-pantolon', 'LOWER_BODY'), step('v-gomlek', 'UPPER_BODY')],
        mode: 'FAST',
      },
      publisher(),
    );

    expect(result.totalCostMicroUsd).toBe(75_000n);
  });

  it('tüm katmanlar giydirildiyse SUCCEEDED ve son görsel döner', async () => {
    const fal = provider('fal', [success('alt'), success('ust'), success('dis')]);

    const result = await composeOutfit(
      [fal],
      {
        baseImageUrl: 'https://signed/kisi',
        steps: [
          step('v-pantolon', 'LOWER_BODY'),
          step('v-gomlek', 'UPPER_BODY'),
          step('v-ceket', 'OUTERWEAR'),
        ],
        mode: 'FAST',
      },
      publisher(),
    );

    expect(result.status).toBe('SUCCEEDED');
    expect(result.appliedCount).toBe(3);
    expect(result.image?.toString()).toBe('dis');
    expect(result.steps.every((outcome) => outcome.status === 'SUCCEEDED')).toBe(true);
  });

  it('yedek sağlayıcı zinciri katman bazında çalışmaya devam eder', async () => {
    const primary = provider('fal', [failure('PROVIDER_ERROR')]);
    const backup = provider('gemini', [success('alt')]);

    const result = await composeOutfit(
      [primary, backup],
      {
        baseImageUrl: 'https://signed/kisi',
        steps: [step('v-pantolon', 'LOWER_BODY')],
        mode: 'FAST',
      },
      publisher(),
    );

    expect(result.status).toBe('SUCCEEDED');
    expect(result.steps[0]?.provider).toBe('gemini');
  });
});
