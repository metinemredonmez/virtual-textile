import type { ApiErrorBody, ApiErrorDetailField } from '../envelope.js';
import { ERROR_CATALOG, isErrorCode, type ErrorCode, type ErrorFamily } from './error-catalog.js';

/**
 * İSTEMCİ TARAFI HATA NESNESİ — sunucu zarfının olduğu gibi taşıyıcısı.
 *
 * `AppError` KULLANILMAZ: kurucusu `interpolate(def.message, params)` çağırıyor
 * ve `userMessage` `readonly`. Sunucudan gelen hazır mesajı `AppError` üzerine
 * yazmaya çalışmak ya readonly sözleşmesini kırar ya da bir gün kullanıcıya
 * doldurulmamış `"en fazla {available} adet alabilirsiniz"` metnini gösterir.
 * Burada `interpolate` hiç çağrılmadığı için o tuzak YAPISAL OLARAK imkânsız.
 *
 * ⚠️ Sürüm sapması bilinçli olarak tolere edilir: API katalogda olmayan yeni bir
 *    kod döndürdüğünde `family` `undefined` olur ama sunucunun `message` ve
 *    `requestId` alanları KORUNUR ve gösterilir. Bilinmeyen kodda beyaz ekran
 *    vermek, frontend'i her sözleşme değişikliğinde kırılgan yapardı.
 */
export class ApiFailure extends Error {
  readonly code: string;
  /** Kullanıcıya OLDUĞU GİBİ gösterilir. Frontend yeniden yazmaz. */
  readonly userMessage: string;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly details?: unknown;
  readonly requestId: string;
  readonly retryAfterSeconds?: number;

  constructor(body: ApiErrorBody) {
    // Error.message = LOG mesajı. Kullanıcı metni `userMessage`ta.
    super(`${body.code}: ${body.message}`);
    this.name = 'ApiFailure';
    this.code = body.code;
    this.userMessage = body.message;
    this.httpStatus = body.httpStatus;
    this.retryable = body.retryable;
    this.details = body.details;
    this.requestId = body.requestId;
    this.retryAfterSeconds = body.retryAfterSeconds;
  }

  /** Katalogda olmayan kodda `undefined` — çağıran taraf bunu ele almalı. */
  get family(): ErrorFamily | undefined {
    return isErrorCode(this.code) ? ERROR_CATALOG[this.code].family : undefined;
  }

  /** Kod bu derlemenin bildiği katalogda mı? Davranış seçiminden ÖNCE sorulur. */
  isKnown(): this is ApiFailure & { code: ErrorCode } {
    return isErrorCode(this.code);
  }

  is(code: ErrorCode): boolean {
    return this.code === code;
  }

  /**
   * Alan bazlı doğrulama hataları.
   *
   * ⚠️ Buradaki `message` TÜRKÇE OLMAYABİLİR: `zodBody` pipe'ı ZodError
   *    mesajını ham geçiriyor ve bazı şemalarda Zod varsayılanı (`"Required"`,
   *    `"String must contain at least 3 character(s)"`) kalıyor. Bu metin
   *    kullanıcıya gösterilmek üzere üretilmedi; `rule` + `path` üzerinden
   *    Türkçe eşleme yapılır (bkz. apps/web `components/hata/alan-hatalari.ts`).
   *    "Mesajı yeniden yazma" kuralı `error.message` içindir, burası için değil.
   */
  get fields(): ApiErrorDetailField[] {
    const details = this.details;
    if (typeof details !== 'object' || details === null || !('fields' in details)) return [];
    const fields = (details as { fields: unknown }).fields;
    return Array.isArray(fields) ? (fields as ApiErrorDetailField[]) : [];
  }
}

export function isApiFailure(error: unknown): error is ApiFailure {
  return error instanceof ApiFailure;
}
