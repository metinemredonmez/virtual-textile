import type { ErrorCode } from './errors/error-catalog.js';

/**
 * API yanıt zarfları. TEK format — istisna yok.
 * Frontend `error.code` üzerinden dallanır, `error.message`'ı doğrudan gösterebilir.
 */

export interface ResponseMeta {
  requestId: string;
  /** Cursor tabanlı sayfalama — sonraki sayfa yoksa null. */
  nextCursor?: string | null;
  /** Toplam kayıt sayısı — yalnızca ucuz hesaplanabildiğinde döner. */
  total?: number;
}

export interface ApiSuccess<T> {
  data: T;
  meta: ResponseMeta;
}

export interface ApiErrorDetailField {
  path: string;
  message: string;
  /** Zod issue kodu vb. */
  rule?: string;
}

export interface ApiErrorBody {
  code: ErrorCode;
  /** Kullanıcıya gösterilebilir Türkçe mesaj. */
  message: string;
  httpStatus: number;
  /** İstemci aynı isteği tekrar deneyebilir mi? */
  retryable: boolean;
  /** Alan bazlı doğrulama hataları veya iş kuralına özgü ek bilgi. */
  details?: unknown;
  requestId: string;
  /** 429/503 için saniye cinsinden bekleme süresi. */
  retryAfterSeconds?: number;
}

export interface ApiError {
  error: ApiErrorBody;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export function isApiError<T>(response: ApiResponse<T>): response is ApiError {
  return 'error' in response;
}

export function ok<T>(data: T, meta: ResponseMeta): ApiSuccess<T> {
  return { data, meta };
}
