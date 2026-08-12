import 'server-only';
import type { NextRequest } from 'next/server';
import { apiBaseUrl } from '../env';
import { csrfViolation, forbiddenEnvelope } from './csrf';
import { ensureGid, GID_COOKIE, SID_COOKIE } from '../session/cookies';
import { getValidSession, refreshNow, SessionRevoked } from '../session/single-flight';
import { deleteSession } from '../session/store';

/**
 * VEKİL — tarayıcı ile API arasındaki tek kapı.
 *
 * Tarayıcı API kökenine ASLA gitmez; jeton sunucuda kalır, CORS ortadan kalkar.
 *
 * ⚠️ VEKİLİN AÇTIĞI DELİK: API'nin `SameSite=Strict` olan `vt_rt` çerezi artık
 *    HİÇBİR ŞEYİ korumuyor — SameSite bir TARAYICI kuralıdır ve Node `fetch`ine
 *    uygulanmaz; tarayıcı da API kökeniyle hiç konuşmuyor. Koruma tamamen
 *    `vt_sid`e ve aşağıdaki Origin denetimine devroldu. Bu denetim uç başına
 *    değil, ORTAK katmanda durur: bir uç eklerken unutulabilecek bir şey
 *    olmamalı.
 */

/**
 * Misafir kimliği gerektiren uç önekleri.
 *
 * Liste DAR tutuluyor: her yola gid basmak, hiç sepet açmamış ziyaretçilere de
 * çerez yazmak ve gereksiz bir kimlik üretmek olurdu.
 */
const GUEST_IDENTITY_PREFIXES = ['/cart', '/outfits', '/checkout', '/tryon'];

/**
 * İstemciden gelip API'ye AYNEN taşınacak başlıklar.
 *
 * ⚠️ `user-agent` LİSTEDE OLMAK ZORUNDA; eksikliği İKİ yerde sessizce
 *    bozuyordu. ÖLÇÜLDÜ: iPhone UA'sıyla giriş yapıldı, `GET /auth/sessions`
 *    yine `"deviceLabel":"Bilinmeyen cihaz"` döndü.
 *      1. `describeDevice()` `meta.userAgent`i `'unknown'` görüyor → "cihaz
 *         bazlı oturum listesi" hiçbir cihaz göstermiyor, yani kullanıcı
 *         yabancı bir oturumu tanıyamıyor ve o ekranın tek işi bu.
 *      2. Daha ağırı: `me.service.ts` → `requestFingerprint()` aynı boş UA'yı
 *         KVKK RIZA KAYDINA yazıyor. Rıza delilinin tarayıcı alanı kalıcı
 *         olarak boş kalıyordu; geçmişe dönük düzeltilemez.
 */
const FORWARD_REQUEST_HEADERS = [
  'content-type',
  'accept',
  'accept-language',
  'idempotency-key',
  'user-agent',
];

/** API'den gelip tarayıcıya AYNEN taşınacak başlıklar. */
const FORWARD_RESPONSE_HEADERS = [
  'content-type',
  'x-request-id',
  'retry-after',
  'idempotent-replay',
];

function errorResponse(
  code: string,
  message: string,
  httpStatus: number,
  retryable = false,
): Response {
  // ⚠️ Vekilin ürettiği hatalar da ZARF biçiminde döner. Düz metin dönseydi
  //    istemcinin `unwrap`ı "JSON olmayan yanıt" dalına düşer ve gerçek sebep
  //    (403 CSRF) kullanıcıya "sunucuya ulaşılamıyor" diye görünürdü.
  return Response.json(
    { error: { code, message, httpStatus, retryable, requestId: 'vekil' } },
    { status: httpStatus },
  );
}

/**
 * ⚠️ GELEN `X-Forwarded-For` ATILIR ve gerçek istemci IP'sinden YENİDEN KURULUR.
 *
 *    Gelen zinciri iletmek, istemcinin kendi IP'sini uydurup hız limitini
 *    atlamasına ya da başkasının kovasını doldurmasına izin verirdi. Ayrıca
 *    API'de `trust proxy: 1` ayarlı; zincire eklemek atlama sayısını değiştirir
 *    ve `deployment.md` §5'in uyardığı sessiz bozulmayı üretir.
 *
 * ⚠️ YAPILMAZSA: `register` limiti scope:'ip' ve 3/saat. Tüm site TEK kovaya
 *    düşer, günde 3 kişi kayıt olabilir ve hata ancak üretimde "kimse kayıt
 *    olamıyor" olarak görünür.
 */
function clientIp(request: NextRequest): string | null {
  const chain = request.headers.get('x-forwarded-for');
  return chain?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip') ?? null;
}

interface UpstreamOptions {
  path: string;
  search: string;
  method: string;
  body: ArrayBuffer | null;
  incoming: NextRequest;
  accessToken: string | null;
  refreshToken: string | null;
  guestId: string | null;
}

async function callUpstream(options: UpstreamOptions): Promise<Response> {
  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = options.incoming.headers.get(name);
    if (value) headers.set(name, value);
  }

  const ip = clientIp(options.incoming);
  if (ip) headers.set('x-forwarded-for', ip);

  if (options.accessToken) headers.set('authorization', `Bearer ${options.accessToken}`);

  // Misafir sepeti. ⚠️ `cart.owner.ts`: token varsa bu başlık YOK SAYILIR, o
  // yüzden üye isteklerinde göndermek zararsız ama gereksiz.
  if (!options.accessToken && options.guestId) headers.set('x-session-id', options.guestId);

  // ⚠️ Gerçek çerez yolu `/v1/auth` — refresh, logout ve sessions uçlarının
  //    HEPSİ vt_rt istiyor. Yalnız refresh'e göndermek eksik olurdu.
  if (options.refreshToken && options.path.startsWith('/auth/')) {
    headers.set('cookie', `vt_rt=${encodeURIComponent(options.refreshToken)}`);
  }

  return fetch(`${apiBaseUrl()}${options.path}${options.search}`, {
    method: options.method,
    headers,
    body: options.body,
    cache: 'no-store',
    redirect: 'manual',
  });
}

