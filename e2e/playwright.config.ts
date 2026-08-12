/**
 * ═══════════════════════ UÇTAN UCA (E2E) TEST YAPILANDIRMASI ═══════════════
 *
 * ⚠️ TARAYICI YOK. Frontend yazılmadı; bunlar API seviyesinde uçtan uca
 *    testlerdir. Playwright burada `APIRequestContext` için kullanılıyor —
 *    çerez kavanozu, yeniden deneme ve raporlama hazır geldiği için.
 *    `projects` içinde hiçbir tarayıcı tanımı YOK; olsaydı `npx playwright
 *    install` zorunlu olur ve CI'da yüz megabaytlık indirmeler için beklenirdi.
 *
 * ⚠️ TEK WORKER. Veritabanı paylaşılıyor: stok rezervasyonu, defter bakiyesi
 *    ve hız limiti sayaçları GLOBAL durumlardır. Paralel koşulsaydı
 *    "checkout stoğu rezerve ediyor mu" testi, başka bir senaryonun aynı anda
 *    stok tüketmesi yüzünden rastgele kırmızı yanardı. `fullyParallel: false`
 *    ve `workers: 1` bilinçli bir yavaşlık; belirsiz bir testten ucuzdur.
 *
 * ⚠️ retries: 0. Yeniden deneme, yarış durumu hatalarını gizler — 5. senaryo
 *    tam da bir yarış durumunu sınıyor. Bir kere kırmızı yanan test kırmızı
 *    kalmalı.
 *
 * ─────────────────────── ÇALIŞTIRMA ────────────────────────────────────────
 *
 *   1. Altyapı ayakta olmalı:  pnpm infra:up && pnpm db:migrate
 *   2. API ayakta olmalı (3001) ve ⚠️ IYZICO_BASE_URL sahte sağlayıcıya
 *      çevrilmiş olmalı:
 *
 *        IYZICO_BASE_URL=http://127.0.0.1:3999 \
 *        IYZICO_API_KEY=PLACEHOLDER-NOT-A-SECRET-01 \
 *        IYZICO_SECRET_KEY=PLACEHOLDER-NOT-A-SECRET-02 \
 *        IYZICO_WEBHOOK_SECRET=PLACEHOLDER-NOT-A-SECRET-03 \
 *        pnpm --filter @vt/api dev
 *
 *   3. pnpm --filter @vt/e2e e2e
 *
 * ⚠️ IYZICO_WEBHOOK_SECRET İKİ TARAFTA DA, AYNI DEĞERLE bulunmalıdır. Sahte
 *    sağlayıcı webhook gövdesini bu sırla imzalıyor, API aynı sırla
 *    doğruluyor. Kök `.env`de bu değişken BOŞ; test tarafı bu yüzden aşağıda
 *    `E2E_WEBHOOK_SIRRI` varsayılanına düşüyor. Varsayılan olmasaydı
 *    `sahteIyzico` fixture'ı kurulum anında patlar ve TEK BİR senaryo bile
 *    koşmazdı — 45 testin tamamı "OrtamHatasi" ile kırmızı yanardı. Değer
 *    gizli değildir, yalnızca iki sürecin anlaşması gereken bir dizedir;
 *    sunucuyu elle başlatırken 2. adımdaki satırı atlamayın.
 *
 *   `E2E_SUNUCUYU_BEN_BASLAT=1` verilirse Playwright API'yi kendisi başlatır
 *   (aşağıdaki `webServer`), doğru env ile — o yolda sır iki tarafa da
 *   otomatik geçirilir. Zaten çalışan bir sunucuya bağlanmak isteniyorsa bu
 *   değişken verilmez ve sır elle verilmelidir.
 *
 *   Başka bir portta koşan sunucuya bağlanmak için: E2E_BASE_URL.
 *
 * ─────────────────────── PAKETLEME ─────────────────────────────────────────
 *
 * `e2e/package.json` yazıldı ve `e2e` `pnpm-workspace.yaml`a eklendi
 * (`@vt/db`nin `workspace:*` ile çözülebilmesi için zorunluydu).
 *
 * ⚠️ Koşum betiğinin adı `test` DEĞİL, `e2e`. CI `pnpm test` → `turbo run test`
 *    çalıştırıyor; bu paket `test` sağlasaydı Playwright ayakta bir API
 *    olmadan her derlemede koşup kırmızı yanardı. `typecheck` ve `lint` ise
 *    sağlanıyor — ikisi de statiktir, servis istemez.
 *
 * ⚠️ E2E CI'A EKLENMEDİ. Ayrı bir iş gerekiyor: servisleri kaldırma,
 *    migrasyon, sahte iyzico'yu işaret eden env ile API başlatma. Ayrıca üç
 *    senaryo (`yetki`, `kvkk`, `hata-zarfi`) GERÇEK eksikleri açığa çıkardığı
 *    için BİLEREK kırmızıdır; onlar yeşile dönmeden CI'a eklemek, kırmızının
 *    normalleştiği bir iş üretir.
 */
