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
  return rastgeleUuid();
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  UUID v4 — `crypto.randomUUID()` YOKSA DA ÇALIŞIR.
 *
 *  ⚠️ CANLIDA ÖLÇÜLDÜ (2026-08-14). `crypto.randomUUID()` tarayıcıda YALNIZCA
 *     GÜVENLİ BAĞLAMDA tanımlıdır: HTTPS ya da `localhost`. Sitemiz bugün
 *     `http://91.99.183.64` üzerinden servis ediliyor (alan adı/TLS henüz yok),
 *     yani güvenli bağlam DEĞİL — fonksiyon HİÇ YOK ve çağrı
 *     `TypeError: crypto.randomUUID is not a function` ile düşüyor.
 *
 *  GÖRÜNEN ARIZA ŞUYDU: sanal deneme fotoğrafı R2'ye yükleniyordu (PUT 200),
 *  ardından `POST /me/photos/:id/confirm` HİÇ GÖNDERİLMİYORDU — çünkü istek
 *  kurulmadan önce anahtar üretimi patlıyordu. Ağ sekmesinde `confirm` satırı
 *  YOKTU ve ekranda yalnızca "Beklenmeyen bir hata oluştu" görünüyordu.
 *
 *  ⚠️ YERELDE HİÇ GÖRÜNMEZ: `localhost` güvenli bağlam sayılır, fonksiyon
 *     oradadır. Bu, bu depoda beşinci "yerelde çalışıyor, sunucuda kırılıyor"
 *     vakası ve HTTP/HTTPS farkından doğan İKİNCİSİ (birincisi `Secure`
 *     çerezdi). Ortak ders: güvenli bağlam gerektiren tarayıcı API'leri,
 *     TLS'siz bir sunucuda sessizce yok olur.
 *
 *  ⚠️ `Math.random()` KULLANILMADI ve kullanılmamalı: bu anahtar bir
 *     IDEMPOTENCY anahtarıdır. Tahmin edilebilir bir değer, başkasının
 *     idempotency kaydına ÇARPAR — yani bir kullanıcının siparişinin yanıtı
 *     başka birine dönebilir. `crypto.getRandomValues` ise güvenli bağlam
 *     GEREKTİRMEZ (yalnız `randomUUID` gerektiriyor), bu yüzden burada
 *     kriptografik kalite kaybı YOK.
 *
 *  ⚠️ TLS geldiğinde bu yedek yolu SİLMEK GEREKMEZ: `randomUUID` varsa o
 *     kullanılıyor. Yedek yalnızca yokluğunda devreye giriyor.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function rastgeleUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();

  const baytlar = new Uint8Array(16);
  crypto.getRandomValues(baytlar);

  // RFC 4122: sürüm 4 ve varyant bitleri sabitlenir.
  baytlar[6] = (baytlar[6]! & 0x0f) | 0x40;
  baytlar[8] = (baytlar[8]! & 0x3f) | 0x80;

  const onaltilik = [...baytlar].map((b) => b.toString(16).padStart(2, '0'));
  return (
    `${onaltilik.slice(0, 4).join('')}-${onaltilik.slice(4, 6).join('')}-` +
    `${onaltilik.slice(6, 8).join('')}-${onaltilik.slice(8, 10).join('')}-` +
    `${onaltilik.slice(10, 16).join('')}`
  );
}
