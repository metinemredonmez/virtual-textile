import { RESILIENCE } from '@vt/config';

/**
 * DEVRE KESİCİ
 *
 * Bir sağlayıcı çöktüğünde her isteği ona göndermek iki zarar verir:
 *  1. Kullanıcı zaman aşımı süresi kadar bekler (25 sn × her istek)
 *  2. Çöken servise yük bindirir, toparlanmasını geciktirir
 *
 * Devre açıkken çağrı ANINDA başarısız olur; ticaret akışı bloklanmaz.
 *
 * Durumlar:
 *   CLOSED    → normal. Ardışık hata eşiği aşılınca OPEN'a geçer.
 *   OPEN      → tüm çağrılar anında reddedilir. resetAfterMs sonra HALF_OPEN.
 *   HALF_OPEN → tek bir deneme geçirilir. Başarılıysa CLOSED, değilse OPEN.
 */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitOpenError extends Error {
  constructor(
    readonly circuitName: string,
    readonly retryAfterMs: number,
  ) {
    super(`Devre açık: ${circuitName}`);
    this.name = 'CircuitOpenError';
  }
}

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold?: number;
  /** Hataların sayıldığı pencere. Pencere dışındaki hatalar unutulur. */
  windowMs?: number;
  resetAfterMs?: number;
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
  /** Test için enjekte edilebilir saat. */
  now?: () => number;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureTimestamps: number[] = [];
  private openedAt = 0;
  /** HALF_OPEN'da yalnızca tek deneme geçsin. */
  private probeInFlight = false;

  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly windowMs: number;
  private readonly resetAfterMs: number;
  private readonly now: () => number;
  private readonly onStateChange?: (from: CircuitState, to: CircuitState) => void;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.failureThreshold = options.failureThreshold ?? RESILIENCE.circuitBreaker.failureThreshold;
    this.windowMs = options.windowMs ?? RESILIENCE.circuitBreaker.windowMs;
    this.resetAfterMs = options.resetAfterMs ?? RESILIENCE.circuitBreaker.resetAfterMs;
    this.now = options.now ?? Date.now;
    this.onStateChange = options.onStateChange;
  }

  getState(): CircuitState {
    this.refresh();
    return this.state;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.refresh();

    if (this.state === 'OPEN') {
      throw new CircuitOpenError(this.name, this.openedAt + this.resetAfterMs - this.now());
    }

    if (this.state === 'HALF_OPEN') {
      if (this.probeInFlight) {
        throw new CircuitOpenError(this.name, this.resetAfterMs);
      }
      this.probeInFlight = true;
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    } finally {
      this.probeInFlight = false;
    }
  }

  private refresh(): void {
    if (this.state === 'OPEN' && this.now() - this.openedAt >= this.resetAfterMs) {
      this.transition('HALF_OPEN');
    }
  }

  private recordSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.failureTimestamps = [];
      this.transition('CLOSED');
    } else {
      // Kapalı durumda başarı, penceredeki hata sayacını yavaşça temizler.
      this.failureTimestamps.shift();
    }
  }

  private recordFailure(): void {
    const timestamp = this.now();

    // HALF_OPEN'da tek bir hata devreyi tekrar açar — servis hâlâ hasta.
    if (this.state === 'HALF_OPEN') {
      this.openedAt = timestamp;
      this.transition('OPEN');
      return;
    }

    this.failureTimestamps.push(timestamp);
    this.failureTimestamps = this.failureTimestamps.filter(
      (time) => timestamp - time <= this.windowMs,
    );

    if (this.failureTimestamps.length >= this.failureThreshold) {
      this.openedAt = timestamp;
      this.transition('OPEN');
    }
  }

  private transition(next: CircuitState): void {
    if (this.state === next) return;
    const previous = this.state;
    this.state = next;
    this.onStateChange?.(previous, next);
  }
}

/** Sağlayıcı başına tek devre — tüm çağrılar aynı sağlığı paylaşmalı. */
const registry = new Map<string, CircuitBreaker>();

export function circuitFor(name: string, options?: Partial<CircuitBreakerOptions>): CircuitBreaker {
  let breaker = registry.get(name);
  if (!breaker) {
    breaker = new CircuitBreaker({ name, ...options });
    registry.set(name, breaker);
  }
  return breaker;
}

/** Yalnızca test için. */
export function resetCircuits(): void {
  registry.clear();
}
