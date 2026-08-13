import { VARSAYILAN_LOCALE, type Locale } from '@vt/contracts';
import { sozluk, type Mesajlar } from './sozluk';
import { eksikAnahtarKapisi } from './eksik-anahtar';

/**
 * DİL KARARI VE İSTEK YAPILANDIRMASI — SAF, next-intl'e BAĞIMSIZ.
 *
 * ⚠️ NEDEN `request.ts` İÇİNDE DEĞİL — VE BU AYRIM BİR ARIZANIN BEDELİYLE
 *    ÖĞRENİLDİ. `request.ts` `next-intl/server`ı import ediyor; o modül
 *    `react-server` ihraç koşulu altında derlenmiş bir RSC yapısı ve
 *    `environment: 'node'` altında YÜKLENEMİYOR (koşulsuz hâlde
 *    "`getRequestConfig` is not supported in Client Components", koşul
 *    açıldığında bu kez React'in kendisi "`react-server` condition must be
 *    enabled" diye fırlatıyor ve tüm `web` projesinin React çözümü bozuluyor).
 *    Yani karar `request.ts` içinde kaldığı sürece TEST EDİLEMEZ.
 *
 *    Bedeli somut: bir süre `request.ts` içinde ölçüm amacıyla yazılmış
 *    `localeCoz('en')` satırı unutuldu. `<html lang="en">` çıkıyor, TÜM arayüz
 *    İngilizce çiziliyordu; `tsc --noEmit` temiz, `next build` temiz, 1373 test
 *    yeşil. Hiçbir kapı görmedi çünkü karara bakan bir kapı YOKTU.
 *
 * ⚠️ Bu, `muzakere.ts`in `proxy.ts`ten ayrılmasıyla AYNI gerekçedir ve o
 *    dosyanın başlığında da yazılı: kararı, ancak üretim derlemesi üzerinde
 *    ölçülebilen bir kabuğun içinde bırakma. Kabuğa kalan yalnızca çağırmak.
 */

/**
 * next-intl'in `getRequestConfig` dönüşünden bu depoda kullanılan alt küme.
 *
 * ⚠️ `import type` — ÇALIŞMA ZAMANINDA HİÇBİR ŞEY YÜKLENMEZ. Bu dosyanın
 *    `next-intl/server`dan bağımsız kalmasının tek sebebi test edilebilirliği
 *    (dosya başlığı); tip düzeyinde bağlanmak o bağımsızlığı bozmaz çünkü
 *    `import type` derleme sırasında tamamen silinir.
 *
 * ⚠️ `formats` ALANI YOK VE OLMAMALI — BU BİR EKSİK DEĞİL, ÖLÇÜLMÜŞ BİR
 *    AYRIŞMANIN KAPATILMASI. Bir süre burada `dateTime: { gun, gunSaat }`
 *    duruyordu ve başlığında "bağ `INTL_ETIKET`in tek tablo olmasıyla
 *    korunuyor" yazıyordu. O bağ YOKTU:
 *      · next-intl biçim etiketini `config.locale`den türetir; bu alan
 *        `'en'`dir, `INTL_ETIKET.en` (`'en-GB'`) DEĞİL.
 *      · ÖLÇÜLDÜ: `Intl.DateTimeFormat('en', {dateStyle:'long'})` →
 *        "August 12, 2026"; `('en-GB', …)` → "12 August 2026".
 *      · `lib/tarih.ts` `INTL_ETIKET`ten okuyor, yani `en-GB`.
 *    Yani ilk `format.dateTime('gun')` çağrısı, yorumun engellendiğini
 *    söylediği ayrışmayı ÜRETİRDİ ve hiçbir kapı görmezdi — üstelik blok
 *    bugüne kadar SIFIR kez çağrılmıştı (ölü kod bir değişmezi savunuyordu).
 *
 *    Karar: **tarih/sayı/para biçiminin TEK KAPISI `lib/tarih.ts` ve
 *    `lib/sayi-bicim.ts`.** next-intl bu depoda YALNIZ mesaj katmanıdır.
 *    Kapısı `yapilandirma.test.ts` → "biçimleme next-intl'e verilmemiş":
 *    `formats` geri konursa da `useFormatter`/`format.dateTime` kullanılırsa da
 *    test kırılır.
 */
