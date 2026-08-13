import 'server-only';
import { redirect } from 'next/navigation';
import { apiBaseUrl } from '../env';
import { GID_COOKIE, readSid } from '../session/cookies';
import { getValidSession, SessionRevoked } from '../session/single-flight';
import { cookies } from 'next/headers';
import { buildInit, buildQuery, unwrap, type ApiResult, type RequestOptions } from './core';

/**
 * SUNUCU BİLEŞENİNDEN KİMLİKLİ OKUMA — sepet, sipariş, gardırop, KVKK, panel.
 *
 * ⚠️ Bu dosya iki ayrı ajanın birbirinden habersiz yazdığı iki kopyanın
 *    birleşimidir (`sepet/sepet-sunucu.ts` ve `hesabim/_lib/hesap-istek.ts`).
 *    İkisi de aynı üç adımı yapıyordu — sid oku, `getValidSession`, `Bearer` —
 *    ama oturum düşünce FARKLI davranıyorlardı. Kopyalar kaldığı sürece
 *    "oturum düştüğünde ne olur" sorusunun deponun iki yerinde iki cevabı
 *    olurdu; birleşince fark, ARAYÜZ KARARI olarak açıkça seçilebilir hale
 *    geliyor (aşağıdaki `DusmeDavranisi`).
 *
 * ⚠️ NEDEN `serverFetch` DEĞİL: `lib/api/server.ts` bilinçli olarak jeton
 *    TAŞIMAZ ve taşımamalı. Kimlikli bir kaynağı oradan okumak, kullanıcının
 *    sepetini misafir sepeti sanmak olurdu.
 *
 * ⚠️ NEDEN `/api/*` VEKİLİNDEN GEÇMİYOR: vekil bir ROUTE HANDLER'dır, girdisi
 *    `NextRequest`tir; bir Sunucu Bileşeninden çağırmanın tek yolu kendi
 *    sunucumuza HTTP açmaktır. Bu her sayfada tarayıcı → Next → Next → API
 *    turu ve tek worker'lı geliştirmede kendi kendini bekleyen bir istek demek.
 *    Daha ağırı: vekil misafir kimliğini `cookies().set()` ile ÜRETİYOR; o
 *    çağrı ayrı bir istek bağlamında çalışır ve ürettiği `Set-Cookie` bizim
 *    `fetch`imizde kalır, tarayıcıya HİÇ ULAŞMAZ — yani her SSR'da yeni bir
 *    `vt_gid` doğar, hiçbiri yapışmaz ve sepet her yenilemede boş görünürdü.
 *    Kuralın koruduğu şey ihlal edilmiyor: jeton tarayıcıya hiç çıkmıyor.
 *    Vekil TARAYICININ tek kapısıdır — sunucunun değil.
 *
 * ⚠️ `import 'server-only'`: bu dosya bir İstemci Bileşenine sızarsa DERLEME
 *    KIRILIR. Kırılmasaydı `getValidSession` üzerinden ioredis ve oturum
 *    jetonları tarayıcı paketine girerdi.
 *
 * ⚠️ Yenileme burada ELLE yapılmaz: `getValidSession` tek uçuşlu yenileyiciyi
 *    çağırır. İkinci bir yenileme yolu açmak `single-flight.ts`i
 *    anlamsızlaştırır ve `AUTH_REFRESH_REUSED` ile kullanıcıyı TÜM
 *    cihazlarından atar.
 */

/** Kimliğin bugünkü hâli — çağıran taraf buna göre davranır. */
export type Kimlik =
  | { kind: 'uye'; token: string }
  /** Girişsiz ziyaretçi, ama `vt_gid` var: misafir sepeti okunabilir. */
  | { kind: 'misafir'; guestId: string }
  /** Ne oturum ne misafir kimliği var. */
  | { kind: 'yok' }
  /** Oturum vardı, düştü. `guvenlik` kullanıcıya ANLATILIR, diğeri sessizdir. */
  | { kind: 'dustu'; sebep: 'guvenlik' | 'suresi-doldu' };

/**
 * ⚠️ Misafir kimliği burada ÜRETİLMEZ, yalnızca OKUNUR. Üretim tek yerde:
 *    vekil (`proxy.ts` → `GUEST_IDENTITY_PREFIXES`), yani tarayıcının çerezi
 *    gerçekten alabildiği yol. Çerez yoksa sepet de yoktur — hiç ürün eklememiş
 *    ziyaretçi; `null` gid ile API'ye gitmek `cart.owner.ts`ten 400 alırdı.
 */
export async function kimligiCoz(): Promise<Kimlik> {
  const sid = await readSid();

  if (!sid) {
    const gid = (await cookies()).get(GID_COOKIE)?.value;
    return gid ? { kind: 'misafir', guestId: gid } : { kind: 'yok' };
  }

  try {
    const oturum = await getValidSession(sid);
    if (!oturum) return { kind: 'dustu', sebep: 'suresi-doldu' };
    return { kind: 'uye', token: oturum.accessToken };
  } catch (error) {
    if (error instanceof SessionRevoked) return { kind: 'dustu', sebep: error.reason };
    throw error;
  }
}

