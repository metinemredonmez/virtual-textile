import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { runWithContext, type RequestContext } from '../request-context.js';

/**
 * Her isteğe izlenebilir bir kimlik verir ve AsyncLocalStorage bağlamını kurar.
 *
 * `X-Request-Id` yanıtta da döner: kullanıcı hata ekranındaki kodu desteğe
 * söylediğinde log'da doğrudan bulunabilsin.
 *
 * ⚠️ İstemciden gelen X-Request-Id'ye körü körüne güvenilmez — log enjeksiyonu
 * ve izleme kirliliği yaratabilir. Biçim doğrulanır, uymayan üretilir.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function requestContextMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const incoming = request.header('X-Request-Id');
  const requestId = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();

  request.id = requestId;
  response.setHeader('X-Request-Id', requestId);

  const sessionHeader = request.header('X-Session-Id');

  const context: RequestContext = {
    requestId,
    ipAddress: request.ip ?? 'unknown',
    userAgent: request.header('User-Agent')?.slice(0, 256) ?? 'unknown',
    startedAt: Date.now(),
    ...(sessionHeader && SAFE_REQUEST_ID.test(sessionHeader) ? { sessionId: sessionHeader } : {}),
  };

  runWithContext(context, () => {
    next();
  });
}
