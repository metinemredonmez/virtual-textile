import { type CallHandler, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { firstValueFrom, of } from 'rxjs';
import type { ApiSuccess } from '@vt/contracts';
import { EnvelopeInterceptor } from './envelope.interceptor.js';

function baglam(): ExecutionContext {
  const request = { id: 'req-envelope-1' };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function isleyici(payload: unknown): CallHandler {
  return { handle: () => of(payload) };
}

async function sar(payload: unknown): Promise<ApiSuccess<unknown>> {
  return firstValueFrom(new EnvelopeInterceptor().intercept(baglam(), isleyici(payload)));
}

describe('EnvelopeInterceptor', () => {
  /**
   * ⚠️ REGRESYON — bu test bir ÜRETİM HATASI için var, kapsama sayısı için değil.
   *
   * `serializeBigInts(undefined)` eskiden `JSON.parse(undefined)` çağırıyordu;
   * argüman "undefined" METNİNE çevrildiği için `SyntaxError` fırlıyordu ve
   * `Promise<void>` dönen HER denetleyici 500 veriyordu. Etkilenen uçlar:
   * `POST /v1/auth/logout`, `DELETE /v1/auth/sessions/:id`, `DELETE /v1/cart/:id`.
   * Yani kullanıcı çıkış yapamıyor, oturum kapatamıyor, sepetten kalem
   * silemiyordu — üçü de 500 dönüyordu.
   *
   * Birim testlerinin bunu görmemesinin sebebi: denetleyici testleri metodu
   * DOĞRUDAN çağırıyor, araya interceptor girmiyor. Hata yalnızca uçtan uca
   * koşumda ortaya çıktı.
   */
  it('tanımsız gövde 204 uçlarını patlatmaz', async () => {
    await expect(sar(undefined)).resolves.toEqual({
      data: undefined,
      meta: { requestId: 'req-envelope-1' },
    });
  });

  it('null gövde de patlatmaz ve null olarak korunur', async () => {
    await expect(sar(null)).resolves.toEqual({
      data: null,
      meta: { requestId: 'req-envelope-1' },
    });
  });

  it('bigint kuruş tutarları STRING olur — Number değil', async () => {
    const zarf = await sar({ totalMinor: 9_007_199_254_740_993n });
    expect(zarf.data).toEqual({ totalMinor: '9007199254740993' });
  });

  it('sayfalama alanları meta’ya taşınır, data sade dizi olur', async () => {
    const zarf = await sar({ items: [{ id: 'a' }], nextCursor: 'c1', total: 1 });
    expect(zarf.data).toEqual([{ id: 'a' }]);
    expect(zarf.meta.nextCursor).toBe('c1');
    expect(zarf.meta.total).toBe(1);
  });

  it('kardeş alanlar (faset vb.) düşmez — data nesne kalır', async () => {
    const zarf = await sar({ items: [{ id: 'a' }], nextCursor: null, facets: { renk: ['siyah'] } });
    expect(zarf.data).toEqual({ items: [{ id: 'a' }], facets: { renk: ['siyah'] } });
    expect(zarf.meta.nextCursor).toBeNull();
  });
});
