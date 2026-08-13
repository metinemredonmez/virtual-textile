import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

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
   */
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.r2.dev' },
      { protocol: 'https', hostname: 'images.pexels.com' },
    ],
    formats: ['image/avif', 'image/webp'],
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
