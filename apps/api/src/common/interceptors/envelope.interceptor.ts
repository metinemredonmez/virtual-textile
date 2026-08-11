import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { map, type Observable } from 'rxjs';
import type { ApiSuccess, ResponseMeta } from '@vt/contracts';
import { serializeBigInts } from '@vt/db';

/** Denetleyici bunu döndürürse sayfalama bilgisi zarfa taşınır. */
export interface Paginated<T> {
  items: T[];
  nextCursor?: string | null;
  total?: number;
}

function isPaginated(value: unknown): value is Paginated<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'items' in value &&
    Array.isArray((value as Paginated<unknown>).items)
  );
}

/**
 * Tüm başarılı yanıtları tek zarfa sarar ve bigint'leri string'e çevirir.
 *
 * ⚠️ bigint → string, Number'a DEĞİL. Kuruş tutarları 2^53'ü aşabilir ve
 * Number'a çevrilirse sessizce bozulur.
 */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ApiSuccess<unknown>> {
    const request = context.switchToHttp().getRequest<Request & { id?: string }>();
    const requestId = request.id ?? 'unknown';

    return next.handle().pipe(
      map((payload: unknown): ApiSuccess<unknown> => {
        const meta: ResponseMeta = { requestId };

        if (isPaginated(payload)) {
          if (payload.nextCursor !== undefined) meta.nextCursor = payload.nextCursor;
          if (payload.total !== undefined) meta.total = payload.total;
          return { data: serializeBigInts(payload.items), meta };
        }

        return { data: serializeBigInts(payload), meta };
      }),
    );
  }
}
