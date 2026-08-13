import { ApiFailure, errorMessage, type ApiErrorBody, type ResponseMeta } from '@vt/contracts';

/**
 * ZARF AÇMA — ortamdan bağımsız çekirdek.
 *
 * Bu dosya `server-only` DEĞİLDİR ve `fetch` dışında hiçbir şeye dokunmaz:
 * Sunucu Bileşeni de, route handler vekili de, İstemci Bileşeni de aynı
 * ayrıştırıcıyı kullanmalı. Üç ayrı ayrıştırıcı, üç ayrı hata davranışı demek
 * olurdu ve aradaki fark ancak kullanıcı garip bir ekran gördüğünde anlaşılırdı.
 */

export interface ApiResult<T> {
  data: T;
  /** ⚠️ `nextCursor` ve `total` BURADADIR, `data` içinde değil. */
  meta: ResponseMeta;
}

/**
 * `Idempotency-Key` başlığı ZORUNLU olan uçlar.
 *
 * ⚠️ Anahtar burada OTOMATİK ÜRETİLMEZ. Üretilseydi "her denemede yeni anahtar"
 *    varsayılan davranış olurdu — yani en tehlikeli davranış (aynı siparişin
 *    ikinci kez oluşması) sessizce varsayılan olurdu. Bunun yerine kapı TİPTE:
 *    aşağıdaki yollardan birine `idempotencyKey` vermeden istek atmak DERLENMEZ.
 *    `SupportedTryOnCategory` desenindeki gerekçenin aynısı.
 */
export type IdempotentPath =
  | '/cart/merge'
  | '/checkout/pay'
  | '/tryon'
  | '/tryon/outfit'
  | '/stylist/conversations'
  | '/seller/apply'
  | '/seller/products/bulk-upload'
  | '/seller/finance/payout'
  | `/orders/${string}/cancel`
  | `/orders/${string}/returns`
  | `/seller/packages/${string}/shipment`
  | `/seller/returns/${string}`
  | `/seller/products/${string}/images/${string}/confirm`
  | `/me/photos/${string}/confirm`
  | `/logistics/packages/${string}/delivered`
  | `/admin/orders/${string}/refund`
  | `/admin/payouts/${string}/approve`;

type IdempotencyOption<P extends string> = P extends IdempotentPath
  ? { idempotencyKey: string }
  : { idempotencyKey?: never };

export type RequestOptions<P extends string> = Omit<RequestInit, 'body'> & {
  /** Nesne verilirse JSON'a çevrilir ve content-type eklenir. */
  json?: unknown;
  query?: Record<string, string | number | boolean | undefined | null | string[]>;
} & IdempotencyOption<P>;

const JSON_TYPE = 'application/json';

function requestIdOf(response: Response): string {
  return response.headers.get('X-Request-Id') ?? 'yok';
}

/**
 * Ağ/vekil katmanının ürettiği, zarf biçiminde OLMAYAN hatalar için.
 *
 * ⚠️ METİN ARTIK PARAMETRE DEĞİL, KODDAN TÜRETİLİYOR. Burada üç çağrı yeri
 *    kendi Türkçe cümlesini yazıyordu ("Sunucuya şu anda ulaşılamıyor.",
 *    "Beklenmeyen bir hata oluştu.") — yani ekranda katalog dışında ikinci bir
 *    metin kaynağı vardı ve çok dilde o cümleler İngilizce arayüzde Türkçe
 *    kalırdı. Artık `ERROR_CATALOG` tek kaynak; `ApiFailure.mesaj(locale)`
 *    gösterim anında doğru dili seçiyor.
 *
 * ⚠️ Buradaki metin yine de TÜRKÇE dolduruluyor ve bu doğru: `userMessage`
 *    telde giden sürüm sapması yedeğinin karşılığı, gösterilecek metin değil.
 */
