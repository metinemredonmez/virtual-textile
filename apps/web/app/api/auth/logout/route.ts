import type { NextRequest } from 'next/server';
import { apiBaseUrl } from '@/lib/env';
import { csrfViolation, forbiddenEnvelope } from '@/lib/api/csrf';
import { successResponse } from '@/lib/api/envelope-response';
import { clearSession, SID_COOKIE } from '@/lib/session/cookies';
import { getValidSession, SessionRevoked } from '@/lib/session/single-flight';
import { deleteSession } from '@/lib/session/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ÇIKIŞ — sıra önemli.
 *
 * ⚠️ ÖLÇÜLDÜ (`auth.controller.ts`): `POST /v1/auth/logout` GEÇERLİ bir access
 *    token istiyor. 16 dakika bekleyip "Çıkış"a basan kullanıcı 401 alır ve
 *    oturum sunucuda 30 GÜN yaşamaya devam eder. Bu yüzden jeton bayatsa ÖNCE
 *    yenilenir, SONRA çıkış çağrılır.
 *
 * ⚠️ Sonuç ne olursa olsun yerel oturum SİLİNİR. API çağrısı başarısız diye
 *    kullanıcıyı giriş yapmış halde bırakmak, "çıkış yaptım" diyen birini
 *    ortak bilgisayarda açık bırakmak demektir.
 */
export async function POST(request: NextRequest): Promise<Response> {
  if (csrfViolation(request)) return forbiddenEnvelope();

  const sid = request.cookies.get(SID_COOKIE)?.value ?? null;

  if (sid) {
    try {
      const session = await getValidSession(sid);
      if (session) {
        await fetch(`${apiBaseUrl()}/auth/logout`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${session.accessToken}`,
            // Çıkış ucu da `/v1/auth` altında — vt_rt gönderilir.
            cookie: `vt_rt=${encodeURIComponent(session.refreshToken)}`,
          },
          cache: 'no-store',
        });
      }
    } catch (error) {
      if (!(error instanceof SessionRevoked)) {
        console.error('[oturum] çıkış çağrısı başarısız, yerel oturum yine de siliniyor', error);
      }
    }
    await deleteSession(sid);
  }

  await clearSession();
  return successResponse({ loggedOut: true });
}
