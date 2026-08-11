import { RESILIENCE } from '@vt/config';
import { integrationError, type ErrorCode } from '@vt/contracts';
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker.js';

/**
 * DIŞ SERVİS ÇAĞRISI SARMALAYICISI
 *
 * Her adapter çağrısı buradan geçer: zaman aşımı → yeniden deneme →
 * devre kesici. Üçü birlikte olmazsa biri diğerini işe yaramaz hâle getirir:
 *  - zaman aşımı yoksa retry hiç tetiklenmez, istek sonsuza kadar asılı kalır
 *  - devre kesici yoksa çöken servise retry fırtınası gönderilir
 *
 * ⚠️ EN KRİTİK KURAL: yalnızca IDEMPOTENT işlemler retry edilir.
 *    Ödeme çekme retry edilirken sağlayıcıya AYNI conversationId gitmelidir,
 *    aksi hâlde müşteriden iki kez para çekilir.
 *    Bkz. `idempotencyKey` alanı — verilmezse retry KAPALI kabul edilir.
 */

export interface ResilientOptions<T> {
  /** "iyzico.initiate3ds" — log ve alarmlarda görünür. */
  provider: string;
  operation: string;
  /** Bu çağrının hangi hata koduyla dışarı çıkacağı. */
  errorCode: ErrorCode;
  timeoutMs?: number;
  /**
   * Yeniden deneme sayısı. **0 = retry yok.**
   * `idempotencyKey` verilmediyse bu değer yok sayılır ve retry kapatılır.
   */
  retryAttempts?: number;
  /**
   * İşlemin idempotency anahtarı. Varlığı "bu çağrıyı tekrarlamak güvenlidir"
   * taahhüdüdür — sağlayıcıya her denemede aynı anahtar gider.
   */
  idempotencyKey?: string;
  /** Hangi hatalarda tekrar denensin. Varsayılan: ağ hataları ve 5xx/429. */
  isRetryable?: (error: unknown) => boolean;
  /** Sağlayıcının hata kodunu çıkarır — loglanır, kullanıcıya gösterilmez. */
  extractProviderCode?: (error: unknown) => string | undefined;
  circuitBreaker?: CircuitBreaker;
  onAttempt?: (info: { attempt: number; error?: unknown; delayMs?: number }) => void;
  /** Tüm denemeler tükendiğinde çalışır. Değer dönerse hata fırlatılmaz. */
  fallback?: (error: unknown) => Promise<T> | T;
}

export class TimeoutError extends Error {
  constructor(
    readonly operation: string,
    readonly timeoutMs: number,
  ) {
    super(`${operation} ${timeoutMs}ms içinde yanıt vermedi`);
    this.name = 'TimeoutError';
  }
}

/** HTTP durum kodu veya ağ hatası taşıyan nesnelerden durum çıkarır. */
function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  for (const value of [candidate.status, candidate.statusCode, candidate.response?.status]) {
    if (typeof value === 'number') return value;
  }
  return undefined;
}

const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

export function defaultIsRetryable(error: unknown): boolean {
  if (error instanceof TimeoutError) return true;

  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && NETWORK_ERROR_CODES.has(code)) return true;

  const status = statusOf(error);
  if (status === undefined) return false;
  // 429 = hız limiti, 5xx = sunucu tarafı. 4xx'ler tekrar denenmez —
  // aynı istek aynı sonucu verir, sadece kota yakar.
  return status === 429 || (status >= 500 && status < 600);
}

async function withTimeout<T>(operation: string, timeoutMs: number, fn: () => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new TimeoutError(operation, timeoutMs));
        });
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Üstel geri çekilme + jitter. Jitter olmadan tüm istemciler aynı anda tekrar dener. */
function backoffDelay(attempt: number, baseMs: number): number {
  const exponential = baseMs * 2 ** (attempt - 1);
  const jitter = Math.random() * exponential * 0.3;
  return Math.min(exponential + jitter, 10_000);
}

export async function resilient<T>(options: ResilientOptions<T>, fn: () => Promise<T>): Promise<T> {
  const label = `${options.provider}.${options.operation}`;
  const timeoutMs = options.timeoutMs ?? RESILIENCE.defaultTimeoutMs;
  const isRetryable = options.isRetryable ?? defaultIsRetryable;

  // ⚠️ Idempotency anahtarı yoksa RETRY YOK. Sessizce çifte işlem yapmaktansa
  // hata dönmek her zaman daha ucuzdur.
  const maxAttempts = options.idempotencyKey
    ? Math.max(1, options.retryAttempts ?? RESILIENCE.defaultRetryAttempts)
    : 1;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const run = (): Promise<T> => withTimeout(label, timeoutMs, fn);
      const result = options.circuitBreaker ? await options.circuitBreaker.execute(run) : await run();
      options.onAttempt?.({ attempt });
      return result;
    } catch (error) {
      lastError = error;

      // Devre açıksa denemeye devam etmenin anlamı yok.
      if (error instanceof CircuitOpenError) break;

      const canRetry = attempt < maxAttempts && isRetryable(error);
      if (!canRetry) {
        options.onAttempt?.({ attempt, error });
        break;
      }

      const delayMs = backoffDelay(attempt, RESILIENCE.retryBaseDelayMs);
      options.onAttempt?.({ attempt, error, delayMs });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  if (options.fallback) {
    return await options.fallback(lastError);
  }

  throw integrationError(
    options.errorCode,
    {
      provider: options.provider,
      operation: options.operation,
      ...(options.extractProviderCode
        ? { providerCode: options.extractProviderCode(lastError) }
        : {}),
    },
    { cause: lastError },
  );
}
