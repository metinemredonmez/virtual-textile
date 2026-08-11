# Mimari

---

## 1. Genel görünüm

```
                    ┌──────────── CDN + WAF ────────────┐
                    │                                    │
   ┌────────────────┴─────────────────┐                  │
   │  apps/web      (Next.js)         │  müşteri, SSR/SEO│
   │  apps/seller   (Next.js)         │  satıcı paneli   │
   │  apps/admin    (Next.js)         │  yönetim paneli  │
   └────────────────┬─────────────────┘                  │
                    │ HTTPS / JSON                        │
   ┌────────────────▼────────────────────────────────────┴──────┐
   │        apps/api  —  NestJS, MODÜLER MONOLİT, tek deploy    │
   │                                                             │
   │  auth · user · catalog · search · cart · order · payment    │
   │  seller · promotion · return · commission · settlement      │
   │  ai-gateway · media · moderation · admin · consent          │
   │                                                             │
   │  ortak: RequestContext · Outbox · Idempotency · RateLimit   │
   │         AuditLog · GlobalExceptionFilter                    │
   └───┬──────────────┬───────────────┬──────────────┬──────────┘
       │              │               │              │
  ┌────▼─────┐  ┌─────▼─────┐  ┌──────▼──────┐ ┌─────▼──────┐
  │PostgreSQL│  │   Redis   │  │   BullMQ    │ │  S3 uyumlu │
  │+pgvector │  │  cache /  │  │  kuyruklar  │ │   depolama │
  │+FTS(tr)  │  │ ratelimit │  └──────┬──────┘ │ public /   │
  │+pg_trgm  │  │ / session │         │        │ private    │
  └──────────┘  └───────────┘         │        └────────────┘
                                ┌─────▼──────────────────────┐
                                │  apps/worker               │
                                │  tryon · embedding ·       │
                                │  outbox · bildirim · cron  │
                                └─────┬──────────────────────┘
                                      │
        ┌─────────────────────────────┴────────────────────────┐
        │   packages/adapters — TÜM dış servisler burada       │
        │   ödeme · try-on · LLM · kargo · SMS/e-posta · depo  │
        └──────────────────────────────────────────────────────┘
```

---

## 2. Neden modüler monolit

Discovery aşamasında 10+ mikroservis çizildi. MVP takvimi ve takım büyüklüğü için bu
yanlış olurdu: her servis kendi deploy'unu, gözlemlenebilirliğini ve dağıtık transaction
sorununu getirir.

Bunun yerine **tek deploy, net modül sınırları.** Sınırlar kodda zorlanır, böylece yük
arttığında bir modülü ayırmak iki haftalık iş olur, altı aylık refactor değil.

### Sınır kuralları

1. Bir modül **başka modülün Prisma modeline doğrudan erişemez** — yalnızca o modülün
   `*.service.ts` public metodunu çağırır.
2. Modüller arası yan etki **domain event** ile olur (`OutboxEvent` → BullMQ).
3. Her modülün tablo öneki vardır (`order_*`, `catalog_*`, `finance_*`).
4. Modülün yalnızca `index` / `*.service` / `*.types` dosyaları dışarıdan import
   edilebilir — ESLint `no-restricted-imports` ile zorlanır.

---

## 3. Ticaret akışı AI'dan yalıtılır

**İlke: yapay zekâ işleri ticaret akışını asla bloklamaz.**

- Sanal deneme senkron çalışmaz; kuyruğa alınır, kullanıcı beklerken gezinmeye devam eder
- AI bütçesi dolarsa AI özellikleri kapanır, **sipariş akışı çalışmaya devam eder**
- Try-on sağlayıcısı tamamen çökse bile kullanıcı ürünü sepete atıp satın alabilir

Bu yalıtım tesadüf değil; API ile worker'ın ayrı prosesler olmasının asıl sebebi budur.

---

## 4. Veri bütünlüğü kararları

### Para

`BigInt` + **kuruş**. `0.1 + 0.2 !== 0.3` finansal hesapta tolere edilemez.
API sınırında `string` olarak taşınır — `Number`'a çevrilirse 2^53 üstü tutarlar
sessizce bozulur.

Komisyon oranları **basis point** (1250 = %12,50) tam sayı olarak tutulur.
`applyBps()` half-up yuvarlar ve kalanı bildirir; `allocate()` indirimi satıcı
paketlerine kuruş kaybı olmadan dağıtır.

### Append-only kayıtlar

`LedgerEntry`, `CommissionRuleVersion`, `ConsentRecord`, `OrderEvent`, `AuditLog`
güncellenmez — yeni satır yazılır. Geçmiş durum her zaman yeniden üretilebilir olmalıdır.

### Satıcı bakiyesi hesaplanır, tutulmaz

```sql
SELECT SUM(amount_minor) FROM finance_ledger_entries WHERE seller_id = ?
```

Ayrı bir `balance` kolonu er geç tutarsızlaşır: bir yerde güncellenmeyi unutur, bir
yerde transaction dışında güncellenir. Toplam her zaman hesaplanır.

### Komisyon versiyonlama

`OrderItem` kendi anındaki `commissionRuleVersionId` ve `commissionRateBps` değerini
**snapshot** alır. Komisyon ileride değişse bile eski siparişin muhasebesi bozulmaz.

