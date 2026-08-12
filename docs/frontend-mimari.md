# Frontend Mimarisi — Kararlar

> Kod yazılmadan önce kapatılması gereken sorular. Görsel yön ayrı bir
> belgededir (`design-system.md`); burada **yapı** kararları var.

---

## 1. Tek uygulama, üç bölge

`apps/web` — tek Next.js uygulaması, üç yönlendirme grubu:

```
app/
  (magaza)/     müşteri vitrini      açık tema, SSR, SEO açık
  (satici)/     satıcı paneli        açık tema, tamamı korumalı
  (yonetim)/    yönetim paneli       koyu tema, tamamı korumalı
```

**Neden üç ayrı uygulama değil:** üçü de aynı para biçimlendirmesini, aynı hata
zarfını, aynı oturum akışını ve aynı bileşen kütüphanesini kullanıyor. Ayrı
uygulamalar bunları ya üç kez yazmayı ya da dördüncü bir paylaşılan paket
kurmayı gerektirirdi. Tek geliştirici için üç ayrı derleme ve üç ayrı dağıtım
hattı, kazandırdığından fazlasını götürür.

⚠️ **Ayrılma anı belli:** yönetim paneli müşteri vitrininden farklı bir ölçekte
büyürse (ör. yoğun tablo ekranları vitrinin paket boyutunu şişirmeye başlarsa)
bölünür. Yönlendirme grupları bugünden o ayrımı hazırlıyor — o gün gelirse
klasör taşınır, kod yeniden yazılmaz.

Backend'deki "modüler monolit" kararının aynısı, aynı gerekçeyle.

---

## 2. Yığın

| Katman        | Seçim                 | Not                                           |
| ------------- | --------------------- | --------------------------------------------- |
| Çatı          | Next.js App Router    | Ürün sayfaları SSR olmak zorunda — SEO        |
| Dil           | TypeScript, `strict`  | Backend ile aynı sertlik                      |
| Stil          | Tailwind              | `design-system.md` paletine bağlı             |
| Bileşen       | shadcn/ui             | Kopyalanır, bağımlılık değil                  |
| İkon          | Lucide                | shadcn ile geliyor, 1.5px, metinden soluk     |
| Sunucu durumu | TanStack Query        | Yalnızca istemci tarafı mutasyon/yoklama için |
| Form          | react-hook-form + zod | Şemalar `@vt/contracts`'tan gelir             |

⚠️ **Global durum kütüphanesi YOK.** Sepet, oturum ve gardırop sunucu
durumudur; istemcide ikinci bir kopyasını tutmak iki kaynağın ayrışması
demektir. Sepet rozetindeki sayı ile sepet sayfasındaki sayının farklı olması
tam olarak böyle doğar.

---

## 3. Tipler koddan gelir, kodgen'den değil

OpenAPI şeması **üretilmeyecek**. Sebep: bu bir monorepo ve `@vt/contracts`
zaten paylaşılan tek doğruluk kaynağı. Frontend onu doğrudan import eder.

```
@vt/contracts →  ApiSuccess / ApiError zarfı
                 ERROR_CATALOG (kod → Türkçe mesaj, aile, retryable)
                 Money yardımcıları ve applyBps
                 zod şemaları
```

Kodgen tercih edilseydi tipler **kopya** olurdu ve şema ile arasında bir
üretim adımı bulunurdu; o adım atlanınca frontend eski sözleşmeyle derlenmeye
devam eder. Doğrudan import edildiğinde sözleşme değişince frontend
**derlenmez** — istenen budur.

⚠️ Bunun bedeli: `@vt/contracts` tarayıcıda çalışabilir kalmalıdır. Node'a
özgü hiçbir şey (fs, crypto, process) o pakete giremez. Bugün girmiyor;
girerse frontend derlemesi kırılarak haber verir.

---

## 4. Para — tek kural

Zarf `bigint` değerleri **string** olarak gönderiyor (`serializeBigInts`;
kuruş tutarı 2^53'ü aşabildiği için `Number`'a çevrilmiyor).

Frontend'de:

```
string  →  BigInt(...)  →  Money  →  biçimlendir
```

⚠️ **`Number(...)` ile para okunmayacak.** Tek bir yerde yapılırsa bile
sessizce yanlış tutar gösterir; hata mesajı vermez. Bu kural bir lint
kuralıyla değil, para okumanın **tek bir yardımcı fonksiyondan** geçmesiyle
korunur — başka yerde ham alan okunmaz.

