import { HttpException, HttpStatus, type ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { appError, integrationError, type ApiError } from '@vt/contracts';
import { Prisma } from '@vt/db';
import { GlobalExceptionFilter } from './global-exception.filter.js';
import type { Logger } from '../logger.js';

function createHost(): {
  host: ArgumentsHost;
  getBody: () => ApiError;
  getStatus: () => number;
  getHeaders: () => Record<string, string>;
} {
  let status = 0;
  let body: ApiError;
  const headers: Record<string, string> = {};

  const response = {
    status: (code: number) => {
      status = code;
      return response;
    },
    json: (payload: ApiError) => {
      body = payload;
      return response;
    },
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  };

  const request = { id: 'req-test-1', method: 'POST', path: '/v1/checkout/pay', route: undefined };

  const host = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ArgumentsHost;

  return { host, getBody: () => body, getStatus: () => status, getHeaders: () => headers };
}

const silentLogger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

describe('GlobalExceptionFilter', () => {
  it('AppError’u zarfa çevirir ve requestId ekler', () => {
    const filter = new GlobalExceptionFilter(silentLogger);
    const { host, getBody, getStatus } = createHost();

    filter.catch(appError('INSUFFICIENT_STOCK', { params: { available: 2 } }), host);

    expect(getStatus()).toBe(409);
    expect(getBody().error.code).toBe('INSUFFICIENT_STOCK');
    expect(getBody().error.message).toContain('2 adet');
    expect(getBody().error.requestId).toBe('req-test-1');
    expect(getBody().error.retryable).toBe(false);
  });

  it('ZodError’u alan bazlı doğrulama hatasına çevirir', () => {
    const filter = new GlobalExceptionFilter(silentLogger);
    const { host, getBody, getStatus } = createHost();
    const schema = z.object({ email: z.string().email(), age: z.number().min(18) });
    const result = schema.safeParse({ email: 'gecersiz', age: 12 });

    filter.catch(result.success ? new Error('beklenmedik') : result.error, host);

    expect(getStatus()).toBe(400);
    expect(getBody().error.code).toBe('VALIDATION_FAILED');
    const details = getBody().error.details as { fields: Array<{ path: string }> };
    expect(details.fields.map((f) => f.path).sort()).toEqual(['age', 'email']);
  });

  it('Prisma unique ihlalini e-posta çakışmasına eşler', () => {
    const filter = new GlobalExceptionFilter(silentLogger);
    const { host, getBody, getStatus } = createHost();

    const prismaError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '6.19.3',
      meta: { target: ['email'] },
    });

    filter.catch(prismaError, host);

    expect(getStatus()).toBe(409);
    expect(getBody().error.code).toBe('AUTH_EMAIL_TAKEN');
  });

  it('Prisma kilitlenmesini tekrar denenebilir olarak işaretler', () => {
    const filter = new GlobalExceptionFilter(silentLogger);
    const { host, getBody } = createHost();

    filter.catch(
      new Prisma.PrismaClientKnownRequestError('deadlock', {
        code: 'P2034',
        clientVersion: '6.19.3',
      }),
      host,
    );

    expect(getBody().error.code).toBe('CONCURRENCY_CONFLICT');
    expect(getBody().error.retryable).toBe(true);
  });

  it('bilinmeyen hatanın iç detayını SIZDIRMAZ', () => {
    const filter = new GlobalExceptionFilter(silentLogger);
    const { host, getBody, getStatus } = createHost();

    filter.catch(new Error('connect ECONNREFUSED 10.0.0.5:5432 password=süpergizli'), host);

    expect(getStatus()).toBe(500);
    const serialized = JSON.stringify(getBody());
    expect(serialized).not.toContain('ECONNREFUSED');
    expect(serialized).not.toContain('süpergizli');
    expect(serialized).not.toContain('10.0.0.5');
    expect(getBody().error.code).toBe('INTERNAL_ERROR');
  });

  it('IntegrationError’da sağlayıcı adını kullanıcıya göstermez', () => {
    const filter = new GlobalExceptionFilter(silentLogger);
    const { host, getBody } = createHost();

    filter.catch(
      integrationError('PAYMENT_PROVIDER_DOWN', {
        provider: 'iyzico',
        operation: 'initiate3ds',
        providerCode: '5012',
      }),
      host,
    );

    const serialized = JSON.stringify(getBody());
    expect(serialized).not.toContain('iyzico');
    expect(serialized).not.toContain('5012');
    expect(getBody().error.retryable).toBe(true);
  });

  it('Retry-After başlığını yazar', () => {
    const filter = new GlobalExceptionFilter(silentLogger);
    const { host, getHeaders } = createHost();

    filter.catch(
      appError('RATE_LIMITED', { params: { retryAfter: 30 }, retryAfterSeconds: 30 }),
      host,
    );

    expect(getHeaders()['Retry-After']).toBe('30');
  });

  it('Nest HttpException’ı katalog koduna eşler', () => {
    const filter = new GlobalExceptionFilter(silentLogger);
    const { host, getBody } = createHost();

    filter.catch(new HttpException('Forbidden', HttpStatus.FORBIDDEN), host);

    expect(getBody().error.code).toBe('AUTH_FORBIDDEN');
  });

  it('beklenen iş sonuçlarını raporlamaz, sistem hatalarını raporlar', () => {
    const report = vi.fn();
    const filter = new GlobalExceptionFilter(silentLogger, { report, integrationSampleRate: 1 });

    filter.catch(appError('COUPON_EXPIRED'), createHost().host);
    expect(report).not.toHaveBeenCalled();

    filter.catch(new Error('beklenmeyen'), createHost().host);
    expect(report).toHaveBeenCalledTimes(1);
  });
});
