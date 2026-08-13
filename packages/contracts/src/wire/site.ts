import type { MinorString } from './money.js';
// ⚠️ `TryOnCategoryWire` katalog telinden alınır, YENİDEN YAZILMAZ. İkinci bir
//    union açmak, bu depoda ölçülmüş bir arıza sınıfı: aynı sekiz kategori
//    etiketi bir dönem dört ayrı yerde durdu ve biri geride kaldı.
import type { TryOnCategoryWire } from './catalog.js';

/**
 * SİTE GÖRSELİ — telde görünen şekil.
 *
 * Adminden yönetilen SİTE görselleri: vitrin afişi, kategori kapağı,
 * koleksiyon kapağı. Ürün görseli DEĞİL — sahibi satıcı değil platformdur.
 *
 * ⚠️ Buradaki her alan çalışan API'den okundu (`GET /v1/site-images/hero`,
 *    `GET /v1/site-images?slot=CATEGORY_COVER`, `GET /v1/admin/site-images`),
 *    sunucudaki `*View` arayüzünden değil. Fark önemli: view tipi `bigint` ve
 *    `Date` taşır, tel string taşır.
 */

export type SiteImageSlotWire = 'HERO' | 'CATEGORY_COVER' | 'COLLECTION_COVER';

/**
 * Afişin üzerinde duran ürün kartı.
 *
 * ⚠️ `ProductListItemWire` KULLANILAMAZ, ölçüldü — iki alan eksik ve ikisi de
 *    kartın işini yapan alanlar:
 *
 *    (a) `SepeteEkle` zorunlu prop'u `variantIdler: readonly string[]`; liste
 *        tipinde varyant YOK. Kart "Sepete Ekle" düğmesini varyant kimliği
 *        olmadan çizemez.
 *    (b) Deneme kapısı İKİ YARIMDIR: `tryOnable` yalnızca "kategorinin bir
 *        try-on karşılığı var mı" der ve AYAKKABI için de `true` döner; ikinci
 *        yarı bugünkü sağlayıcı yeteneğidir. Yalnız ilk yarıya bakan bir kart,
 *        `PRODUCT_NOT_TRYONABLE` ile geri dönen bir düğme çizer.
 *
 *    Bu yüzden `tryOnable` BURADA tam kapıdır: sunucu `isTryOnSupported`'ı da
 *    uygulayarak hesaplar. `false` ise kart yalnızca "Sepete Ekle" gösterir —
 *    devre dışı ya da gri bir "Üzerimde Dene" ÇİZİLMEZ.
 */
export interface SiteImageCardWire {
  productId: string;
  slug: string;
  title: string;
  brandName: string;
  /**
   * R2 nesne anahtarı — tam adres DEĞİL. `lib/media.ts` CDN kökünü ekler.
   *
   * ⚠️ BUGÜN HİÇBİR YÜZEY OKUMUYOR ve bu bilinçli bir bekletmedir, unutulmuş
   *    bir alan değil. Vitrindeki kartta ürün görseli YOK (ölçüldü: 1024px'te
   *    görselli kart afişe sığmıyor), yönetim ekranındaki kart satırı da
   *    başlık + marka ile kimliklendiriyor.
   *
   *    SİLİNMEDİ çünkü tek gerçek aday tüketici yönetim ekranının kart satırı
   *    ve orada bir küçük görsel yöneticinin "doğru ürünü mü seçtim" sorusunu
   *    metinden daha hızlı yanıtlar. Alan telde durmanın bedeli bir string;
   *    silip geri eklemenin bedeli sözleşme + servis + test turu.
   *
   *    ⚠️ Bu, üçüncü bir tur sonunda hâlâ tüketicisi yoksa SİLİNİR. Kullanılmayan
   *       alanın kalıcılaşması bu depoda yazılı bir arıza deseni.
   */
  imageKey: string | null;
  priceMinor: MinorString;
  listPriceMinor: MinorString | null;
  /**
   * Sepete eklenecek varyant.
   *
   * ⚠️ `null` OLABİLİR: ürünün aktif varyantı kalmamış olabilir (hepsi pasife
   *    çekilmiş). O durumda kart "Sepete Ekle" göstermez — düğmeyi çizip
   *    `VARIANT_NOT_FOUND` aldırmak, kullanıcıya çalışmayan bir şey sunmaktır.
   */
  defaultVariantId: string | null;
  /** Bugün gerçekten denenebilir mi — kapının TAMAMI (bkz. yukarısı). */
  tryOnable: boolean;
  tryOnCategory: TryOnCategoryWire | null;
}

/** Vitrin afişi ve üzerindeki kartlar — tek istekte. */
export interface SiteImageWire {
  id: string;
  slot: SiteImageSlotWire;
  /** HERO'da `null`; kapaklarda kategori kimliği ya da koleksiyon slug'ı. */
  targetKey: string | null;
  /** R2 nesne anahtarı. Ürün görselleriyle AYNI `mediaUrl()`den geçer. */
  storageKey: string;
  widthPx: number;
  heightPx: number;
  blurhash: string | null;
  title: string | null;
  subtitle: string | null;
  linkHref: string | null;
  cards: SiteImageCardWire[];
}

/**
 * `GET /site-images/hero` yanıtı.
 *
 * ⚠️ `image` NULL OLABİLİR VE BU NORMAL BİR DURUMDUR, hata değil: yönetici
 *    henüz afiş tanımlamamıştır. Vitrin o zaman bugünkü davranışına — ilk
 *    ürünün fotoğrafı — düşer. Uç 404 DÖNMEZ; 404 dönseydi ana sayfa,
 *    yönetici hiçbir şey yapmadığı için hata sınırına giderdi.
 */
export interface SiteHeroWire {
  image: SiteImageWire | null;
}

/**
 * Yönetim listesi satırı.
 *
 * Vitrinin okuduğundan farkı: pasif kayıtları da taşır ve yönetimin görmesi
 * gereken alanları (`isActive`, `sortOrder`, `createdAt`) içerir.
 */
export interface AdminSiteImageWire extends SiteImageWire {
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}
