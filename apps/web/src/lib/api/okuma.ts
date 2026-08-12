import 'server-only';
import type { ApiErrorBody } from '@vt/contracts';
import type { RequestOptions } from '@/lib/api/core';
import { list } from '@/lib/api/core';
import { hesapFetch } from '@/lib/api/server-authed';
import { hataYuku } from '@/components/hata/hata-koprusu';

/**
 * PANEL EKRANLARININ OKUMA KAPISI — satıcı ve yönetim, TEK kalıp.
 *
 * ⚠️ İKİ AYRI SÜRÜM VARDI ve ikisi de aynı işi yapıyordu, farklı alan adlarıyla:
 *    satıcı `{ok, veri, govde}`, yönetim `{tamam, veri, hata}`. Aynı ekranın iki
 *    yarısı iki farklı sürümü okuduğunda derleme kırılmıyor, yalnızca `if` yanlış
 *    dala giriyordu. Tek şekil kaldı: `{tamam, veri}` / `{tamam:false, hata}`.
 *
 * ⚠️ `hesapFetch` KULLANILIYOR, `serverFetch` DEĞİL: panel uçlarının hiçbiri
 *    `@Public()` değil ve `server.ts` bilerek jeton taşımıyor. Vekil de değil —
 *    vekil TARAYICININ kapısıdır; Sunucu Bileşeninden `/api/*`e HTTP açmak
 *    fazladan bir tur demek (gerekçenin tamamı `server-authed.ts` başlığında).
 *
 * ⚠️ HATA FIRLATILMIYOR, DÖNDÜRÜLÜYOR. Panonun dört kartı dört ayrı uçtan
 *    besleniyor; biri 500 verdiğinde `throw` etmek pano yerine hata sınırını
 *    gösterirdi, yani ÜÇ ÇALIŞAN karta bakılamazdı. `ApiFailure` zaten RSC
 *    sınırından geçemiyor (`hata-koprusu.ts`), o yüzden düz gövdeye çevriliyor.
 *
 * ⚠️ `redirect()` YUTULMAZ. `hesapFetch` oturum yokken `NEXT_REDIRECT` fırlatır;
 *    o hata `try` bloğunun içinde yakalanırsa kullanıcı `/giris` yerine bir hata
 *    kutusu görür. `hataYuku` onu yeniden fırlatıyor (bkz. o dosya).
 */
export type Okuma<T> = { tamam: true; veri: T } | { tamam: false; hata: ApiErrorBody };

/** Tekil kaynak: `data` bir nesne. */
export async function tekilOku<T, P extends string>(
  path: P,
  donusYolu: string,
  options: RequestOptions<P> = {} as RequestOptions<P>,
): Promise<Okuma<T>> {
  try {
    const sonuc = await hesapFetch<T, P>(path, donusYolu, options);
    return { tamam: true, veri: sonuc.data };
  } catch (hata) {
    return { tamam: false, hata: hataYuku(hata) };
  }
}

export interface ListeOkumasi<T> {
  items: T[];
  nextCursor: string | null;
  /** `list()` çıplak dizi olmayan `data`daki kardeş alanları buraya koyar. */
  extra: Record<string, unknown>;
}

/**
 * Sayfalı kaynak.
 *
 * ⚠️ `list()` ZORUNLU, elle `data.items` OKUNMAZ: zarf, denetleyici yalnızca
 *    `{items, nextCursor}` döndürdüğünde `data`yı ÇIPLAK DİZİ yapıyor ama
 *    kardeş alan varsa nesne bırakıyor. ÖLÇÜLDÜ — `admin/sellers` dizi,
 *    `admin/fraud/alerts` nesne (`counts`, `range`, `derived` kardeşleri var).
 *    Yalnız birini bilen bir okuma diğerinde sessizce boş liste gösterirdi.
 */
export async function listeOku<T, P extends string>(
  path: P,
  donusYolu: string,
  options: RequestOptions<P> = {} as RequestOptions<P>,
): Promise<Okuma<ListeOkumasi<T>>> {
  try {
    const sonuc = await hesapFetch<unknown, P>(path, donusYolu, options);
    const { items, nextCursor, extra } = list<T>(sonuc);
    return { tamam: true, veri: { items, nextCursor, extra } };
  } catch (hata) {
    return { tamam: false, hata: hataYuku(hata) };
  }
}

/**
 * KUYRUK SAYISI — "12" ya da "20+".
 *
 * ⚠️ `meta.total` YOK: panel uçlarının hepsi imleçli ve `Page<T>` yalnızca
 *    `{items, nextCursor}` taşıyor (`admin.ports.ts:37`, satıcı tarafında da
 *    aynısı). Yani "bekleyen 37 başvuru" cümlesi bugün KURULAMAZ; kurulsaydı
 *    sayfa boyutu kadar sayı gösterip onu toplam sanmak olurdu. `nextCursor`
 *    doluyken "+" basmak, bilmediğimizi bildiğimiz gibi göstermenin tek dürüst
 *    yolu.
 */
export function sayimEtiketi(sayfadaki: number, nextCursor: string | null): string {
  return nextCursor === null ? String(sayfadaki) : `${sayfadaki}+`;
}
