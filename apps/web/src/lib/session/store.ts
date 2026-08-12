import 'server-only';
import Redis from 'ioredis';
import { sessionRedisUrl } from '../env';
import { SESSION_MAX_AGE_SECONDS } from './cookies';

/**
 * WEB OTURUM DEPOSU.
 *
 * Tarayıcı yalnızca `vt_sid` taşır; jetonların tamamı burada durur.
 * `vt_rt` (API'nin httpOnly refresh çerezi) da burada saklanır: tarayıcı API
 * kökenine hiç gitmediği için o çerezi tarayıcıda tutmanın bir anlamı yok.
 */

export interface WebSession {
  accessToken: string;
  /** API'nin `vt_rt` çerezine koyduğu değer. Vekil bunu elle geri gönderir. */
  refreshToken: string;
  /** Erişim jetonunun bitiş anı — epoch ms. */
  expiresAt: number;
  userId: string;
  role: 'CUSTOMER' | 'SELLER_USER' | 'SUPPORT' | 'ADMIN';
}

let client: Redis | null = null;

/**
 * ⚠️ Modül düzeyinde tekil: her istekte yeni bağlantı açmak geliştirmede
 *    HMR ile onlarca bağlantı, üretimde bağlantı havuzu tükenmesi demek.
 */
export function redis(): Redis {
  client ??= new Redis(sessionRedisUrl(), { maxRetriesPerRequest: 3, lazyConnect: false });
  return client;
}

const key = (sid: string) => `websess:${sid}`;

export async function loadSession(sid: string): Promise<WebSession | null> {
  const raw = await redis().get(key(sid));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WebSession;
  } catch {
    // Bozuk kayıt oturumu düşürür; ayrıştırılamayan bir jetonla devam etmek
    // her istekte 401 üretirdi.
    await redis().del(key(sid));
    return null;
  }
}

export async function saveSession(sid: string, session: WebSession): Promise<void> {
  await redis().set(key(sid), JSON.stringify(session), 'EX', SESSION_MAX_AGE_SECONDS);
}

export async function deleteSession(sid: string): Promise<void> {
  await redis().del(key(sid));
}

/**
 * `/v1/auth/refresh` backend'de ÇIPLAK — login 5/15dk, register 3/sa var, refresh
 * yok. Vekil sid başına 20/dk tavan koyar.
 *
 * ⚠️ Tek uçuş doğru çalışırken bu sayaç ASLA dolmaz. Dolduysa tek uçuşun bir
 *    yerde kaçırdığının İKİNCİ kanıtıdır — sessizce yutulmaz, loglanır.
 */
export async function refreshBudgetExceeded(sid: string): Promise<boolean> {
  const budgetKey = `refreshrate:${sid}`;
  const count = await redis().incr(budgetKey);
  if (count === 1) await redis().expire(budgetKey, 60);
  return count > 20;
}
