import { createHash } from 'node:crypto';
import {
  Injectable,
  SetMetadata,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { from, of, switchMap, tap, type Observable } from 'rxjs';
import { AppError } from '@vt/contracts';
import { serializeBigInts, type PrismaClient } from '@vt/db';

export const IDEMPOTENT_KEY = 'vt:idempotent';

/**
 * Bu uç noktada `Idempotency-Key` başlığı ZORUNLU olsun.
 *
 * ⚠️ Ödeme, sipariş oluşturma, iade ve payout'ta zorunludur.
 * Ağ zaman aşımında istemci isteği tekrarlar; bu katman olmadan
 * müşteriden iki kez para çekilir. E-ticarette en pahalı hata budur.
 */
export const Idempotent = (): MethodDecorator => SetMetadata(IDEMPOTENT_KEY, true);

const KEY_TTL_HOURS = 24;

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const required = this.reflector.get<boolean>(IDEMPOTENT_KEY, context.getHandler());
    if (!required) return next.handle();

    const request = context.switchToHttp().getRequest<Request & { userId?: string }>();
    const response = context.switchToHttp().getResponse<Response>();

    const key = request.header('Idempotency-Key');
    if (!key) {
      throw new AppError('VALIDATION_FAILED', {
        internalMessage: 'Idempotency-Key başlığı eksik',
        details: {
          fields: [
            {
              path: 'headers.Idempotency-Key',
              message: 'Bu işlem için Idempotency-Key başlığı zorunludur.',
            },
          ],
        },
      });
    }

    const requestHash = createHash('sha256')
      .update(JSON.stringify({ body: request.body ?? null, path: request.path }))
      .digest('hex');

    return from(this.begin(key, request, requestHash)).pipe(
      switchMap((cached) => {
        // Daha önce tamamlanmış: kaydedilen yanıtı aynen döndür, İŞLEMİ TEKRARLAMA.
        if (cached) {
          response.setHeader('Idempotent-Replay', 'true');
          response.status(cached.statusCode);
          return of(cached.response);
        }

        return next.handle().pipe(
          tap({
            next: (payload: unknown) => {
              void this.complete(key, response.statusCode, payload);
            },
            error: () => {
              // Başarısız istek anahtarı serbest bırakır — istemci düzeltip
              // aynı anahtarla tekrar deneyebilsin.
              void this.release(key);
            },
          }),
        );
      }),
    );
  }

  /**
   * Anahtarı rezerve eder.
   * @returns tamamlanmış bir kayıt varsa onun yanıtı, yoksa null
   */
  private async begin(
    key: string,
    request: Request & { userId?: string },
    requestHash: string,
  ): Promise<{ statusCode: number; response: unknown } | null> {
    const existing = await this.prisma.idempotencyKey.findUnique({ where: { key } });

    if (existing) {
      // Aynı anahtar, FARKLI gövde → istemci hatası, sessizce kabul edilmez.
      if (existing.requestHash !== requestHash) {
        throw new AppError('IDEMPOTENCY_CONFLICT', {
          internalMessage: `Anahtar ${key} farklı gövde ile tekrar kullanıldı`,
        });
      }

      if (existing.completedAt && existing.statusCode !== null) {
        return { statusCode: existing.statusCode, response: existing.response };
      }

      // Hâlâ işleniyor — paralel çift istek.
      throw new AppError('IDEMPOTENCY_IN_PROGRESS', { retryAfterSeconds: 2 });
    }

    try {
      await this.prisma.idempotencyKey.create({
        data: {
          key,
          userId: request.userId ?? null,
          endpoint: `${request.method} ${request.path}`,
          requestHash,
          lockedAt: new Date(),
          expiresAt: new Date(Date.now() + KEY_TTL_HOURS * 60 * 60 * 1000),
        },
      });
      return null;
    } catch {
      // Yarış durumu: iki istek aynı anda create denedi, biri kaybetti.
      // Kaybeden "işleniyor" der; istemci birazdan tekrar dener.
      throw new AppError('IDEMPOTENCY_IN_PROGRESS', { retryAfterSeconds: 2 });
    }
  }

  private async complete(key: string, statusCode: number, payload: unknown): Promise<void> {
    await this.prisma.idempotencyKey.update({
      where: { key },
      data: {
        statusCode,
        response: serializeBigInts(payload) as never,
        completedAt: new Date(),
      },
    });
  }

  private async release(key: string): Promise<void> {
    await this.prisma.idempotencyKey.delete({ where: { key } }).catch(() => {
      // Kayıt zaten yoksa sorun değil.
    });
  }
}