Kural benzersizliği veritabanında `NULLS NOT DISTINCT` ile zorlanır — standart `UNIQUE`
NULL'ları farklı saydığı için aynı kategoriye iki platform kuralı eklenebiliyordu ve bu
komisyon aramasını belirsizleştiren bir para hatasıydı.

### Sipariş kalemi snapshot'ı

`OrderItem` ürün başlığını, marka adını, varyant etiketini, fiyatı ve görsel anahtarını
kopyalar. Ürün silinse, yeniden adlandırılsa veya fiyatı değişse bile geçmiş sipariş ve
faturası bozulmaz.

### Çok satıcılı sipariş

```
Order
 ├─ OrderPackage (satıcı A)  →  OrderItem, OrderItem
 └─ OrderPackage (satıcı B)  →  OrderItem
```

A satıcısı kargolarken B iptal edebilir. `Order.status` paketlerin bileşkesinden
**hesaplanır**, ayrı kolonda tutulmaz — tutulursa tutarsızlık kaynağı olur.

---

## 5. Altyapı desenleri

### Transactional outbox

Domain event'leri sipariş yazımıyla **aynı transaction'da** `OutboxEvent` tablosuna
yazılır; worker sonra kuyruğa taşır. Böylece "sipariş yazıldı ama bildirim gitmedi"
veya "bildirim gitti ama sipariş rollback oldu" durumu oluşmaz.

### Idempotency

`Idempotency-Key` başlığı ödeme, sipariş, iade ve payout uçlarında **zorunludur**.
Aynı anahtarla gelen tekrar isteği işlemi tekrarlamadan kayıtlı yanıtı döner.

### Webhook tekilleştirme

`WebhookEvent.id` = sağlayıcının olay kimliği. Unique ihlali → zaten işlenmiş → `200`
dön ve çık. Sağlayıcılar aynı olayı birden fazla kez gönderebilir.

### Optimistic locking

`Inventory.version` eşzamanlı checkout'ta fazla satışı engeller. Veritabanı düzeyinde
`CHECK (reserved <= onHand)` kısıtı son savunma hattıdır.

---

## 6. Arama

MVP'de **PostgreSQL**, ayrı arama kümesi yok.

- Türkçe FTS: `turkish_unaccent` yapılandırması (`unaccent` + `turkish_stem`) üzerinde
  generated `tsvector` column, GIN indeksli. "gomlek" araması "Gömlek"i bulur.
- Autocomplete ve yazım toleransı: `pg_trgm`. "palazo pantolon" → "Palazzo Pantolon"
  (0.48 benzerlik).
- Benzer ürün: `pgvector` HNSW, kosinüs mesafesi.

Bu ölçekte ayrı bir arama motoru operasyon yükü ekler, fayda eklemez. Arayüz
(`SearchProvider`) arkasında olduğu için ürün sayısı 200k'yı aştığında veya arama p95
300 ms'yi geçtiğinde geçiş bir haftalık iştir.

---

## 7. Sanal deneme mimarisi

```
[1] Fotoğraf yükleme → EXIF temizliği → kalite skoru
[2] RIZA KONTROLÜ (işleme + yurt dışı aktarım) — atlanamaz
[3] ÖNBELLEK: sha256(fotoğraf içeriği + varyant + mod + pipeline sürümü)
    HIT  → anında sonuç, maliyet 0
    MISS → devam
[4] KOTA: kullanıcı günlük + platform bütçesi
[5] Kuyruğa al → 202 { jobId }, kullanıcı gezinmeye devam eder
[6] Worker: sağlayıcı çağrısı → fallback zinciri → filigran → depola
[7] Sonuç + görsel güven skoru (beden güveninden AYRI)
```

Önbellek en büyük maliyet kaldıracıdır: anahtar dosya kimliğine değil **fotoğraf
içeriğine** dayanır, böylece kullanıcı aynı fotoğrafı tekrar yüklese de isabet eder.

`promptVersion` pipeline değiştiğinde artırılır; artırılmazsa kullanıcılar eski
kalitedeki görselleri görmeye devam eder.

---

## 8. Bilinçli olarak yapılmayanlar

| Yapılmadı              | Neden                                                    | Ne zaman                                        |
| ---------------------- | -------------------------------------------------------- | ----------------------------------------------- |
| Mikroservisler         | Deploy ve gözlemlenebilirlik yükü, dağıtık transaction   | Modül trafiği ayrı ölçeklenmeyi gerektirdiğinde |
| Kendi GPU havuzu       | Sabit gider + kurulum süresi, MVP'de ürün faydası yok    | Hacim barındırılan API maliyetini geçtiğinde    |
| OpenSearch             | Bu katalog boyutunda gereksiz                            | >200k ürün veya arama p95 >300 ms               |
| Kafka                  | BullMQ retry/DLQ/gecikmeli iş için yeterli               | Olay hacmi Redis'i zorladığında                 |
| Ayrı Python AI servisi | MVP'de AI = HTTP orkestrasyonu, model çalıştırma değil   | Kendi model eğitimi başladığında                |
| GraphQL                | REST + Zod sözleşmeleri yeterli, önbellekleme daha basit | —                                               |

Her satır bir ADR'ye bağlanır: [`docs/adr/`](adr/).
