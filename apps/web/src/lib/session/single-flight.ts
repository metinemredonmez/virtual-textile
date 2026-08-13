import 'server-only';
import { ApiFailure, type AuthSessionResponse } from '@vt/contracts';
import { apiBaseUrl } from '../env';
import { unwrap } from '../api/core';
import {
  deleteSession,
  loadSession,
  redis,
  refreshBudgetExceeded,
  saveSession,
  type WebSession,
} from './store';

/**
 * ═══ REFRESH ROTASYONU — TEK UÇUŞ ═══
 *
 * ÖLÇÜM 1: aynı `vt_rt` ile 4 PARALEL refresh → dördü de 200, dört ayrı oturum
 *          doğdu. Sebep `token.service.ts` — findUnique → revokedAt kontrolü →
 *          update ATOMİK DEĞİL (klasik TOCTOU).
 * ÖLÇÜM 2: 15 ms arayla aynı istek → 401 AUTH_REFRESH_REUSED + tüm oturumlar
 *          düşürüldü.
 *
 * ⚠️ Yani tehlike "tam aynı anda" değil, **~10 ms'lik pencerenin DIŞINDAKİ her
 *    şey**. Yarış penceresi dar, felaket bölgesi geniş: kullanıcı bütün
 *    cihazlarından atılıyor.
 *
 * ⚠️ SIRALAMA: backend'de `rotate`i atomik yapmak (UPDATE ... WHERE revokedAt IS
 *    NULL RETURNING *) doğru bir düzeltmedir ama TEK BAŞINA durumu KÖTÜLEŞTİRİR:
 *    4 paralel istekten 3'ü REUSED alır. Önce buradaki tek uçuş, SONRA backend.
 *
 * ⚠️ BU KODUN DOĞRULUĞU YALNIZCA NEGATİF BİR GÖZLEMLE GÖRÜLÜR: üretim
 *    loglarında `AUTH_REFRESH_REUSED` satırının OLMAMASI. Bozulduğunda hiçbir
 *    test kırılmaz. Bu yüzden testi taklit nesneyle değil, GERÇEK Redis + GERÇEK
 *    API + N paralel istek ile yazılır.
 */

/** KATMAN 0 — bu eşiğin üstünde jeton olduğu gibi kullanılır. */
const YENILEME_ESIGI_MS = 90_000;

/** KATMAN 2 — kilit ömrü. Yenileme çağrısı bundan uzun sürerse zaten bitmiştir. */
const KILIT_MS = 10_000;
const BEKLEME_ADIMI_MS = 50;
const BEKLEME_ADIM_SAYISI = 20;

/**
 * KATMAN 1 — süreç içi uçuş kaydı.
 *
 * Aynı süreçteki 2., 3., 4. istek hiç API'ye gitmez.
 * ⚠️ TEK BAŞINA YETMEZ: PM2 cluster'da Next çok worker koşar, iki sekme farklı
 *    worker'a düşer ve bu Map onları GÖRMEZ. Taklit nesneyle yazılmış bir test
 *    yeşil kalır, gerçek topolojide bağlantı kopuktur.
 */
const inFlight = new Map<string, Promise<WebSession | null>>();

/** Oturum kurtarılamaz — çağıran çerezleri temizleyip /login'e göndermeli. */
export class SessionRevoked extends Error {
  constructor(readonly reason: 'guvenlik' | 'suresi-doldu') {
    super(`Oturum düşürüldü: ${reason}`);
    this.name = 'SessionRevoked';
  }
}

function expiryFrom(tokens: AuthSessionResponse['tokens']): number {
  return Date.now() + tokens.expiresIn * 1000;
}

