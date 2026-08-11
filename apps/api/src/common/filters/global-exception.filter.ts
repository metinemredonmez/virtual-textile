import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import {
  AppError,
  IntegrationError,
  isAppError,
  shouldReport,
  toAppError,
  type ApiError,
  type ApiErrorDetailField,
  type ErrorCode,
} from '@vt/contracts';
import { isPrismaKnownError, PRISMA_ERROR, uniqueViolationTarget, Prisma } from '@vt/db';
import type { Logger } from '../logger.js';

/**
 * TEK HATA ÇIKIŞ NOKTASI.
 *
 * Kurallar:
 *  1. İstemciye giden gövde her zaman aynı zarftadır.
 *  2. Yığın izi, SQL, dosya yolu, sağlayıcı kodu ve env değeri ASLA sızmaz.
 *  3. Loglama seviyesi hata AİLESİNE göre seçilir — beklenen iş sonuçları
 *     (stok yok, kupon geçersiz) Sentry'ye gitmez, yoksa gerçek hatalar
 *     gürültü içinde kaybolur.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly logger: Logger,
    private readonly options: {
      /** Integration hatalarının kaçta kaçı raporlansın (0-1). */
      integrationSampleRate?: number;
      report?: (error: Error, context: Record<string, unknown>) => void;
    } = {},
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { id?: string }>();
    const response = http.getResponse<Response>();
    const requestId = request.id ?? 'unknown';

    const { error, details } = this.normalize(exception);

    this.log(error, request, requestId);
    this.report(error, request, requestId);

    const body: ApiError = {
      error: {
        code: error.code,
        message: error.userMessage,
        httpStatus: error.httpStatus,
        retryable: error.retryable,
        ...(details !== undefined ? { details } : {}),
        requestId,
        ...(error.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: error.retryAfterSeconds }
          : {}),
      },
    };

    if (error.retryAfterSeconds !== undefined) {
      response.setHeader('Retry-After', String(error.retryAfterSeconds));
    }

    response.status(error.httpStatus).json(body);
  }

  /** Her hata tipini AppError'a indirger. */
  private normalize(exception: unknown): { error: AppError; details?: unknown } {
    // 1. Zaten bizim hatamız
    if (isAppError(exception)) {
      return { error: exception, details: exception.details };
    }

    // 2. Zod doğrulama hatası → alan bazlı detay
    if (exception instanceof ZodError) {
      const fields: ApiErrorDetailField[] = exception.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
        rule: issue.code,
      }));
      return {
        error: new AppError('VALIDATION_FAILED', {
          internalMessage: `Doğrulama başarısız: ${fields.length} alan`,
        }),
        details: { fields },
      };
    }

    // 3. Prisma hataları → anlamlı iş hatalarına çevir
    if (isPrismaKnownError(exception)) {
      return this.fromPrisma(exception);
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      // Prisma doğrulama hatası = BİZİM kodumuzda hata, kullanıcı girdisi değil.
      return {
        error: new AppError('INTERNAL_ERROR', {
          cause: exception,
          internalMessage: 'Prisma sorgu doğrulaması başarısız — kod hatası',
        }),
      };
    }

    // 4. Nest'in kendi HttpException'ları (guard/pipe kaynaklı)
    if (exception instanceof HttpException) {
      return { error: this.fromHttpException(exception) };
    }

    // 5. Bilinmeyen → INTERNAL_ERROR (iç mesaj sızmaz)
    return { error: toAppError(exception) };
  }

  private fromPrisma(error: Prisma.PrismaClientKnownRequestError): {
    error: AppError;
    details?: unknown;
  } {
    switch (error.code) {
      case PRISMA_ERROR.UNIQUE_VIOLATION: {
        const target = uniqueViolationTarget(error);
        // Sık karşılaşılan alanlara özel, kullanıcıya anlamlı mesaj
        if (target?.some((t) => t.includes('email'))) {
          return { error: new AppError('AUTH_EMAIL_TAKEN', { cause: error }) };
        }
        if (target?.some((t) => t.includes('phone'))) {
          return { error: new AppError('AUTH_PHONE_TAKEN', { cause: error }) };
        }
        return {
          error: new AppError('DUPLICATE_RESOURCE', { cause: error }),
          // Alan ADLARI güvenli; değerler gönderilmez.
          details: target ? { fields: target } : undefined,
        };
      }
      case PRISMA_ERROR.RECORD_NOT_FOUND:
        return { error: new AppError('NOT_FOUND', { cause: error }) };
      case PRISMA_ERROR.FOREIGN_KEY_VIOLATION:
        return { error: new AppError('INVALID_REFERENCE', { cause: error }) };
      case PRISMA_ERROR.CONSTRAINT_VIOLATION:
        // CHECK kısıtı tetiklendi — uygulama katmanı bunu yakalamalıydı.
        return {
          error: new AppError('VALIDATION_FAILED', {
            cause: error,
            internalMessage: `Veritabanı kısıtı ihlali: ${error.message}`,
          }),
        };
      case PRISMA_ERROR.TRANSACTION_CONFLICT:
        // Kilitlenme — istemci tekrar deneyebilir.
        return { error: new AppError('CONCURRENCY_CONFLICT', { cause: error }) };
      default:
        return {
          error: new AppError('INTERNAL_ERROR', {
            cause: error,
            internalMessage: `Beklenmeyen Prisma hatası ${error.code}`,
          }),
        };
    }
  }

  private fromHttpException(exception: HttpException): AppError {
    const status = exception.getStatus();
    const map: Partial<Record<number, ErrorCode>> = {
      [HttpStatus.BAD_REQUEST]: 'VALIDATION_FAILED',
      [HttpStatus.UNAUTHORIZED]: 'AUTH_TOKEN_INVALID',
      [HttpStatus.FORBIDDEN]: 'AUTH_FORBIDDEN',
      [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
      [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
      [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
      [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
    };
    return new AppError(map[status] ?? 'INTERNAL_ERROR', {
      cause: exception,
      internalMessage: exception.message,
    });
  }

  private log(error: AppError, request: Request, requestId: string): void {
    const base = {
      requestId,
      method: request.method,
      // Sorgu dizesi loglanmaz — kişisel veri içerebilir.
      path: request.route?.path ?? request.path,
      ...error.toLogObject(),
    };

    switch (error.family) {
      case 'system':
        this.logger.error({ ...base, err: error }, 'İstek başarısız — sistem hatası');
        break;
      case 'integration':
        this.logger.warn({ ...base, err: error }, 'Dış servis hatası');
        break;
      case 'domain':
        this.logger.info(base, 'İş kuralı reddi');
        break;
      case 'validation':
        this.logger.debug(base, 'Doğrulama hatası');
        break;
    }
  }

  private report(error: AppError, request: Request, requestId: string): void {
    if (!this.options.report || !shouldReport(error.family)) return;

    // Integration hataları örneklenir: bir sağlayıcı çökerse Sentry'yi
    // saniyede binlerce aynı olayla doldurmasın.
    if (error.family === 'integration') {
      const rate = this.options.integrationSampleRate ?? 0.1;
      if (Math.random() > rate) return;
    }

    this.options.report(error, {
      requestId,
      method: request.method,
      path: request.route?.path ?? request.path,
      errorCode: error.code,
      ...(error instanceof IntegrationError
        ? { provider: error.provider, operation: error.operation }
        : {}),
    });
  }
}
