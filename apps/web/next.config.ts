import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

/**
 * `NEXT_PUBLIC_MEDIA_URL` KÖKÜNÜ `remotePatterns`E ÇEVİRİR.
 *
 * ⚠️ NEDEN TÜRETİLİYOR, NEDEN ELLE YAZILMIYOR: bu ikisi ayrı yerde tutulduğu
 *    sürece biri değişip diğeri unutulabilir ve arıza SESSİZ DEĞİL, SİTE
 *    GENELİDİR — Next tanımadığı kaynağa `400 "url" parameter is not allowed`
 *    döndürür, yani TEK BİR ürün görseli bile yüklenmez. Derleme yeşil, testler
 *    yeşil, sayfa 200. Bu depodaki en pahalı hata sınıfının tam tarifi.
 *    Türetince o sınıf kapanır: kök neresiyse izin de oraya yazılır.
 *
 * ⚠️ Değer geçersizse `new URL` FIRLATIR ve derleme durur. İstenen budur:
 *    bozuk bir kök, kırık görselden önce derlemede görünmelidir.
 *
 * Değer boşsa hiçbir kayıt üretilmez — `mediaUrl()` de o durumda `null`
 * döndürdüğü için zaten hiç görsel istenmez, yeni bir arıza doğmaz.
 */
function medyaKokDeseni(): {
  protocol: 'http' | 'https';
  hostname: string;
  port?: string;
  pathname: string;
}[] {
  const ham = process.env.NEXT_PUBLIC_MEDIA_URL?.trim();
  if (!ham) return [];

  const adres = new URL(ham);
  const protokol = adres.protocol === 'http:' ? 'http' : 'https';

  // Kök bir yol taşıyorsa (`http://91.99.183.64/medya`) izin O YOLLA sınırlanır.
  // Yalnız ana bilgisayarı açmak, görsel iyileştiricisini kendi sunucumuzdaki
  // HER yolu çekebilen bir araca çevirirdi; dar tutmak bedava.
  const kok = adres.pathname.replace(/\/+$/, '');

  /**
   * ⚠️ `port` TAŞINMAK ZORUNDA — UNUTULDUĞUNDA ARIZA SİTE GENELİ. Ölçüldü.
   *
   *    `remotePatterns` kaydında `port` YAZILMAZSA Next onu "port YOK" diye
   *    okur; `http://localhost:3001/...` desene UYMAZ ve her görsel isteği
   *    `400 Bad Request` döner ("url" parameter is not allowed).
   *
   *    Kök r2.dev iken (443, varsayılan port) bu fark hiç görünmüyordu. Kök
   *    kendi API'mize (`:3001`) çevrilir çevrilmez ana sayfadaki 49 görselin
   *    TAMAMI 400'e düştü — ve sayfa yine 200 dönüyordu. Bu dosyanın
   *    başlığındaki uyarının ("derleme yeşil, testler yeşil, sayfa 200") tam
   *    olarak tarif ettiği sınıf; türetme o sınıfı KAPATMAK için yazılmıştı ve
   *    portu taşımadığı için yarısı açık kalmış.
   *
   *    Üretimde kök `http://91.99.183.64/medya` — port yok, `adres.port` boş
   *    dize, alan hiç eklenmiyor. Yani bu satır yalnızca portlu köklerde
   *    devreye girer ve üretim davranışını değiştirmez.
   */
  return [
    {
      protocol: protokol,
      hostname: adres.hostname,
      ...(adres.port ? { port: adres.port } : {}),
      pathname: kok ? `${kok}/**` : '/**',
    },
  ];
}

