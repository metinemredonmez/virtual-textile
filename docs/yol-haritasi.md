# Yol Haritası — bizim eksiklerimiz ve sırası

> Bu belge [`ozellik-yol-haritasi.md`](ozellik-yol-haritasi.md)nin **yerine geçmez, onu
> tamamlar**. O belge "rakipte var, bizde ne durumda" sorusunu cevaplar (DRESSX
> karşılaştırması, faz planı). Bu belge "**bizde yazılmış ama görünmüyor / hiç yok, ve hangi
> sırayla**" sorusunu cevaplar.
>
> Ölçüm tarihi: **2026-08-13**. Her sayının kaynağı yanında; kaynaksız sayı yok.
> Canlı ölçümler http://91.99.183.64 üzerine atılmış isteklerden.

---

## 1. Teşhis — site neden "basit" görünüyor

Şikâyet aynen: _"artık bütün özellikleri yok, basit bir site olmuş gibi."_ Dört olası sebep
tek tek ölçüldü.

| #   | Hipotez                               | Sonuç                                 | Kanıt                                                                                                                 |
| --- | ------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | Sunucu eski kodda                     | ❌ **elendi**                         | `/urunler` 404 · `/hesabim` 404 · `/products` 200 · `/calculator` 200 · `/api/outfits` 200 · `/api/tryon/history` 401 |
| 2   | ADMIN rolü olan kullanıcı yok         | ✅ **doğru — ama sonuç, sebep değil** | Üretimde ADMIN doğuracak desteklenen yol yok (aşağıda)                                                                |
| 3   | Seed verisi ince                      | ⚠️ **yanlış teşhis**                  | Seed ince değil; canlıda **hiç çalıştırılamaz** (kod bunu bilerek engelliyor)                                         |
| 4   | Yetenek var, arayüzde yüzeye çıkmamış | ✅ **doğru**                          | 118 uçtan ~20'sinin ekran karşılığı yok; üç model (`Favorite`, `Review`, `Address`) hiç uca bağlanmamış               |

### Asıl sebep: canlı katalog boş, ve seed oraya **asla** gidemez

|          | Seed tanımı (yerel)                                             | Canlı (2026-08-13)                              |
| -------- | --------------------------------------------------------------- | ----------------------------------------------- |
| Ürün     | **28** (`seed/veri.ts` → `URUNLER`)                             | **3** (`GET /api/products?limit=100`)           |
| Kategori | **32** (`KATEGORILER`)                                          | **3** — 1 kök + 2 çocuk (`GET /api/categories`) |
| Satıcı   | **6** (`SATICILAR`)                                             | —                                               |
| Hesap    | **9** — 1 `ADMIN` + 4 `SELLER_USER` + 4 `CUSTOMER` (`HESAPLAR`) | ADMIN yok                                       |

⚠️ **Önceki ölçümlerin "canlıda `pnpm db:seed` çalıştır, sorun biter" önerisi YANLIŞTIR ve
uygulanamaz.** `packages/db/prisma/seed/kapi.ts:44-70` üç bağımsız kapı taşıyor ve üçü de
birden sağlanmadan seed başlamıyor:

1. `NODE_ENV === 'production'` → red
2. `DATABASE_URL` host'u yerel değil → red
3. `APP_URL` yerel değil → red

Gerekçe kodda yazılı ve doğru: seed `finance_ledger_entries`e `SALE`/`COMMISSION` satırları
yazıyor, defter **append-only**, satıcı bakiyesi `SUM(amount_minor)` ile hesaplanıyor —
üretimde bir kez koşarsa gerçek hakedişler geri alınamaz biçimde bozulur. Sahte satıcının
`ibanEnc` değeri de `demo:not-encrypted`; payout akışı onu çözmeye çalıştığında patlar.
Aynı dosya "demo modu bayrağı da eklenmez" diyor, çünkü o bayrak bir gün "sadece bir kez,
canlıyı göstermek için" diye açılır.

**Doğru teşhis:** canlı, gerçek bir üretim ortamıdır ve **üretim için bir katalog açılış
yolu hiç yazılmadı.** Yereldeki demo seed'in yokluğu değil, üretim bootstrap'ının yokluğu.

### Kapalı çember: üretimde ilk ADMIN doğamaz

| Yol                       | Durum                                                      | Kaynak                                                                                                                         |
| ------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Seed (ADMIN hesabı yazar) | üretimde reddedilir                                        | `seed/kapi.ts:44-70`                                                                                                           |
| `rol-ata.ts` betiği       | `NODE_ENV=production` altında `throw`                      | `packages/db/scripts/rol-ata.ts:48`                                                                                            |
| HTTP ucu                  | **yok** — `POST /v1/auth/register` herkesi `CUSTOMER` açar | rol yazan tek kod yolu `seller-role.service.ts`, o da bir ADMIN'in `POST /admin/sellers/:id/approve` çağırmasıyla tetikleniyor |
| `docs/deployment.md`      | admin/rol kelimesi **hiç geçmiyor** (grep: 0 isabet)       | —                                                                                                                              |

⚠️ **Rol yazma ucunun olmaması DOĞRU bir güvenlik tasarımıdır ve korunmalı.**
`PROTECTED_ROLES = ['ADMIN','SUPPORT']` (`seller-role.ts:34`); ele geçirilmiş bir admin
oturumu kalıcı yetki dağıtamıyor. Eksik olan tasarım değil, **bootstrap prosedürü**.

### İkinci sebep, kalıcı olan: yetenek var, ekrana bağlanmamış

118 uç · 47 model · 48 sayfa. **~20 ucun ekran karşılığı yok** (4'ü tasarım gereği ekransız:
`/health`, `/health/deep`, `/webhooks/iyzico`, `/payments/3ds/callback`) → kapsama ≈ **%80**.
Üstüne, uçtan bile önce gelen bir katman var: **şemada var, ucu bile olmayan üç model.**

