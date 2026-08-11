import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from '@vt/contracts';

/**
 * HAM GÖVDE YAKALAMA
 *
 * ⚠️ Webhook imzası HAM baytlar üzerinden doğrulanır. Express'in JSON
 *    ayrıştırıcısı gövdeyi tükettikten sonra ham hâli geri getirilemez;
 *    `JSON.stringify(req.body)` ile yeniden üretmek anahtar sırasını, sayı
 *    biçimini ve unicode kaçışlarını değiştirir ve imza HER ZAMAN tutmaz.
 *
 * Bu yüzden gövde, ayrıştırma SIRASINDA `verify` geri çağrısıyla saklanır.
 *
 * ⚠️ ENTEGRASYON GEREKLİ: `apps/api/src/main.ts` bu ajanın yazma alanı
 *    dışında. Entegrasyon ajanı `NestFactory.create` çağrısına şunu eklemeli:
 *
 *      const app = await NestFactory.create<NestExpressApplication>(AppModule, {
 *        rawBody: true,          // Nest req.rawBody'yi doldurur
 *        ...
 *      });
 *
 *    veya kendi body parser'ını kuruyorsa:
 *
 *      app.use(express.json({ verify: captureRawBody }));
 *
 * Bu yapılmazsa webhook ucu 500 döner (sessizce imza doğrulamayı ATLAMAZ) —
 * yapılandırma hatası alarm üretmeli, sessizce güvenlik açığına dönüşmemeli.
 */
export function captureRawBody(
  request: Request & { rawBody?: Buffer },
  _response: Response,
  buffer: Buffer,
): void {
  if (buffer.length > 0) request.rawBody = Buffer.from(buffer);
}

/** Denetleyicide `@RawBody() body: Buffer` olarak kullanılır. */
export const RawBody = createParamDecorator((_data: unknown, context: ExecutionContext): Buffer => {
  const request = context.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();
  const raw = request.rawBody;

  if (!raw || raw.length === 0) {
    // ⚠️ Ham gövde yoksa imza DOĞRULANAMAZ. Doğrulamayı atlayıp devam etmek
    //    sahte ödeme bildirimlerine kapı açardı; bu yüzden isteği reddediyoruz.
    throw new AppError('INTERNAL_ERROR', {
      internalMessage:
        'Ham gövde yakalanmamış — main.ts içinde rawBody:true / captureRawBody bağlanmalı',
    });
  }

  return raw;
});

/** Başlıkları adapter'ın beklediği düz nesneye çevirir. */
export function plainHeaders(request: Request): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    headers[key] = Array.isArray(value) ? value[0] : value;
  }
  return headers;
}
