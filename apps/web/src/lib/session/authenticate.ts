import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { ApiFailure, type AuthSessionResponse, type CartMergeResultWire } from '@vt/contracts';
import { apiBaseUrl, sessionSecret } from '../env';
import { unwrap } from '../api/core';
import { clearGid, GID_COOKIE, setSid } from './cookies';
import { saveSession, type WebSession } from './store';

/**
 * MİSAFİR → ÜYE GEÇİŞİ. SIRA KRİTİK:
 *
 *   1. `vt_gid` OKUNUR — girişten ÖNCE.
 *      ⚠️ `cart.owner.ts`: `request.user` varsa `X-Session-Id` YOK SAYILIR.
 *         Vekil gid'i giriş sonrasına bırakırsa misafir sepeti KALICI olarak
 *         erişilemez hale gelir; kullanıcı ürünlerinin nereye gittiğini asla
 *         öğrenemez.
 *   2. login/register
 *   3. jetonlar Redis'e, `vt_sid` kurulur
 *   4. `vt_gid` varsa `POST /cart/merge`
 *   5. `vt_gid` SİLİNİR (merge sonucu ne olursa olsun)
 *   6. `skipped` çağırana döner ve sepet ekranında GÖSTERİLİR
 *
 * ⚠️ Merge başarısız olsa da giriş TAMAMLANIR: sepetteki tek bir yayından
 *    kalkmış ürün, kullanıcının giriş yapmasını engellememeli.
 */

function extractRefreshToken(response: Response): string {
  for (const raw of response.headers.getSetCookie()) {
    const match = /^vt_rt=([^;]*)/.exec(raw);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  // ⚠️ Buraya düşmek "yenileme jetonu yok" demektir: oturum 15 dakika sonra
  //    ölür ve kullanıcı sebepsiz atılır. Sessizce geçilmez.
  throw new Error('API yanıtında vt_rt çerezi yok — oturum kurulamaz.');
}

/**
 * Idempotency anahtarı — merge için TÜRETİLMİŞ, rastgele DEĞİL.
 *
 * ⚠️ Rastgele anahtar burada YANLIŞ: ağ zaman aşımında istemci isteği tekrarlar
 *    ve `cart.service.ts` adetleri TOPLADIĞI için sepet ikiye katlanır.
 * ⚠️ Tuzsuz türetme de yanlış: `schema.prisma` → `key String @id` KÜRESEL
 *    birincil anahtar ve `idempotency.interceptor.ts` `begin()` `userId`
 *    doğrulaması yapmıyor. Tahmin edilebilir bir anahtar başkasının kaydına
 *    çarpar. Tuz sunucuda kalır, anahtar vekilin dışına hiç çıkmaz.
 */
function mergeIdempotencyKey(userId: string, guestId: string): string {
  return createHash('sha256')
    .update(`${sessionSecret()}cart-merge:${userId}:${guestId}`)
    .digest('hex');
}

function clientIp(request: NextRequest): string | null {
  const chain = request.headers.get('x-forwarded-for');
  return chain?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip') ?? null;
}

export interface AuthenticateResult {
  user: AuthSessionResponse['user'];
  /** Misafir sepetinden taşınamayan kalemler. Sessizce yutulmaz. */
  skipped: CartMergeResultWire['skipped'];
}

export async function authenticate(
  request: NextRequest,
  path: '/auth/login' | '/auth/register',
  payload: unknown,
): Promise<AuthenticateResult> {
  // 1 — gid ÖNCE okunur.
  const guestId = request.cookies.get(GID_COOKIE)?.value ?? null;

  const ip = clientIp(request);
  const headers = new Headers({ 'content-type': 'application/json', accept: 'application/json' });
  // ⚠️ Olmazsa `login` (5/15dk) ve `register` (3/saat) limitleri TÜM SİTE için
  //    tek kovaya düşer — günde 3 kayıt.
  if (ip) headers.set('x-forwarded-for', ip);

  // ⚠️ OTURUMUN CİHAZ ETİKETİ TAM BURADA DOĞUYOR. `auth.service.ts` kaydı bir
  //    kez yazar ve `describeDevice()` bu başlığı okur; gönderilmezse oturum
  //    "Bilinmeyen cihaz" olarak KALICI kaydedilir ve sonraki hiçbir istek onu
  //    düzeltmez (ölçüldü). Giriş isteği vekilden GEÇMİYOR, buradan çıkıyor —
  //    yani `proxy.ts`teki `FORWARD_REQUEST_HEADERS` bu yolu kapsamaz.
  const userAgent = request.headers.get('user-agent');
  if (userAgent) headers.set('user-agent', userAgent);

  // 2 — kimlik doğrulama.
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
  const { data } = await unwrap<AuthSessionResponse>(response);

  // 3 — jetonlar sunucuda kalır; tarayıcı yalnızca opak sid görür.
  const sid = randomBytes(32).toString('hex');
  const session: WebSession = {
    accessToken: data.tokens.accessToken,
    refreshToken: extractRefreshToken(response),
    expiresAt: Date.now() + data.tokens.expiresIn * 1000,
    userId: data.user.id,
    role: data.user.role,
  };
  await saveSession(sid, session);
  await setSid(sid);

  // 4 — sepet birleştirme.
  let skipped: CartMergeResultWire['skipped'] = [];
  if (guestId) {
    try {
      const mergeResponse = await fetch(`${apiBaseUrl()}/cart/merge`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Bearer ${session.accessToken}`,
          'Idempotency-Key': mergeIdempotencyKey(data.user.id, guestId),
          ...(ip ? { 'x-forwarded-for': ip } : {}),
        },
        body: JSON.stringify({ sessionId: guestId }),
        cache: 'no-store',
      });
      const merged = await unwrap<CartMergeResultWire>(mergeResponse);
      skipped = merged.data.skipped ?? [];
    } catch (error) {
      // Giriş TAMAMLANIR. Yalnızca loglanır.
      console.error('[oturum] sepet birleştirme başarısız', {
        userId: data.user.id,
        code: error instanceof ApiFailure ? error.code : 'BILINMEYEN',
      });
    }
    // 5 — sonuç ne olursa olsun misafir kimliği silinir.
    await clearGid();
  }

  return { user: data.user, skipped };
}