function synthesize(
  code: ApiErrorBody['code'],
  httpStatus: number,
  retryable: boolean,
  requestId: string,
): ApiFailure {
  return new ApiFailure({
    code,
    message: errorMessage(code, { params: { requestId } }),
    httpStatus,
    retryable,
    requestId,
  });
}

export function buildQuery(query: RequestOptions<string>['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    // Tekrarlanan parametre: ?color=Siyah&color=Bej — API dizi olarak okuyor.
    if (Array.isArray(value)) for (const item of value) params.append(key, item);
    else params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Yanıtı zarftan çıkarır. Başarısızlıkta `ApiFailure` FIRLATIR.
 *
 * ⚠️ 204'ün GÖVDESİ YOKTUR ve `res.json()` orada SyntaxError fırlatır; o hata
 *    yakalanmazsa BAŞARILI bir istek (logout, sepet kalemi silme, oturum iptali)
 *    kullanıcıya "sunucu çöktü" diye görünür.
 */
export async function unwrap<T>(response: Response): Promise<ApiResult<T>> {
  const requestId = requestIdOf(response);

  if (response.status === 204) {
    return { data: undefined as T, meta: { requestId } };
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes(JSON_TYPE)) {
    // ⚠️ Vekil/ters vekil devrede olduğu için HTML hata sayfası veya boş gövde
    //    görmek mümkün. Bunu JSON sanıp ayrıştırmaya çalışmak asıl sorunu
    //    "Unexpected token <" diye gizler.
    const preview = (await response.text()).slice(0, 200);
    console.error('[api] JSON olmayan yanıt', { status: response.status, requestId, preview });
    throw synthesize(
      response.ok ? 'INTERNAL_ERROR' : 'UPSTREAM_UNAVAILABLE',
      response.status,
      !response.ok,
      requestId,
    );
  }

  const body: unknown = await response.json();

  if (!response.ok) {
    if (typeof body === 'object' && body !== null && 'error' in body) {
      throw new ApiFailure((body as { error: ApiErrorBody }).error);
    }
    throw synthesize('INTERNAL_ERROR', response.status, response.status >= 500, requestId);
  }

  const success = body as { data: T; meta?: ResponseMeta };
  return { data: success.data, meta: success.meta ?? { requestId } };
}

/**
 * Sayfalı uçlar için tek okuma noktası.
 *
 * ⚠️ `data` KOŞULLU BİR ŞEKİLDİR: denetleyici yalnızca `{items, nextCursor}`
 *    döndürürse zarf `data`yı ÇIPLAK DİZİ yapar; `facets`/`didYouMean` gibi
 *    kardeş alanlar varsa nesne olarak bırakır. Yalnız birini bilen bir istemci
 *    diğerinde sessizce `undefined.items` okur.
 */
export function list<T>(result: ApiResult<unknown>): {
  items: T[];
  nextCursor: string | null;
  total: number | null;
  extra: Record<string, unknown>;
} {
  const { data, meta } = result;
  if (Array.isArray(data)) {
    return {
      items: data as T[],
      nextCursor: meta.nextCursor ?? null,
      total: meta.total ?? null,
      extra: {},
    };
  }
  const { items, ...extra } = (data ?? {}) as { items?: T[] } & Record<string, unknown>;
  return {
    items: items ?? [],
    nextCursor: meta.nextCursor ?? null,
    total: meta.total ?? null,
    extra,
  };
}

export function buildInit<P extends string>(options: RequestOptions<P>): RequestInit {
  const {
    json,
    query: _query,
    idempotencyKey,
    headers,
    ...rest
  } = options as RequestOptions<P> & {
    idempotencyKey?: string;
  };
  void _query;

  const merged = new Headers(headers);
  if (json !== undefined) merged.set('content-type', JSON_TYPE);
  if (idempotencyKey) merged.set('Idempotency-Key', idempotencyKey);
  merged.set('accept', JSON_TYPE);

  return {
    ...rest,
    headers: merged,
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
  };
}