import { defineConfig } from '@playwright/test';

const TEMEL_URL = process.env['E2E_BASE_URL'] ?? 'http://localhost:3001';
const IYZICO_PORT = process.env['E2E_IYZICO_PORT'] ?? '3999';
const SUNUCUYU_BEN_BASLAT = process.env['E2E_SUNUCUYU_BEN_BASLAT'] === '1';

/**
 * Webhook imza sırrı — GİZLİ DEĞİL, iki sürecin anlaşması gereken bir dize.
 * Kabuktan verilirse o kazanır; verilmezse hem `webServer` ile başlatılan API
 * hem de test süreci bu değeri kullanır, böylece iki taraf sessizce ayrışamaz.
 * Biçim `PLACEHOLDER-NOT-A-SECRET-NN`: gitleaks'in gerçek anahtar sanmaması için.
 */
const E2E_WEBHOOK_SIRRI = process.env['IYZICO_WEBHOOK_SECRET'] ?? 'PLACEHOLDER-NOT-A-SECRET-03';
process.env['IYZICO_WEBHOOK_SECRET'] = E2E_WEBHOOK_SIRRI;

export default defineConfig({
  testDir: './senaryolar',
  testMatch: /.*\.spec\.ts$/,

  // ── Paylaşılan veritabanı: sıralı koşum ZORUNLU ──
  fullyParallel: false,
  workers: 1,
  retries: 0,

  // Uçtan uca akışlar (kayıt → ürün → sipariş → ödeme) birkaç saniye sürebilir;
  // varsayılan 30 sn kısmi zaman aşımlarıyla gürültü üretiyordu.
  timeout: 90_000,
  expect: { timeout: 10_000 },

  // Bir senaryonun ürettiği veri diğerinin filtresine takılabilir; ilk hatada
  // durmak yerine tamamı koşuyor ki tek bir rapordan bütün resim görülsün.
  maxFailures: 0,

  reporter: process.env['CI'] === undefined ? [['list']] : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: TEMEL_URL,
    extraHTTPHeaders: { Accept: 'application/json' },
    // Hata ayıklarken hangi isteğin ne döndürdüğü görünsün.
    trace: 'retain-on-failure',
    ignoreHTTPSErrors: true,
  },

  ...(SUNUCUYU_BEN_BASLAT
    ? {
        webServer: {
          command: 'pnpm --filter @vt/api dev',
          url: `${TEMEL_URL}/health`,
          cwd: '..',
          reuseExistingServer: false,
          timeout: 120_000,
          stdout: 'pipe',
          stderr: 'pipe',
          env: {
            NODE_ENV: 'development',
            // ⚠️ ÖDEME SAĞLAYICISININ YÖNÜ. Sunucu kodu değiştirilmiyor;
            //    yalnızca üçüncü taraf yer değiştiriyor. Bu satır olmadan
            //    ödeme akışı gerçek iyzico'ya gider, 3DS formu tarayıcı
            //    ister ve sipariş asla PAID olmaz — defter/iade senaryoları
            //    kurulamaz.
            IYZICO_BASE_URL: `http://127.0.0.1:${IYZICO_PORT}`,
            // Anahtarların BOŞ OLMAMASI yeterli: `isPaymentConfigured` yalnızca
            // doluluk bakıyor, imzayı doğrulayan taraf sahte sunucu.
            IYZICO_API_KEY: 'PLACEHOLDER-NOT-A-SECRET-01',
            IYZICO_SECRET_KEY: 'PLACEHOLDER-NOT-A-SECRET-02',
            // ⚠️ WEBHOOK SIRRI — sunucuya ve test sürecine AYNI değer gitmeli.
            //    Sahte sağlayıcı gövdeyi bununla imzalıyor, API bununla
            //    doğruluyor. Kök `.env`de boş olduğu için burada açıkça
            //    veriliyor; eksik olsaydı `sahteIyzico` fixture'ı kurulumda
            //    patlar ve TEK BİR senaryo bile koşmazdı.
            IYZICO_WEBHOOK_SECRET: E2E_WEBHOOK_SIRRI,
          },
        },
      }
    : {}),
});
