import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isIntegrationError } from '@vt/contracts';
import { resilient, TimeoutError, defaultIsRetryable } from './resilient.js';
import { CircuitBreaker, CircuitOpenError, resetCircuits } from './circuit-breaker.js';

const base = {
  provider: 'test',
  operation: 'call',
  errorCode: 'UPSTREAM_UNAVAILABLE',
} as const;

beforeEach(() => {
  resetCircuits();
});

describe('idempotency ve retry ilişkisi', () => {
  it('⚠️ idempotency anahtarı YOKSA retry YAPMAZ', async () => {
    const fn = vi.fn().mockRejectedValue(Object.assign(new Error('503'), { status: 503 }));

    await expect(
      resilient({ ...base, retryAttempts: 5 }, fn), // retryAttempts verildi ama anahtar yok
    ).rejects.toSatisfy(isIntegrationError);

    // Tek deneme: çifte tahsilat riskindense hata dönmek yeğdir.
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('idempotency anahtarı varsa retry yapar', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('503'), { status: 503 }))
      .mockResolvedValueOnce('tamam');

    const result = await resilient(
      { ...base, retryAttempts: 3, idempotencyKey: 'order-1' },
      fn,
    );

    expect(result).toBe('tamam');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('hangi hatalar tekrar denenir', () => {
  it('4xx tekrar denenmez — aynı istek aynı sonucu verir', () => {
    expect(defaultIsRetryable(Object.assign(new Error(), { status: 400 }))).toBe(false);
    expect(defaultIsRetryable(Object.assign(new Error(), { status: 422 }))).toBe(false);
  });

  it('429 ve 5xx tekrar denenir', () => {
    expect(defaultIsRetryable(Object.assign(new Error(), { status: 429 }))).toBe(true);
    expect(defaultIsRetryable(Object.assign(new Error(), { status: 503 }))).toBe(true);
  });

  it('ağ hataları ve zaman aşımı tekrar denenir', () => {
    expect(defaultIsRetryable(Object.assign(new Error(), { code: 'ECONNRESET' }))).toBe(true);
    expect(defaultIsRetryable(new TimeoutError('x', 100))).toBe(true);
  });

  it('4xx aldığında denemeyi bırakır', async () => {
    const fn = vi.fn().mockRejectedValue(Object.assign(new Error('400'), { status: 400 }));

    await expect(
      resilient({ ...base, retryAttempts: 3, idempotencyKey: 'k' }, fn),
    ).rejects.toThrow();

    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('zaman aşımı', () => {
  it('askıda kalan çağrıyı keser', async () => {
    const fn = vi.fn(() => new Promise(() => undefined)); // asla çözülmez

    await expect(resilient({ ...base, timeoutMs: 50 }, fn)).rejects.toSatisfy(isIntegrationError);
  });
});

describe('hata sarma', () => {
  it('IntegrationError’a sarar ve sağlayıcı bağlamını taşır', async () => {
    const fn = vi.fn().mockRejectedValue(Object.assign(new Error('bum'), { status: 500 }));

    try {
      await resilient(
        {
          ...base,
          provider: 'iyzico',
          operation: 'refund',
          errorCode: 'PAYMENT_PROVIDER_DOWN',
          extractProviderCode: () => '5012',
        },
        fn,
      );
      expect.unreachable('hata bekleniyordu');
    } catch (error) {
      if (!isIntegrationError(error)) throw error;
      expect(error.provider).toBe('iyzico');
      expect(error.operation).toBe('refund');
      expect(error.providerCode).toBe('5012');
      // Sağlayıcı detayı kullanıcıya sızmaz
      expect(error.userMessage).not.toContain('iyzico');
    }
  });

  it('fallback verilirse hata fırlatmaz', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('bum'));

    const result = await resilient({ ...base, fallback: () => 'yedek' }, fn);

    expect(result).toBe('yedek');
  });
});

describe('devre kesici', () => {
  it('eşik aşılınca açılır ve anında reddeder', async () => {
    let clock = 0;
    const breaker = new CircuitBreaker({
      name: 'test',
      failureThreshold: 3,
      windowMs: 60_000,
      resetAfterMs: 30_000,
      now: () => clock,
    });

    const failing = (): Promise<never> => Promise.reject(new Error('bum'));

    for (let i = 0; i < 3; i += 1) {
      await breaker.execute(failing).catch(() => undefined);
    }

    expect(breaker.getState()).toBe('OPEN');
    await expect(breaker.execute(failing)).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it('bekleme süresi sonrası tek deneme geçirir ve başarıda kapanır', async () => {
    let clock = 0;
    const breaker = new CircuitBreaker({
      name: 'test',
      failureThreshold: 2,
      resetAfterMs: 30_000,
      now: () => clock,
    });

    const failing = (): Promise<never> => Promise.reject(new Error('bum'));
    await breaker.execute(failing).catch(() => undefined);
    await breaker.execute(failing).catch(() => undefined);
    expect(breaker.getState()).toBe('OPEN');

    clock += 30_001;
    expect(breaker.getState()).toBe('HALF_OPEN');

    await expect(breaker.execute(() => Promise.resolve('iyi'))).resolves.toBe('iyi');
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('yarı açıkken tek hata devreyi tekrar açar', async () => {
    let clock = 0;
    const breaker = new CircuitBreaker({
      name: 'test',
      failureThreshold: 2,
      resetAfterMs: 10_000,
      now: () => clock,
    });

    const failing = (): Promise<never> => Promise.reject(new Error('bum'));
    await breaker.execute(failing).catch(() => undefined);
    await breaker.execute(failing).catch(() => undefined);

    clock += 10_001;
    expect(breaker.getState()).toBe('HALF_OPEN');

    await breaker.execute(failing).catch(() => undefined);
    expect(breaker.getState()).toBe('OPEN');
  });

  it('devre açıkken retry denenmez', async () => {
    let clock = 0;
    const breaker = new CircuitBreaker({ name: 't', failureThreshold: 1, now: () => clock });
    await breaker.execute(() => Promise.reject(new Error('x'))).catch(() => undefined);

    const fn = vi.fn().mockRejectedValue(new Error('x'));
    await resilient(
      { ...base, circuitBreaker: breaker, retryAttempts: 5, idempotencyKey: 'k' },
      fn,
    ).catch(() => undefined);

    // Devre açık: sağlayıcıya hiç gidilmez
    expect(fn).not.toHaveBeenCalled();
  });
});
