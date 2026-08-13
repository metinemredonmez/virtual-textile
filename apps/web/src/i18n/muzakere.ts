import { isLocale, LOCALES, VARSAYILAN_LOCALE, type Locale } from '@vt/contracts';

/**
 * LOCALE MÜZAKERESİ — SAF FONKSİYONLAR.
 *
 * ⚠️ `proxy.ts` İÇİNE GÖMÜLMEDİ ve bu bilinçli. O dosya bu turda ÜÇ işin
 *    çakıştığı yer (yeni İngilizce panel önekleri · `[locale]` öneki · dil
 *    müzakeresi) ve orada yazılan her satır ancak üretim derlemesi üzerinde
 *    çekilerek ölçülebiliyor. Kararın kendisi burada, `environment: 'node'`
 *    altında test edilebilir hâlde duruyor; `proxy.ts`e kalan yalnızca bu
 *    fonksiyonları çağırmak.
 *
 * ⚠️ next-intl'in KENDİ middleware'i KULLANILMIYOR. Her i18n kütüphanesinin
 *    kurulum belgesi `middleware.ts` yazıyor; Next 16'da o yakınsama
 *    KULLANIMDAN KALDIRILDI ve dosyanın adı `proxy.ts`. Belge ile kodun
 *    ayrıldığı bu nokta tek sessiz kırılma noktası olurdu — kütüphanenin
 *    yönlendirmesine hiç bağlanmayarak o riski almıyoruz. next-intl bu depoda
 *    YALNIZCA mesaj/biçim katmanı.
 */

/**
 * ÜÇ ROLÜN AYRIMI — karıştırılırsa hidrasyon ve SEO birlikte bozulur:
 *
 *   URL öneki  → OTORİTE. Render, `<html lang>`, `hreflang`, önbellek anahtarı.
 *   Çerez      → yalnız TERCİH HAFIZASI. `/` köküne geleni hangi öneke atacağımız.
 *   Accept-Language → yalnız ilk ziyarette, çerez yokken TAHMİN.
 *
 * ⚠️ İçeriği çerez belirleseydi aynı URL farklı kullanıcıya farklı dil verirdi:
 *    Googlebot çerezsiz gezdiği için yalnız varsayılan dil indekslenir,
 *    `hreflang` yazılamaz, `Vary: Cookie` CDN önbelleğini böler. Ve hidrasyon:
 *    `lib/tarih.ts`in yorumu bu depoda YAŞANMIŞ bir olayı anlatıyor — sunucu
 *    ile istemci farklı biçimlendirdiğinde kullanıcı tarihi bir an "11 Ağustos"
 *    sonra "12 Ağustos" görüyor. Dil yalnız istemcide okunan bir çerezden
 *    gelseydi aynı hata dil ekseninde tekrarlanırdı.
 */
export const LOCALE_CEREZI = 'vt_dil';

/** Çerez ömrü: bir yıl. Tema çerezi (`vt_tema`) ile aynı gerekçe — tercih unutulmaz. */
export const LOCALE_CEREZ_OMRU_SN = 60 * 60 * 24 * 365;

/**
 * Yolun başındaki dil önekini ayırır.
 *
 * `/en/products` → `{ locale: 'en', kalan: '/products' }`
 * `/products`    → `{ locale: null, kalan: '/products' }`
 * `/en`          → `{ locale: 'en', kalan: '/' }`
 *
 * ⚠️ `startsWith('/en')` YAZILMAZ: `/energy` da o kontrolü geçer. Segment
 *    sınırı aranır.
 */
export function onekAyir(pathname: string): { locale: Locale | null; kalan: string } {
  const segmentler = pathname.split('/');
  const ilk = segmentler[1];

  if (!isLocale(ilk)) return { locale: null, kalan: pathname };

  const kalan = '/' + segmentler.slice(2).join('/');
  return { locale: ilk, kalan: kalan === '/' ? '/' : kalan.replace(/\/$/, '') };
}

/** `('/products', 'en')` → `/en/products`. Kök için `/en`. */
export function onekEkle(pathname: string, locale: Locale): string {
  const temiz = pathname === '/' ? '' : pathname;
  return `/${locale}${temiz}`;
}

/**
 * `Accept-Language` başlığından en iyi eşleşme.
 *
 * ⚠️ `q` DEĞERİ OKUNUYOR ve okunmak zorunda: tarayıcılar sıklıkla
 *    `tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7` gönderiyor. Sırayı yok sayan bir
 *    ayrıştırıcı `en-US`i `tr`den önce görebilir ve Türk kullanıcıya İngilizce
 *    açar.
 *
 * ⚠️ Bölge eki DÜŞÜRÜLÜR: `en-GB` de `en-US` de `en`dir. `LOCALES` bir DİL
 *    listesi; bölgeye göre dallanmak burada yapılmaz.
 */
