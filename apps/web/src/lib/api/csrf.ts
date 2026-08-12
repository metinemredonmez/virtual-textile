import 'server-only';
import type { NextRequest } from 'next/server';
import { appUrl } from '../env';

/**
 * CSRF — vekilin açtığı deliğin kapağı.
 *
 * API'nin `SameSite=Strict` çerezi vekil devreye girince HİÇBİR ŞEYİ korumuyor:
 * SameSite bir TARAYICI kuralıdır, Node `fetch`ine uygulanmaz ve tarayıcı API
 * kökeniyle hiç konuşmuyor. Koruma `vt_sid`in `SameSite=Lax` olmasına ve bu
 * denetime kaldı.
 *
 * ⚠️ Bu fonksiyon ORTAK katmanda çağrılır (vekil + çerez yazan auth yolları),
 *    uç başına değil. Uç başına olsaydı bir gün eklenen yeni bir POST yolu
 *    korumasız kalır ve bunu hiçbir test göstermezdi.
 *
 * ⚠️ `vt_gid` de aynı denetimden geçer — misafir sepeti de bir hesaptır.
 */

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function csrfViolation(request: NextRequest): boolean {
  if (!UNSAFE_METHODS.has(request.method)) return false;

  const origin = request.headers.get('origin');
  if (!origin || origin !== appUrl()) return true;

  // `Origin` köken tabanlı; `Sec-Fetch-Site` ikinci ve bağımsız sinyal.
  const site = request.headers.get('sec-fetch-site');
  return site !== null && site !== 'same-origin';
}

export function forbiddenEnvelope(): Response {
  // ⚠️ Vekilin ürettiği hata da ZARF biçiminde döner; düz metin dönseydi
  //    istemcinin ayrıştırıcısı "JSON olmayan yanıt" dalına düşer ve gerçek
  //    sebep kullanıcıya "sunucuya ulaşılamıyor" diye görünürdü.
  return Response.json(
    {
      error: {
        code: 'AUTH_FORBIDDEN',
        message: 'Bu işlem için yetkiniz yok.',
        httpStatus: 403,
        retryable: false,
        requestId: 'vekil',
      },
    },
    { status: 403 },
  );
}
