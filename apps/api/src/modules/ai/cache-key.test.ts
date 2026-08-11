import { describe, expect, it } from 'vitest';
import { LocalTryOnCacheKeyAdapter } from './ai.gateway.js';

/**
 * ⚠️ BU TEST BİR EŞLEŞMEYİ KİLİTLER, DAVRANIŞI DEĞİL.
 *
 * API tarafındaki geçici kopya ile worker'ın kullandığı
 * `packages/adapters/src/ai/cache-key.ts` AYNI özeti üretmek zorundadır.
 * Ayrışırlarsa önbellek sessizce ıskalar: hata yok, uyarı yok, sadece her
 * istekte yeniden ödenen bir üretim maliyeti.
 *
 * Beklenen değerler `tryOnCacheKey()`'in çıktısıdır:
 *   sha256("<contentHash>|<variantId>|<mode>|v<promptVersion>")
 */
const adapter = new LocalTryOnCacheKeyAdapter();

describe('try-on önbellek anahtarı', () => {
  it('@vt/adapters ile birebir aynı özeti üretir (FAST)', () => {
    expect(
      adapter.build({ photoContentHash: 'hash-1', variantId: 'variant-1', mode: 'FAST' }),
    ).toBe('146f06596474957ecfa5dcf785e2004d65355cae8d7d32a461a4ecd44e727eb1');
  });

  it('@vt/adapters ile birebir aynı özeti üretir (QUALITY)', () => {
    expect(
      adapter.build({ photoContentHash: 'hash-1', variantId: 'variant-1', mode: 'QUALITY' }),
    ).toBe('547aea48093a32369c960da86796a6d8cc2bebcfb218619ae8b685e33ff07585');
  });

  it('mode farkı farklı anahtar üretir — FAST ve QUALITY farklı çıktıdır', () => {
    const fast = adapter.build({ photoContentHash: 'h', variantId: 'v', mode: 'FAST' });
    const quality = adapter.build({ photoContentHash: 'h', variantId: 'v', mode: 'QUALITY' });

    expect(fast).not.toBe(quality);
  });

  it('varyant farkı farklı anahtar üretir — renk/beden farklı üründür', () => {
    const a = adapter.build({ photoContentHash: 'h', variantId: 'v1', mode: 'FAST' });
    const b = adapter.build({ photoContentHash: 'h', variantId: 'v2', mode: 'FAST' });

    expect(a).not.toBe(b);
  });

  it('aynı girdi her zaman aynı anahtarı verir', () => {
    const input = { photoContentHash: 'h', variantId: 'v', mode: 'FAST' } as const;

    expect(adapter.build(input)).toBe(adapter.build(input));
  });
});
