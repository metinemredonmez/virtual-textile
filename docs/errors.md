# Hata Yönetimi

> Kaynak: [`packages/contracts/src/errors/`](../packages/contracts/src/errors/) ·
> Uygulama: [`apps/api/src/common/filters/global-exception.filter.ts`](../apps/api/src/common/filters/global-exception.filter.ts)

Bu projede `throw new Error('...')` yazılmaz. Her hata durumunun katalogda bir kodu vardır;
kod HTTP durumunu, hata ailesini, tekrar denenebilirliği ve kullanıcıya gösterilecek Türkçe
mesajı belirler.

---

## 1. Tek yanıt zarfı

Başarı:

```json
{
  "data": { "...": "..." },
  "meta": { "requestId": "01J...", "nextCursor": "eyJ..." }
}
```

Hata — istisnasız aynı biçim:

```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Yeterli stok kalmadı. Bu üründen en fazla 2 adet alabilirsiniz.",
    "httpStatus": 409,
    "retryable": false,
    "details": [{ "variantId": "01J...", "available": 2 }],
    "requestId": "01J..."
  }
}
```

`message` doğrudan kullanıcıya gösterilebilir. Frontend'in kendi mesaj sözlüğünü
tutmasına gerek yoktur; koda göre dallanır, metni sunucudan alır.

---

## 2. Dört hata ailesi

Aile, **loglama seviyesini ve Sentry'ye raporlanıp raporlanmayacağını** belirler.

| Aile          | Anlamı                                        | Log     | Sentry             |
| ------------- | --------------------------------------------- | ------- | ------------------ |
| `validation`  | Girdi şeması tutmadı                          | `debug` | ❌                 |
| `domain`      | İş kuralı reddetti (stok yok, kupon geçersiz) | `info`  | ❌                 |
| `integration` | Dış servis hatası                             | `warn`  | ✅ %10 örneklenmiş |
| `system`      | Bizim hatamız                                 | `error` | ✅ + alarm         |

**Neden bu ayrım:** "Stok yetersiz" bir hata değil, bir iş sonucudur. Sentry'ye
gönderilirse üçüncü hafta panoda 40.000 olay olur ve gerçek hatalar gürültü içinde
kaybolur.

`integration` ailesi örneklenir: bir sağlayıcı çökerse Sentry saniyede binlerce aynı
olayla dolmasın.

### Belgelenmiş istisna

İki kod HTTP durumu 4xx olmasına rağmen `system` ailesindedir, çünkü kök nedeni bizim
tarafımızdadır ve sessizce geçilmemelidir:

- `PAYMENT_AMOUNT_MISMATCH` — istemcinin gönderdiği tutar sunucunun hesabıyla tutmuyor.
  Kurcalama veya hesaplama hatası.
- `COMMISSION_RULE_NOT_FOUND` — her kategori için geçerli bir kural olmalı. Yoksa
  referans verisi bozuk, sipariş alınamaz.

Bu istisna [`app-error.test.ts`](../packages/contracts/src/errors/app-error.test.ts) içinde
sabitlenmiştir; yeni bir 4xx+`system` kodu eklenirse test kırılır ve gerekçe yazılmaya zorlanır.

---

## 3. Ne sızmaz

Hata yanıtında **asla** bulunmaz:

- Yığın izi
- SQL sorgusu veya tablo adı
- Dosya yolu
- Sağlayıcının ham hata kodu (`iyzico`, `5012` gibi)
- Ortam değişkeni değeri
- Kart numarası (maskeli hâli bile hata mesajında tekrarlanmaz)

`AppError` bunu iki ayrı alanla sağlar:

```ts
const err = appError('INTERNAL_ERROR', { internalMessage: 'prisma bağlantısı koptu' });

err.message; // "prisma bağlantısı koptu"  → LOG
err.userMessage; // "Beklenmeyen bir hata oluştu..." → KULLANICI
```

Bilinmeyen hatalar `toAppError()` ile sarılır; iç mesaj log'a gider, kullanıcı jenerik
mesaj ve `requestId` görür.

---

## 4. Prisma hata eşlemesi

| Prisma             | Kod                    | HTTP | Not                                         |
| ------------------ | ---------------------- | ---- | ------------------------------------------- |
| `P2002` unique     | `DUPLICATE_RESOURCE`   | 409  | `email`/`phone` hedefinde özel koda eşlenir |
| `P2025` bulunamadı | `NOT_FOUND`            | 404  |                                             |
| `P2003` FK         | `INVALID_REFERENCE`    | 400  |                                             |
| `P2004` CHECK      | `VALIDATION_FAILED`    | 400  | Uygulama katmanı yakalamalıydı              |
| `P2034` kilitlenme | `CONCURRENCY_CONFLICT` | 409  | `retryable: true`                           |

`PrismaClientValidationError` bilinçli olarak `INTERNAL_ERROR`'a eşlenir: bu kullanıcı
girdisi hatası değil, bizim sorgumuzda hata var demektir.

---

## 5. Dış servis dayanıklılığı

Her adapter çağrısı [`resilient()`](../packages/adapters/src/resilience/resilient.ts)
sarmalayıcısından geçer: **zaman aşımı → yeniden deneme → devre kesici.**

Üçü birlikte olmalıdır:

- Zaman aşımı yoksa retry hiç tetiklenmez, istek sonsuza kadar asılı kalır.
- Devre kesici yoksa çöken servise retry fırtınası gider ve toparlanmasını geciktirir.

### ⚠️ Retry'ın tek kuralı

**`idempotencyKey` verilmediyse retry kapalıdır.** `retryAttempts: 5` yazılsa bile tek
deneme yapılır — bu kod düzeyinde zorlanır, yorumla rica edilmez.