**Tersi yön temiz:** "özellik varmış gibi görünen boş ekran" yok. Sorun tam ters yönde —
**kod ekrandan zengin.**

### Kullanıcıya söylenecek tek cümle

> Ürün basitleşmedi, özellik kaybolmadı. İki şey oldu: (a) canlı veritabanı boş çünkü üretim
> için bir katalog açılış yolu hiç yazılmadı — demo seed oraya bilerek girmiyor; (b)
> backend'in taşıdığı yeteneğin ~%20'si hiç ekrana bağlanmadı ve bağlanmayanlar tam olarak
> bir pazaryerinde ilk aranan şeyler: yorum, favori, adres defteri, satıcı başvurusu.

---

## 2. Görünmeyen yetenekler — uç var, ekran yok

Ölçüm çağrı yeri bazlı (`serverFetch` / `apiFetch` / `hesapFetch` / `tekilOku` / `listeOku`

- ham `fetch`), yol dizgisi bazlı **değil**. Bu ayrım şart: `src/lib/api/core.ts:28-44`teki
  `IdempotentPath` tip birleşimi yolu taşır ama çağırmaz.

### A) Müşteri vitrini — 11 uç

| Uç                           | Kaynak                     | Kaybedilen                                                                                                                                            |
| ---------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /products/:id/similar`  | `catalog.controller.ts:51` | Benzer ürünler. `apps/web`de `similar` geçişi **0**. ⚠️ Canlıda bilinmeyen ürün için **500** dönüyor (404 dönmeli) — hiç çağrılmadığı için görünmemiş |
| `GET /tryon/history`         | `ai.controller.ts:79`      | Deneme geçmişi; sekme yenilenince kaybolan görselin kalıcı karşılığı                                                                                  |
| `DELETE /tryon/history`      | `ai.controller.ts:92`      | **KVKK** — üretilen görselleri silme                                                                                                                  |
| `DELETE /me/photos/:photoId` | `media.controller.ts:109`  | **KVKK** — yüklenen fotoğrafı silme (`UserPhoto` özel nitelikli veri)                                                                                 |
| `GET /outfits`               | `cart.controller.ts:113`   | Kayıtlı kombinler                                                                                                                                     |
| `POST /outfits`              | `cart.controller.ts:119`   | Kombin kaydetme                                                                                                                                       |
| `POST /outfits/:id/items`    | `cart.controller.ts:129`   | "Kombinin tamamını tek seferde sepete" — ürünün ayırt edici satın alma akışı                                                                          |
| `DELETE /outfits/:id`        | `cart.controller.ts:139`   | Kombin silme                                                                                                                                          |
| `POST /orders/:id/cancel`    | `order.controller.ts:56`   | Müşteri kendi siparişini iptal edemiyor                                                                                                               |
| `POST /auth/otp/send`        | `auth.controller.ts:150`   | Telefon/OTP giriş                                                                                                                                     |
| `POST /auth/otp/verify`      | `auth.controller.ts:174`   | aynı                                                                                                                                                  |

### B) Satıcı — 3 uç

| Uç                             | Kaynak                     | Kaybedilen                                                                   |
| ------------------------------ | -------------------------- | ---------------------------------------------------------------------------- |
| `POST /seller/apply`           | `seller.controller.ts:89`  | **"Satıcı ol" başvurusu yok — pazaryerinin arz tarafı girişi kapalı**        |
| `PATCH /seller/store`          | `seller.controller.ts:134` | Mağaza ayarları ekranı yok                                                   |
| `GET /seller/analytics/funnel` | `seller.controller.ts:288` | Huni raporu; `seller/finance/page.tsx:61` ucun varlığını biliyor, ekranı yok |

### C) Yönetim — 5 uç

| Uç                                                                                  | Kaynak                             | Kaybedilen                                                                                   |
| ----------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------- |
| `GET /admin/coupons` · `POST /admin/coupons` · `POST /admin/coupons/:id/deactivate` | `admin.controller.ts:177,185,195`  | Kupon ekranı hiç yazılmamış                                                                  |
| `POST /admin/users/:userId/photos/break-glass`                                      | `admin-report.controller.ts:74`    | Denetim ekranı bu olayın etiketini taşıyor (`audit/page.tsx:58`), üretecek yüzey yok         |
| `POST /logistics/packages/:id/delivered`                                            | `order-logistics.controller.ts:67` | ⚠️ **Webhook DEĞİL** — dosyanın kendi başlığı "musluk" diyor; bu geçiş olmadan 4 özellik ölü |

### D) Yarım — uç ve ekran var, bağ zayıf

- `GET /stylist/conversations/:id` — sohbet açılıyor, mesaj akıyor, **yenilenince geçmiş geri
  okunamıyor**.
- `POST /search/natural` — yalnız `sorgu.ara !== null` iken istemci sezgisiyle tetikleniyor
  (`urun-listesi.tsx:99`); ayrı bir doğal dil girişi yok.

### E) Uçtan da önce — şemada var, **ucu bile yok**

`grep -riE "favorite|review|address" apps/api/src --include="*.controller.ts"` → **0 isabet.**

| Model      | Şema                | Durum                                                                                               | Ama arka planda…                                                                                                                                          |
| ---------- | ------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Favorite` | `schema.prisma:580` | 0 uç · 0 ekran · frontend'de 0 geçiş                                                                | `stylist.gateway.ts:40` favorileri okuyup **stil sinyali üretiyor**                                                                                       |
| `Review`   | `schema.prisma:559` | 0 uç · 0 ekran; `rating`/`title`/`body`/`fitFeedback`/`isApproved`/`orderItemId` dâhil tam model    | `ai.gateway.ts:266` + `fit-learning.gateway.ts:91` yorumları **beden motoruna** besliyor                                                                  |
| `Address`  | `schema.prisma:126` | CRUD ucu yok; `isDefault`/`archivedAt`/`companyName`/`taxOffice`/`taxNumberEnc` (AES-256-GCM) hazır | `checkout/adres-formu.tsx:14-21` itiraf ediyor: `addressId` kabul ediliyor ama listeleyecek uç olmadığı için adres **her siparişte gövdede elle** gidiyor |

