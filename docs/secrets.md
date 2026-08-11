# Gizli Anahtar Yönetimi

> Şablon: [`.env.example`](../.env.example) · Doğrulama: [`packages/config/src/env.ts`](../packages/config/src/env.ts)

---

## 1. Katı kurallar

1. **Hiçbir gizli anahtar frontend'e gitmez.** `NEXT_PUBLIC_*` yalnızca şunlar olabilir:
   `API_URL`, `SENTRY_DSN` (zaten public), `GOOGLE_CLIENT_ID`, `R2_PUBLIC_URL`.
2. **Tarayıcı hiçbir AI veya ödeme sağlayıcısını doğrudan çağırmaz.** Her çağrı API
   üzerinden geçer — kota kontrolü, rıza kontrolü ve maliyet kaydı orada yapılır.
3. `.env` **asla** commit edilmez. Depoda yalnızca `.env.example` bulunur, değerler
   yer tutucudur. CI'da `gitleaks` ve dosya tipi taraması bunu ayrıca doğrular.
4. **Env doğrulaması açılışta yapılır.** Bir anahtar eksik veya bozuksa süreç
   **başlamaz**. Üç hafta sonra üretimde "neden SMS gitmiyor" aramaktan iyidir.
5. **Hata mesajı anahtar ADINI yazar, DEĞERİNİ yazmaz.**
6. **Log'da secret olmaz** — [`logger.ts`](../apps/api/src/common/logger.ts) redaction
   listesi parola, token, kart, IBAN, vergi no ve API anahtarlarını gizler.
7. **Kart verisi bu sisteme hiç gelmez.** 3DS iframe + sağlayıcı tokenizasyonu; PCI-DSS
   kapsamı dışında kalırız.

---

## 2. Anahtar envanteri

Sahiplik sütunu önemlidir: **hesabı kim açacak, faturayı kim ödeyecek.**

| Değişken                                    | Ortam         | Sahip       | Rotasyon   | Sızarsa                       |
| ------------------------------------------- | ------------- | ----------- | ---------- | ----------------------------- |
| `IYZICO_API_KEY` / `IYZICO_SECRET_KEY`      | prod, sandbox | Ürün sahibi | 6 ay       | 🔴 Para                       |
| `IYZICO_WEBHOOK_SECRET`                     | prod          | Ürün sahibi | 6 ay       | 🔴 Sahte ödeme bildirimi      |
| `FAL_KEY`                                   | tümü          | Ürün sahibi | 3 ay       | 🟠 Fatura                     |
| `GOOGLE_AI_API_KEY`                         | tümü          | Ürün sahibi | 3 ay       | 🟠 Fatura                     |
| `ANTHROPIC_API_KEY`                         | tümü          | Ürün sahibi | 3 ay       | 🟠 Fatura                     |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | tümü          | Ürün sahibi | 6 ay       | 🔴 **Kullanıcı fotoğrafları** |
| `DATABASE_URL`                              | tümü          | Altyapı     | 3 ay       | 🔴 Tüm veri                   |
| `REDIS_URL`                                 | tümü          | Altyapı     | 6 ay       | 🟠 Oturumlar                  |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`  | tümü          | Altyapı     | 12 ay      | 🔴 Kimlik taklidi             |
| `FIELD_ENCRYPTION_KEY`                      | tümü          | Altyapı     | ⚠️ bkz. §4 | 🔴 IBAN / vergi no            |
| `GOOGLE_CLIENT_ID` / `SECRET`               | tümü          | Ürün sahibi | 12 ay      | 🟡                            |
| `NETGSM_*`                                  | prod          | Ürün sahibi | 6 ay       | 🟠 SMS bombardımanı           |
| `RESEND_API_KEY`                            | tümü          | Ürün sahibi | 6 ay       | 🟡 İtibar                     |
| `SHIPPING_API_KEY`                          | prod          | Ürün sahibi | 12 ay      | 🟡                            |
| `SENTRY_DSN`                                | tümü          | Altyapı     | 12 ay      | 🟢                            |
| `INTERNAL_API_TOKEN`                        | tümü          | Altyapı     | 3 ay       | 🟠 İç uçlar                   |

### Anahtar üretimi

```bash
openssl rand -hex 64   # JWT_ACCESS_SECRET, JWT_REFRESH_SECRET
openssl rand -hex 32   # FIELD_ENCRYPTION_KEY
openssl rand -hex 24   # INTERNAL_API_TOKEN
```

---

## 3. Nerede saklanır

| Ortam      | Yer                                                                                |
| ---------- | ---------------------------------------------------------------------------------- |
| Geliştirme | `.env` (gitignore) + paylaşımlı parola kasası                                      |
| CI         | GitHub Actions Secrets — `staging` ve `production` **ayrı ortam** olarak           |
| Üretim     | Barındırma sağlayıcısının secret store'u. **Dosya sisteminde düz metin tutulmaz.** |

---

## 4. Rotasyon

Standart akış:

1. Sağlayıcı panelinde **yeni** anahtar üret (eskisini henüz iptal etme)
2. Ortam değişkenini güncelle
3. Deploy et, sağlık kontrolünü doğrula
4. **Sonra** eski anahtarı iptal et
5. `docs/runbook/secret-rotation.md`'ye tarih düş

### ⚠️ `FIELD_ENCRYPTION_KEY` istisnası

Bu anahtar veritabanındaki `ibanEnc` ve `taxNumberEnc` alanlarını şifreler. Değiştirmek
**mevcut verinin yeniden şifrelenmesini** gerektirir:

1. Yeni anahtarı `FIELD_ENCRYPTION_KEY_NEXT` olarak ekle
2. Okuma iki anahtarı da dener, yazma yeni anahtarı kullanır
3. Arka plan işi tüm satırları yeniden şifreler
4. Eski anahtar kaldırılır

Bu akış yazılmadan anahtar döndürülemez.

---

## 5. Webhook güvenliği

```
1. HAM gövdeyi al — JSON.parse'tan ÖNCE
   (parse edilmiş gövdeyi yeniden serileştirmek imzayı bozar)
