import type { NextRequest } from 'next/server';
import { csrfViolation, forbiddenEnvelope } from '@/lib/api/csrf';
import { failureResponse, successResponse } from '@/lib/api/envelope-response';
import { authenticate } from '@/lib/session/authenticate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ÇEREZ YAZAN YOL — genel vekilden AYRI.
 *
 * Genel vekil "isteği aynen ilet" işini yapıyor; burada ek olarak Redis'e
 * oturum yazılıyor, `vt_sid` üretiliyor ve misafir sepeti birleştiriliyor.
 * İkisini tek handler'a sıkıştırmak, oturum kurma SIRASINI (bkz.
 * `authenticate.ts`) genel bir `if` bloğunun içine gömerdi.
 */
export async function POST(request: NextRequest): Promise<Response> {
  if (csrfViolation(request)) return forbiddenEnvelope();

  try {
    const body: unknown = await request.json();
    return successResponse(await authenticate(request, '/auth/login', body));
  } catch (error) {
    return failureResponse(error);
  }
}
