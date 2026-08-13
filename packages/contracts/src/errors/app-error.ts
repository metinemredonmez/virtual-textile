import {
  ERROR_CATALOG,
  getErrorDefinition,
  type ErrorCode,
  type ErrorFamily,
} from './error-catalog.js';
import { errorMessage, type ErrorParams } from './error-message.js';

export interface AppErrorOptions {
  /**
   * Kullanıcı mesajındaki `{param}` yer tutucularını doldurur.
   *
   * ⚠️ DEĞERLER HAM VERİLİR: tutar KURUŞ dizgisi ("100000"), sayı sayı olarak.
   *    Burada `Money.formatMoney(...)` çağırıp hazır bir Türkçe dizgi vermek
   *    tam olarak kaldırılan hataydı — o dizgi telde olduğu gibi gider ve
   *    İngilizce cümlenin ortasında Türkçe ayraçlı bir tutar bırakır. Tutarın
   *    biçimi kataloğun `params` tablosundan (`'para'`) belli.
   */
  params?: ErrorParams;
  /** İstemciye gönderilecek yapılandırılmış ek bilgi (alan hataları, stok adedi vb.). */
  details?: unknown;
  /** Asıl hata — loglanır, ASLA istemciye gönderilmez. */
  cause?: unknown;
  /** Yalnızca log için, kullanıcıya gösterilmez. */
  internalMessage?: string;
  /** 429/503 yanıtlarında `Retry-After` başlığı. */
  retryAfterSeconds?: number;
}

/**
 * Uygulamanın tek hata tipi.
 *
 * Davranış (HTTP kodu, aile, retry, kullanıcı mesajı) katalogdan gelir —
 * fırlatan taraf yalnızca kodu ve parametreleri verir.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly family: ErrorFamily;
  readonly retryable: boolean;
  /**
   * Kullanıcıya gösterilebilir TÜRKÇE mesaj.
   *
   * ⚠️ Dile göre DEĞİŞMEZ ve değişmemeli. `AppError` bir sunucu nesnesi; onu
   *    üreten kod yolunda (servis, worker işi, kuyruk) HTTP isteği ve
   *    dolayısıyla kullanıcının dili her zaman bilinmiyor. Kullanıcının dilinde
   *    metin, gösterildiği yerde `errorMessage(code, { locale, params })` ile
   *    kurulur. Burası log/telemetri metni ve telde giden SÜRÜM SAPMASI
   *    YEDEĞİDİR.
   */
  readonly userMessage: string;
  /** Telde `ApiErrorBody.params` olarak gider — istemci metni bununla kurar. */
  readonly params?: ErrorParams;
  readonly details?: unknown;
  readonly retryAfterSeconds?: number;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    const def = getErrorDefinition(code);
    // ⚠️ `interpolate` DEĞİL: `errorMessage` yer tutucuyu TÜRÜNE göre biçimler
    //    (kuruş → "1.000,00 ₺"). Düz interpolasyon sunucu metnine ham "100000"
    //    yazardı ve o metin sürüm sapması yedeği olarak kullanıcıya çıkabilir.
    const userMessage = errorMessage(code, { params: options.params });

    // Error.message = LOG mesajı (teknik). userMessage = KULLANICI mesajı.
    super(options.internalMessage ?? `${code}: ${userMessage}`, { cause: options.cause });

    this.name = 'AppError';
    this.code = code;
    this.httpStatus = def.status;
    this.family = def.family;
    this.retryable = def.retryable;
    this.userMessage = userMessage;
    this.params = options.params;
    this.details = options.details;
    this.retryAfterSeconds = options.retryAfterSeconds;

    Error.captureStackTrace?.(this, this.constructor);
  }

  get isClientError(): boolean {
    return this.httpStatus >= 400 && this.httpStatus < 500;
  }

  /** Log için güvenli gösterim — kullanıcı verisi ve secret içermez. */
  toLogObject(): Record<string, unknown> {
    return {
      errorCode: this.code,
      errorFamily: this.family,
      httpStatus: this.httpStatus,
      retryable: this.retryable,
      message: this.message,
    };
  }
}

/**
 * Dış servis hatası. `resilient()` sarmalayıcısı bunu fırlatır.
 * Hangi sağlayıcının hangi işleminde patladığını taşır — alarm ve runbook için kritik.
 */
export class IntegrationError extends AppError {
  readonly provider: string;
  readonly operation: string;
  /** Sağlayıcının kendi hata kodu — kullanıcıya ASLA gösterilmez, loglanır. */
  readonly providerCode?: string;

  constructor(
    code: ErrorCode,
    context: { provider: string; operation: string; providerCode?: string },
    options: AppErrorOptions = {},
  ) {
    super(code, {
      ...options,
      internalMessage:
        options.internalMessage ??
        `${context.provider}.${context.operation} başarısız (${code}${
          context.providerCode ? `, sağlayıcı kodu: ${context.providerCode}` : ''
        })`,
    });
    this.name = 'IntegrationError';
    this.provider = context.provider;
    this.operation = context.operation;
    this.providerCode = context.providerCode;
  }

  override toLogObject(): Record<string, unknown> {
    return {
      ...super.toLogObject(),
      provider: this.provider,
      operation: this.operation,
      providerCode: this.providerCode,
    };
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function isIntegrationError(error: unknown): error is IntegrationError {
  return error instanceof IntegrationError;
}

/** Kısa yol: `throw appError('INSUFFICIENT_STOCK', { params: { available: 1 } })` */
export function appError(code: ErrorCode, options?: AppErrorOptions): AppError {
  return new AppError(code, options);
}

export function integrationError(
  code: ErrorCode,
  context: { provider: string; operation: string; providerCode?: string },
  options?: AppErrorOptions,
): IntegrationError {
  return new IntegrationError(code, context, options);
}

/**
 * Bilinmeyen bir hatayı AppError'a çevirir.
 * İç mesaj/stack ASLA `userMessage`'a sızmaz.
 */
export function toAppError(error: unknown, fallback: ErrorCode = 'INTERNAL_ERROR'): AppError {
  if (isAppError(error)) return error;
  return new AppError(fallback, {
    cause: error,
    internalMessage: error instanceof Error ? error.message : String(error),
  });
}

/** Katalogdaki tüm kodlar — dokümantasyon üretimi ve test için. */
export const ALL_ERROR_DEFINITIONS = ERROR_CATALOG;
