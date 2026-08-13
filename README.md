# virtual-textile

Çok satıcılı moda pazaryeri · yapay zekâ destekli sanal giyinme kabini · AI stil danışmanı.

Kullanıcı kendi fotoğrafı üzerinde ürünü dener, AI stil danışmanından kombin önerisi alır ve
farklı satıcılardan seçtiği ürünleri tek sepetten satın alır. Ürünün ayrıştırıcı iddiası
_tek ürün denemesi_ değil: **bir mağazanın ceketi + ikincinin pantolonu, aynı kişide, tek
sepette** — çok satıcılı sipariş, komisyon paylaşımı ve append-only hakediş defteri bunun
altındaki ticari makinedir.

Depo bir **modüler monolit**: tek NestJS API (18 denetleyici, 118 uç), tek Next.js uygulaması
(48 sayfa; müşteri vitrini + satıcı paneli + yönetim paneli aynı uygulamanın üç bölgesi) ve
BullMQ tüketicilerini koşturan bir worker. Sayılar ölçülmüştür, tahmin değildir —
doğrulama komutları [Depo yapısı](#depo-yapısı) bölümünde.

> **Durum:** aktif geliştirme — MVP. Dürüst durum tablosu için aşağıdaki
> [Bugünkü durum](#bugünkü-durum) bölümünü **kurulumdan önce** okuyun.

---

## Bugünkü durum

Ölçüm tarihi **2026-08-13**. Her satır ya bir dosya yolundan ya da canlıya atılmış bir
istekten geliyor.

### Çalışıyor

| Alan             | Kanıt                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| Backend          | 118 uç / 18 denetleyici, 47 Prisma modeli, 24 enum                                                |
| Frontend         | 48 sayfa — 22 vitrin, 12 satıcı paneli, 14 yönetim paneli                                         |
| Test             | 1376 statik `it`/`test` bloğu, 89 test dosyası (`it.each` genişlemesiyle koşumda ~1392)           |
| E2E              | 45 senaryo / 10 dosya (`e2e/senaryolar/`), CI'dan ayrı işte koşar                                 |
| Canlı dağıtım    | http://91.99.183.64 — **yeni İngilizce rotalar dağıtılmış durumda** (aşağıdaki nota bakın)        |
| Sanal deneme     | Uçtan uca yazılmış; çok parçalı kombin denemesi (`POST /tryon/outfit`) de **canlı ve çağrılıyor** |
| Dijital gardırop | `wardrobe.controller.ts` 5 uç + `account/wardrobe` ekranı — tamam                                 |

> ✅ **"Sunucu eski kodda" doğru değil.** 2026-08-13'te ölçüldü: eski Türkçe adresler
> ölmüş (`/urunler` → 404, `/hesabim` → 404), yeni adresler ayakta (`/products` → 200,
> `/calculator` → 200, `/stylist` → 307 giriş yönlendirmesi), yeni uçlar canlı
> (`/api/outfits` → 200, `/api/tryon/history` → 401 yani var ama kimlik istiyor).

### Çalışmıyor / eksik

| Sorun                                         | Ölçüm                                                                                                                                            | Sonuç                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| **Canlı katalog neredeyse boş**               | `GET /api/products?limit=100` → **3 ürün** · `GET /api/categories` → **3 kategori** (1 kök + 2 çocuk)                                            | Vitrin "basit bir site" gibi görünüyor            |
| **Üretimde ADMIN doğuracak yol yok**          | Seed üretimde reddediyor (`packages/db/prisma/seed/kapi.ts:44-70`, üç bağımsız kapı) · `rol-ata.ts:48` üretimde çıkıyor · rol yazan HTTP ucu yok | Yönetim paneli canlıda hiç açılamadı              |
| **R2 kova CORS'u yok**                        | Ön uçuş `OPTIONS` → **403** (`infra/R2-CORS.md`)                                                                                                 | Ana özellik — fotoğraf yükleme — tarayıcıda kırık |
| **TLS yok**                                   | `infra/nginx/vt.conf:16` tek `listen 80`                                                                                                         | Üretim trafiği düz HTTP                           |
| **118 ucun ~20'sinin ekranı yok**             | Ayrıntı: [`docs/yol-haritasi.md`](docs/yol-haritasi.md)                                                                                          | Yetenek var, yüzeye çıkmamış                      |
| **`Favorite` · `Review` · `Address` ucu yok** | Şemada var (`schema.prisma:580`, `:559`, `:126`); denetleyicilerde grep **0 isabet**                                                             | Pazaryeri taban çizgisi eksik                     |
| `docs/runbook/` dizini yok                    | 4 belgeden atıf var (`secrets.md:76,132`, `privacy.md:147`, `deployment.md:301`)                                                                 | KVKK ihlal prosedürü yazılı değil                 |

> ⚠️ **Seed üretimde çalıştırılamaz ve bu bilinçli.** `kapi.ts` üç şart birden arıyor:
> `NODE_ENV !== production`, `DATABASE_URL` host'u yerel, `APP_URL` yerel. Gerekçe kodda
> yazılı: seed `finance_ledger_entries`e `SALE`/`COMMISSION` satırları yazıyor ve defter
> append-only — üretimde bir kez koşarsa **geri alınamaz**. Yani canlı katalog "seed
> unutulduğu için" değil, **üretim için ayrı bir katalog açılış yolu hiç yazılmadığı için**
> boş. Bu, yol haritasının 1. maddesidir.

---

## Mimari özet

**Modüler monolit** (NestJS) + ayrı bir kuyruk worker'ı. Mikroservis değil: modül sınırları
baştan doğru çizilir, yük arttığında bağımsız servislere ayrılabilir.

```
apps/web (Next.js — TEK uygulama, ÜÇ bölge)
  (magaza)/   müşteri vitrini      22 sayfa
  (satici)/   satıcı paneli        12 sayfa
  (yonetim)/  yönetim paneli       14 sayfa
                 │
        apps/api (NestJS — tek deploy, 18 denetleyici / 118 uç)
        admin · ai · auth · cart · catalog · checkout
        health · me · media · notification · order · seller · stylist · wardrobe
                 │
   PostgreSQL 17 (+pgvector/FTS) · Redis · BullMQ · S3-uyumlu depolama (R2)
                 │
        apps/worker (try-on · embedding · outbox · bildirim · cron)
        WORKER_ROLE=core | media — üretimde AYRI süreçler
                 │
   Dış servisler — hepsi adapter arkasında:
   fal.ai (try-on) · Anthropic (stil) · iyzico (ödeme) · kargo · NetGSM/Resend
```

> ⚠️ **Ayrı `apps/seller` veya `apps/admin` uygulaması YOKTUR** ve `:3002`/`:3003`
> portlarında hiçbir şey dinlemez. Paneller `apps/web` içindeki rota gruplarıdır.
> (Bu README bir dönem üç ayrı Next uygulaması iddia ediyordu; iddia yanlıştı, düzeltildi.)
> Bölge kararının gerekçesi: [`docs/frontend-mimari.md:8-10`](docs/frontend-mimari.md).

Detay: [`docs/architecture.md`](docs/architecture.md) · Kararlar: [`docs/adr/`](docs/adr/)

### Temel tasarım kararları

| Konu            | Karar                                         | Neden                                                                               |
| --------------- | --------------------------------------------- | ----------------------------------------------------------------------------------- |
| Mimari          | Modüler monolit + 1 worker                    | Küçük takım, kısa takvim. Sınırlar kodda zorlanır (ESLint), ayırmak sonra kolay.    |
| Panel dağıtımı  | Tek Next uygulaması, üç rota bölgesi          | Üç ayrı uygulama üç ayrı oturum/derleme/dağıtım demekti; kazancı yoktu.             |
| Dil             | Baştan sona TypeScript                        | MVP'de AI = HTTP orkestrasyonu, model çalıştırma değil. Python'a gerek yok.         |
| Arama           | PostgreSQL FTS + `pg_trgm` + `pgvector`       | Bu ölçekte OpenSearch gereksiz operasyon yükü. Arayüz arkasında, sonra geçilebilir. |
| Kuyruk          | BullMQ (Redis)                                | Retry, backoff, DLQ, delayed job hazır. Kafka bu ölçekte fazla.                     |
| Try-on          | Hosted model API (adapter arkasında)          | Kendi GPU havuzu MVP'ye zaman ve sabit gider ekler, ürün faydası eklemez.           |
| Para            | `BigInt` + kuruş (minor unit)                 | Kayan noktalı sayı finansal hesapta kullanılmaz.                                    |
| Komisyon        | Versiyonlu kural + sipariş kaleminde snapshot | Kural değişince geçmiş siparişin muhasebesi bozulmaz.                               |
| Satıcı bakiyesi | Append-only ledger, `SUM()` ile hesaplanır    | Ayrı `balance` kolonu er geç tutarsızlaşır.                                         |
| Worker topoloji | `core` / `media` ayrı süreçler                | Ağır görsel işleme, 10 sn'de bir koşan outbox dağıtıcısını aç bırakmasın.           |

---

## Gereksinimler

- Node.js **≥ 20.11** · pnpm **≥ 9** (`package.json` → `engines`)
- Docker — **yalnızca yerel geliştirme için**

> **Sunucuda konteyner yoktur.** PostgreSQL, Redis ve Node doğrudan makinede kurulur,
> süreçler PM2 ile yönetilir. Bkz. [`docs/deployment.md`](docs/deployment.md).

---

## Kurulum

### 1. Bağımlılıklar ve ortam

```bash
pnpm install
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
```

> ⚠️ **İKİ ayrı env dosyası var ve bu bilinçli.** Next kök `.env`i okumaz; kendi uygulama
> dizinindeki dosyayı okur. Frontend süreci backend'in sırlarını (`JWT_*`, `IYZICO_*`,
> `FIELD_ENCRYPTION_KEY`) **görmemeli** — görmediği şeyi paketine gömemez.
> `apps/web/.env.local` atlanırsa `apps/web` derlemede "APP_URL tanımlı değil" ile düşer
> (`apps/web/src/lib/env.ts:16` → `required()`).

Anahtarları üret ve `.env`e yaz:

```bash
openssl rand -hex 64   # JWT_ACCESS_SECRET
openssl rand -hex 64   # JWT_REFRESH_SECRET
openssl rand -hex 32   # FIELD_ENCRYPTION_KEY
openssl rand -hex 24   # INTERNAL_API_TOKEN
openssl rand -hex 32   # apps/web/.env.local → SESSION_SECRET
```

### 2. Altyapı + veritabanı + demo veri

```bash
pnpm infra:up      # vt-postgres:5433 · vt-redis:6380 · vt-minio:9000/9001 · redis-commander
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Yerelde 5433/6380 kullanılıyor çünkü geliştirici makinesinde zaten bir Postgres veya Redis
çalışıyor olabilir.

### 3. Yönetici ve satıcı hesabı

`pnpm db:seed` **9 hesabı kendisi yazar** — 1 `ADMIN`, 4 `SELLER_USER`, 4 `CUSTOMER`
(`packages/db/prisma/seed/veri.ts` → `HESAPLAR`). Yani yerelde ek bir adım gerekmez:

| Rol      | E-posta                          | Parola           |
| -------- | -------------------------------- | ---------------- |
| `ADMIN`  | `yonetici@example.com`           | `DemoParola2026` |
| `SELLER` | `satici@atolye-nord.example.com` | `DemoParola2026` |

Tam liste ve her hesabın hangi senaryo için var olduğu:
**[`docs/demo-veri.md`](docs/demo-veri.md)**.

Seed dışındaki bir hesabı yükseltmek gerekirse (önce normal yoldan kayıt olun, betik yalnızca
**rolü** değiştirir — parola üretmez):

```bash
pnpm --filter @vt/db rol:ata -- --eposta=ben@ornek.test --rol=ADMIN
```

> ⚠️ Bu betik `NODE_ENV=production` altında çalışmaz (`packages/db/scripts/rol-ata.ts:48`).
> Bir kabuk erişimini kalıcı yönetici yetkisine çeviren betiğin üretimde bulunması, tüm
> yetki kapılarının etrafından dolaşmaktır. Üretimde ilk ADMIN'i doğuracak **desteklenen
> bir yol bugün yoktur** — açık iş maddesi, bkz. [`docs/yol-haritasi.md`](docs/yol-haritasi.md).

### `pnpm db:seed` ne yazıyor

32 kategori (üç seviye) · 6 satıcı (4 `APPROVED`, 1 `PENDING`, 1 `SUSPENDED`) · 28 ürün
(25 `PUBLISHED`, 3 `PENDING_REVIEW`) · 178 varyant/stok · 56 görsel · 16 sipariş
(`OrderStatus`un 10 değerinin 10'u) · 55 ledger kaydı. Kaynak:
[`docs/demo-veri.md`](docs/demo-veri.md).

İki değişmez: **idempotenttir** (iki kez çalıştırmak güvenli, yarım koşu kendini onarır) ve
**hiçbir veri silmez** (ledger append-only).

> ⚠️ **Seed üretimde çalışmaz** — `packages/db/prisma/seed/kapi.ts` üç bağımsız şart arar.
> Bir "demo modu bayrağı" da eklenmeyecek; o bayrak bir gün "sadece bir kez, canlıyı
> göstermek için" diye açılır ve sahte finansal kayıt geri alınamaz.

### Yerel adresler

| Servis          | Adres                                            |
| --------------- | ------------------------------------------------ |
| Web (üç bölge)  | http://localhost:3000 → `/`, `/seller`, `/admin` |
| API             | http://localhost:3001                            |
| MinIO konsolu   | http://localhost:9001                            |
| Redis Commander | http://localhost:8081                            |

### Tek bir uygulamayı ayağa kaldırmak

```bash
pnpm --filter @vt/api dev     # kendi dev betiği dotenv -e ../../.env taşır
pnpm --filter @vt/web dev
pnpm --filter @vt/worker dev  # ⚠️ kök .env'i kendisi YÜKLEMEZ:
pnpm exec dotenv -e .env -- pnpm --filter @vt/worker dev
```

> ⚠️ `turbo run` sonrası `packages/config` veya `packages/contracts` dist'i bayatlayabilir
> ve `next dev` kaynak doğruyken "Export X doesn't exist" der. Çözüm:
> `pnpm --filter @vt/config build` (bkz. `apps/web/AGENTS.md:639-645`).

---

## Ortam değişkenleri

Doğrulama `packages/config/src/env.ts` içinde, Zod ile. **Kural: uygulama açılırken
doğrulanır; bir anahtar eksik veya bozuksa süreç BAŞLAMAZ.** Üç hafta sonra üretimde
"neden SMS gitmiyor" aramaktan iyidir.

| Grup           | Anahtarlar                                                                                     | Not                                                             |
| -------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Çalışma zamanı | `NODE_ENV` `LOG_LEVEL` `PORT` `APP_URL` `API_URL` `CORS_ORIGINS`                               | `CORS_ORIGINS` üretimde `localhost` içeremez                    |
| Veri           | `DATABASE_URL` `REDIS_URL`                                                                     |                                                                 |
| Kimlik         | `JWT_ACCESS_SECRET` `JWT_REFRESH_SECRET` `JWT_ACCESS_TTL` `JWT_REFRESH_TTL`                    | JWT sırları **tam 64 bayt hex** (HS512)                         |
| Şifreleme      | `FIELD_ENCRYPTION_KEY`                                                                         | AES-256-GCM, **32 bayt hex**. IBAN/vergi no alanları için       |
| Ödeme          | `IYZICO_BASE_URL` `IYZICO_API_KEY` `IYZICO_SECRET_KEY` `IYZICO_WEBHOOK_SECRET`                 | Üretimde `sandbox` adresi reddedilir                            |
| Depolama       | `R2_ENDPOINT` `R2_ACCESS_KEY_ID` `R2_SECRET_ACCESS_KEY` `R2_BUCKET_PUBLIC` `R2_BUCKET_PRIVATE` | İki kova **aynı olamaz** — KVKK, özel nitelikli veri            |
| AI             | `FAL_KEY` `FAL_TRYON_MODEL` `GOOGLE_AI_API_KEY` `ANTHROPIC_API_KEY` `ANTHROPIC_MODEL`          | `FAL_TRYON_MODEL` varsayılanı **`fal-ai/idm-vton`**             |
| AI bütçe       | `AI_DAILY_BUDGET_USD` `AI_MONTHLY_BUDGET_USD` `AI_TRYON_DAILY_PER_USER` `..._PER_GUEST`        | Varsayılan 50 / 1200 USD                                        |
| Video try-on   | `AI_VIDEO_TRYON_ENABLED` `FAL_VIDEO_TRYON_MODEL` `AI_VIDEO_DAILY_BUDGET_USD`                   | **Varsayılan kapalı**, ayrı bütçe kovası — aşağıdaki nota bakın |
| Bildirim       | `NETGSM_*` `RESEND_API_KEY` `MAIL_FROM`                                                        |                                                                 |
| Kargo          | `SHIPPING_PROVIDER` `SHIPPING_API_KEY` `SHIPPING_CUSTOMER_CODE`                                | Varsayılan `mock`                                               |
| Gözlem / iç    | `SENTRY_DSN` `OTEL_EXPORTER_OTLP_ENDPOINT` `INTERNAL_API_TOKEN` `WORKER_ROLE`                  | `INTERNAL_API_TOKEN` ≥ 16 karakter                              |

`apps/web/.env.local` (ayrı ve dar): `API_URL` `APP_URL` `SESSION_REDIS_URL` `SESSION_SECRET`
`NEXT_PUBLIC_MEDIA_URL`.

Üretimde boş bırakılamayan 10 anahtar `env.ts` içinde `superRefine` ile ayrıca zorlanır ve
her biri **sonucuyla birlikte** hata verir (`FAL_KEY` eksikse: "sanal deneme çalışmaz").

> ⚠️ `AI_VIDEO_TRYON_ENABLED` için `z.coerce.boolean()` **kullanılmadı ve kullanılmamalı**:
> `Boolean('false')` JavaScript'te `true`dur. Yani `AI_VIDEO_TRYON_ENABLED=false` yazan bir
> `.env`, istek başına ~1 dolarlık özelliği tam tersine **açardı**.

Sır yönetimi ve rotasyon: [`docs/secrets.md`](docs/secrets.md).

---

## Test

```bash
pnpm test                       # turbo run test → tüm paketlerde vitest run
pnpm exec vitest run            # kökten tek koşu
pnpm --filter @vt/api test      # tek paket
pnpm lint · pnpm typecheck · pnpm format
```

Bugünkü hacim: **89 test dosyası**, **1376 statik `it`/`test` bloğu**
(`it.each` genişlemesiyle koşumda ~1392).

> ⚠️ `apps/web/AGENTS.md:586` eşiği hâlâ "1245'ten aşağı düşmemeli" diyor. Gerçek sayı çok
> daha yüksek olduğu için bu koruma bugün gevşek — yukarı çekilmeli.

### E2E (Playwright)

```bash
pnpm --filter @vt/e2e e2e                        # servisleri kendisi kaldırır
pnpm --filter @vt/e2e e2e:sunucuyu-sen-baslat    # zaten ayaktaysa
```

45 senaryo / 10 dosya: `checkout-stok` `hata-zarfi` `iade` `katalog-arama` `kayit-giris`
`komisyon-ledger` `kvkk` `sepet` `token-hirsizligi` `yetki`.

> ⚠️ **Koşum betiğinin adı bilerek `test` değil, `e2e`.** CI `pnpm test` → `turbo run test`
> çalıştırıyor; bu paket `test` sağlasaydı Playwright ayakta bir API olmadan CI'da koşar ve
> her derlemede kırmızı yanardı (gerekçe `e2e/package.json` içinde yazılı). E2E ayrı bir işte,
> servisler kaldırıldıktan sonra çağrılır.

### CI

`.github/workflows/ci.yml` — pgvector/pg17 + redis servis konteynerleri ile lint · typecheck ·
build · test. `apps/web` derleme anında ortam istediği için CI **sahte** `PLACEHOLDER-NOT-A-SECRET-*`
değerleri kullanır ve bunlar sahte kalmalıdır: CI çıktısı dağıtılabilir bir eser değildir,
sunucu `.env.production` ile yeniden derler.

---

## Dağıtım özeti

|                | Yerel                             | Üretim                       |
| -------------- | --------------------------------- | ---------------------------- |
| PostgreSQL     | Docker (`vt-postgres`, port 5433) | Sistem paketi, port 5432     |
| Redis          | Docker (`vt-redis`, port 6380)    | Sistem paketi, port 6379     |
| Node süreçleri | `pnpm dev`                        | PM2 (`ecosystem.config.cjs`) |
| Depolama       | MinIO (Docker)                    | Cloudflare R2                |

PM2 dört süreç yönetir: `vt-api` · `vt-worker-core` · `vt-worker-media` · `vt-web`.
Web üretimde **3020** portunu dinler (3000 değil — o portta bu makinede başka bir proje var).

```bash
/var/www/virtual/scripts/deploy.sh          # yedek → çek → derle → migrate → reload → sağlık
/var/www/virtual/scripts/deploy.sh --build-atla
```

nginx: `infra/nginx/vt.conf` — `default_server` **değil** (aynı makinede komşu projeler var).

**Bugün eksik iki altyapı adımı:**

1. **TLS yok** — `vt.conf:16` tek `listen 80`.
2. **R2 kova CORS'u yok** — ön uçuş `OPTIONS` → 403. Bu bir "yapılacaklar" notu değil,
   **kabul ölçütüdür**: bu ayar yapılmadan sanal denemenin tarayıcıda çalıştığı iddia
   edilemez. `.env`deki jeton bu ayarı **yapamaz** (`GetBucketCors` → `AccessDenied`);
   Cloudflare panelinden veya geniş yetkili jetonla yapılmalı. Bkz. [`infra/R2-CORS.md`](infra/R2-CORS.md).

Tam prosedür: [`docs/deployment.md`](docs/deployment.md).

---

## Depo yapısı

```
apps/
  api/        NestJS — HTTP API (modüler monolit, 18 denetleyici / 118 uç)
  worker/     BullMQ tüketicileri + zamanlanmış işler (core | media)
  web/        Next.js — müşteri vitrini + satıcı paneli + yönetim paneli
packages/
  contracts/  Zod şemaları, wire tipleri, hata kodu kataloğu (FE + BE ortak)
  config/     Env doğrulama (Zod), sabitler, feature flag
  db/         Prisma şeması (47 model / 24 enum), migration, seed, rol-ata betiği
  adapters/   Dış servisler — ödeme, AI, kargo, bildirim, depolama
infra/        docker-compose, nginx, systemd, R2-CORS.md
e2e/          Playwright (10 dosya / 45 senaryo)
docs/         Mimari, ADR, hata kataloğu, KVKK, demo veri, yol haritası
scripts/      deploy.sh, i18n-kapsam.mjs
```

Sayıları kendiniz doğrulayın:

```bash
find apps/api/src -name '*.controller.ts' | wc -l                    # 18
grep -rhoE '@(Get|Post|Patch|Put|Delete)\(' apps/api/src --include='*.controller.ts' | wc -l   # 118
find apps/web/app -name page.tsx | wc -l                             # 48
grep -cE '^model ' packages/db/prisma/schema.prisma                  # 47
```

> ⚠️ `packages/ui` **yoktur**. Paylaşılan React bileşenleri `apps/web/src/components/`
> içinde yaşıyor; tek tüketici olduğu için ayrı paket açmanın kazancı yok.

### Modül sınırı kuralları

Monoliti ileride ayırabilmek için 4 kural, ESLint ile zorlanır:

1. Bir modül **başka modülün Prisma modeline doğrudan erişemez** — yalnızca o modülün
   `*.service.ts` public metodunu çağırır.
2. Modüller arası yan etki **domain event** ile olur (`OutboxEvent` → BullMQ).
3. Her modülün tablo öneki vardır (`order_*`, `catalog_*`).
4. Modülün yalnızca `index` / `*.service` / `*.types` dosyaları dışarıdan import edilebilir.

---

## Belge haritası

| Sorunuz                                  | Dosya                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| Sistem nasıl kurgulandı?                 | [`docs/architecture.md`](docs/architecture.md)                                              |
| Şu karar neden böyle verildi?            | [`docs/adr/`](docs/adr/) — 5 ADR                                                            |
| **Sırada ne var, neden bu sırada?**      | **[`docs/yol-haritasi.md`](docs/yol-haritasi.md)**                                          |
| Rakiplerle karşılaştırma, faz planı      | [`docs/ozellik-yol-haritasi.md`](docs/ozellik-yol-haritasi.md) ⚠️                           |
| B2B / çok kiracılı hizmet mimarisi       | [`docs/hizmet-mimarisi.md`](docs/hizmet-mimarisi.md) — en taze belge                        |
| Frontend rota/bölge yapısı               | [`docs/frontend-mimari.md`](docs/frontend-mimari.md)                                        |
| Arayüz kuralları, öğe bütçesi            | [`docs/design-system.md`](docs/design-system.md)                                            |
| Frontend'de çalışırken uyulacak kurallar | [`apps/web/AGENTS.md`](apps/web/AGENTS.md) — 645 satır, depodaki en detaylı                 |
| Demo hesaplar, seed neyi yazıyor         | [`docs/demo-veri.md`](docs/demo-veri.md)                                                    |
| Hata zarfı ve kod kataloğu               | [`docs/errors.md`](docs/errors.md)                                                          |
| KVKK: veri akışı, saklama, silme         | [`docs/privacy.md`](docs/privacy.md) · [`docs/kvkk-veri-akisi.md`](docs/kvkk-veri-akisi.md) |
| KVKK metin taslakları (aydınlatma, rıza) | [`docs/kvkk-metinler-taslak.md`](docs/kvkk-metinler-taslak.md)                              |
| Sır yönetimi, rotasyon                   | [`docs/secrets.md`](docs/secrets.md)                                                        |
| Sunucuya nasıl çıkılır                   | [`docs/deployment.md`](docs/deployment.md)                                                  |
| Hangi kategori denenebilir               | [`docs/tryon-kategori-destegi.md`](docs/tryon-kategori-destegi.md) ⚠️                       |
| Çeviri/dil kapsamı                       | [`docs/i18n.md`](docs/i18n.md)                                                              |
| R2 CORS kabul kapısı                     | [`infra/R2-CORS.md`](infra/R2-CORS.md)                                                      |

⚠️ **İki belgede bilinen bayat bilgi var** (dosyalar bilerek değiştirilmedi, düzeltme yol
haritasının 3. maddesi):

- `ozellik-yol-haritasi.md:18,20,21` — "markalar arası tam kombin", "dijital gardırop" ve
  "doğal dilde arama" **planlı/Faz 2** diye işaretli; üçü de bugün canlı
  (`multi-tryon.controller.ts:42`, `wardrobe.controller.ts` 5 uç + `account/wardrobe` ekranı,
  `natural-search.controller.ts:29`).
- `tryon-kategori-destegi.md` — gerekçe sütunu "FASHN v1.6" diyor; gerçek model
  `.env:54` ve `packages/config/src/env.ts:75` uyarınca **`fal-ai/idm-vton`**. Kategori
  tablosunun kendisi doğru.

Eksik belgeler (henüz yazılmadı): `docs/runbook/` (4 yerden atıf var), `CONTRIBUTING.md`,
`CODEOWNERS`, veri modeli haritası, sipariş durum diyagramı.

---

## Güvenlik ve gizlilik

- **Kart verisi hiçbir zaman bu sisteme gelmez** — 3D Secure iframe + sağlayıcı
  tokenizasyonu (PCI kapsamı dışı).
- **Kullanıcı fotoğrafları özel nitelikli kişisel veridir.** Ayrı private bucket, imzalı URL
  (5 dk), EXIF temizliği, süreli saklama + otomatik silme. Yönetici hesapları dahil serbest
  erişim yoktur; `break-glass` erişimi denetim izine yazılır.
- Üretilen her sanal deneme görselinde **"yapay zekâ ile oluşturulmuştur"** uyarısı piksel
  içine gömülür.
- Rıza kayıtları append-only tutulur; yurt dışına aktarım için ayrı rıza alınır.
- **Rol yükseltmenin HTTP ucu yoktur ve bu bilinçlidir.** `PROTECTED_ROLES = ['ADMIN','SUPPORT']`
  (`seller-role.ts:34`); ele geçirilmiş bir admin oturumu kalıcı yetki dağıtamaz. Bedeli:
  ilk ADMIN'in üretimde nasıl doğacağı hâlâ çözülmemiş bir sorudur.
- Gizli anahtarlar repoda tutulmaz — bkz. [`docs/secrets.md`](docs/secrets.md).

Detay: [`docs/privacy.md`](docs/privacy.md) · Dağıtım: [`docs/deployment.md`](docs/deployment.md)

---

## Hata yönetimi

Tek hata zarfı, dört hata ailesi ve kod kataloğu: [`docs/errors.md`](docs/errors.md)

```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Seçtiğiniz beden için yeterli stok kalmadı.",
    "httpStatus": 409,
    "retryable": false,
    "requestId": "01J..."
  }
}
```

---

## Katkı

```bash
git switch -c feat/kisa-aciklama
pnpm lint && pnpm typecheck && pnpm test
git commit -m "feat(catalog): varyant matrisi"
```

Commit mesajları [Conventional Commits](https://www.conventionalcommits.org/) biçimindedir.
Frontend'e dokunmadan önce [`apps/web/AGENTS.md`](apps/web/AGENTS.md) okunur — orada
yazılı kurallar bu depoda **gerçekten yaşanmış** arızalardan doğdu.
