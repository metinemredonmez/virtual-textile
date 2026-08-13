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
  /**
   * Sunucunun kendi dilinde (Türkçe) hazır metin.
   *
   * ⚠️ ARTIK TEK KAYNAK DEĞİL, YEDEK. Metin `error-message.ts` üzerinden
   *    `code` + `params`tan, gösterileceği dilde kurulur. Bu alan telde
   *    KALIYOR çünkü SÜRÜM SAPMASINI karşılıyor: API bu frontend derlemesinin
   *    bilmediği yeni bir kod döndürdüğünde kullanıcı boş kutu değil doğru
   *    cümleyi görür. Alanı kaldırmak o güvenceyi siler.
   */
  message: string;
  httpStatus: number;
  /** İstemci aynı isteği tekrar deneyebilir mi? */
  retryable: boolean;
  /**
   * Katalog metnindeki `{yerTutucu}` değerleri — HAM, biçimlenmemiş.
   *
   * ⚠️ BİÇİMLENMİŞ DEĞER GÖNDERİLMEZ. Tutarlar KURUŞ dizgisi ("100000"),
   *    sayılar sayı olarak gider; biçim gösterildiği dilde kurulur
   *    (`ERROR_CATALOG` → `params` tür tablosu). Sunucu "1.000,00 ₺" diye
   *    hazır bir dizgi gönderseydi İngilizce cümlenin ortasında Türkçe ayraçlı
   *    bir tutar kalırdı — derleme, tip kontrolü ve testler bunu göremez.
   *
   * ⚠️ Buraya KİŞİSEL VERİ konmaz: değerler istemciye gider ve loglara düşer.
   *    Bugün taşınanların hepsi sınır/adet/istek kimliği (`{max}`, `{requestId}`).
   */
  params?: Readonly<Record<string, string | number>>;
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