function toClientResponse(upstream: Response): Response {
  const headers = new Headers();
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  // ⚠️ API'nin Set-Cookie'si tarayıcıya GEÇİRİLMEZ: `vt_rt` Redis'te durur,
  //    tarayıcıda işi yok. Geçirilseydi tarayıcıda hiçbir zaman kullanılmayacak
  //    ikinci bir jeton kopyası dolaşırdı.
  return new Response(upstream.body, { status: upstream.status, headers });
}

/** Yanıt gövdesini bozmadan hata kodunu okumak için — 401 dalında gerekiyor. */
async function errorCodeOf(response: Response): Promise<{ code: string | null; body: string }> {
  const body = await response.text();
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
      return { code: (parsed as { error: { code?: string } }).error.code ?? null, body };
    }
  } catch {
    // JSON değilse kod da yok; gövde olduğu gibi geri verilir.
  }
  return { code: null, body };
}

export async function proxyRequest(request: NextRequest, segments: string[]): Promise<Response> {
  // ⚠️ İlk satır: kimlik okunmadan ÖNCE. Sonraya bırakılsaydı çapraz siteden
  //    gelen bir istek en azından oturum yenilemesini tetikleyebilirdi.
  if (csrfViolation(request)) return forbiddenEnvelope();

  const path = `/${segments.join('/')}`;
  const search = request.nextUrl.search;
  const method = request.method;

  // ⚠️ Gövde AKIŞ olarak değil, TAMPONA alınarak taşınır: 401 sonrası isteği
  //    BİR KEZ tekrarlamamız gerekiyor ve tüketilmiş bir akış tekrarlanamaz.
  //    Büyük yüklemeler zaten buradan geçmiyor (medya imzalı URL ile doğrudan
  //    R2'ye gidiyor).
  const body = method === 'GET' || method === 'HEAD' ? null : await request.arrayBuffer();

  const sid = request.cookies.get(SID_COOKIE)?.value ?? null;

  /**
   * ⚠️ MİSAFİR KİMLİĞİ BURADA DOĞAR — başka hiçbir yerde.
   *
   *    `cart.owner.ts` misafir için `X-Session-Id` ZORUNLU tutuyor: kimlik
   *    üretilmezse misafirin sepete attığı ilk ürün 400 ile geri döner. Kimliği
   *    "giriş sayfası açılırken" gibi bir yerde üretmek, sepete ekleme yolundan
   *    KOPUK bir bağ olurdu — bu depoda üç kez yaşanmış hatanın deseni.
   */
  const guestId =
    !sid && GUEST_IDENTITY_PREFIXES.some((prefix) => path.startsWith(prefix))
      ? await ensureGid()
      : (request.cookies.get(GID_COOKIE)?.value ?? null);

  let session = null;
  if (sid) {
    try {
      session = await getValidSession(sid);
    } catch (error) {
      if (error instanceof SessionRevoked) return oturumDusuruldu(error.reason);
      throw error;
    }
  }

  let upstream = await callUpstream({
    path,
    search,
    method,
    body,
    incoming: request,
    accessToken: session?.accessToken ?? null,
    refreshToken: session?.refreshToken ?? null,
    guestId,
  });

  if (upstream.status === 401 && sid && session) {
    const { code, body: originalBody } = await errorCodeOf(upstream);

    if (code === 'AUTH_TOKEN_EXPIRED') {
      // KATMAN 0 kaçırdıysa buraya düşülür; yenileme yine tek uçuştan geçer.
      try {
        const yenilenmis = await refreshNow(sid);
        if (yenilenmis) {
          upstream = await callUpstream({
            path,
            search,
            method,
            body,
            incoming: request,
            accessToken: yenilenmis.accessToken,
            refreshToken: yenilenmis.refreshToken,
            guestId,
          });
          return toClientResponse(upstream);
        }
      } catch (error) {
        if (error instanceof SessionRevoked) return oturumDusuruldu(error.reason);
        throw error;
      }
    }

    if (code === 'AUTH_REFRESH_REUSED') {
      await deleteSession(sid);
      return oturumDusuruldu('guvenlik');
    }

    // Gövde tüketildi; olduğu gibi geri kur.
    const headers = new Headers();
    for (const name of FORWARD_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(originalBody, { status: upstream.status, headers });
  }

  return toClientResponse(upstream);
}

/**
 * Oturum düştü: çerezler temizlenir ve istemciye yönlendirme SEBEBİ bildirilir.
 * `303` yerine zarf dönüyoruz çünkü çağıran taraf çoğunlukla `fetch` — tarayıcı
 * yönlendirmeyi izlese bile kullanıcı hiçbir şey görmezdi.
 */
function oturumDusuruldu(reason: 'guvenlik' | 'suresi-doldu'): Response {
  const response = errorResponse(
    reason === 'guvenlik' ? 'AUTH_REFRESH_REUSED' : 'AUTH_TOKEN_EXPIRED',
    reason === 'guvenlik'
      ? 'Güvenlik nedeniyle tüm oturumlarınız kapatıldı. Lütfen tekrar giriş yapın.'
      : 'Oturumunuz sona erdi, tekrar giriş yapın.',
    401,
  );
  response.headers.append(
    'set-cookie',
    `${SID_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
  response.headers.append(
    'set-cookie',
    `${GID_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
  return response;
}
