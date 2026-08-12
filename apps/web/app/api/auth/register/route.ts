import type { NextRequest } from 'next/server';
import { csrfViolation, forbiddenEnvelope } from '@/lib/api/csrf';
import { failureResponse, successResponse } from '@/lib/api/envelope-response';
import { authenticate } from '@/lib/session/authenticate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ⚠️ `register` hız limiti scope:'ip', 3/SAAT. Vekil gerçek istemci IP'sini
 *    kurmazsa tüm site tek kovaya düşer ve günde 3 kişi kayıt olabilir.
 *    KANIT ADIMI: bu yola arka arkaya 4 kez farklı IP simülasyonuyla vurulur ve
 *    4.'nün 429 ALMADIĞI görülür.
 */
export async function POST(request: NextRequest): Promise<Response> {
  if (csrfViolation(request)) return forbiddenEnvelope();

  try {
    const body: unknown = await request.json();
    return successResponse(await authenticate(request, '/auth/register', body), 201);
  } catch (error) {
    return failureResponse(error);
  }
}