> **Kullanıcının hiç oluşturamadığı veriden AI sinyali çıkarılıyor.** Yatırımın yarısı
> yapılmış: model, seed verisi ve tüketici hazır; eksik olan yalnızca uç + ekran.

### F) Hiç yok — ne şema ne uç

Stok bildirimi ("gelince haber ver" — "Tükendi" rozeti var, çıkış kapısı yok) · son gezilenler ·
ürün karşılaştırma · filtre kaydetme · arama geçmişi · **try-on sonucunu paylaşma**
(`navigator.share` geçişi **0** — ürünün tek organik büyüme kanalı) · fatura/e-arşiv.

### Yetim rota — 1 tane

`/calculator`. Hiçbir yerden bağlantı yok; kaynakta tek geçtiği yer kendi `YOL` sabiti
(`calculator/page.tsx:27`). **Canlıda 200 dönüyor** — ekran çalışıyor, kimse bulamıyor.
Kendi başlığına göre satıcıya yönelik: satıcı kazanımının tek pazarlama yüzeyi, menüde yok.

---

## 3. Yönetim paneli eksikleri

**Panel sanıldığından iyi.** 14 sayfa; ADMIN yetkili 31 ucun **26'sı** ekrana bağlı (%84),
17 yazma ucunun **13'ü** panelde düğme. Yani "yetenek yüzeye çıkmamış" hipotezi yönetim
paneli için büyük ölçüde yanlış — panel sığ değil, titiz yazılmış (durum makinesi aynaları,
hata izolasyonu, para tutarlarının bilinçli gizlenmesi).

**Kaybolan yönetim özellikleri UI'da değil, API'de hiç yok.** Üç büyük boşluğun üçü de aynı
yapısal hataya işaret ediyor: _süreçlerin son adımının sahibi yok._