/** Kimliği API'nin anladığı başlıklara çevirir. */
export function kimlikBasliklari(kimlik: Kimlik): Record<string, string> | null {
  if (kimlik.kind === 'uye') return { authorization: `Bearer ${kimlik.token}` };
  // ⚠️ `cart.owner.ts`: token varsa bu başlık YOK SAYILIR — ikisi birlikte
  //    gönderilmez, misafir başlığı yalnız token yokken anlamlıdır.
  if (kimlik.kind === 'misafir') return { 'x-session-id': kimlik.guestId };
  return null;
}

/**
 * Kimlikli GET/POST. Başarısızlıkta `ApiFailure` FIRLATIR; çağıran sayfa
 * yakalayıp `<SunucuHatasi>` ile gösterir.
 *
 * `donusYolu` yalnızca oturum düştüğünde `/login?next=` için kullanılır.
 * ⚠️ Sunucu Bileşeninde geçerli yolu okumanın güvenilir bir yolu YOK
 *    (`headers()` istek yolunu taşımıyor), bu yüzden çağıran taraf yazar.
 */
export async function hesapFetch<T, P extends string>(
  path: P,
  donusYolu: string,
  options: RequestOptions<P> = {} as RequestOptions<P>,
): Promise<ApiResult<T>> {
  const kimlik = await kimligiCoz();

  // ⚠️ `redirect()` bir istisna FIRLATIR (`NEXT_REDIRECT`) ve bu çağrı hiçbir
  //    `try` bloğunun İÇİNDE olmamalı; yutulursa kullanıcı boş bir hesap
  //    ekranında kalır.
  if (kimlik.kind !== 'uye') {
    girise(donusYolu, kimlik.kind === 'dustu' ? kimlik.sebep : null);
  }

  const init = buildInit(options);
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${kimlik.token}`);

  const response = await fetch(`${apiBaseUrl()}${path}${buildQuery(options.query)}`, {
    ...init,
    headers,
    // ⚠️ Kişisel veri ÖNBELLEKLENMEZ. Varsayılana bırakılsaydı bir kullanıcının
    //    sipariş listesi başka bir kullanıcıya servis edilebilirdi.
    cache: 'no-store',
  });

  return unwrap<T>(response);
}

function girise(donusYolu: string, sebep: 'guvenlik' | 'suresi-doldu' | null): never {
  const arama = new URLSearchParams({ next: donusYolu });
  // ⚠️ Yalnızca 'guvenlik' kullanıcıya ANLATILIR. "Süresi doldu" sessizce
  //    yeniden giriş ister; her 15 dakikada bir "oturumunuz düştü" demek, tek
  //    uçuşlu yenilemenin gizlediği şeyi geri getirirdi.
  if (sebep === 'guvenlik') arama.set('sebep', 'guvenlik');
  redirect(`/login?${arama.toString()}`);
}

/**
 * SUNUCUDAN VERİ ÇEKMEYEN ama GİRİŞ İSTEYEN ekranın kapısı.
 *
 * ⚠️ `hesapFetch`in yönlendirme yarısı, isteğin kendisi olmadan. Stil
 *    danışmanı gibi bütün verisini istemciden alan bir ekranda kapı
 *    olmasaydı ziyaretçi boş sohbet kutusuna yazar ve ancak GÖNDERDİKTEN
 *    sonra girişe atılırdı — yazdığı da kaybolurdu.
 *
 * ⚠️ Çağıran taraf `redirect('/login?next=…')` yazmasın diye burada: `?next=`
 *    kaçırma ve `sebep=guvenlik` ayrımı TEK yerde kalmalı, ikisi de sessizce
 *    yanlış yazılabilecek şeyler (açık yönlendirme kapısı `lib/donus-yolu.ts`
 *    tarafında kapalı ve o kapı yalnız bu biçimi bekliyor).
 *
 * ⚠️ BU BİR GÜVENLİK KATMANI DEĞİL, ARAYÜZ KAPISI — `guard.ts` başlığındaki üç
 *    katman ayrımının aynısı. Gerçek koruma API guard'larında: danışman
 *    uçlarının hiçbiri `@Public()` değil, çünkü her mesaj sağlayıcıya para
 *    ödetiyor ve kota kullanıcı başına tanımlı.
 */
export async function girisGerekli(donusYolu: string): Promise<void> {
  const kimlik = await kimligiCoz();

  // ⚠️ `girise` `redirect()` çağırıyor, yani FIRLATIYOR (`NEXT_REDIRECT`);
  //    hiçbir `try` bloğunun içinde olmamalı.
  if (kimlik.kind !== 'uye') {
    girise(donusYolu, kimlik.kind === 'dustu' ? kimlik.sebep : null);
  }
}