2. HMAC-SHA256 imzayı sabit zamanlı karşılaştırmayla doğrula
3. Zaman damgası 5 dakikadan eskiyse REDDET (replay saldırısı)
4. WebhookEvent tablosuna INSERT — id = sağlayıcının olay kimliği
   └─ unique ihlali → zaten işlenmiş → 200 dön, ÇIK
5. İşle → processedAt yaz
6. Her durumda 200 dön
   (5xx dönersen sağlayıcı sonsuz retry yapar; hata olursa kuyruğa at, sonra 200 dön)
```

---

## 6. İmzalı URL politikası

| Nesne                      | Kova        | Erişim                         | Ömür  |
| -------------------------- | ----------- | ------------------------------ | ----- |
| Ürün görseli               | public      | CDN, imzasız                   | ∞     |
| **Kullanıcı fotoğrafı**    | **private** | Yalnızca sahibi                | 5 dk  |
| Try-on sonucu              | private     | Yalnızca sahibi                | 15 dk |
| Satıcı belgesi             | private     | Yalnızca admin, `AuditLog` ile | 5 dk  |
| İade fotoğrafı             | private     | Sahibi + ilgili satıcı + admin | 15 dk |
| AI sağlayıcıya giden girdi | private     | Tek kullanımlık                | 10 dk |

Kullanıcı fotoğrafları **ayrı bir private kovada** durur. Ürün görselleriyle aynı yerde
dursaydı, bir gün yanlış bir CORS veya public-read ayarıyla dışarı sızardı.
`packages/config` üretim ortamında iki kovanın aynı olmasını engeller.

---

## 7. Sızma durumunda

1. Anahtarı **hemen** iptal et (önce yenisini üretmeyi bekleme)
2. Sağlayıcı panelinden erişim loglarını incele — ne kullanıldı
3. Yeni anahtar üret, deploy et
4. `R2_*` veya `DATABASE_URL` sızdıysa: kişisel veri erişimi olup olmadığını değerlendir.
   Erişim varsa **KVKK ihlal bildirimi 72 saat içinde** yapılmalıdır
   (`docs/runbook/kvkk-breach.md`)
5. Git geçmişine girmişse anahtarı iptal etmek yeterlidir — geçmişi temizlemek değil.
   Anahtar zaten yayılmıştır; asıl iş onu geçersiz kılmaktır.