| #   | Boşluk                                            | Ayrıntı                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **İade hakemliği — hiç yok** (en ağır)            | Akış: müşteri açar → **satıcı karar verir** (`PATCH /seller/returns/:id`, `seller.controller.ts:275`) → **üstünde kimse yok.** Admin modülünde `ReturnRequest`e (`schema.prisma:943-968`, `ReturnStatus` 7 değerli) dokunan tek uç yok. Manuel iade `admin-finance.service.ts:121-176` yalnız `AuditLog` + `OutboxEvent` yazıyor, **`ReturnRequest.status`a dokunmuyor** → para gider, kayıt `REJECTED` kalır, muhasebe ile müşteri kaydı ayrışır |
| 2   | **KVKK talep kuyruğu — hiç yok**                  | Worker iki işi yürütüyor (`account-deletion.job.ts` günlük 03:00, `data-export.job.ts` 5 dk'da bir) ve `AuditLog`a yazıyor. Denetim ekranının kayıt türü listesi 8 değer içeriyor (`audit/page.tsx:61-68`) ve worker'ın yazdığı `User` ile `DataExport` **listede yok**. `account-deletion.job.ts:37-40` "admin görsün diye yazılır" diyor; admin göremiyor                                                                                       |
| 3   | **Denetim izi sorgulanamıyor** (en ucuz düzeltme) | Uç `actorId`, `action`, `from`, `to` filtrelerini **zaten destekliyor** (`admin.schema.ts:315-322`); ekran bunlardan **yalnız `entityType` + `entityId`** gönderiyor (`audit/page.tsx:88`). "Bu yönetici ne yaptı" ve "tüm break-glass erişimlerini göster" — bir denetim izinin varlık sebebi olan iki sorgu — sunucuda hazır, ekranda kapalı                                                                                                    |

**Kupon — "özellik kayboldu" hissinin en saf hâli.** 3 uç tam, şema tam
(`admin.schema.ts:114-169`: kapsam, indirim tipi, kullanım limiti, tarih aralığı, bps
doğrulaması), servis tam, denetim eylemleri tanımlı, denetim ekranı bu kodları Türkçeye
çeviriyor (`audit/page.tsx:51-52`), filtre menüsünde `Coupon` kayıt türü hazır bekliyor —
**ama kuponu oluşturan ekran yok ve `packages/contracts/src/wire/` içinde `AdminCouponWire`
bile yok** (`SellerCouponWire` var, `seller.ts:498`). Yönetici, kendi yapamadığı bir işlemin
satırını denetim izinde görmeyi bekliyor.

**Belge görülmeden mağaza onaylanıyor.** `sellers/[id]/page.tsx:161-176`: belge `storageKey`i
uç bilinçli olarak dışarı vermiyor, imzalı URL üreten yönetim ucu **hiç yazılmamış**. Ekranda
yalnız `fileName` var; ekran bunu dürüstçe yazıyor ("Belge incelemesi bugün panel dışında
yapılır"). `r2.config.ts:143` imzalı URL üretebiliyor, çağıran uç yok.

**Kullanıcı yönetimi — ayrıştırılmalı.**

- ✅ **Rol yazma ucunun olmaması korunmalı** (yukarıda, §1).
- ❌ **Kullanıcı LİSTESİ olmaması bununla ilgisiz.** `GET /admin/users` yok. Yönetici bir
  kullanıcının varlığını doğrulayamıyor, hesabını askıya alamıyor (`UserStatus.SUSPENDED`
  şemada var, `schema.prisma:37-42`, hiçbir uç yazmıyor), oturumlarını düşüremiyor.
  `/admin/alerts` bir kullanıcıyı dolandırıcılıkla işaretliyor ve **gidilecek yer yok** —
  ekran itiraf ediyor (`alerts/page.tsx:23-26`).

**Diğer kusurlar:** moderasyon kuyruğunda `sellerStatus` yok → askıdaki satıcının ürününde
onay düğmesi 403 veriyor (`moderation/karar.tsx:17-24`) · payout ekranında bakiye rakamı yok,
satıcı/admin iki farklı bakiye kuralı kullanıyor (`payout/page.tsx:38-51`) · fraud uyarısı
türetilmiş, kalıcı tablo yok, "okundu" işaretlenemiyor · `SUPPORT` altı uç grubunu
okuyabiliyor ama panele hiç giremiyor (`(yonetim)/layout.tsx:27-38`) · `user.role.changed`
denetim eylemi `AUDIT_ACTION` içinde değil (`admin/audit.ts:51-68`, 16 eylem), ayrı sabit
olarak `seller-role.service.ts:42`de duruyor → ekranda ham kod olarak beliriyor.

---

## 4. Vitrin eksikleri

22 vitrin sayfası. Vitrin **kırık değil, eksik** — ve eksikler pazaryeri taban çizgisinde
yoğunlaşıyor.

### A) Bir pazaryeri bunlarsız pazaryeri sayılmaz

| #   | Eksik                         | Neden ağır                                                                                                                                                                                 |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Ürün yorumları + puanlama** | `Review` hazır, moderasyon alanı dâhil; **beden motorunu zaten besliyor**. Ürün detayında tek yıldız yok                                                                                   |
| 2   | **Favoriler**                 | `Favorite` hazır, stil danışmanı zaten okuyor, frontend'de 0 geçiş                                                                                                                         |
| 3   | **Adres defteri**             | `Address` vergi alanlarına kadar hazır, CRUD yok; checkout her siparişte 9 alan doldurtuyor. Form `companyName`/`taxOffice`/`taxNumber` taşımıyor → **kurumsal fatura şema içinde kalmış** |
| 4   | **Fatura / e-arşiv**          | Türkiye'de pazaryeri satışında yasal zorunluluk. Model kısmen hazır (`Address.taxNumberEnc`), uç yok                                                                                       |
| 5   | **KVKK silme düğmeleri**      | `docs/privacy.md:102` **üç** silme hakkı vaat ediyor; arayüzde yalnız biri bağlı (`hesap-silme.tsx:54` → `/me`). `apps/web`de `tryon/history` geçişi **0**                                 |
| 6   | **Kargo takibi yarım**        | `account/orders/[siparisNo]/page.tsx:231` takip numarasını **düz metin** basıyor; `carrier` alanı da var, eksik olan sadece URL eşlemesi                                                   |

### B) Ayrıştırıcı — bu üründe konfor değil

7. **Try-on sonucunu paylaşma** — `navigator.share` geçişi **0**. Tek organik büyüme kanalı.
8. **Deneme geçmişi ekranı** — uç hazır; sekme kapanınca üretilen görsel kayboluyor.
9. **Kayıtlı kombinler** — 4 uç + `Outfit` modeli hazır; `ozellik-yol-haritasi.md:87` bunu
   "ASIL İDDİA" diye yazıyor, ekranı yok.
10. **Benzer ürünler** — uç hazır, çağıran yok, canlıda **500** dönüyor.

### C) Konfor (en sona)

Son gezilenler · gezinme çubuğunda arama (`AramaKutusu` ana sayfa ve `/products`ta var,
çubukta yok — `(magaza)/layout.tsx:52-58`, 5 bağlantı) · stok bildirimi · karşılaştırma ·
filtre kaydetme · arama geçmişi.

### Sanal deneme akışı — repodaki en olgun ekran

`product/_bilesenler/`, 14 dosya, 1757 satır. "Üzerimde Dene" düğmesi `variant="birincil"
size="lg" w-full` — "Sepete Ekle" ile **birebir aynı ağırlık** (`deneme-ekrani.tsx:112-129`).
Fotoğraf yükleme (211 satır), iki ayrı rıza modalı, ilerleme + `estimatedSeconds`, sonuç +
iki ayrı güven skoru (`guven-skorlari.tsx:65`), parça karuseli.

⚠️ **Ve akışın tamamı bugün zaten kapalı:** R2 kova CORS'u yok, ön uçuş `OPTIONS` → **403**
(`infra/R2-CORS.md`, `apps/web/AGENTS.md:524-534`). Ana özellik tarayıcıda tamamlanamıyor.

### Sorun bulunamayan iki alan

- **Mobil 375px** — gezinme etiketleri `hidden sm:inline`, hedefler gizlenmiyor, `aria-label`
  var; her `<table>` `overflow-x-auto` kabında (`components/ui/table.tsx:16`); ızgara tabanı
  `grid-cols-2`. **Eksik olan şey her ekran genişliğinde eksik.**
- **Boş durumlar** — 5/6 kural tutuyor (sepet, ürün listesi `didYouMean` ile, siparişler,
  gardırop, rızalar hepsi eylem sunuyor). Tek ihlal `/category`: "Henüz kategori tanımlanmamış."
  çıkmaz sokak (`category/page.tsx:43`) — ve canlıda kategori 3 olduğu için bu ekran şu an
  gerçekten boşa yakın.

### Hesabım ekranı — kullanıcının ilk baktığı yer

4 kısayol var (`account/page.tsx:29-47`): Siparişlerim, Gardırobum, Güvenlik, Gizlilik.
**Favoriler yok, adreslerim yok, deneme geçmişim yok.**

### İki tasarım kuralı eksiği koruyor

- `design-system.md` öğe bütçesi: `product/[slug]/page.tsx:11-17` "ÜÇ BLOK, FAZLASI DEĞİL"
  diyor ve satır 21-22 örnek olarak açıkça **"'yorumlar' gibi bir blok"**u reddediyor.
  **Çözüm kuralı bozmadan:** yorum bloğu dördüncü blok değil, **eylem bloğunun parçasıdır**
  (yıldız + sayı, başlığın altında); tam metin ayrı ekrana gider.
- `ozellik-yol-haritasi.md:3` yanlış rakiple kıyaslıyor: DRESSX bir AI deneme oyuncusu,
  pazaryeri değil. 12 satırlık kıyas tablosunda **favori, yorum, adres, fatura, kargo takibi
  hiç geçmiyor.** A grubunun tamamı bu kör noktadan doğuyor.

---

## 5. Kiracı (B2B) hazırlığı

**Durum: başlanmamış. Sıfır.** `hizmet-mimarisi.md` §3-4'teki B2B mimarisinin kod karşılığı
yok — "yazılmamış" değil, _başlanmamış_.

| Yapı taşı                                             | Ölçüm                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------- |
| `Organization` / `orgId`                              | `schema.prisma`da **0 eşleşme**                                     |
| Prisma `$extends` / `$use(`                           | `apps/api/src` + `apps/worker/src` + `packages/db/src` içinde **0** |
| `ApiKeyGuard` · `WidgetSessionGuard` · `PartnerGuard` | **0**                                                               |
| Kiracıya bakan uç / sayfa                             | **118'in 0'ı · 48'in 0'ı**                                          |

**Bu, kullanıcının şikâyetiyle ilgisizdir.** B2B tarafında "yüzeye çıkmamış yetenek" diye bir
şey yok — çünkü yetenek de yok.

**Belge güvenilir.** `hizmet-mimarisi.md`nin verdiği satır numaraları tek tek çekildi:
sapma ≤ ±2 satır. Bir tasarım hayali değil, ölçülmüş bir plan.

### Bugünkü yalıtım: kod düzeyinde değil, **insan** düzeyinde

Zincir üç halka: JWT'de `sellerIds` + `SellerScopeGuard` (`auth.guard.ts:150-185`) ·
`@SellerPanel()` sınıf düzeyinde · `@SellerId()` her metotta — `seller.controller.ts`
**25/25**, `media.controller.ts` 2 → **27/27, kapsam dışı 0**. Satıcı + medya modülündeki
**22 Prisma çağrısının 22'sinde** `sellerId` var. **Gerçek sızıntı yok.**

⚠️ **Ama engelleyen şey nedir? Yazan kişinin `where`e `sellerId` koymuş olması. Başka hiçbir
şey.** RLS yok, Prisma extension yok, testle kapatılmış kapı yok. 23'üncüyü yazan unutursa
hiçbir şey kırılmaz, hiçbir test kızarmaz, uç sessizce tüm mağazaların verisini döndürür.
Dekoratör _insanı korur_; Prisma extension _insanın unuttuğu günü korur_ — ikinci katman
hiç yok. **Mekanizma değil, disiplin çalışıyor.**

### Ölçüm ve kapılar

- **API anahtarı / kullanım ölçümü / giden webhook → 0 / 1-kısmi / 0.** `apiKey` geçen 58
  satırın tamamı **bizim dışarıya verdiğimiz** sağlayıcı anahtarları. `WebhookEvent`
  (`schema.prisma:1367-1381`) **gelen** webhook için.
- **`AiUsageLog` kiracı bazlı sorgulanamıyor — kolon zaten orada.** `sellerId String?` var
  (`schema.prisma:1272`) ve **tamamen ölü**: 4 yazma noktasının 4'ü de boş bırakıyor
  (`stylist.gateway.ts:140`, `tryon.service.ts:425`, `multi-tryon.service.ts:501`,
  `tryon.processor.ts:475`), indeksi yok, `Seller` relation'ı yok.
- **Asıl kırılma ölçüm değil, kapı.** Bütçe toplaması hiçbir filtre taşımıyor —
  `tryon.guards.ts:98-104` `aggregate({ where: { createdAt: { gte: dayStart } } })`. Kota
  `userId` bazlı (`:146-160`) → **widget ziyaretçisinin `userId`si yok → kota sayacı 0
  döner → kota hiç işlemez.** İki kapı da B2B'de kırık.

### En küçük çalışan dilim — 3 madde

Kriter: _"bu olmadan ilk ödeyen müşteriyi almak imkânsız ya da tehlikeli mi?"_

1. **`AiUsageLog`a kiracı boyutu + bütçe/kota ayrımı — ertelenemez.** ⚠️ Belge "ölü
   `sellerId`yi sil, `orgId` ekle" diyor; **en küçük dilim için tersi öneriliyor: silme,
   DOLDUR.** Faz 1'de kiracı zaten onaylanmış bir satıcı (belgenin §3.4 kendi kararı), doğru
   kiracı anahtarı `sellerId`dir. Bedeli: 4 yazma noktasına birer alan + `[sellerId, createdAt]`
   indeksi + `tryon.guards.ts:98-104`e kiracı filtresi. Kazancı: `Organization` +
   `OrganizationOrigin` + `OrganizationApiKey` **kritik yoldan çıkar (3 tablo → 1)**.
   Faz 4'te dış marka geldiğinde `Organization`a göç gerekir; **bu göç bilerek satın alınıyor.**
2. **`ApiKeyGuard` + `/v1/partner/*` öneki + anahtar tablosu.** Faturalamayı değil **çağrıyı**
   mümkün kılan şey. ⚠️ `JwtAuthGuard`a **dokunulmaz**: `APP_GUARD` global
   (`auth.module.ts:43`), içine anahtar yolu eklemek 118 ucun tamamını API anahtarına açar ve
   **hiçbir test bunu yakalamaz**.
3. **Append-only kredi defteri.** Bakiye kolonu yok, `SUM()` — `LedgerEntry` kararının
   kopyası (`schema.prisma:1128-1131`).

**Bilerek dışarıda:** widget/iframe · `ConsentRecord.userId` nullable migration'ı · katalogda
`storeSlug` filtresi · `/magaza/[slug]` vitrini · Prisma extension. ⚠️ Tek istisna: **fiyat
söylenecekse** `x-fal-billable-units` listeye girer (`fal.ts:123` başlıkları düşürüyor) —
aksi hâlde verilen her rakam `ai-cost.ts:86`daki bir sabittir.

---

## 6. Sıralanmış iş listesi

**Sıralama ölçütü: görünen etkiyi en ucuza kapatan önce.** İlk üç madde neredeyse hiç ürün
kodu yazmadan şikâyetin büyük kısmını kapatıyor.

---

### 0 — Üretim katalog açılışı + ilk ADMIN

**Ne:** üretimde çalışabilen, **ledger'a dokunmayan** bir bootstrap yolu. İki parça:
(a) kategori ağacı + gerçek satıcı/ürün girişi, (b) ilk ADMIN hesabının doğuşu.

**Neden bu sırada:** şikâyetin **görünen** kısmının tek sebebi bu. Canlıda 3 ürün / 3 kategori
var; yönetim paneli hiç açılamadı. Bundan önce yapılacak hiçbir geliştirme kullanıcıya fark
ettirmez.

**Ön koşul:** yok.

**⚠️ Nasıl YAPILMAZ:** `pnpm db:seed` canlıya koşturulmaz — `seed/kapi.ts:44-70` üç kapıyla
reddeder ve kapılar haklıdır (sahte `SALE`/`COMMISSION` satırları append-only deftere
yazılır, geri alınamaz; `ibanEnc = demo:not-encrypted` payout akışını patlatır). Kapıları
gevşetmek de yasak.

**Doğru çözüm — üç ayrı iş:**

| Parça          | İçerik                                                                                                                                                    | Not                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Kategori ağacı | `KATEGORILER` (32 kayıt) **yapısal veridir, demo değil** — ayrı bir `bootstrap` betiğiyle üretime idempotent yazılır                                      | Ledger'a dokunmaz, `SALE` satırı üretmez                             |
| İlk ADMIN      | Ya `rol-ata.ts`ye üretim için **denetim izine yazan, tek seferlik, açıkça onaylanan** ayrı bir mod, ya da `docs/deployment.md`ye yazılı ham SQL prosedürü | Rol yazan **HTTP ucu eklenmez** — `PROTECTED_ROLES` tasarımı korunur |
| Gerçek katalog | Satıcı başvurusu → onay → ürün girişi. Bu, 6. maddenin (`POST /seller/apply` ekranı) canlıda karşılığıdır                                                 | Elle onboard edilecekse 6. madde beklenebilir                        |

**Kabul kanıtı:** `GET /api/categories` 32 döner · `yonetici@…` ile `/admin` **dolu** açılır ·
`docs/deployment.md` bootstrap adımını içerir (bugün "admin" kelimesi hiç geçmiyor).

---

### 1 — R2 CORS + TLS

**Ne:** özel kovaya CORS kuralı, nginx'e `listen 443` + sertifika.
**Neden burada:** ürünün **ana özelliği** bugün tarayıcıda tamamlanamıyor; ön uçuş `OPTIONS`
→ 403. Katalog dolduktan sonra vitrin zengin görünecek ama "Üzerimde Dene" hâlâ kırık
olacak — ve o düğme ekranda "Sepete Ekle" ile aynı ağırlıkta. **Kırık ana özellik, boş
vitrinden daha kötü bir izlenim bırakır.**
**Ön koşul:** geniş yetkili R2 jetonu veya Cloudflare panel erişimi —
`.env`deki jeton `GetBucketCors` için `AccessDenied` alıyor. Ürün kodu yazılmaz.

---

### 2 — Belge düzeltmeleri

**Ne:** `ozellik-yol-haritasi.md` satır 18/20/21 (üç "planlı" → canlı) ·
`tryon-kategori-destegi.md` gerekçe sütunu (FASHN → `fal-ai/idm-vton`).
**Neden bu kadar erken:** **bu belgeler şikâyetin kendisini üretiyor.** Sahip, "ASIL İDDİA"
dediği özelliğe bakıp "planlı, Faz 2" okuyor; kod ise "yapıldı, kullanıcı sadece göremiyor"
diyor.

| Belge satırı                 | Diyor                                        | Gerçek                                                                                                                                                                                     |
| ---------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ozellik-yol-haritasi.md:18` | Markalar arası tam kombin — 🔶 planlı, Faz 2 | `POST /tryon/outfit` **canlı** (`multi-tryon.controller.ts:42`) **ve arayüzden çağrılıyor** (`use-deneme.ts:400`)                                                                          |
| `:21`                        | Dijital gardırop — 🔶 planlı, Faz 2          | `wardrobe.controller.ts` **5 uç** + `account/wardrobe/` tam ekran                                                                                                                          |
| `:20`                        | Doğal dilde arama — 🔶 kısmi                 | `POST /search/natural` canlı (`natural-search.controller.ts:29`)                                                                                                                           |
| `tryon-kategori-destegi.md`  | "FASHN v1.6 destekliyor"                     | `.env:54` = `fal-ai/idm-vton` · `env.ts:75` varsayılan aynı · `ai-cost.ts:86-88` üç model sayıyor, **FASHN yok** · FASHN'ın geçtiği tek yer `seed/denetim.ts:46,57,68` (sahte demo verisi) |

⚠️ `hizmet-mimarisi.md:88-107` bu çelişkiyi zaten kaydetmiş: FASHN'a geçilirse defter her
üretimde **%25 eksik** yazar. Teşhis var, tedavi yok. Kategori tablosunun kendisi doğru ve
`TRYON_PROVIDER_CAPABILITIES`ten türetildiği iddiası da doğru (`constants.ts:229-234`).

**README zaten düzeltildi** (5 uygulama → 3, `packages/ui` yok, `:3002`/`:3003` yok).
**Ön koşul:** yok. Kod yazılmaz. **3. maddeden sonraya bırakılırsa yeniden yazılması gerekir.**

---

### 3 — KVKK silme düğmeleri

**Ne:** `DELETE /me/photos/:photoId` + `DELETE /tryon/history` → `account/privacy` ekranına.
**Neden burada:** `docs/privacy.md:102` **üç** silme hakkı yazılı olarak vaat ediyor, arayüzde
yalnız biri bağlı. `UserPhoto` özel nitelikli kişisel veri. Yazılı taahhüdün karşılığının
olmaması, eksik özellikten **farklı bir risk sınıfıdır**.
**Ön koşul:** yok — iki uç hazır ve dağıtılmış, sıfır backend işi.

---

### 4 — Denetim izi filtreleri + `docs/runbook/kvkk-breach.md`

**Ne:** `audit/page.tsx`e `actorId`, `action`, `from`, `to` form alanları + `KAYIT_TURLERI`ye
`User` ve `DataExport`. Yanında eksik runbook dosyası.
**Neden burada:** **depodaki en yüksek kaldıraçlı iş — ~1 saat, backend 0 satır.** Uç
filtreleri zaten destekliyor (`admin.schema.ts:315-322`), ekran ikisini gönderiyor
(`audit/page.tsx:88`). `User`/`DataExport` eklenmeden worker'ın yazdığı KVKK olayları
(`user.deletion.blocked`, `user.data_export.skipped`) hiç filtrelenemiyor. Runbook aynı
pakette çünkü `privacy.md:141-147` ihlalde **72 saat içinde** bildirim yükümlülüğünü anlatıp
var olmayan bir dosyaya yolluyor.
**Ön koşul:** 0. madde (ADMIN olmadan panel açılamaz).

---

### 5 — Pazaryeri taban çizgisi: yorum + favori

**Ne:** `Review` ve `Favorite` için uç + contracts wire tipi + ürün detayı yüzeyi + hesabım
kısayolu.
**Neden 5. sırada:** gerçek geliştirme gerektiren **ilk** madde — 0-4 arası neredeyse hiç
ürün kodu yazmıyordu.
**Neden bu ikisi ilk:** ikisi de şemada tam, seed veri yazıyor, **ve ikisi de zaten arka
planda okunuyor** (`ai.gateway.ts:266` + `fit-learning.gateway.ts:91` → beden motoru;
`stylist.gateway.ts:40` → stil danışmanı). Yatırımın yarısı yapılmış ve bugün kullanıcının
hiç oluşturamadığı veriden AI sinyali çıkarılıyor. Ürün detayına giren birinin aradığı ilk üç
şeyden ikisi bunlar; ekran boş değil ama **tanıdık değil**.
**Ön koşul:** 0. madde (ürün olmadan yorum olmaz).
⚠️ `design-system.md` üç-blok bütçesi buna direniyor — çözüm §4'te: yıldız + sayı eylem
bloğuna, tam metin ayrı ekrana.

---

### 6 — Satıcı arz tarafı

**Ne:** `POST /seller/apply` ve `PATCH /seller/store` için ekran. Bonus: `/calculator`
menüye eklenir.
**Neden burada:** pazaryerinin **arz tarafı girişi bugün kapalı** — yeni satıcı başvuru
yapamıyor, mevcut satıcı mağazasını düzenleyemiyor. 5'ten sonra çünkü talep tarafı
doldurulmadan arz çekmenin anlamı yok; 7'den önce çünkü **katalog büyümesi buradan gelir** ve 0. maddedeki "gerçek katalog" parçasının kalıcı çözümü budur.
**Ön koşul:** 0. madde (ADMIN olmadan başvuru onaylanamaz).

---

### 7 — Ayrıştırıcı yüzeyler

**Ne:** paylaşım düğmesi · deneme geçmişi ekranı (`GET`/`DELETE /tryon/history`) · kayıtlı
kombinler (`GET`/`POST /outfits`, `POST /outfits/:id/items`, `DELETE /outfits/:id`) · benzer
ürünler (`GET /products/:id/similar`).
**Neden burada:** **6 uç hazır, çağıran yok.** Taban çizgisi (5) kapanmadan ayrıştırıcıya
geçilmez — yorumsuz bir pazaryerinde paylaşılan try-on görseli boşa gider.
**Ön koşul:** 1. madde (R2 CORS olmadan try-on tamamlanmıyor, geçmiş de dolmuyor).
⚠️ Aynı pakette küçük hata: `GET /api/products/xyz/similar` canlıda **500** dönüyor (404
dönmeli).

---

### 8 — Operasyon musluğu

**Ne:** `POST /logistics/packages/:id/delivered` için ADMIN düğmesi (küçük) +
`POST /orders/:id/cancel` müşteri yüzeyi (orta).
**Neden burada:** teslim ucu `@Roles('ADMIN')` — webhook değil, **operatör ucu**. Dosyanın
kendi başlığı sayıyor: bu musluk açılmadan **4 özellik birden ölü** — iade penceresi
(`ORDER.returnWindowDays`), satıcı hakediş penceresi (`payoutAvailableAt`),
DELIVERED→COMPLETED geçişi, beden öğrenme sinyali (`fit-learning.gateway.ts`). Tek düğme dört
aşağı akış özelliğini canlandırıyor. Sipariş hacmi olmadan görünmez.
**Ön koşul:** 6. madde (gerçek satıcı → gerçek sipariş).

---

### 9 — Yeni dikeyler

| İş                                                | Neden                                                                                                          |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **İade hakemliği** (`GET`/`PATCH /admin/returns`) | Tek gerçek yasal maruziyet. Bugün satıcının üstünde kimse yok; manuel iade `ReturnRequest.status`u düzeltmiyor |
| **Adres defteri** (`Address` CRUD)                | Checkout her siparişte 9 alan doldurtuyor; kurumsal fatura alanları şema içinde kalmış                         |
| **Kupon ekranı**                                  | 3 uç + servis + denetim eylemleri tam, `AdminCouponWire` ve 2 ekran eksik                                      |
| **Satıcı belge görüntüleme**                      | İmzalı URL ucu yok; yönetici vergi levhasını görmeden mağaza onaylıyor                                         |
| **Kullanıcı listesi + askıya alma**               | ⚠️ **rol yazma ucu EKLENMEZ.** Sadece okuma + `suspend`/`reinstate`; fotoğraf ve beden profili **asla dönmez** |
| **Fatura / e-arşiv**                              | Yasal zorunluluk, ama gerçek satış başlamadan devreye girmez                                                   |

**Neden hepsi bu sırada:** her biri yeni uç + yeni servis + yeni ekran — üstteki maddelerin
5-10 katı iş. Yasal ağırlığına rağmen iade hakemliği 0-4'ün önüne geçmiyor çünkü **bugün
canlıda 3 ürün var; iade hacmi de yok.**
**Ön koşul:** 8. madde (iade penceresi `deliveredAt`e bağlı).

---

### 10 — Tekrarı önleyen test: uç ↔ ekran tutarlılık kapısı

**Ne:** her uç için ya bir çağrı yeri ya da açık bir "ekransız" listesinde kayıt zorunlu
kılan test.
**Neden sonda ama mutlaka:** depo bu hatayı `apps/web/AGENTS.md` §9.9'a göre **üç kez
yaşamış** ve iki kapı kapatmış — `yan-menu.test.ts` (menü↔ekran) ve `rota-tablosu.test.ts`
(bağlantı↔rota). **Ama uç↔ekran tutarlılığını ölçen hiçbir şey yok**, ve ~20 eksik ekranın
tamamı o boşluktan geçmiş. Bu test yazılmadan 9. madde biter bitmez aynı desen yeniden
birikir.
**Ön koşul:** 9. madde (liste stabilleşmeden kapı yazmak sürekli kırmızı yanar).
⚠️ Yan iş: `apps/web/AGENTS.md:586` test eşiği 1245'te donmuş; gerçek **1376 statik blok**
(koşumda ~1392) — yukarı çekilir.

---

### 11 — Çok kiracılı (B2B): ayrı program

Sıra: (0) TLS + R2 CORS — zaten 1. maddede · (1) `AiUsageLog.sellerId`yi **sil değil DOLDUR**

- `[sellerId, createdAt]` indeksi + `tryon.guards.ts:98-104`e kiracı filtresi ·
  (2) `ApiKeyGuard` + `/v1/partner/*` · (3) append-only kredi defteri.

**Neden en sonda:** 118 ucun **0'ı**, 48 sayfanın **0'ı** kiracıya bakıyor. Bu, kullanıcının
"özellikler yok" şikâyetiyle **ilgisiz**. Bir ödeyen müşteri belirmeden sıraya girmez.

⚠️ İki kırmızı çizgi: (a) `JwtAuthGuard`a dokunulmaz — `APP_GUARD` global
(`auth.module.ts:43`), içine anahtar yolu eklemek 118 ucu API anahtarına açar ve **hiçbir
test yakalamaz**; (b) fiyat söylenecekse `x-fal-billable-units` listeye girer
(`fal.ts:123` başlıkları düşürüyor).

---

## 7. Ertelenenler ve gerekçeleri

| Madde                                             | Karar                                  | Gerekçe                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`POST /cart/merge` çağrısı**                    | ⛔ **Listeden düştü — yanlış ölçümdü** | Önceki bir ölçüm bunu "misafir sepeti yok oluyor" diye P0 yapmıştı. Yanlış: `apps/web/src/lib/session/authenticate.ts:112` ham `fetch` ile **çağırıyor**, idempotency anahtarı türetiyor, `:9-25`te sırayı gerekçesiyle yazıyor, hata durumunda girişi tamamlayıp `skipped` dönüyor. Naif tarama `apiFetch` aradığı için kaçırmış |
| **Video try-on**                                  | ⛔ Birim ekonomi ölçülmeden açılmaz    | Kullanıcı kararı. ~$0,50-1,00/istek vs ~$0,08. `AI_VIDEO_TRYON_ENABLED` varsayılan kapalı, ayrı bütçe kovası. Migration `migrations-pending/` içinde bekliyor — doğru yerde                                                                                                                                                       |
| **Ayakkabı / takı / çanta**                       | ⛔ Sağlayıcı olmadan açılmaz           | Kullanıcı kararı. `TRYONABLE_CATEGORIES` matristen türetiliyor (`constants.ts:229-234`), elle açılamaz — doğru tasarım                                                                                                                                                                                                            |
| **3D avatar · AR ayna**                           | ⛔ Kapsam dışı                         | Donanım + perakende operasyonu işi, yazılım projesi değil (`ozellik-yol-haritasi.md`)                                                                                                                                                                                                                                             |
| **Pazaryeri modelinden sapma**                    | ⛔ Tartışılmıyor                       | —                                                                                                                                                                                                                                                                                                                                 |
| **Konfor katmanı**                                | En sona                                | Son gezilenler, karşılaştırma, filtre kaydetme, arama geçmişi, stok bildirimi, gezinme çubuğunda arama. **Hiçbiri şikâyeti açıklamıyor**                                                                                                                                                                                          |
| **Prisma extension (kiracı yalıtımı 2. katmanı)** | 11. maddeye                            | Bugün gerçek sızıntı yok (27/27 dekoratör, 22/22 sorgu). Disiplin çalışıyor; mekanizmayı ödeyen müşteri gelince kurmak yeterli                                                                                                                                                                                                    |
| **`packages/ui` paketi**                          | Açılmıyor                              | Tek tüketici `apps/web`; ayrı paket bakım maliyeti getirir, kazanç getirmez                                                                                                                                                                                                                                                       |
| **Widget / iframe · `/magaza/[slug]` vitrini**    | 11. maddenin de dışında                | İlk 3 müşteri elle onboard edilecekse satılabilirliğin önünde durmuyor (`hizmet-mimarisi.md` kendi kararı)                                                                                                                                                                                                                        |
