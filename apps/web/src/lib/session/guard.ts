import 'server-only';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { ApiFailure, type AuthenticatedUser } from '@vt/contracts';
import { apiBaseUrl } from '../env';
import { unwrap } from '../api/core';
import { readSid } from './cookies';
import { getValidSession, SessionRevoked } from './single-flight';

/**
 * KORUMALI ROTALAR — ÜÇ KATMAN, YALNIZ ÜÇÜNCÜSÜ GÜVENLİK.
 *
 *   1. `proxy.ts` (eski adıyla middleware) — sadece `vt_sid` VAR MI diye bakar.
 *      Bu UX'tir, güvenlik DEĞİL. Rol kontrolü YAPMAZ: rol Redis'te, o katman
 *      Edge'de. Dahası "proxy var, koruma tamam" yanılsaması, bir gün matcher'a
 *      yeni bir bölge eklemeyi unutan kişiyi ölümcül hataya götürür.
 *   2. BU DOSYA — `GET /v1/auth/me`, rol uymuyorsa `notFound()`.
 *   3. API guard'ları (JwtAuthGuard + RolesGuard + SellerScopeGuard) — varsayılan
 *      KAPALI (`auth.guard.ts`: @Public() yazılmamış her uç token ister).
 *      **Tek gerçek katman.** Frontend'de hiçbir şey yapmamaktan gelen garanti.
 *
 * ⚠️ REDIS'TEKİ ROLE GÜVENİLMEZ. `WebSession.role` giriş anındaki fotoğraftır;
 *    yetkisi iptal edilen bir satıcı 30 gün boyunca panel kabuğunu görmeye devam
 *    ederdi. Rol her istekte sunucudan sorulur.
 *
 * ⚠️ `cache()` ZORUNLU: `auth.guard.ts` her kimlikli istekte bir `isSessionActive`
 *    DB sorgusu açıyor. Sarılmazsa tek bir yönetim ekranı (layout + sayfa + alt
 *    bileşenler) onlarca gereksiz oturum sorgusu üretir.
 */
export const currentUser = cache(async (): Promise<AuthenticatedUser | null> => {
  const sid = await readSid();
  if (!sid) return null;

  try {
    const session = await getValidSession(sid);
    if (!session) return null;

    const response = await fetch(`${apiBaseUrl()}/auth/me`, {
      headers: { authorization: `Bearer ${session.accessToken}`, accept: 'application/json' },
      cache: 'no-store',
    });
    const { data } = await unwrap<AuthenticatedUser>(response);
    return data;
  } catch (error) {
    if (error instanceof SessionRevoked) return null;
    if (error instanceof ApiFailure && error.httpStatus === 401) return null;
    throw error;
  }
});

/**
 * Rol uymuyorsa `notFound()`.
 *
 * ⚠️ 403 DEĞİL, 404. Yönetim panelinin varlığını doğrulamak, onu aramak için
 *    sebep verir; olmayan bir sayfa hiçbir şey söylemez.
 */
export async function requireRole(
  roles: readonly AuthenticatedUser['role'][],
): Promise<AuthenticatedUser> {
  const user = await currentUser();
  if (!user || !roles.includes(user.role)) notFound();
  return user;
}
