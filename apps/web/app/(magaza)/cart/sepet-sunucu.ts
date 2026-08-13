import 'server-only';
import { ApiFailure, type CartWire } from '@vt/contracts';
import { unwrap } from '@/lib/api/core';
import { apiBaseUrl } from '@/lib/env';
import { kimlikBasliklari, kimligiCoz } from '@/lib/api/server-authed';

/**
 * SEPETİ SUNUCUDA OKU.
 *
 * Kimlik çözümü ortak katmanda (`lib/api/server-authed.ts`); burada yalnızca
 * SEPETE ÖZGÜ olan iki şey var: boş sepetin şekli ve okunamama durumu.
 *
 * ⚠️ NEDEN `hesapFetch` DEĞİL: o yardımcı oturum yoksa `/login`e YÖNLENDİRİR.
 *    Sepet misafirin de sepetidir; girişe atmak, ürün eklemiş bir ziyaretçiyi
 *    sepetine bakmak istediği anda kaybetmek olurdu. Fark bilinçli ve arayüz
 *    kararıdır, kopya değil.
 */

/** Sunucuda okunamayan durum: istemci vekilden tekrar dener. */
export type SepetOkuma =
  | { kind: 'sepet'; sepet: CartWire }
  /** Kimlik var ama okuma başarısız — istemci vekilden (yenileme + tekrar) dener. */
  | { kind: 'okunamadi' };

/**
 * ⚠️ `MinorString` markası ayrıştırma sınırından doğar; boş sepetin sıfırı
 *    ayrıştırmadan gelmiyor. Kaçış tek yerde ve gerekçeli: bu değer bir tutarı
 *    TEMSİL etmiyor, yalnızca "gösterilecek bir şey yok"un biçimlenebilir hâli.
 */
const SIFIR = '0' as CartWire['totalMinor'];

/**
 * ⚠️ Dışa açık: sepet SSR'da okunamadığında sayfanın çizeceği başlangıç da BU.
 *    Sayfada ikinci bir boş sepet nesnesi yazılsaydı, sunucunun `emptyView()`
 *    çıktısının frontend'de İKİ farklı kopyası olurdu ve biri güncellenip
 *    diğeri unutulduğunda hiçbir şey uyarmazdı.
 */
export function bosSepet(): CartWire {
  // ⚠️ Sunucunun `emptyView()` çıktısının BİREBİR aynısı. Farklı bir şekil
  //    üretmek, "sepet boş" ekranının iki farklı yoldan iki farklı şekilde
  //    doğması demek olurdu.
  return {
    id: null,
    packages: [],
    unavailableItems: [],
    coupon: null,
    subtotalMinor: SIFIR,
    discountMinor: SIFIR,
    totalMinor: SIFIR,
    itemCount: 0,
    distinctItemCount: 0,
    hasPriceChange: false,
    freeShipping: false,
    expiresAt: null,
  };
}

export async function sepetiOku(): Promise<SepetOkuma> {
  const kimlik = await kimligiCoz();

  // Hiç kimlik yok → hiç sepet yok. İstek atmak `cart.owner.ts`ten 400 alırdı.
  if (kimlik.kind === 'yok') return { kind: 'sepet', sepet: bosSepet() };

  // ⚠️ Oturum düştüyse SSR PATLAMAZ. Kullanıcı sepet sayfasında beyaz ekran
  //    yerine istemci kabuğunu görür; vekil bir sonraki istekte çerezleri
  //    temizleyip /login'e yönlendirir.
  const basliklar = kimlikBasliklari(kimlik);
  if (!basliklar) return { kind: 'okunamadi' };

  try {
    const response = await fetch(`${apiBaseUrl()}/cart`, {
      headers: { accept: 'application/json', ...basliklar },
      cache: 'no-store',
    });
    const { data } = await unwrap<CartWire>(response);
    return { kind: 'sepet', sepet: data };
  } catch (error) {
    // ⚠️ Hata SSR'ı kırmaz: sepet ekranı hata sınırına düşerse kullanıcı
    //    sepetine hiç ulaşamaz. İstemci kabuğu aynı isteği vekilden — yani
    //    401'de tek uçuşlu yenileme + tekrar yapan yoldan — tekrarlar.
    if (error instanceof ApiFailure) return { kind: 'okunamadi' };
    throw error;
  }
}