Para gösterilen her yerde `font-variant-numeric: tabular-nums` (bkz.
`design-system.md` → Finansal tablolar).

---

## 5. Oturum — jeton tarayıcı JavaScript'ine verilmez

Backend'in verdiği: kısa ömürlü erişim jetonu (gövdede) + yenileme jetonu
(httpOnly çerez, yolu `/v1/auth/refresh` ile kısıtlı).

Erişim jetonu `localStorage`'a **yazılmayacak**. Oradaki bir jeton, sayfadaki
herhangi bir XSS'in doğrudan hesabı ele geçirmesi demektir; moda vitrini
üçüncü taraf betikleri (analitik, piksel) barındıran bir yüzeydir.

**Karar: Next.js yönlendirme işleyicileri ince bir vekil olur.** Tarayıcı yalnızca
kendi kökenindeki `/api/*` adresine gider; jeton sunucu tarafında httpOnly
çerezde tutulur ve isteğe orada eklenir.

Bu ayrıca CORS'u ortadan kaldırır: tarayıcı hiçbir zaman API kökenine
doğrudan istek atmaz.

⚠️ **Bedeli dürüstçe:** her istek bir ek atlama yapar (tarayıcı → Next →
API). Ürün listesi gibi genel ve önbelleklenebilir uçlar bu yüzden vekilden
**geçmez**; Sunucu Bileşeni içinden doğrudan API'ye gider. Vekil yalnızca
kimlik gerektiren uçlar içindir.

---

## 6. Hata — zarf zaten Türkçe konuşuyor

Backend her hatayı tek zarfta ve **kullanıcıya gösterilebilir Türkçe mesajla**
döndürüyor. Frontend bu mesajı yeniden yazmaz; gösterir.

Kod (`error.code`) ise **davranış** içindir:

```
retryable            → "Tekrar dene" düğmesi gösterilir
AUTH_TOKEN_EXPIRED   → sessizce yenile, isteği bir kez tekrarla
CONSENT_REQUIRED     → rıza akışını aç, hata gösterme
INSUFFICIENT_STOCK   → sepette ilgili satırı işaretle
OUTFIT_*             → karuselde çakışan parçayı işaretle
```

⚠️ Mesajı frontend'de yeniden yazmak iki metin kaynağı üretir ve ikisi
zamanla ayrışır. Metin değişikliği `ERROR_CATALOG`'da yapılır.

---

## 7. Sanal deneme — iş tabanlı, yoklamalı

Üretim eşzamansızdır: `POST /tryon` bir iş kimliği döndürür, sonuç
`GET /tryon/:jobId` ile yoklanır.

```
POST /tryon        → { jobId, estimatedSeconds }
GET  /tryon/:jobId → { status: QUEUED | RUNNING | SUCCEEDED | FAILED }
```

Arayüz `estimatedSeconds` değerini **kullanır**: belirsiz bir dönen çark
yerine beklenen süreyi gösterir. Kullanıcı 20 saniye sürecek bir işi
beklerken ne kadar kaldığını bilmelidir, yoksa sekmeyi kapatır.

⚠️ **Karusel parçayı değiştirdiğinde ekran komple yenilenmez** — yalnızca
görsel alanı. Bu, arka taraftaki önek tabanlı önbellek mantığının arayüz
karşılığıdır (bkz. `cache-key.ts` → `multiTryOnCacheKey`): ilk n-1 katman
yeniden üretilmez. Ekranı baştan kuran bir tasarım bu kazancı görünmez kılar.

Stil danışmanı ayrı: o gerçekten akış (`text/event-stream`) döndürüyor.

---

## 8. MVP kapsamı — sıra

```
1. İskelet + vitrin      liste, ürün detayı, sanal deneme, sepet, ödeme
2. Hesap                 giriş, siparişler, gardırop, rıza yönetimi
3. Satıcı paneli         ürün/varyant, siparişler, finans tabloları
4. Yönetim paneli        satıcı onayı, komisyon, payout, raporlar
```

⚠️ Sıralama gelir yönüne göre: 1 olmadan tek kuruş girmez, 4 olmadan girer.
Yönetim işleri MVP'de veritabanından da yapılabilir; vitrin yapılamaz.
