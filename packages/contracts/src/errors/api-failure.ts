import type { ApiErrorBody, ApiErrorDetailField } from '../envelope.js';
import { VARSAYILAN_LOCALE, type Locale } from '../i18n/locale.js';
import { ERROR_CATALOG, isErrorCode, type ErrorCode, type ErrorFamily } from './error-catalog.js';
import { wireErrorMessage, type ErrorParams } from './error-message.js';

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
  /**
   * Sunucunun gönderdiği hazır metin (Türkçe).
   *
   * ⚠️ ARTIK DOĞRUDAN EKRANA BASILMAZ — `mesaj(locale)` kullanılır. Bu alan
   *    yalnızca sürüm sapması yedeği ve log metni olarak duruyor: katalogda
   *    olmayan bir kod geldiğinde gösterilecek tek şey budur.
   */
  readonly userMessage: string;
  readonly httpStatus: number;
  readonly retryable: boolean;
  /** Katalog metnindeki yer tutucuların HAM değerleri. */
  readonly params?: ErrorParams;
  readonly details?: unknown;
  readonly requestId: string;
  readonly retryAfterSeconds?: number;

  constructor(body: ApiErrorBody) {
    // Error.message = LOG mesajı. Kullanıcı metni `mesaj(locale)`dan.
    super(`${body.code}: ${body.message}`);
    this.name = 'ApiFailure';
    this.code = body.code;
    this.userMessage = body.message;
    this.httpStatus = body.httpStatus;
    this.retryable = body.retryable;
    this.params = body.params;
    this.details = body.details;
    this.requestId = body.requestId;
    this.retryAfterSeconds = body.retryAfterSeconds;
  }

  /**
   * KULLANICIYA GÖSTERİLECEK METİN — istenen dilde.
   *
   * ⚠️ "Mesajı frontend yeniden yazmaz" kuralı BURADA KORUNUYOR: metin yine
   *    katalogdan geliyor, yalnız kataloğun iki dili var. Bu fonksiyonun
   *    dışında hiçbir ekranda hata cümlesi YAZILMAZ.
   *
   * ⚠️ `interpolate` HÂLÂ ÇAĞRILMIYOR ve bu bilinçli: doldurma işi
   *    `error-message.ts`te, `readonly userMessage`a dokunmadan yapılıyor.
   *    Böylece "yarısı doldurulmuş cümle" tuzağı yapısal olarak imkânsız
   *    kalmaya devam ediyor (dosya başlığındaki gerekçe).
   */
  mesaj(locale: Locale = VARSAYILAN_LOCALE): string {
    return wireErrorMessage(
      { code: this.code, message: this.userMessage, params: this.params },
      locale,
    );
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
