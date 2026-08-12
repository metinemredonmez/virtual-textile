import { buildInit, buildQuery, unwrap, type ApiResult, type RequestOptions } from './core';

/**
 * İSTEMCİ BİLEŞENİ → `/api/*` VEKİLİ.
 *
 * Tarayıcı API kökenine ASLA gitmez. Jeton burada yoktur, olamaz: `localStorage`
 * veya `sessionStorage`'daki bir jeton, sayfadaki herhangi bir XSS'in doğrudan
 * hesabı ele geçirmesi demektir — ve moda vitrini üçüncü taraf betikleri
 * (analitik, piksel) barındıran bir yüzeydir.
 *
 * ⚠️ `credentials: 'same-origin'` varsayılan davranıştır ama AÇIKÇA yazılıyor:
 *    `vt_sid` gitmezse her istek misafir isteği olur ve hata "sepetim boşaldı"
 *    şeklinde, sebebi görünmeden ortaya çıkar.
 */
export async function apiFetch<T, P extends string>(
  path: P,
  options: RequestOptions<P> = {} as RequestOptions<P>,
): Promise<ApiResult<T>> {
  const init = buildInit(options);
  const response = await fetch(`/api${path}${buildQuery(options.query)}`, {
    ...init,
    credentials: 'same-origin',
  });
  return unwrap<T>(response);
}

/**
 * ⚠️ IDEMPOTENCY ANAHTARI BURADA ÜRETİLMEZ.
 *
 * Üretilseydi "her denemede yeni anahtar" varsayılan olurdu — yani en tehlikeli
 * davranış (aynı siparişin ikinci kez oluşması) varsayılan olurdu. Kapı TİPTE:
 * `IdempotentPath` listesindeki bir yola `idempotencyKey` vermeden istek atmak
 * DERLENMEZ.
 *
 * Anahtar kullanıcı NİYETİ başına BİR KEZ üretilir ve `useRef`te tutulur.
 * ⚠️ `useState` DEĞİL: state güncellemesi render tetikler ve render sırasında
 *    yeni anahtar üretilirse "yeniden dene" İKİNCİ BİR SİPARİŞ yaratır.
 */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
