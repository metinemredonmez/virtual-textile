import 'server-only';
import type { SiteHeroWire, SiteImageCardWire, SiteImageWire } from '@vt/contracts';
import { isTryOnSupported, type TryOnCategoryName } from '@vt/config/constants';
import { list } from '@/lib/api/core';
import { serverFetch } from '@/lib/api/server';

/**
 * SİTE GÖRSELLERİ — vitrinin adminden yönetilen görsel yüzeyinin OKUMA tarafı.
 *
 * ⚠️ TİPLER `@vt/contracts` → `wire/site.ts`TEN GELİR, BURADA YENİDEN
 *    YAZILMAZ. Bu dosya bir tur boyunca (uç henüz yokken ölçüm yapabilmek
 *    için) kendi yerel kopyasını taşıdı; sözleşme inince kopya SİLİNDİ.
 *    İkinci bir tel tipi bu depoda ölçülmüş bir arıza sınıfıdır — aynı uç
 *    için `SellerPackageSummaryWire` ↔ `SaticiPaketOzetiWire` yaşandı.
 *
 * ⚠️ ÜÇ İSTEK, VE ÜÇÜ DE ZORUNLU. `GET /site-images` `slot`u ZORUNLU istiyor
 *    (gerekçe `admin-site-image.schema.ts`: slotsuz bir uç, vitrine ihtiyacı
 *    olmayan kapakları da indirtirdi). Üçü de `Promise.all` içinde ürün
 *    listesi ve kategori ağacıyla BİRLİKTE gidiyor; sayfaya eklenen gecikme
 *    en yavaş isteğin farkı kadar.
 */

/**
 * ⚠️ AFİŞ EKRANIN TAMAMINI KIRAMAZ. Değişmez: afiş tanımlanmamışsa ana sayfa
 *    BUGÜNKÜ davranışına düşer. Uç `{image:null}` döndürerek bunu zaten
 *    karşılıyor (404 DEĞİL — gerekçe `wire/site.ts`); buradaki `catch` ise
 *    ucun KENDİSİ düştüğünde (dağıtılmadı, API kapalı, ağ koptu) aynı
 *    davranışı garantiler.
 *
 * ⚠️ SESSİZ DEĞİL: hata sunucu günlüğüne YAZILIR. Bu depoda altı kez yaşanan
 *    sınıf tam olarak "yazıldı, derlendi, hiçbir yerden ulaşılamadı" ve
 *    `catch {}` o sınıfın en sevdiği yer. Kullanıcı kırık sayfa görmüyor ama
 *    biz ucun ölü olduğunu görüyoruz.
 */
async function guvenliOku<T>(uc: string, oku: () => Promise<T>, yedek: T): Promise<T> {
  try {
    return await oku();
  } catch (error) {
    // ⚠️ Günlüğe UÇ YOLU yazılır, "afiş"/"kapak" gibi bir etiket değil: arıza
    //    anında aranan şey hangi adresin düştüğüdür, hangi bölümün olduğu değil.
    console.warn(`[vitrin] ${uc} okunamadı, bugünkü davranışa düşülüyor`, error);
    return yedek;
  }
}

/**
 * ⚠️ Afiş günde birkaç kez değişir; her görüntülemede çekmek boşuna tur.
 *    Yöneticinin değişikliği en geç bir dakikada görünür. Sayfanın
 *    `force-dynamic` olması sayfayı ilgilendirir, bu `fetch`in önbelleğini
 *    değil.
 */
const TAZELEME_SANIYE = 60;

/** Vitrin afişi + üzerindeki ürün kartları — tek istek, tek sorgu. */
export async function afisGetir(): Promise<SiteImageWire | null> {
  return guvenliOku(
    '/site-images/hero',
    async () => {
      const sonuc = await serverFetch<SiteHeroWire, '/site-images/hero'>('/site-images/hero', {
        next: { revalidate: TAZELEME_SANIYE },
      });
      return sonuc.data.image;
    },
    null,
  );
}

/**
 * KAPAKLAR — `targetKey` → kayıt haritası.
 *
 * ⚠️ OKUMA HOŞGÖRÜLÜ: hedefi silinmiş bir kapak (kategori kaldırıldı,
 *    koleksiyon slug'ı değişti) haritada kalır ama kimse sormaz. Sayfa
 *    kırılmaz; bölüm yalnızca o kapağı göstermez.
 */
export async function kapaklariGetir(
  slot: 'CATEGORY_COVER' | 'COLLECTION_COVER',
): Promise<Map<string, SiteImageWire>> {
  const items = await guvenliOku(
    `/site-images?slot=${slot}`,
    async () => {
      const sonuc = await serverFetch<unknown, '/site-images'>('/site-images', {
        query: { slot },
        next: { revalidate: TAZELEME_SANIYE },
      });
      /**
       * ⚠️ `sonuc.data.items` OKUNMAZ — ÖLÇÜLDÜ, SAYFAYI 500 YAPTI. Denetleyici
       *    `{ items: [...] }` döndürüyor ama `EnvelopeInterceptor` tek anahtarlı
       *    liste yanıtını DÜZLEŞTİRİYOR; telde `data` ÇIPLAK DİZİ olarak
       *    geliyor (ölçüm: `GET /v1/site-images?slot=CATEGORY_COVER` →
       *    `{"data":[{…}]}`). İki şekli birden karşılayan tek yer `list()` ve
       *    zaten bunun için var (`lib/api/core.ts`). `tsc` bunu göremezdi:
       *    yanıt tipi bizim BEYANIMIZ, ölçümümüz değil.
       */
      return list<SiteImageWire>(sonuc).items;
    },
    [] as SiteImageWire[],
  );

  const harita = new Map<string, SiteImageWire>();
  for (const gorsel of items) if (gorsel.targetKey) harita.set(gorsel.targetKey, gorsel);
  return harita;
}

/**
 * DENEME KAPISI — İKİNCİ KATMAN.
 *
 * ⚠️ `tryOnable` telde ZATEN kapının TAMAMIdır: sunucu `isTryOnSupported`ı da
 *    uygulayarak hesaplıyor (`wire/site.ts`). Buradaki kontrol onun YERİNE
 *    GEÇMEZ, ÜSTÜNE biner — alanın anlamı bir gün sessizce
 *    `catalog.service.ts`teki ham bayrağa kayarsa (ki o bayrak AYAKKABI için
 *    de `true`) ayakkabıda düğme çıkmasın diye. Bedeli bir karşılaştırma;
 *    karşılığı `PRODUCT_NOT_TRYONABLE` ile geri dönen bir düğmenin hiç
 *    çizilmemesi.
 */
export function kartDenenebilir(kart: SiteImageCardWire): boolean {
  return kart.tryOnable && isTryOnSupported(kart.tryOnCategory as TryOnCategoryName | null);
}
