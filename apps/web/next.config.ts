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

  // Ürün görselleri genel R2 kovasından servis ediliyor; imza gerekmiyor.
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**.r2.dev' }],
    formats: ['image/avif', 'image/webp'],
  },

  // Workspace paketleri kaynaktan değil, dist/esm'den geliyor — ayrıca
  // transpile edilmelerine gerek yok.
  serverExternalPackages: ['ioredis'],

  /**
   * `/checkout/sonuc` → `/odeme/sonuc`
   *
   * ⚠️ SİTENİN TEK İNGİLİZCE YOLU ve onu biz seçmedik: adres backend'de SABİT
   *    YAZILI (`checkout.service.ts` → `callbackResult()` →
   *    `${APP_URL}/checkout/sonuc?siparis=…&durum=…`) ve `POST
   *    /v1/payments/3ds/callback` yanıtında ölçüldü. Köprü olmadan ödemesini
   *    bitiren kullanıcı 404 görür.
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
    return [{ source: '/checkout/sonuc', destination: '/odeme/sonuc', permanent: true }];
  },

  /**
   * Hukuki metinler: adres kısa kalır, dosya tek olur.
   *
   * ⚠️ REWRITE, REDIRECT DEĞİL — adres çubuğu `/kullanim-kosullari` kalmalı.
   *    Bu iki adres kayıt formunda ve yarın e-postalarda sabit yazılı olacak;
   *    `/hukuki/...`e yönlendirmek onları bir gün kırılacak ikinci bir adrese
   *    bağlamak olurdu.
   */
  async rewrites() {
    return [
      { source: '/kullanim-kosullari', destination: '/hukuki/kullanim-kosullari' },
      { source: '/aydinlatma-metni', destination: '/hukuki/aydinlatma-metni' },
    ];
  },
};

export default nextConfig;
