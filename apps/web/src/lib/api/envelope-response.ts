import 'server-only';
import { ApiFailure, errorMessage } from '@vt/contracts';

/**
 * Route handler'ın döndüreceği zarf.
 *
 * ⚠️ Vekilin ÜRETTİĞİ hatalar da API'nin zarfıyla AYNI şekilde döner. İki farklı
 *    hata biçimi olsaydı istemcinin ayrıştırıcısı ikisini de bilmek zorunda
 *    kalır ve bilmediği biçim "sunucuya ulaşılamıyor" diye görünürdü.
 */
export function successResponse<T>(data: T, status = 200): Response {
  return Response.json({ data, meta: { requestId: 'vekil' } }, { status });
}

export function failureResponse(error: unknown): Response {
  if (error instanceof ApiFailure) {
    return Response.json(
      {
        error: {
          code: error.code,
          // Sunucunun mesajı AYNEN taşınır — vekil yeniden yazmaz.
          message: error.userMessage,
          httpStatus: error.httpStatus,
          retryable: error.retryable,
          // ⚠️ `params` DA TAŞINIR. Vekil bu alanı düşürseydi tarayıcı cümleyi
          //    kendi dilinde kuramaz, doldurulmamış yer tutucu gösterirdi —
          //    ve arıza YALNIZCA vekilden geçen (yani kimlikli) isteklerde
          //    görünürdü.
          params: error.params,
          details: error.details,
          requestId: error.requestId,
          retryAfterSeconds: error.retryAfterSeconds,
        },
      },
      { status: error.httpStatus },
    );
  }

  console.error('[vekil] beklenmeyen hata', error);
  return Response.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        // Elle yazılmış cümle YOK — metin katalogdan (`ERROR_CATALOG`).
        message: errorMessage('INTERNAL_ERROR', { params: { requestId: 'vekil' } }),
        httpStatus: 500,
        retryable: true,
        requestId: 'vekil',
      },
    },
    { status: 500 },
  );
}