Ödeme çekimini körü körüne tekrarlamak müşteriden iki kez para çekmek demektir.
E-ticarette en pahalı hata budur; sessizce çift işlem yapmaktansa hata dönmek her zaman
daha ucuzdur.

| İşlem          | Retry | Idempotency mekanizması                 |
| -------------- | ----- | --------------------------------------- |
| `initiate3ds`  | ✅    | `conversationId` = `orderId`            |
| `complete3ds`  | ❌    | Hata → durum `inquire()` ile sorgulanır |
| `refund`       | ✅    | `refundRef` = `returnId`                |
| `payout`       | ✅    | `payoutRef` = `payoutId`                |
| try-on üretimi | ✅    | `cacheKey`                              |
| SMS / e-posta  | ✅    | deterministik `messageId`               |

### Hangi hatalar tekrar denenir

- ✅ Ağ hataları (`ECONNRESET`, `ETIMEDOUT`, …), zaman aşımı, `429`, `5xx`
- ❌ `4xx` — aynı istek aynı sonucu verir, sadece kota yakar

Geri çekilme üsteldir ve **jitter** içerir; jitter olmadan tüm istemciler aynı anda
tekrar dener ve toparlanan servisi yeniden düşürür.

### Devre kesici

```
CLOSED ──(eşik aşıldı)──► OPEN ──(bekleme bitti)──► HALF_OPEN ──(başarı)──► CLOSED
                            ▲                            │
                            └────────(tek hata)──────────┘
```

Devre açıkken çağrı **anında** başarısız olur; kullanıcı 25 saniye beklemez.

---

## 6. Sanal deneme fallback zinciri

```
fal.ai (FAST)
  ├─ zaman aşımı / 5xx ──────────► fal.ai (alternatif model)
  │                                    └─ başarısız ──► Gemini (yedek sağlayıcı)
  │                                                          └─ başarısız ──► ZARİF DÜŞÜŞ
  ├─ güvenlik filtresi ──────────► ❌ DUR (kalıcı hata)
  ├─ fotoğrafta kişi yok ────────► ❌ DUR (kalıcı hata)
  └─ geçersiz girdi ─────────────► ❌ DUR (kalıcı hata)
```

**Kalıcı hatalar zinciri keser.** "Fotoğrafta kişi yok" hatası üçüncü denemede de kişi
bulmayacaktır; sadece maliyet üretir ve kullanıcıyı bekletir.

Zarif düşüşte:

- Kullanıcının günlük kotası **geri verilir**
- Ürünün orijinal model görseli + beden tablosu gösterilir
- **Ticaret akışı çalışmaya devam eder** — try-on çökse bile kullanıcı sepete atıp satın alabilir

Başarısız çağrıların maliyeti de kaydedilir; kaydedilmezse aylık fatura açıklanamaz.

---

## 7. Ödeme hatası → kullanıcı mesajı

Banka hata kodları kullanıcıya olduğu gibi gösterilmez.

| Sağlayıcı durumu | Kullanıcıya                                          | Sonraki adım        |
| ---------------- | ---------------------------------------------------- | ------------------- |
| Yetersiz bakiye  | "Kartınızda yeterli bakiye yok."                     | Başka kart          |
| Limit aşımı      | "Kart limitiniz yetersiz."                           | Taksit öner         |
| Kart geçersiz    | "Kart bilgileri geçersiz veya kartın süresi dolmuş." | Formu tekrar        |
| 3DS iptal        | "3D Secure doğrulaması iptal edildi."                | Tekrar dene         |
| Bankaca red      | "Bankanız işlemi onaylamadı."                        | Başka ödeme yöntemi |
| Bilinmeyen       | "Ödeme tamamlanamadı." + `requestId`                 | Destek              |

**Asla:** "Bankanız 51 hatası döndü". **Asla:** kart numarasını hata mesajında tekrarlama.

---

## 8. İstemci tarafı

| Kod                   | Frontend davranışı                                 |
| --------------------- | -------------------------------------------------- |
| `AUTH_TOKEN_EXPIRED`  | Sessiz refresh dene → başarısızsa giriş ekranı     |
| `AUTH_REFRESH_REUSED` | Tüm oturum temizle + güvenlik uyarısı göster       |
| `RATE_LIMITED`        | `Retry-After` kadar geri sayım                     |
| `INSUFFICIENT_STOCK`  | Sepeti yenile, etkilenen kalemi işaretle           |
| `CART_PRICE_CHANGED`  | Yeni tutar onay modalı                             |
| `CONSENT_REQUIRED`    | Rıza modalını aç                                   |
| `VALIDATION_FAILED`   | `details.fields` → form alanlarına bas             |
| `5xx`                 | Toast + "Tekrar dene" + kopyalanabilir `requestId` |

Otomatik yeniden deneme yalnızca `GET` isteklerinde yapılır. `POST`/`PATCH` **asla**
otomatik tekrarlanmaz — bu istemci tarafındaki çifte işlem kaynağıdır.

---

## 9. Yeni hata kodu eklerken

1. [`error-catalog.ts`](../packages/contracts/src/errors/error-catalog.ts) içine ekle:
   durum, aile, `retryable`, Türkçe mesaj.
2. Mesaj kullanıcının **ne yapması gerektiğini** söylesin. "Geçersiz istek" değil,
   "Bu adrese kargo gönderimi yapılamıyor".
3. Parametre gerekiyorsa `{param}` yer tutucusu kullan.
4. `throw appError('KOD', { params: {...} })`.
5. Frontend'de özel davranış gerekiyorsa yukarıdaki tabloya ekle.

Katalog testi her kodun geçerli bir HTTP durumu ve boş olmayan bir mesajı olmasını
zorunlu kılar.