export interface IstekYapilandirmasi {
  locale: Locale;
  messages: Mesajlar;
  timeZone: string;
  onError: typeof eksikAnahtarKapisi;
  getMessageFallback: (girdi: { key: string; namespace?: string }) => string;
}

/**
 * BUGÜNKÜ DİL KARARI.
 *
 * ⚠️ SABİT DEĞER VE BUGÜN DOĞRUSU BU — "unutulmuş" sanılmasın diye gerekçe:
 *    `[locale]` segmenti henüz yok, yani okunacak bir ROTA verisi de yok. Tek
 *    alternatif çerez/`Accept-Language` okumaktı ve o yol ölçümle kapalı
 *    (aşağıdaki `⚠️ requestLocale` notu). Bugünkü davranış göç öncesiyle
 *    BİREBİR aynı: her sayfa Türkçe.
 *
 * ⚠️ `[locale]` GELDİĞİNDE DEĞİŞECEK TEK YER BURASI, ve doğru halefi
 *    `requestLocale` DEĞİL — o alan next-intl 4'te kullanımdan kaldırıldı ve
 *    ayrıca bir İSTEK verisi olduğu için statik üretimi bozuyor:
 *
 *      ÖLÇÜLDÜ (`next build`, aynı ağaç, tek fark bu satır):
 *        `await requestLocale` VARKEN : 53 rotanın 53'ü `ƒ` — statik rota SIFIR.
 *        `await requestLocale` YOKKEN : `○ /_not-found` · `○ /calculator` ·
 *                                       `○ /collection` (göç öncesiyle aynı).
 *
 *    Statik rota tablosunun düşmesi kozmetik değil: `legal/[belge]`nin
 *    `dynamicParams:false` + `generateStaticParams` 404 kapısı da onunla
 *    birlikte SESSİZCE düşer — AGENTS.md §8'in "aylarca 200 döndü" arızası.
 *    Doğru halef `next/root-params`; ROTA verisidir, statik üretimi bozmaz:
 *
 *        import { locale as rotaLocale } from 'next/root-params';
 *        return localeCoz(await rotaLocale());
 *
 *    Bugün yazılamaz çünkü segment yokken o modül `locale` dışa aktarmaz ve
 *    import DERLEMEYİ KIRAR. Ayrıntı: `docs/i18n.md` → "Açık uçlar".
 */
export function aktifLocale(): Locale {
  return VARSAYILAN_LOCALE;
}

export function istekYapilandirmasi(locale: Locale = aktifLocale()): IstekYapilandirmasi {
  return {
    locale,
    messages: sozluk(locale),

    /**
     * ⚠️ SAAT DİLİMİ AÇIKÇA YAZILIR. `lib/tarih.ts`in başındaki gerekçe burada
     *    da geçerli ve bu depoda YAŞANMIŞ: verilmezse sunucu Next sürecinin
     *    diliminde (üretimde UTC), tarayıcı kullanıcının diliminde biçimlendirir;
     *    React aynı düğümde iki farklı metin görür ve kullanıcı tarihi bir an
     *    "11 Ağustos", sonra "12 Ağustos" olarak görür.
     */
    timeZone: 'Europe/Istanbul',

    /**
     * ⚠️ BURAYA `formats` EKLEMEYİN. Gerekçe dosya başlığında ve ölçümle
     *    birlikte yazılı: next-intl biçim etiketini `'en'`den türetir,
     *    `lib/tarih.ts` `INTL_ETIKET.en = 'en-GB'`ten. İkisi aynı ekranda
     *    "August 12, 2026" ile "12 August 2026" üretir. Tarih biçiminin tek
     *    kapısı `lib/tarih.ts`.
     */

    onError: eksikAnahtarKapisi,

    /**
     * ⚠️ EKSİK ANAHTARDA ANAHTAR YOLU BASILIR, BOŞLUK DEĞİL. next-intl'in
     *    varsayılanı da budur ve bilerek korunuyor: boş dizge dönseydi eksik
     *    çeviri ekranda BİR HİÇ olarak görünür — düğmenin üstünde yazı yok,
     *    kimse fark etmez. Ham anahtar (`panel.sonrakiSayfa`) çirkin ve tam da
     *    bu yüzden fark edilir.
     */
    getMessageFallback: ({ key, namespace }) => (namespace ? `${namespace}.${key}` : key),
  };
}
