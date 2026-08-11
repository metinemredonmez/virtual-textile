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
  /** Faset, öneri gibi ek alanlar korunur ve data içinde döner. */
  [extra: string]: unknown;
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
          const { items, nextCursor, total, ...rest } = payload;
          if (nextCursor !== undefined) meta.nextCursor = nextCursor;
          if (total !== undefined) meta.total = total;

          // Yalnızca sayfalama alanları varsa: data = dizi (sade liste ucu).
          // Kardeş alanlar da varsa (faset, öneri) nesne olarak korunur —
          // aksi hâlde sessizce düşerlerdi.
          return Object.keys(rest).length === 0
            ? { data: serializeBigInts(items), meta }
            : { data: serializeBigInts({ items, ...rest }), meta };
        }

        return { data: serializeBigInts(payload), meta };
      }),
    );
  }
}