/**
 * ⚠️ `compress: false` — stil danışmanı `text/event-stream` döndürüyor.
 *    Gzip ara belleği doldurmadan yazmadığı için akış, olay olay değil
 *    blok blok ulaşır; kullanıcı "yazıyor" etkisini hiç görmez. Statik
 *    varlıklar zaten CDN/ters vekil tarafından sıkıştırılıyor.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  compress: false,
  poweredByHeader: false,

  /**
   * Ürün görselleri genel R2 kovasından servis ediliyor; imza gerekmiyor.
   *
   * ⚠️ `images.pexels.com` YALNIZCA DEMO VERİSİ İÇİN. Gerçek satıcı ürün
   *    yüklediğinde görsel normal yoldan R2'ye gider; dış bir servise
   *    bağımlılık YOKTUR.
   *
   *    Neden gerekti: seed `demo/...` anahtarları yazıyordu ama o dosyalar
   *    R2'ye hiç yüklenmemişti (canlıda ölçüldü: HTTP 404) ve vitrinde kırık
   *    ikon çıkıyordu. Depoya ikili dosya koymak git geçmişini şişirir;
   *    seed sırasında R2'ye yüklemek ise YERELDE ÇALIŞMAZ (yerel geliştirmede
   *    R2 yapılandırılmamış, fabrika `Unconfigured` döner). Mutlak URL,
   *    yerelde ve sunucuda AYNI çalışan tek seçenekti — `mediaUrl()` zaten
   *    `http(s)://` ile başlayan anahtarı olduğu gibi geçiriyor.
   *
   * ⚠️ Bu satır silinirse demo görselleri kırılır ama ÜRETİM ETKİLENMEZ.
   *    Pexels adresleri bir gün ölürse etkilenen tek şey demo verisidir.
   *
   * ⚠️ ÜRETİMDE KÖK ARTIK r2.dev DEĞİL, KENDİ SUNUCUMUZ (`/medya`). Gerekçe ve
   *    ölçümler: docs/medya-dagitimi.md — özeti: `pub-<hash>.r2.dev`
   *    Cloudflare'in GELİŞTİRME adresidir, hız sınırlıdır ve aynı anahtara
   *    ardışık isteklerin yarısı TLS el sıkışmasında düşüyor. Kök
   *    `NEXT_PUBLIC_MEDIA_URL`den TÜRETİLİYOR (yukarı bakın), bu yüzden adres
   *    değiştiğinde burada elle bir şey güncellenmesi GEREKMEZ.
   *
   * ⚠️ `**.r2.dev` SİLİNMEZ. İki sebep: (1) yerelde nginx yok, geliştirme
   *    doğrudan r2.dev'den okur; (2) `mediaUrl()` mutlak adresi olduğu gibi
   *    geçiriyor ve veritabanında mutlak r2.dev adresi taşıyan kayıt olabilir.
   *
   * ⚠️ `NEXT_PUBLIC_*` DERLEME ZAMANINDA GÖMÜLÜR: aşağıdaki türetme `next build`
   *    anında koşar. Ortam dosyası build'den ÖNCE doğru olmalı; PM2 restart
   *    değeri değiştirmez.
   */
  images: {
    remotePatterns: [
      ...medyaKokDeseni(),
      /**
       * ⚠️ `**.r2.dev` VE `images.pexels.com` BU TURDA KALDIRILDI.
       *
       *    r2.dev: ölçüldü (2026-08-13) — TCP kuruluyor, TLS el sıkışması
       *    düşürülüyor; 8 istekte 8 zaman aşımı. Görseller artık `/v1/media`
       *    üzerinden BİZİM API'mizden geliyor (bkz. media-public.controller.ts)
       *    ve o kök zaten `medyaKokDeseni()` ile izinli. Kaydı bırakmak,
       *    çalışmayan bir kaynağa geri düşme yolunu açık tutmak olurdu.
       *
       *    images.pexels.com: hiçbir yerde kullanılmıyor. Demo görselleri
       *    fal.ai ile üretilip R2'ye yükleniyor (`seed-assets/uret.ts`);
       *    kullanılmayan bir uzak kaynak, görsel iyileştiricisine bedava
       *    açılmış bir kapıdır.
       */
    ],
    formats: ['image/avif', 'image/webp'],

    /**
     * ⚠️ YALNIZCA GELİŞTİRMEDE AÇIK, ÜRETİMDE KAPALI — VE FARK ÖNEMLİ.
     *
     *    Next 16 görsel iyileştiricisinin üst kaynağı ÖZEL bir IP'ye çözülürse
     *    isteği reddediyor (SSRF koruması). Ölçülen günlük satırı:
     *      "upstream image … hostname resolved to private IP ["::1","127.0.0.1"]"
     *    Bu koruma DOĞRU: iyileştirici, saldırganın verdiği bir adresi sunucu
     *    kimliğiyle çeken bir araca dönüşebilir.
     *
     *    Ama yerelde medya kökü `http://localhost:3001/v1/media`, yani tanım
     *    gereği loopback. Bayrak olmadan geliştirmede TEK BİR görsel yüklenmez.
     *
     *    ÜRETİMDE GEREKMİYOR: kök `http://91.99.183.64/medya` — genel IP,
     *    koruma zaten tetiklenmiyor. Bu yüzden bayrak `NODE_ENV`e bağlı; üretim
     *    derlemesinde `false` kalır ve koruma tam olarak yerinde durur.
     *
     * ⚠️ AÇIKKEN DE SINIRSIZ DEĞİL: `remotePatterns` yukarıda ana bilgisayarı,
     *    PORTU ve yol önekini birlikte kısıtlıyor. Yani bayrak "her yerel
     *    adresi çek" demiyor, "izin verilen tek yerel kökü çek" diyor.
     */
    dangerouslyAllowLocalIP: process.env.NODE_ENV !== 'production',
  },

  // Workspace paketleri kaynaktan değil, dist/esm'den geliyor — ayrıca
  // transpile edilmelerine gerek yok.
  serverExternalPackages: ['ioredis'],

  /**
   * `/checkout/sonuc` → `/checkout/result`
   *
   * ⚠️ ROTA GÖÇÜNDE AYAKTA BIRAKILAN TEK KÖPRÜ. Göç bir 301/308 haritası
   *    KURMADI — bayat bağlantı yüksek sesle 404 vermeli, yoksa ölü bağlantı
   *    testinin bakacağı yüzey maskelenir. Bu kayıt istisnadır çünkü adresi
   *    biz seçmedik: backend'de SABİT YAZILI (`checkout.service.ts` →
   *    `callbackResult()` → `${APP_URL}/checkout/sonuc?siparis=…&durum=…`) ve
   *    `POST /v1/payments/3ds/callback` yanıtında ölçüldü. Köprü olmadan,
   *    3DS'ten dönen — yani PARASI ÇEKİLMİŞ — kullanıcı 404 görür. Diğer her
   *    ölü bağlantının bedeli bir 404; bunun bedeli bir SİPARİŞ.
   *
   * ⚠️ `source !== destination` OLMAK ZORUNDA. Göç sırasında bir find/replace
   *    ikisini eşitlerse Next kendine yönlenen bir kayıt üretir
   *    (ERR_TOO_MANY_REDIRECTS) ve arıza YALNIZCA gerçek bir ödeme
   *    tamamlandığında görünür. İddia `src/rota/rota-tablosu.test.ts`te.
   *
   * ⚠️ KALICI DEĞİL: backend bu yolu paylaşılan bir sabitten okumaya başladığı
   *    gün kayıt, uçuştaki 3DS ödemeleri için bir ödeme zaman aşımı penceresi
   *    kadar daha durur, sonra kaldırılır.
   *
   * ⚠️ NEDEN SAYFA DEĞİL, YÖNLENDİRME: burada `permanentRedirect()` çağıran bir
   *    sayfa vardı ve ÖLÇÜLDÜ — Next o sayfa için 308 değil, `200 OK` +
   *    `<meta http-equiv="refresh">` üretiyordu. Meta yenileme bir POST'u
   *    KORUYAMAZ; sağlayıcı `callbackUrl`ı bir gün doğrudan buraya POST ederse
   *    gövde sessizce kaybolurdu. `redirects()` HTTP düzeyindedir.
   *
   * ⚠️ `permanent: true` → 308, 301 DEĞİL: 301 tarayıcıya yöntemi GET'e çevirme
   *    izni verir, 308 vermez. Sorgu dizesi kendiliğinden taşınır.
   */
  async redirects() {
    return [{ source: '/checkout/sonuc', destination: '/checkout/result', permanent: true }];
  },

  /**
   * Hukuki metinler: adres kısa kalır, dosya tek olur.
   *
   * ⚠️ REWRITE, REDIRECT DEĞİL — adres çubuğu `/kullanim-kosullari` kalmalı.
   *    Bu iki adres kayıt formunda ve yarın e-postalarda sabit yazılı olacak;
   *    `/legal/...`e yönlendirmek onları bir gün kırılacak ikinci bir adrese
   *    bağlamak olurdu.
   */
  async rewrites() {
    return [
      { source: '/kullanim-kosullari', destination: '/legal/kullanim-kosullari' },
      { source: '/aydinlatma-metni', destination: '/legal/aydinlatma-metni' },
    ];
  },
};

/**
 * next-intl EKLENTİSİ — SUNUCU TARAFI OKUMASININ TEK BAĞLAYICISI.
 *
 * ⚠️ BU SATIR OLMADAN `getTranslations()` / `getLocale()` ÇALIŞMAZ ve arıza
 *    "modül bulunamadı" gibi okunur değildir: eklenti, `src/i18n/request.ts`i
 *    derleme zamanında sunucu çalışma zamanına bağlar. Yolu AÇIKÇA yazıyoruz —
 *    varsayılan arama sırası (`./i18n/request.ts`, `./src/i18n/request.ts`) bir
 *    sonraki ana sürümde değişirse sessizce yapılandırmasız kalırdık ve her
 *    metin varsayılan dile düşerdi. Sessiz düşüş bu depodaki en pahalı hata
 *    sınıfı.
 *
 * ⚠️ SARMALAMA EN DIŞTA ve `redirects`/`rewrites` DOKUNULMADAN kalıyor:
 *    eklenti yalnız derleyici tarafına ekleme yapıyor, yönlendirme tablosuna
 *    karışmıyor. `/checkout/sonuc` köprüsü olduğu gibi duruyor.
 */
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl(nextConfig);
