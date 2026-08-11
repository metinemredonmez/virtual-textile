# virtual-textile

Çok satıcılı moda pazaryeri · yapay zekâ destekli sanal giyinme kabini · AI stil danışmanı.

Kullanıcı kendi fotoğrafı üzerinde ürünü dener, AI stil danışmanından kombin önerisi alır ve
farklı satıcılardan seçtiği ürünleri tek sepetten satın alır.

> **Durum:** aktif geliştirme — MVP.

---

## Mimari özet

**Modüler monolit** (NestJS) + ayrı bir kuyruk worker'ı. Mikroservis değil: modül sınırları
baştan doğru çizilir, yük arttığında bağımsız servislere ayrılabilir.

```
apps/web · apps/seller · apps/admin          (Next.js)
                 │
        apps/api (NestJS — tek deploy)
        auth · catalog · cart · order · payment · seller
        commission · settlement · ai-gateway · media · consent
                 │
   PostgreSQL(+pgvector/FTS) · Redis · BullMQ · S3-uyumlu depolama
                 │
        apps/worker (try-on · embedding · outbox · bildirim · cron)
                 │
   Dış servisler — hepsi adapter arkasında:
   try-on API · LLM · ödeme · kargo · SMS/e-posta
```

Detay: [`docs/architecture.md`](docs/architecture.md) · Kararlar: [`docs/adr/`](docs/adr/)

### Temel tasarım kararları

| Konu | Karar | Neden |
|---|---|---|
| Mimari | Modüler monolit + 1 worker | Küçük takım, kısa takvim. Sınırlar kodda zorlanır (ESLint), ayırmak sonra kolay. |
| Dil | Baştan sona TypeScript | MVP'de AI = HTTP orkestrasyonu, model çalıştırma değil. Python'a gerek yok. |
| Arama | PostgreSQL FTS + `pg_trgm` + `pgvector` | Bu ölçekte OpenSearch gereksiz operasyon yükü. Arayüz arkasında, sonra geçilebilir. |
| Kuyruk | BullMQ (Redis) | Retry, backoff, DLQ, delayed job hazır. Kafka bu ölçekte fazla. |
| Try-on | Hosted model API (adapter arkasında) | Kendi GPU havuzu MVP'ye zaman ve sabit gider ekler, ürün faydası eklemez. |
| Para | `BigInt` + kuruş (minor unit) | Kayan noktalı sayı finansal hesapta kullanılmaz. |
| Komisyon | Versiyonlu kural + sipariş kaleminde snapshot | Kural değişince geçmiş siparişin muhasebesi bozulmaz. |
| Satıcı bakiyesi | Append-only ledger, `SUM()` ile hesaplanır | Ayrı `balance` kolonu er geç tutarsızlaşır. |

---

## Gereksinimler

- Node.js **≥ 20.11**
- pnpm **≥ 9**
- Docker (Postgres + Redis + MinIO için)

## Kurulum

```bash
pnpm install
cp .env.example .env        # değerleri doldur
pnpm infra:up               # postgres + redis + minio
pnpm db:migrate
pnpm db:seed
pnpm dev
```

| Servis | Adres |
|---|---|
| Müşteri web | http://localhost:3000 |
| API | http://localhost:3001 |
| Satıcı paneli | http://localhost:3002 |
| Admin paneli | http://localhost:3003 |
| MinIO konsolu | http://localhost:9001 |

## Komutlar

```bash
pnpm dev            # tüm uygulamalar (turbo)
pnpm build          # üretim derlemesi
pnpm typecheck      # tip kontrolü
pnpm lint           # ESLint
pnpm test           # Vitest
pnpm format         # Prettier

pnpm db:migrate     # migration uygula
pnpm db:studio      # Prisma Studio
pnpm db:seed        # demo veri

pnpm infra:up       # altyapı ayağa kalksın
pnpm infra:reset    # ⚠️ volume'leri siler, sıfırdan kurar
```

---

## Depo yapısı

```
apps/
  api/        NestJS — HTTP API (modüler monolit)
  worker/     BullMQ tüketicileri + zamanlanmış işler
  web/        Next.js — müşteri
  seller/     Next.js — satıcı paneli
  admin/      Next.js — yönetim paneli
packages/
  contracts/  Zod şemaları, hata kodu kataloğu, ortak tipler (FE + BE)
  config/     Env doğrulama (Zod), sabitler, feature flag
  db/         Prisma şeması, migration, seed
  adapters/   Dış servisler — ödeme, AI, kargo, bildirim, depolama
  ui/         Paylaşılan React bileşenleri
infra/        docker-compose, Dockerfile, deploy
docs/         Mimari, ADR, hata kataloğu, runbook
e2e/          Playwright
```

### Modül sınırı kuralları

Monoliti ileride ayırabilmek için 4 kural, ESLint ile zorlanır:

1. Bir modül **başka modülün Prisma modeline doğrudan erişemez** — yalnızca o modülün `*.service.ts` public metodunu çağırır.
2. Modüller arası yan etki **domain event** ile olur (`OutboxEvent` → BullMQ).
3. Her modülün tablo öneki vardır (`order_*`, `catalog_*`).
4. Modülün yalnızca `index` / `*.service` / `*.types` dosyaları dışarıdan import edilebilir.

---

## Güvenlik ve gizlilik

- **Kart verisi hiçbir zaman bu sisteme gelmez** — 3D Secure iframe + sağlayıcı tokenizasyonu (PCI kapsamı dışı).
- **Kullanıcı fotoğrafları özel nitelikli kişisel veridir.** Ayrı private bucket, imzalı URL (5 dk),
  EXIF temizliği, süreli saklama + otomatik silme. Yönetici hesapları dahil serbest erişim yoktur.
- Üretilen her sanal deneme görselinde **"yapay zekâ ile oluşturulmuştur"** uyarısı piksel içine gömülür.
- Rıza kayıtları append-only tutulur; yurt dışına aktarım için ayrı rıza alınır.
- Gizli anahtarlar repoda tutulmaz — bkz. [`docs/secrets.md`](docs/secrets.md).

Detay: [`docs/privacy.md`](docs/privacy.md)

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
