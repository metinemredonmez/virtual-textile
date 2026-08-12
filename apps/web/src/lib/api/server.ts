import 'server-only';
import { headers } from 'next/headers';
import { apiBaseUrl } from '../env';
import { buildInit, buildQuery, unwrap, type ApiResult, type RequestOptions } from './core';

/**
 * SUNUCU BİLEŞENİ → DOĞRUDAN API.
 *
 * ⚠️ Bu yol YALNIZCA kimlik gerektirmeyen, genel ve önbelleklenebilir uçlar
 *    içindir (ürün listesi, ürün detayı, kategoriler). Kimlik gerektiren her
 *    şey vekilden geçer — jeton bu dosyada YOKTUR ve olmamalıdır.
 *    Gerekçe ve bedeli: frontend-mimari.md §5.
 */

type ServerOptions<P extends string> = RequestOptions<P> & {
  /**
   * Gerçek istemci IP'sini API'ye taşı.
   *
   * ⚠️ ÖLÇÜLDÜ: `/products` ucunda `@RateLimit({name:'search', scope:'ip'})` var
   *    ve limit 60/dk. SSR isteği Next sunucusundan çıktığı için API TÜM
   *    ziyaretçileri TEK kovaya koyar; dakikada 60 sayfa görüntülemeden sonra
   *    site herkese 429 döndürür. Hata ancak trafik gelince görünür.
   *
   * ⚠️ Bedeli dürüstçe: `headers()` okumak rotayı DİNAMİK yapar. Statik
   *    üretilecek sayfalarda (revalidate ile önbelleklenen vitrin blokları)
   *    `false` bırakılır; orada zaten istek başına bir çağrı yok.
   */
  forwardClientIp?: boolean;
};

/**
 * ⚠️ GELEN `X-Forwarded-For` ZİNCİRİ İLETİLMEZ, YENİDEN KURULUR.
 *    Zinciri olduğu gibi geçirmek istemcinin kendi IP'sini uydurup hız
 *    limitini atlamasına ya da başkasının kovasını doldurmasına izin verirdi.
 *    API tarafında `trust proxy: 1` ayarlı; tek atlama görmesi gerekiyor.
 */
async function clientIpHeader(): Promise<Record<string, string>> {
  const incoming = await headers();
  const chain = incoming.get('x-forwarded-for');
  const clientIp = chain?.split(',')[0]?.trim() ?? incoming.get('x-real-ip') ?? '';
  return clientIp ? { 'x-forwarded-for': clientIp } : {};
}

export async function serverFetch<T, P extends string>(
  path: P,
  options: ServerOptions<P> = {} as ServerOptions<P>,
): Promise<ApiResult<T>> {
  const { forwardClientIp = false, ...rest } = options;
  const init = buildInit(rest as RequestOptions<P>);

  if (forwardClientIp) {
    const merged = new Headers(init.headers);
    for (const [key, value] of Object.entries(await clientIpHeader())) merged.set(key, value);
    init.headers = merged;
  }

  const response = await fetch(`${apiBaseUrl()}${path}${buildQuery(rest.query)}`, init);
  return unwrap<T>(response);
}