export function baslikTahmini(acceptLanguage: string | null | undefined): Locale | null {
  if (!acceptLanguage) return null;

  const adaylar = acceptLanguage
    .split(',')
    .map((parca) => {
      const [etiket, ...parametreler] = parca.trim().split(';');
      const q = parametreler
        .map((p) => p.trim())
        .find((p) => p.startsWith('q='))
        ?.slice(2);
      const agirlik = q === undefined ? 1 : Number.parseFloat(q);
      return {
        dil: (etiket ?? '').trim().toLowerCase().split('-')[0] ?? '',
        agirlik: Number.isFinite(agirlik) ? agirlik : 0,
      };
    })
    .filter((aday) => aday.agirlik > 0)
    .sort((a, b) => b.agirlik - a.agirlik);

  for (const aday of adaylar) {
    if (isLocale(aday.dil)) return aday.dil;
  }
  return null;
}

/**
 * Önekli olmayan bir istek için hangi dile gidileceği.
 *
 * Sıra: ÇEREZ → `Accept-Language` → varsayılan.
 *
 * ⚠️ Çerez başlığı EZER. Kullanıcı bir kez dil seçtiyse tarayıcı ayarı onu
 *    geri almaz; aksi hâlde İngilizceye geçen bir Türk kullanıcı her yeni
 *    sekmede Türkçeye düşerdi ve seçim "kalıcı" olmazdı.
 */
export function hedefLocale(girdi: {
  cerez?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  if (isLocale(girdi.cerez)) return girdi.cerez;
  return baslikTahmini(girdi.acceptLanguage) ?? VARSAYILAN_LOCALE;
}

/**
 * `/products?a=1` → `/tr/products?a=1` yönlendirmesi gerekiyor mu?
 *
 * ⚠️ `null` dönmesi "yönlendirme YOK" demek ve bu yol SICAK: her istek
 *    buradan geçiyor. Zaten önekli olan adres için hiçbir şey yapılmaz —
 *    yapılsaydı `/tr/x` → `/tr/tr/x` gibi bir döngü doğardı ve tarayıcı
 *    ERR_TOO_MANY_REDIRECTS gösterirdi.
 */
export function yonlendirmeHedefi(girdi: {
  pathname: string;
  search?: string;
  cerez?: string | null;
  acceptLanguage?: string | null;
}): string | null {
  if (muafMi(girdi.pathname)) return null;
  if (onekAyir(girdi.pathname).locale !== null) return null;

  const locale = hedefLocale(girdi);
  return onekEkle(girdi.pathname, locale) + (girdi.search ?? '');
}

/**
 * DİL ÖNEKİ ALMAYACAK YOLLAR.
 *
 * ⚠️ `/api/**` LİSTEDE ve olmak zorunda: bunlar backend sözleşmesidir, bir
 *    kullanıcı yüzeyi değil. `/tr/api/...` diye bir adres yoktur ve vekile
 *    dil öneki eklemek stil danışmanı akışını (`/api/stylist/.../messages`)
 *    bir yönlendirmenin arkasına koyardı — `POST` gövdesi 307'de korunur ama
 *    akış gecikir.
 *
 * ⚠️ Uzantılı yollar (`.ico`, `.png`, `.txt`) da dışarıda: `/favicon.ico`
 *    yönlendirilirse tarayıcı sekme ikonunu hiç göremez.
 */
export function muafMi(pathname: string): boolean {
  return (
    pathname.startsWith('/api/') ||
    pathname === '/api' ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/_vercel/') ||
    /\.[a-z0-9]+$/i.test(pathname)
  );
}

/**
 * Bir yolun dilini DEĞİŞTİRİR — dil değiştirici bileşenin tek hesabı.
 *
 * `('/en/products', 'tr')` → `/tr/products`
 * `('/products', 'en')`    → `/en/products`  (öneksiz geçiş dönemi için)
 */
export function dilDegistir(pathname: string, hedef: Locale): string {
  const { kalan } = onekAyir(pathname);
  return onekEkle(kalan, hedef);
}

/** Rota tablosu ve `generateStaticParams` için. */
export const LOCALE_PARAMETRELERI = LOCALES.map((locale) => ({ locale }));