/** API'nin döndürdüğü yeni `vt_rt` değerini Set-Cookie başlığından çıkarır. */
function extractRefreshToken(response: Response, fallback: string): string {
  for (const raw of response.headers.getSetCookie()) {
    const match = /^vt_rt=([^;]*)/.exec(raw);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  // Rotasyon başlığı gelmezse eski jetonu korumak, hiç jeton bırakmamaktan iyi.
  return fallback;
}

async function callRefresh(sid: string, current: WebSession): Promise<WebSession> {
  const response = await fetch(`${apiBaseUrl()}/auth/refresh`, {
    method: 'POST',
    headers: {
      // ⚠️ Gerçek Set-Cookie yolu `/v1/auth` (auth.controller.ts), belgede yazan
      //    `/v1/auth/refresh` değil. Pratik sonucu: `/v1/auth/*` altındaki HER
      //    çağrıda (refresh, logout, sessions) vt_rt gönderilmelidir.
      cookie: `vt_rt=${encodeURIComponent(current.refreshToken)}`,
      accept: 'application/json',
    },
    cache: 'no-store',
  });

  const { data } = await unwrap<AuthSessionResponse>(response);
  const yeni: WebSession = {
    accessToken: data.tokens.accessToken,
    refreshToken: extractRefreshToken(response, current.refreshToken),
    expiresAt: expiryFrom(data.tokens),
    userId: data.user.id,
    role: data.user.role,
  };
  await saveSession(sid, yeni);
  return yeni;
}

async function refreshWithLock(sid: string, current: WebSession): Promise<WebSession> {
  if (await refreshBudgetExceeded(sid)) {
    console.error('[oturum] refresh bütçesi aşıldı — tek uçuş kaçırıyor', { sid });
    await deleteSession(sid);
    throw new SessionRevoked('guvenlik');
  }

  // KATMAN 2 — süreçler arası kilit.
  const kilit = await redis().set(`lock:refresh:${sid}`, '1', 'PX', KILIT_MS, 'NX');

  if (kilit === 'OK') {
    try {
      return await callRefresh(sid, current);
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'AUTH_REFRESH_REUSED') {
        // ⚠️ YENİDEN DENENMEZ. Backend bu noktada tüm oturumları düşürdü;
        //    tekrar denemek yalnızca ikinci bir güvenlik olayı üretir.
        console.error('[oturum] AUTH_REFRESH_REUSED — tek uçuş kaçırdı', {
          sid,
          requestId: error.requestId,
        });
        await deleteSession(sid);
        throw new SessionRevoked('guvenlik');
      }
      throw error;
    } finally {
      await redis().del(`lock:refresh:${sid}`);
    }
  }

  // Kilit başkasında: Redis'i yeniden okuyup `expiresAt`in ilerlemesini bekle.
  // ⚠️ pub/sub gerekmiyor — kilit sahibinin işi bittiği JETONUN KENDİSİNDEN
  //    anlaşılıyor. Bir kanal eklemek üçüncü bir hata kaynağı olurdu.
  for (let i = 0; i < BEKLEME_ADIM_SAYISI; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, BEKLEME_ADIMI_MS));
    const taze = await loadSession(sid);
    if (!taze) throw new SessionRevoked('suresi-doldu');
    if (taze.expiresAt > current.expiresAt) return taze;
  }

  // Kilit sahibi çökmüş olabilir: kilit PX ile kendiliğinden düşecek, bu istek
  // bayat jetonla devam eder ve gerekirse 401 yolundan tekrar dener.
  return current;
}

/**
 * Geçerli oturumu döndürür; gerekiyorsa TEK UÇUŞLA yeniler.
 *
 * KATMAN 0 sayesinde yenileme 401'e REAKSİYON olmaktan çıkıp PLANLI hale gelir;
 * 401 yolu istisna olur.
 */
export async function getValidSession(sid: string): Promise<WebSession | null> {
  const session = await loadSession(sid);
  if (!session) return null;
  if (session.expiresAt - Date.now() > YENILEME_ESIGI_MS) return session;
  return refreshNow(sid);
}

/**
 * Eşiğe bakmadan yeniler — 401 `AUTH_TOKEN_EXPIRED` yolundan çağrılır.
 *
 * ⚠️ AYNI uçuş kaydını kullanır. Ayrı bir Map'i olsaydı proaktif yenileme ile
 *    401 tepkisi aynı anda çakışır ve tek uçuşun tamamı anlamsızlaşırdı.
 */
export function refreshNow(sid: string): Promise<WebSession | null> {
  const running = inFlight.get(sid);
  if (running) return running;

  /**
   * ⚠️ KAYIT İLK `await`TEN ÖNCE YAZILIR — bu satırların sırası KATMAN 1'in
   *    tamamıdır.
   *
   *    Eskiden `loadSession(sid)` (Redis I/O) doğrudan burada `await`
   *    ediliyordu ve harita ANCAK ONDAN SONRA yazılıyordu. Aynı tick'te gelen
   *    N istek yukarıdaki `get`i `undefined` görüyor, hepsi `loadSession`da
   *    askıya alınıyor ve hepsi KENDİ işini kuruyordu; dosyanın kendi iddiası
   *    ("2., 3., 4. istek hiç API'ye gitmez") bu yolda geçersizdi.
   *
   *    Görünür bedeli KATMAN 2 değil BÜTÇE sayacıydı: `refreshWithLock`
   *    sayacı kilidi ALMADAN ÖNCE artırıyor (`store.ts` INCR, tavan 20/dk),
   *    yani kilidi kaybeden her istek de sayacı artırıyordu. Tek sayfada çok
   *    kimlikli fetch + PM2 cluster → tavan aşılır, oturum SİLİNİR ve
   *    kullanıcı "Güvenlik nedeniyle tüm oturumlarınız kapatıldı" görür;
   *    backend hiçbir şey yapmamışken. `store.ts:68` bu sayacı zaten "tek
   *    uçuşun bir yerde kaçırdığının kanıtı" diye tanımlıyordu — kaçırdığı
   *    yer burasıydı.
   *
   *    Bu yüzden fonksiyon `async` DEĞİL: `async` olsaydı gövde yine bir
   *    mikro-görevde çalışır ve `set` senkron olmazdı.
   */
  const job = (async (): Promise<WebSession | null> => {
    const session = await loadSession(sid);
    if (!session) return null;
    return refreshWithLock(sid, session);
  })().finally(() => {
    // ⚠️ YALNIZ KENDİ kaydını siler. Koşulsuz `delete` ilk biten işin İKİNCİ
    //    işin kaydını düşürmesi demekti; tek uçuş bir sonraki turda yine
    //    kaçırırdı.
    if (inFlight.get(sid) === job) inFlight.delete(sid);
  });

  inFlight.set(sid, job);
  return job;
}
