import 'server-only';
import { ApiFailure } from '@vt/contracts';

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
          // Sunucunun Türkçe mesajı AYNEN taşınır — yeniden yazılmaz.
          message: error.userMessage,
          httpStatus: error.httpStatus,
          retryable: error.retryable,
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
        message: 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.',
        httpStatus: 500,
        retryable: true,
        requestId: 'vekil',
      },
    },
    { status: 500 },
  );
}
