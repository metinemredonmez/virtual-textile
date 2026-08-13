# Hizmet Olarak Sanal Deneme — Mimari ve Kapsam Kararı

> Sanal deneme motorunu **kendi satıcılarımızın kendi sitelerinde** çalıştırılabilir
> hâle getirme kararı. Ne yapılacağı değil, **neden öyle seçildiği** yazılır.
> Kaynaksız sayı yoktur; ölçülmemiş olan "ölçülmedi" diye geçer.
>
> ⚠️ `docs/ozellik-yol-haritasi.md` bu konuda **ESKİDİR** — DRESSX'i tüketici
> rakibi sayar ve "marka-ötesi kombini yapan yok" der. İkisi de artık doğru
> değil (§1). O dosya değiştirilmedi; rekabet konumu için bu belge geçerlidir.

Tarih: 2026-08-13 · Tur tipi: salt-okunur analiz (derleme/test çalıştırılmadı)

---

## 1. Konumlanma — DRESSX pivot etmedi, iki yönlü genişledi

Görevin çıkış tezi ("DRESSX tüketiciye satmıyor, markalara altyapı satıyor")
**yarım doğru**. `dressx.com/b2c/dressx-agent` canlı ve şunu yazıyor: entegrasyon
ücreti yok, tüm ortaklıklar CPA modeline dayanıyor. DRESSX Agent (Eylül 2025,
+11.800 marka) onların kendi tüketici pazaryeri. B2B vitrini öne çıktı, tüketici
tarafı arkaya çekildi — kapanmadı.

Bu düzeltme kozmetik değil, **ayrıştırıcı cümleyi değiştiriyor**:

| Eski ayrıştırıcı (`ozellik-yol-haritasi.md:30-34`)                         | Durum                                                                                                                                                             |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Bir mağazanın ceketi + ikincinin pantolonu — bunu yapan yok"              | ❌ Artık yanlış. DRESSX Agent'ta marka-ötesi mix & match var                                                                                                      |
| **Yeni:** marka-ötesi kombinin **tek sepette ve tek ödemede** tamamlanması | ✅ Bizde var (çok satıcılı sipariş + komisyon paylaşımı). Onlarda **yapısal olarak yok** — CPA modelinde envanter tutmuyorlar, sipariş perakendecide tamamlanıyor |

**Tedarikçi olarak alınamazlar.** Açık fiyat yok, self-serve yok, entegrasyon
elle. Kanıt: canlı Victoria Beckham ürün sayfasında yüklenen dosya adı
`loader_vb_test.js`, uç adları `tryons_create_vb_ai` / `vb_ai_predict_get`.
Kurumsal vitrin müşterisinde "test" adlı dosyanın canlıda durması ve müşteriye
özel uç adları, müşteri başına elle entegrasyonu gösterir. **fal.ai kararı
değişmiyor** (MEMORY: MVP fal.ai).

**Fiyat ligimiz FASHN, DRESSX değil.** Pazar ikiye yarılmış: FASHN $19/$49/$99
ay + $0,10/kredi (açık liste) ile DRESSX "contact sales" arasında kimse yok.
DRESSX'in bandını hedeflemek satış ekibi + kurumsal sözleşme altyapısı ister;
bu bir yazılım kararı değildir.

### ⚠️ Yapısal engel: biz pazaryeriyiz, DRESSX değil

DRESSX envanter tutmadığı için hiçbir markanın rakibi değil — widget'ını gönül
rahatlığıyla gömersin. Bizim widget'ımızı gömen bir dış marka, kendi müşterisinin
fotoğrafını ve deneme telemetrisini **kendisiyle rekabet eden bir pazaryerinin
altyapısına** verir. Bu teknik bir sorun değil; satış görüşmesinin ikinci
dakikasında çıkacak bir itirazdır ve hiçbir DPA maddesi onu çözmez.

Bu tek gerçek MVP müşteri seçimini belirliyor → §3'teki kısayol.

**Konum cümlesi:** Türk markalarına, KVKK'sı yerelde çözülmüş, tek sepetli çok
satıcılı pazaryeri **artı** o pazaryerinin satıcılarına açılan deneme altyapısı.
DRESSX'in lüks/global odağının dışındayız ve onunla aynı masada değiliz.

---

## 2. Yetenek envanteri — "var" demek için çalışan uç arandı, pazarlama sayfası değil

| DRESSX ürünü                                          | Bizde                          | Kanıt / eksik olan                                                                                                                                                 |
| ----------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Virtual Try-On**                                    | ✅ VAR                         | `POST /tryon` (202; önbellek isabetinde 200), `GET /tryon/:jobId`, BullMQ + polling. Mimari **birebir aynı**. 4 giysi kategorisi açık                              |
| **DRESSX Agent** (kendi pazaryeri)                    | ✅ VAR ve daha güçlü           | Tek sepet + tek ödeme; onlarda CPA yüzünden yapısal olarak yok                                                                                                     |
| **AI Customer Assistant**                             | 🔶 KISMİ                       | Stylist motoru var (`stylist.tools.ts:71-151`, 6 araç) ama **altısı da alışveriş aracı**. Sipariş durumu / iade / kargo aracı yok → stilist, müşteri hizmeti değil |
| **Retail AI Stylist**                                 | 🔶 KISMİ                       | Aynı motor; mağaza içi varyantı yok                                                                                                                                |
| **AI Studio** (yapay manken üzerinde katalog görseli) | ❌ YOK — **ve ürünümüz değil** | `tryon-kategori-destegi.md:39-44` bunu bilinçli ayırmış: satıcıya katalog görseli üretir, müşteri denemesi kazandırmaz. DRESSX'te de ayrı SKU → ayrım doğrulandı   |
| **DRESSX AI** (metinden görsel)                       | ❌ YOK                         | Şemsiye marka + prompt tabanlı görsel üretimi                                                                                                                      |
| **AI for Email Marketing**                            | ❌ YOK                         | Klaviyo/Salesforce eklentisi; katma değeri şüpheli                                                                                                                 |
| **GPT Ads**                                           | ❌ KAPSAM DIŞI                 | Reklam ağı işi, try-on ile teknik ilgisi yok                                                                                                                       |
| **DRESSX Mirror**                                     | ❌ KAPSAM DIŞI                 | Donanım + perakende operasyonu                                                                                                                                     |
| **AI Suite / gömülü widget**                          | ❌ YOK — **asıl boşluk**       | Depoda tek `<iframe>` 3-D Secure için (`odeme/uc-d-s.tsx:50`). `customElements`, `attachShadow`, `postMessage`, `embed.js` — hiçbiri geçmiyor                      |

**Tek cümlelik fark:** Motor DRESSX'in yaptığı işi yapıyor. Eksik olan motor
değil, **motoru başkasına satmanın kabuğu**: kimlik doğrulama, kiracı yalıtımı,
kiracı bazlı defter, gömülebilir bileşen. Yazılım riski düşük, **kapsam riski
yüksek** bir iş — bu yüzden kapsam §6'da sertçe kesiliyor.

### ⚠️ "Var görünen ama bağlanmamış" iki kalem

- **Embedding hiçbir yerden çağrılmıyor.** `FalEmbeddingProvider`
  (`embedding.ts:159`) yalnızca kendi testinde geçiyor; `EMBEDDING` kuyruğu
  tanımlı, işlemcisi yok. Sonuç: `catalog.service.ts:494` "benzer ürünler"
  sorgusu `p.embedding IS NOT NULL` şartı taşıyor ve o kolon **hiç
  doldurulmuyor** → özellik sessizce boş dönüyor.
- **`TAGGING` / `DESCRIPTION` / `MODERATION`** `AiFeature` enum'unda var,
  `AI_CONTENT` kuyruğu tanımlı, **üreten kod yok**.

### ⚠️ Belge–kod çelişkisi (fiyat konuşmasından önce kapatılacak)

`docs/tryon-kategori-destegi.md:10-14` dört kategorinin gerekçesini **FASHN
v1.6** ile yazıyor. `.env:54` ise `FAL_TRYON_MODEL=fal-ai/idm-vton`. İkisi aynı
anda doğru olamaz: ya canlıda yanlış model çalışıyor, ya kategori doktrininin
gerekçe sütunu **her satırda** yanlış.

Üstelik `ai-cost.ts:85-89` tablosunda FASHN **yok**:

```ts
export const FAL_TRYON_UNIT_COST_MICRO_USD = {
  'fal-ai/idm-vton': 60_000n, // $0,060
  'fal-ai/cat-vton': 40_000n,
  'fal-ai/leffa/virtual-tryon': 40_000n,
};
```

FASHN'a geçilirse `estimateCost('TRYON')` fallback'ine düşülür → defter $0,06
yazar, gerçek fiyat fal'da $0,075 → **her üretimde %25 eksik defter, hata
vermeden**.

---

## 3. Mimari kararı — Satıcı Vitrin Widget'ı: iframe taşıyıcı, kendi kataloğumuz, ayrı kiracı

### 3.1 Script mi iframe mi? → **İkisi de. İnce script iframe enjekte eder.**

Markanın gördüğü ergonomi `<script>`; çalışan şey iframe. Dört bağımsız kuvvet
aynı yönü gösteriyor:

1. **CSRF zaten kapıyı kapatmış.** `apps/web/src/lib/api/csrf.ts:22-30` —
   `origin !== appUrl()` → her POST 403. Gevşetmek korumanın tamamını atmaktır;
   dosyanın kendi yorumuna göre `SameSite` vekil yüzünden zaten bir şey
   korumuyor, koruma bu denetime kalmış.
2. **KVKK.** Script yolunda fotoğraf markanın DOM'undan geçer → marka fiilen
   veri işleyen olur → her müşteri için ayrı yazılı sözleşme (KVKK md.12/1).
   Üstelik markanın sitesindeki her analitik/piksel/chat betiği o `File`
   nesnesine erişebilir konuma gelir. iframe'de fotoğraf markanın belgesine hiç
   girmez; marka ne sorumlu ne işleyen — **yönlendiren**.
3. **⚠️ R2 CORS operasyonu.** `infra/R2-CORS.md` ölçülmüş bir arıza:
   `OPTIONS <imzalı-url>` → **403**, uygulama jetonunda `PutBucketCors` yetkisi
   yok. Script yolunda kova CORS listesine **her müşteri markası için ayrı
   satır** gerekir → her onboarding bir altyapı operasyonu. iframe yolunda liste
   **tek satır** kalır: kendi kökenimiz. Bu, müşteri başına tekrarlayan opex farkı.
4. **Tema.** `:root` Shadow DOM'da çalışmaz; iframe kendi belgesidir,
   `globals.css:63-80` tokenları aynen çalışır.

### 3.2 3. taraf bağlamda oturum → **taşınmaz. Çerez hiç kullanılmaz.**

`SameSite=Lax` → çapraz siteli iframe'e çerez gitmez; `None` → `Secure` → TLS;
Safari ITP → CHIPS → her marka ayrı kimlik. Bu ağacın tamamı gereksiz.

**Widget oturumu = bellekte tutulan 15 dakikalık token.** `pk` anahtarı +
`Origin` doğrulaması karşılığında basılır, bir JS değişkeninde durur, hiçbir
zaman çereze yazılmaz. Çerez yoksa `SameSite` yok, CHIPS yok, ITP yok, Storage
Access izin kutusu yok.

Bedeli açık ve kabul ediliyor: widget ziyaretçisinin **"gardırobum" /
"geçmiş denemelerim" yoktur**. MVP'de zaten ertelenen şey; widget'ın vaadi tek
ürün denemesi, hesap taşıma değil.

### 3.3 Kiracı `Seller` mi yeni `Organization` mı? → **`Organization`**

`Seller` yeniden kullanılamaz:

- `Seller` bir **ödeme kimliğidir**: `ibanEnc`, `taxNumberEnc`,
  `submerchantKey`, `payouts`, `ledgerEntries` (şema 251-288). B2B müşterisi
  bize öder, bizden almaz. `PayoutRequest` akışı her sorguda "ama bu gerçek
  satıcı değil" şartı taşımak zorunda kalır; o şartın bir yerde unutulması
  olmayan bir IBAN'a havale denemesidir.
- `@SellerPanel()` **sınıf düzeyinde** uygulanıyor (`seller.scope.ts:31-35`,
  kasıtlı). JWT'sine `sellerIds` yazılan bir B2B müşterisi o gün **tüm satıcı
  paneline** — finans, ledger, payout — meşru biçimde erişir. Tasarımın doğru
  çalışmasıdır; yanlış olan onu B2B'ye bağlamaktır.
- Yaşam döngüleri farklı: `SellerStatus` belge onayına, B2B sözleşme imzasına dayanır.

**Ayrı guard, ayrı rota öneki. `JwtAuthGuard`'a ikinci kimlik yolu eklenmez** —
global `APP_GUARD` (`auth.module.ts:46`); içine anahtar desteği eklemek ~116
ucun tamamını API anahtarına açar ve **hiçbir test bunu yakalamaz**, çünkü
davranış "doğru" çalışır.

```
/v1/*          → JwtAuthGuard        (pazaryeri — DEĞİŞMEZ)
/v1/partner/*  → ApiKeyGuard         (sunucu-sunucu, vt_sk_…)
/v1/widget/*   → WidgetSessionGuard  (vt_pk_… + Origin → 15 dk token)
```

İki anahtar tipi zorunlu: tarayıcı sır saklayamaz. `pk`'nın tek savunması
`Origin`'dir ve zayıftır — gerçek koruma **kiracı bazlı kotadır**.

| Karar                               | Gerekçe                                                                                                                                                                                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Saklama `sha256(sır)`               | argon2 **değil**: 256-bit rastgele sırda yavaş hash hiçbir şey satın almaz, her istekte CPU yakar. Şifreleme **değil**: anahtarın geri okunması hiçbir zaman gerekmez (`ibanEnc` şifreli çünkü ödeme anında çözülmesi gerekiyor) |
| Biçim `vt_sk_live_<keyId>.<secret>` | `keyId` ile tek satır çekilir, sonra sabit zamanlı karşılaştırma. Tek parça anahtarla tüm tablo taranırdı                                                                                                                        |
| İptal `revokedAt` + Redis denylist  | `auth.guard.ts:76-83`'teki `isSessionActive` deseninin aynısı — önbellek TTL'i kadar iptal edilmiş anahtar yaşamasın                                                                                                             |

### 3.4 ⚠️ Kör nokta — ilk müşteri dışarıdan gelmemeli

"B2B müşterisi = kataloğumuzun dışındaki marka" varsayımı, gereksiz bir yığın
iş üretiyor. Elimizde `Store` var: `slug`, `name`, `logoKey`, `bannerKey`,
`sellerId @unique` (şema 330-344) — imzalı sözleşmesi, vergi numarası ve
onaylanmış belgesi olan tüzel kişiler. Widget yalnızca **kiracının kendi
`variantId`'lerini** sunarsa:

| Sorun                                                                                                                                       | Dış marka yolunda                                   | Kendi satıcımız yolunda                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------- |
| `TryOnJob.variantId` zorunlu FK (şema 1213)                                                                                                 | canlı tabloda migration                             | **dokunulmuyor**                                           |
| Gölge `Variant` → `embedding`/`searchVector` generated column (şema 437-440) pazaryeri aramasını kirletir                                   | gerçek risk                                         | **yok**                                                    |
| Partner görselinin `tryOnScore`'u bilinmiyor; düşükse üretim düşer, **maliyeti biz öderiz**                                                 | %10 mu %40 mı bilinmiyor → fiyat tablosu dayanaksız | görseller zaten `minProductReadinessScore: 60` ile elenmiş |
| KVKK veri sorumlusu tersine döner; yurt dışı aktarım belgesini marka imzalar (`kvkk-veri-akisi.md:18,105` — mekanizma **henüz seçilmemiş**) | her müşteride haftalarca hukuk turu                 | **sorumlu biz kalırız**, bugünkü akış geçerli              |
| Sözleşme seti                                                                                                                               | 4 yeni belge                                        | mevcut satıcı sözleşmesine **ek madde**                    |
| Önbelleğin kiracılar arası sızması                                                                                                          | anahtar `orgId` almalı → isabet düşer               | tek sorumlu biziz → **küresel önbellek geçerli kalır**     |

Stratejik olarak bu, §1'deki rekabet itirazının da tek panzehiri: bizim
widget'ımızı gömen taraf zaten pazaryerimizde satıyorsa, "rakibe veri verme"
itirazı yoktur.

**⚠️ Korunan karar ve bilinen gerilim:** "müşteri platforma aittir" bozulmuyor —
widget'taki **"Satın Al" düğmesi bizim ürün sayfamıza gider**. Satıcı kendi
sitesinde denemeyi kazanır, sipariş pazaryerinde tamamlanır, komisyon akar.
Gerilim gerçek: satıcı "satın alma bende kalsın" isteyecek. Bu ayrı bir ticari
karardır → §6, ertelendi, **sessizce açılmaz**.

### 3.5 Yalıtım seviyesi — MVP'de sorgu düzeyi

RLS'in bedeli her isteğin transaction içinde olmasıdır; Prisma havuzunda
`$transaction` dışında `SET LOCAL` **sızar** ve yanlış kiracıya veri döner.
Onun yerine depodaki kendi çözümümüz kopyalanır — `seller.scope.ts:15-21`
tuzağı adıyla tarif etmiş ("biri konup diğeri unutulabilirdi"):

- `@OrgScoped()` **tek dekoratör** (guard + `@OrgId()` ayrılamaz) → insanı korur.
- **Prisma Client extension:** `orgId` kolonu olan modelde `orgId` içermeyen
  `findMany`/`findFirst` **çalışma anında fırlatsın** → insanın dekoratörü
  unuttuğu günü korur.

**Depolama öneki şimdi eklenir, bedavayken:** `orgs/{orgId}/…`. Gerekçe teknik
değil sözleşmesel — DPA "sözleşme bitiminde tüm veriyi sil" der; önek yoksa bu
tüm kovayı tarayıp `TryOnJob` ile eşleştirmektir. ⚠️ İlk B2B nesnesi yazılmadan
yapılmalı; sonradan taşımak `UserPhoto.storageKey @unique` üzerinden her dosyayı
kopyalamaktır.

**Katalog okuma tarafı:** `productListQuerySchema` (`catalog.schema.ts:10-24`)
`sellerId`/`storeSlug` filtresi taşımıyor — yalnızca `brand`, o da
`Product.brandName` serbest metni. Widget bugün "sadece bu satıcının ürünleri"
diyemiyor. Küçük ekleme, ama MVP'nin zorunlu parçası.

---

## 4. Token / faturalama — tek defter, tek birim, iki kapı

### ⚠️ Fiyat bugün açıklanamaz, gerekçesi ölçülebilir

Defterdeki **her** try-on satırı bugün varsayım. `readReportedCostMicroUsd()`
(`ai-cost.ts:167`) yalnızca **JSON gövdesine** bakıyor; fal faturalanan miktarı
`x-fal-billable-units` **yanıt başlığında** döndürüyor. `http.ts:82-85`
başlıkları **zaten döndürüyor**, `fal.ts:123` şu satırla atıyor:

```ts
const { json } = await requestJson({ ... });   // headers düşürülüyor
```

Sonuç `ai-cost.ts:156`: `costBasis: input.fromUsage ? 'PROVIDER_USAGE' :
'MODEL_ESTIMATE'` → bugün **`MODEL_ESTIMATE`**. Yani "birim maliyetimiz $0,06"
bir ölçüm değil, `ai-cost.ts:86`'daki bir sabittir.

Düzeltme küçük: başlığı oku, `x-fal-billable-units × birim fiyat` yaz →
`costBasis` `PROVIDER_USAGE` olur. `CostBasis` tipi (`ai-cost.ts:21-27`) ve
`meterCost()` bunun için **zaten hazır**; eksik olan tek şey başlığın okunması.

⚠️ Dolaşımdaki üç rakam, üç kaynak, sıfır ölçüm:

| Kaynak                                   | Rakam         | Not                                      |
| ---------------------------------------- | ------------- | ---------------------------------------- |
| `ai-cost.ts:86`                          | $0,060        | `idm-vton` — kodun çalıştırdığı model    |
| `tryon-kategori-destegi.md` → FASHN v1.6 | fal'da $0,075 | doküman gerekçesi; tabloda karşılığı yok |
| `ozellik-yol-haritasi.md:53`             | $0,08         | orada da **tahmin** olarak yazılmış      |

**Kural: Faz 1 tamamlanmadan hiçbir müşteriye rakam söylenmez.**

### 4.1 Defter — bakiye kolonu YOK

Doğru cevap depoda zaten yazılı, `schema.prisma:1128-1131`: _satıcı bakiyesi
ayrı kolonda tutulmaz, her zaman `SUM(amount_minor)` ile hesaplanır; ayrı bakiye
kolonu er geç tutarsızlaşır._ Kredi için gerekçe daha güçlü: düşme işlemi bir AI
çağrısının yanında olur, çağrı düşebilir, worker çökebilir.

```
OrganizationCreditEntry               ← APPEND-ONLY
  orgId, type: PURCHASE|CONSUMPTION|REFUND|ADJUSTMENT|EXPIRY
  credits BigInt                      ← + satın alma, − tüketim. Kesir yok.
  tryOnJobId String?  invoiceId String?  createdAt

Bakiye = SUM(credits) WHERE orgId = ?
```

### 4.2 Birim = **ziyaretçiye gösterilen bir deneme**, GPU saniyesi değil

| Olay                                           | Kredi | Neden                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Başarılı üretim                                | **1** | —                                                                                                                                                                                                                                                                                                                  |
| **Önbellek isabeti**                           | **1** | ⚠️ Karar burada. Markanın satın aldığı şey ziyaretçisinin gördüğü denemedir; bizim GPU saniyemiz onun işi değil. Önbellek marjı **bize** kalır — `multi-tryon.ts:285` önek anahtarı ve `cache-key.ts` tasarımının tüm ticari değeri buradan gelir. **Sözleşmede açıkça yazılır**, keşfedilip itiraz konusu olmasın |
| Başarısız üretim / fallback'e düşen ilk deneme | **0** | Maliyeti biz öderiz (`tryon.processor.ts:483`: "başarısız denemeler de faturaya girer"). Bu fark **fiyata gömülür**, müşteriye yansıtılmaz                                                                                                                                                                         |

Tüketim satırı işin **başında değil, `SUCCEEDED` olduğunda** yazılır. Kota
tarafındaki zarafet (`tryon.guards.ts:141-160`: kota = "bugün açılmış ve
başarısız olmamış iş sayısı", yani başarısızlık kotayı kendiliğinden iade eder)
ayrı bir tabloda otomatik olmaz — bu yüzden yazma anını sona almak zorunlu.

### 4.3 ⚠️ B2B'nin ilk çağrısından ÖNCE yapılması zorunlu tek değişiklik

`tryon.guards.ts:98-104` bütçeyi **hiçbir filtre olmadan** topluyor
(doğrulandı — `where: { createdAt: { gte: dayStart } }`, başka koşul yok):

```ts
prisma.aiUsageLog.aggregate({
  _sum: { costMicroUsd: true },
  where: { createdAt: { gte: dayStart } },   // ← kiracı ayrımı yok
}),
```

İlk B2B müşterisi günlük platform bütçesini tek başına doldurduğu anda
**pazaryerinin sanal deneme özelliği kapanır.** Ödeyen müşteri, ödemeyeni
susturur.

Düzeltme küçük ve aynı hamlede üç şey birden yapılır:

- `AiUsageLog`'a `orgId` eklenir; platform bütçesi `orgId: null` filtreleyerek
  toplar, kiracı kendi satırlarını.
- **Ölü `sellerId` alanı temizlenir** — `schema.prisma:1272` `sellerId String?`,
  modelde **relation'ı bile yok**, beş yazma noktasının hiçbiri doldurmuyor.
- `[orgId, createdAt]` indeksi konur. Bugünkü üç indeks (`createdAt`,
  `[userId, createdAt]`, `[feature, createdAt]` — şema 1287-1289) kiracı
  boyutunu kapsamıyor; marka bazlı aylık toplam full-scan olurdu.

Aynı kırılma kotada da var: `consumedQuotaToday` `userId` ile sayıyor
(`tryon.guards.ts:96`); widget ziyaretçisinin `userId`'si yok → **kota hiç
işlemez**. Widget kapısı `orgId` bazlı sayar.

### 4.4 Model: **ön ödemeli kredi + aylık taban**

| Seçenek              | Karar | Neden                                                                                                                                                                                                                    |
| -------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Gelir paylaşımı      | ❌    | Faz 1'de "Satın Al" bizim ürün sayfamıza gittiği için komisyon zaten `LedgerEntry` ile kuruşu kuruşuna izleniyor. İkinci bir güven esaslı defter açmak, çalışan disiplini bırakıp her ay mutabakat toplantısı üretmektir |
| Sınırsız abonelik    | ❌    | Sabit gelir + kullanıma doğrusal maliyet = hacim arttıkça marjı negatife çeviren yapı                                                                                                                                    |
| **Ön ödemeli kredi** | ✅    | Tahsilat riski sıfır. Krediler bitince try-on kapanır, ticaret akışı etkilenmez — `architecture.md` §3'teki "bütçe dolunca AI kapanır" ilkesinin aynısı                                                                  |

**Fiyat: tablo değil, taban formülü.**

```
taban = ölçülen_birim × zincir_katsayısı(≈1,15) ÷ (1 − önbellek_isabeti)
```

⚠️ **Önbellek isabeti B2B'de yapısal olarak düşük.** Pazaryerinde aynı kullanıcı
gün içinde 10 ürün deniyor ve ertesi gün dönüyor; widget ziyaretçisi bir kez
gelir, bir ürün dener, gider. **İlk deneme her zaman ıskadır.** İlk ay için %0
varsayılmalı → $0,06 tahmini üzerinden taban $0,069. **Bu bir fiyat değil,
ölçüm gelene kadarki alt sınırdır.**

**Aylık taban ücret pazarlık konusu değil:** sözleşme, DPA ve entegrasyon
desteği kullanımla ölçeklenmez. DRESSX'in kendisi bile müşteri başına elle
onboard ediyor (§1). Sektör lideri otomatikleştiremediyse biz de ilk üç
müşteride otomatikleştiremeyiz. 1.000 denemelik bir müşteri, üretim maliyeti ne
olursa olsun, taban ücret olmadan zarardır.

**Faturalama Faz 1'de elle kesilir.** `Plan`/`Subscription`/`Invoice` modeli
**yazılmaz** — üç müşteri için otomasyon yazmak, müşteriyi bulmadan altyapı
yazmaktır. Kredi satın alma bir `PURCHASE` satırıdır, faturayı muhasebe keser.

**Faz 1'de mutlaka olacak tek okuma ucu:** `GET /v1/partner/usage`. Marka ilk
gün "ne harcadım" diye soracak; sormadan önce cevabımız olsun.

---

## 5. KVKK — Faz 1'de veri sorumlusu BİZ kalırız

KVKK md.3/1-ı veri sorumlusunu "işleme amaçlarını ve **vasıtalarını** belirleyen"
taraf sayar. Bugünkü kodda vasıtaları belirleyen taraf tartışmasız biz:

| Vasıta                | Kim belirliyor           | Kanıt                                               |
| --------------------- | ------------------------ | --------------------------------------------------- |
| Sağlayıcı seçimi      | biz                      | `tryon.factory.ts` fallback zinciri                 |
| Saklama süresi        | biz                      | `UserPhoto.expiresAt` + silme cron'u (şema 234-236) |
| Kalite eşiği ve reddi | biz                      | `UserPhoto.qualityScore`                            |
| Yurt dışına aktarım   | **fiilen biz yapıyoruz** | `consent.rules.ts:10-13`, `fal.ts:33-36`            |

Veri işleyen sağlayıcı seçmez, saklama süresi belirlemez. "Marka sorumlu, biz
işleyeniz" konumu bu mimariyle **savunulamaz**. Rol tersine dönmesi yalnızca
marka kendi ürününü kendi kararıyla işlettiğinde geçerli olurdu — Faz 1'de öyle
bir şey yok, ürün bizim kataloğumuzdan geliyor.

**Bunun bedeli değil kazancı var.** `kvkk-veri-akisi.md:18` ve `:105` bugün
açık: yurt dışı aktarım mekanizması **henüz seçilmemiş** (`[ ]`). Rol
devredilseydi bu, **her müşterinin kendi hukuk ekibinden ABD'ye fotoğraf
aktarımı için ayrı onay alması** demek olurdu — kurumsal Türk perakendecisinde
haftalar süren, bazı müşterileri tamamen eleyen bir satış engeli. Sorumlu biz
kalırsak bu tek bir iç sorundur ve **bir kez** çözülür.

### Üç somut kilit

**1. Fotoğraf markanın DOM'una hiç girmez.** iframe kararının hukuki yarısı
budur. Rıza ekranı bizim kökenimizde, bizim aydınlatma metnimizle, bugünkü
`riza-modallari.tsx` aynen kullanılarak. Marka ne sorumlu ne işleyen —
**yönlendiren**; sözleşmede tek cümleyle kurulur.

**2. `ConsentRecord` şeması değişir, ama minimum.** Doğrulandı (şema 189-206):
`userId String` — nullable **değil** — ve `User`'a `onDelete: Cascade`. Widget
ziyaretçisinin `User` satırı yok.

- ❌ Her ziyaretçi için gölge `User` açmak — pazaryeri kimlik tablosunu kirletir,
  hesap silme akışını bozar.
- ✅ `userId` nullable + `orgId` + `subjectRef` (takma oturum kimliği).
- ⚠️ `ConsentRecord` "APPEND-ONLY / kalıcı" belgelenmiş (şema 186-188). Nullable
  kolon eklemek güvenli; **var olan FK'yi gevşetmek migration ister** — mevcut
  satırlar etkilenmez ama uygulama katmanındaki "userId her zaman var"
  varsayımları taranmalı. `TryOnJob.userId` **zaten `String?` ve `sessionId
String?` mevcut** (şema 1210-1211) — misafir yolu orada kısmen modellenmiş;
  asıl kilit tek başına `ConsentRecord`.

**3. `MODEL_TRAINING` rızası B2B'de toplanmaz — bayrağı bile olmaz.** Kiracı
verisinde model eğitimi sözleşmeyle yasak, kodda yok. `Organization` üzerinde
bir bayrak **konulmaz**; bayrak varsa bir gün açılır.

### ⚠️ Bugün pazaryerini de vuran, kimsenin sıraya koymadığı blokaj

`(magaza)/legal/metinler.ts:38,44` — hukuki metinler **"henüz yayınlanmadı"**.
`ConsentRecord.documentVersion` ise zorunlu alan ve "onaylanan aydınlatma
metninin sürümü"nü tutuyor. Yani **bugün kaydedilen her rıza, var olmayan bir
metne atıf yapıyor.** Bu B2B'nin değil canlının sorunudur ve widget'tan önce
kapatılmalıdır — bir marka müşterisine aydınlatma metni olmayan bir rıza akışı
gösterilemez.

### Sözleşme seti — dört değil, iki

Rol devri yapılmadığı için:

1. **Mevcut satıcı sözleşmesine widget eki** — kapsam, kredi birimi (önbellek
   isabeti dahil), fesih, "veri sorumlusu platformdur" beyanı, ihlal bildirim süresi.
2. **Alt işleyen listesi eki** — fal.ai / Anthropic / Google, ülkeleri,
   değişiklik bildirim süresi. ⚠️ Bilerek kabul edilen yan etki: sağlayıcı
   değiştirdiğimizde markanın itiraz hakkı doğar, yani `tryon.factory.ts`
   zincirini **sessizce değiştiremeyiz**.

Yaş doğrulaması bugün pazaryerinde de yok, widget'ta hiç sinyal yok —
**teknik olarak uygulanmadığı sözleşmede açıkça yazılır**, sessizce geçilmez.

**Belge kararı:** `docs/kvkk-veri-akisi.md` silinmez; yanına
`docs/kvkk-widget-veri-akisi.md` gelir. İki akış aynı anda yaşayacak, tek
belgede anlatmak "şu an hangi durumdayız" sorusunu her paragrafta sordurur.

---

## 6. MVP kapsamı — 8 madde, fazlası yok

**Vaat, tek cümle:** _"Kendi sitenize bir `<script>` yapıştırın; ziyaretçiniz
fotoğrafını yükler, **sizin pazaryerindeki ürününüzde** kendini görür, satın
almak için ürün sayfasına gelir. Deneme başına ödersiniz."_

**Müşteri:** zaten pazaryerinde satan, onaylanmış bir satıcı. İlk üçü elle onboard edilir.

| #   | İş                                                                                                                            | Neden bu, neden şimdi                                                                                                                                                                                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | **TLS + üretim modu**                                                                                                         | ⚠️ Ön koşul, madde değil. `infra/nginx/vt.conf:16` tek dinleyici `listen 80`; dosyanın kendi yorumu (`:86`) "TLS YOK — gerçek kullanıcı alınmadan önce kapatılması zorunlu" diyor. Token'ı HTTP'den geçirmek onu dağıtmaktır. Ayrıca sunucu **üretim modunda hiç çalışmadı** (`vt-api`/`vt-worker` bugün staging) |
| 1   | **`AiUsageLog.orgId` + bütçe ayrımı**                                                                                         | İlk B2B çağrısından önce **zorunlu**. Olmadan ödeyen müşteri pazaryerinin AI'ını kapatır (§4.3)                                                                                                                                                                                                                   |
| 2   | **`x-fal-billable-units` başlığını oku**                                                                                      | Fiyat konuşmasının ön koşulu. `http.ts` başlığı zaten döndürüyor, `fal.ts:123` atıyor                                                                                                                                                                                                                             |
| 3   | **`Organization` + `OrganizationApiKey` + `OrganizationOrigin`**                                                              | 3 tablo, `Seller`'a dokunmadan. Faz 1'de `sellerId` zorunlu                                                                                                                                                                                                                                                       |
| 4   | **`ApiKeyGuard` + `WidgetSessionGuard`**, ayrı rota önekleri                                                                  | `JwtAuthGuard` değişmez — değişirse ~116 uç API anahtarına açılır                                                                                                                                                                                                                                                 |
| 5   | **`OrganizationCreditEntry`** + kiracı bazlı kota/bütçe kapısı                                                                | Append-only defter; kota `orgId` bazlı sayar (bugün `userId` bazlı → widget'ta hiç işlemez)                                                                                                                                                                                                                       |
| 6   | **`ConsentRecord.userId` nullable + `orgId` + `subjectRef`**                                                                  | Tek zorunlu canlı-tablo migration'ı. Hukuki metinlerin yayınlanması bu maddenin parçasıdır                                                                                                                                                                                                                        |
| 7   | **Katalogda `storeSlug`/`sellerId` filtresi** + `/magaza/[slug]` vitrini                                                      | Widget "sadece bu satıcının ürünleri" diyemiyor. Vitrin sayfası zaten eksik (`urun/[slug]/page.tsx:58-59` bilerek bağlantısız)                                                                                                                                                                                    |
| 8   | **Widget** — script → iframe, `data-pk` + `data-variant-id`. Rıza → foto → yokla → sonuç + filigran + `GET /v1/partner/usage` | Fotoğraf akışı için **R2 CORS önce düzeltilir** (`infra/R2-CORS.md`: OPTIONS 403, jetonda `PutBucketCors` yok) — bugün deneme akışı tarayıcıda ilk adımda kırık                                                                                                                                                   |

**Efor tahmini verilmiyor.** Ölçülebilen: 8 maddenin 4'ü şema migration'ı
içeriyor, biri (`ConsentRecord.userId`) canlı tabloda. 1261 birim testi + 45 E2E
bulunan bir sistemde iş yükünün büyük kısmı yeni kod değil, bu migration'ların
**test yükü** olacaktır.

---

## 7. ERTELENENLER — ve neden

> Bu depoda en çok işe yarayan şey, yapılmayanın gerekçesinin yazılı olması oldu.

| Ertelenen                                                                                                     | Faz    | Neden                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Kataloğumuz dışındaki markaya satış** (`partnerGarmentUrl`, `TryOnJob.variantId` nullable, gölge `Variant`) | 5      | Getirdiği yük: canlı migration + arama indeksi kirlenmesi + partner görselinde bilinmeyen başarısızlık oranı + KVKK rol devri + 4 belgelik sözleşme seti. Faz 1'de **hiçbirine gerek yok** (§3.4)                                                                                                                                                                                                                                        |
| **Self-servis kayıt**                                                                                         | —      | İlk 3 müşteri elle. Sözleşme eki imzalanmadan kimse fotoğraf işleyemeyeceğine göre self-servis zaten anlamsız                                                                                                                                                                                                                                                                                                                            |
| **Otomatik faturalama, `Plan`/`Subscription`/`Invoice`**                                                      | —      | Fatura elle kesilir. Müşteriyi bulmadan altyapı yazmak                                                                                                                                                                                                                                                                                                                                                                                   |
| **Widget'ta çoklu parça / kombin**                                                                            | 6      | Tek ürün satılabilir olmadan çoklu ürün satılamaz                                                                                                                                                                                                                                                                                                                                                                                        |
| **Widget'ta "Satın Al" markanın kendi sitesine**                                                              | 6      | ⚠️ "Müşteri platforma aittir" kararını bozar. Ticari karar, **sessizce açılmaz**                                                                                                                                                                                                                                                                                                                                                         |
| **Stylist / doğal dilde arama / AI Studio**                                                                   | 6      | Her biri ayrı sözleşme eki, ayrı maliyet modeli, ayrı kalite eşiği ister                                                                                                                                                                                                                                                                                                                                                                 |
| **Video try-on**                                                                                              | —      | ⚠️ Şart **üç ayrı yerden** karşılanmıyor: `FAL_VIDEO_TRYON_MICRO_USD_PER_SECOND = {}` boş tablo (fiyat alınmamış), `FAL_VIDEO_TRYON_MODEL` varsayılanı boş (model seçilmemiş), `AiFeature`'da `VIDEO_TRYON` **yok** — migration yazılmış ama `migrations-pending/` altında, uygulanmamış. Bugün açılsa harcama kendi kovasına yazılamaz. Filigran da uygulanmamış. **Karar korunuyor**                                                   |
| **Ayakkabı / takı / çanta**                                                                                   | —      | Sağlayıcıda model yok. ⚠️ DRESSX'in `/vto/vto-for-shoes`, `/vto/vto-for-jewelry` sayfaları **var** ve iddialı, ama canlı widget bundle'ında bu kategoriler için **tek uç yok** — gönderilen alanlar `garment_front_url`/`garment_back_url`, kategori `"Ready-To-Wear"`, her sayfanın tek çağrısı "CONTACT US". Sektör lideri bile pazarlama sayfası ile API ucu farkını istismar ediyor. **`docs/tryon-kategori-destegi.md` değişmiyor** |
| **RLS / şema-başına-kiracı**                                                                                  | 4 sonu | Sorgu düzeyi + Prisma extension yeterli (§3.5). Sözleşmede talep eden çıkarsa değerlendirilir                                                                                                                                                                                                                                                                                                                                            |
| **Kiracı içi ekip/davet yönetimi**                                                                            | —      | `OrganizationUser` tablosu şimdi açılır, arayüzü sonra                                                                                                                                                                                                                                                                                                                                                                                   |
| **Beyaz etiket alan adı, kiracıya özel prompt**                                                               | —      | Talep gelmeden yazılmaz                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **SLA taahhüdü, durum sayfası**                                                                               | —      | Ölçülmeyen SLA sahte güvencedir. Sözleşmede "ticari makul çaba"                                                                                                                                                                                                                                                                                                                                                                          |
| **Embedding ve `TAGGING`/`DESCRIPTION`/`MODERATION` bağlanması**                                              | —      | Ayrı iş. Ama ⚠️ **"benzer ürünler" özelliğinin sessizce boş döndüğü bilinerek** satışa çıkılır (§2)                                                                                                                                                                                                                                                                                                                                      |

---

## 8. Yol haritası

### Faz 0 — Kanamayı durdur _(ön koşul: yok)_

Widget'ı 30 KB'a indirmek, oturumu taşıyamıyorsan işe yaramaz. Sıra bu yüzden
altyapıdan başlıyor.

- **TLS + gerçek üretim modu.** `listen 80` kapanır. Sunucu bugün `staging` ile
  çalışıyor; `production`'a alındığında API açılmamıştı — bu **ölçülmemiş bir
  arıza**, çözülene kadar hiçbir B2B konuşması yapılamaz.
- **R2 CORS düzeltilir.** Bugün tarayıcıdan fotoğraf `PUT`'u 403; "üzerimde
  dene" akışı **canlıda kırık**. Widget'tan önce, pazaryeri için.
- **Hukuki metinler yayınlanır.** `documentVersion` var olmayan bir belgeye atıf
  yapmayı bırakır.

**Çıktı:** kendi ürünümüzün çalıştığı, gösterilebilir bir ortam. **Bu faz
atlanamaz** — satılacak şey bugün kendi sitemizde tamamlanamıyor.

### Faz 1 — Ölçüm _(ön koşul: Faz 0)_

- `x-fal-billable-units` okunur → `costBasis` `PROVIDER_USAGE` olur.
- `AiUsageLog.orgId` eklenir, platform bütçesi `orgId: null` filtreler, ölü
  `sellerId` temizlenir, `[orgId, createdAt]` indeksi konur.
- **Kısmi önbellek yeniden kullanımı deftere yazılır.** Bugün `cacheHit` yalnızca
  **tam** isabette `true`; 5 parçalı kombinde 4 katman hazır olsa bile worker
  `cacheHit: false` yazıyor ve `reusedStepCount` yanıtta taşınıp **deftere
  girmiyor**. Kombindeki en büyük tasarruf kaleminin sayısı elimizde yok — satış
  argümanı yapılmadan önce kapatılacak.
- **`.env` / doküman çelişkisi kapatılır:** ya FASHN'a geçilip `ai-cost.ts`
  tablosuna $0,075 yazılır, ya doküman `idm-vton`'a göre düzeltilir. Bugünkü
  hâlde FASHN'a geçiş **her üretimde %25 eksik defter** demektir, hem de hata
  vermeden.
- **Kalite ölçümü:** 30 ürün × 10 kişi, ort. ≥3,5/5
  (`ozellik-yol-haritasi.md:62` — henüz yapılmadı).

**Çıktı:** gerçek birim maliyet, gerçek önbellek isabeti, gerçek kalite skoru.
**Fiyat ancak burada konuşulur.**

### Faz 2 — Kiracı iskeleti _(ön koşul: Faz 1'in maliyet ölçümü)_

`Organization` + `OrganizationApiKey` + `OrganizationOrigin` +
`OrganizationCreditEntry`; `ApiKeyGuard` + `WidgetSessionGuard` ayrı rota
önekleri altında; `@OrgScoped()` + Prisma extension; depolama öneki
`orgs/{orgId}/…`; katalogda `storeSlug` filtresi + `/magaza/[slug]` vitrini;
`ConsentRecord` migration'ı.

**Çıktı:** dışarıya hiçbir şey açılmadan yalıtım ve defter hazır. Ön koşulunun
maliyet ölçümü olması **bilinçli** — kredi biriminin fiyatı bilinmeden defter
tasarımı doğrulanamaz.

### Faz 3 — Widget, tek satıcıyla _(ön koşul: Faz 2 + gönüllü satıcı + hukukçu görüşü)_

Tek dosya taşıyıcı script → iframe. Rıza, foto, yokla, sonuç, filigran.
`GET /v1/partner/usage`. Fatura elle.

**Paket hedefi 30–50 KB gzip.** Bugünkü `/urun/[slug]/dene` ilk yükü **197,9 KB
gzip** (polyfill'le 236,4) — hedefin 4-6 katı.

| Kalem                     | gzip        | Durum                                                                                                                                                         |
| ------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App Router çalışma zamanı | ~113 KB     | Bedava düşer — widget zaten sayfa değil                                                                                                                       |
| Polyfill                  | 38,5 KB     | Bedava düşer — `type=module` ile                                                                                                                              |
| `react-dom`               | **92,5 KB** | ⚠️ Kalan tek büyük kalem. Preact/compat'a inmeden hedef banda girilemez ve `@radix-ui/react-dialog` uyumu **ölçülmedi** (derleme gerekiyordu, bu tur yasaktı) |

`@radix-ui/react-dialog` **çıkarılmaz** — rıza modalı odak tuzağı ve doğru
`aria` isteyen **hukuki bir bileşendir**; elle yazılan modal bunu kaybeder.

**Çıktı:** bir satıcının kendi sitesinde çalışan deneme; ilk gerçek B2B kullanım verisi.

### Faz 4 — İkinci ve üçüncü satıcı _(ön koşul: Faz 3'ün ölçümü)_

Faz 3'ün üç bilinmeyeni burada sayıya döner: rıza akışının vazgeçme oranı,
widget önbellek isabeti, satıcı başına onboarding saati. **Fiyat tablosu burada
yazılır, önce değil.** RLS bu fazın sonunda değerlendirilir.

### Faz 5 — Dış marka _(ön koşul: Faz 4 + yurt dışı aktarım mekanizmasının çözülmesi)_

`partnerGarmentUrl`, `TryOnJob.variantId` nullable, önbellek anahtarına `orgId`,
KVKK rol devri, 4 belgelik sözleşme seti. Ön koşulu ağır çünkü burada veri
sorumlusu markaya geçer ve her müşteri kendi hukuk turunu yaşar.

⚠️ **Bu fazın gerçek tetikleyicisi fiyat değil KVKK olabilir.** Kendi model
barındırma (MEMORY: RunPod, trafik verisine ertelendi) bugünkü bütçe zarfında
**matematiksel olarak kazanamaz**: A100 7/24 ≈ $1.015/ay, %25 doluluk
varsayımıyla başabaş ≈ 54.000 üretim/ay; günlük tavanımız ise en fazla ~666
üretim. Ama her try-on bugün **yurt dışına aktarımdır** ve Türk markalarına
satarken bu, birim maliyet farkından pahalı bir itiraz olabilir. Yani AB/TR
barındırma kararı **hacim eşiğini beklemeden** tetiklenebilir. Tetiklenirse doğru
ilk adım kalıcı pod değil **serverless**'tır — doluluk varsayımını hesaptan
çıkarır; ölçülecek tek şey soğuk başlangıcın FAST modun 25 sn bütçesine sığıp
sığmadığıdır.

### Faz 6 — Ticari genişleme _(ön koşul: talep)_

"Satın Al markanın sitesinde kalsın" (⚠️ "müşteri platforma aittir" kararını
bozar — bilinçli ve ayrı bir karar), widget'ta kombin, stylist'in B2B ürünü
olarak paketlenmesi, beyaz etiket.

---

## 9. Riskler — üçü de ölçülmemiş, hiçbiri teknik değil

### 9.1 Rıza akışının dönüşüm bedeli — planın ticari değerini tek başına belirliyor

Fotoğraf yüklemeden **önce** iki zorunlu onay (`PHOTO_PROCESSING` +
`CROSS_BORDER_TRANSFER`) + aydınlatma metni bağlantısı gösterilecek.
Pazaryerinde kabul edilebilir çünkü kullanıcı zaten üye oluyordu. Satıcının
vitrininde, ürün sayfasında, bu sürtünmenin **çoğunu** oluşturabilir.

Kaç ziyaretçinin vazgeçtiğine dair **hiçbir verimiz yok**. Vazgeçme %70 ise
satıcı ikinci ay yenilemez; kredi paketi satılmış olsa bile ürün ölür.

⚠️ Buna bağlı ikinci bilinmeyen: anonim ziyaretçiden alınan açık rızanın özel
nitelikli veri için **ispat gücü**. Cevap "yetersiz" ise ziyaretçinin iframe
içinde hesap açması şart koşulur ve sürtünme bir kat daha artar. Faz 1'de bu
planı **durdurmaz** (geri çekilme yeri hazır, §10), ama **Faz 5'te dış markaya
satışı tamamen imkânsız kılabilir.**

**Ölçüm yolu:** Faz 3'te tek satıcıda, widget açılışı → rıza onayı → fotoğraf
yüklendi hunisini logla. Fiyat tablosunu bu sayı gelmeden yazma.

### 9.2 Defterdeki her sayı bugün varsayım

Üç bağımsız ölçüm boşluğu üst üste biniyor (§4): birim maliyet ölçüm değil
sabit; üç farklı rakam dolaşıyor; kısmi önbellek tasarrufu görünmüyor.

Üçü de **küçük** düzeltmeler. Tehlike büyüklüklerinde değil **sessizliklerinde**:
FASHN'a geçildiği an fiyat farkı hata vermeden %25 eksik yazılır, aylık $1.200
bütçe gerçekte $1.500 harcamayı örter ve fark ancak sağlayıcı faturası gelince
görülür.

### 9.3 Müşteri başına opex — küçük müşteri her ihtimalde zarar

Fiyattan bağımsız ve fiyatla çözülemeyen risk. Her müşteri için manuel iş:
sözleşme eki, DPA görüşmesi, `OrganizationOrigin` kaydı, R2 CORS satırı, anahtar
teslimi, entegrasyon desteği, elle fatura.

Otomatikleşmediğine dair kanıt: **DRESSX bile elle onboard ediyor** — canlı
Victoria Beckham ürün sayfasında `loader_vb_test.js`, uçlar
`tryons_create_vb_ai` / `vb_ai_predict_get` diye müşteriye özel isimlendirilmiş,
resmî vaka çalışması sayısı **4**. Sektör lideri kendi vitrin müşterisinde bile
tekilleştirilmiş kod tutuyor.

⚠️ Ürüne dönen sonucu: 1.000 denemelik bir müşteri, birim maliyet ne olursa
olsun, aylık taban ücret olmadan **zarardır**. Self-servis kayıt isteği
geldiğinde hatırlanacak şey: otomatikleştirilecek olan kod değil, **hukuk ve
destek**.

### 9.4 Kayıt için — bu turda ölçülmeyenler

- **Canlıdaki hiçbir gerçek sayı görülmedi.** `AiUsageLog`'da kaç satır var,
  isabet oranı kaç, `latencyMs` dağılımı ne — hiçbiri sorgulanmadı (tur
  salt-okunur). Sorgulansaydı bile o satırlardaki maliyetler `MODEL_ESTIMATE`,
  yani ölçüm değil varsayım okunmuş olurdu.
- **Preact/compat + `@radix-ui/react-dialog` uyumu doğrulanmadı**; 92,5 KB
  gzip'lik kazanç buna bağlı ve derleme gerektiriyor.
- **DRESSX'in gerçek gelirinin hangi taraftan geldiği bilinmiyor.** Forbes (Nisan 2026) "toplam 23.000 try-on", kendi VTO raporları "1,2 milyon alışverişçi"
  diyor — ikisi yan yana duramaz. Gelirin çoğu hâlâ metaverse/avatar
  lisanslamasındansa (Roblox, Bitmoji, Meta), B2B AI Suite **satılmış bir ürün
  değil satılmaya çalışılan bir vitrindir**; 4 vaka çalışması ve canlıdaki
  `_vb_test` bu yönü destekliyor. O senaryoda yol haritamızı onlara göre kurmak
  hata olurdu — **bu yüzden yukarıdaki plan onların ürün listesini değil, kendi
  ölçümlerimizi ve kendi satıcı tabanımızı takip ediyor.**
- Onların yayınladığı hiçbir rakam bağımsız doğrulanmadı ve kendi içinde
  tutarsız: "certainty in fit" %75/%89/%91; dönüşüm 3,2×/%40/%50/10×; iade
  %30/%40 azalma — aynı şirketin farklı sayfalarında. **Bizim 30 ürün × 10 kişi,
  ort. ≥3,5/5 eşiğimiz bunların hiçbirinden zayıf değil.**

---

## 10. AÇIK SORULAR — karar bekleyenler

| #   | Soru                                                                                                                                                                                      | Kim karar verir            | Beklerse ne olur                                                                                                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Anonim ziyaretçiden alınan açık rıza, özel nitelikli veri için ispat gücü taşır mı?** Çerez tabanlı takma kimlikle tutulan kayıt ihtilafta yeterli mi? Bilmiyoruz ve tahmin etmeyeceğiz | Hukukçu                    | Faz 1'i **durdurmaz** — cevap "hayır" ise ziyaretçi iframe içinde bizim hesabımıza giriş yapar; kendi satıcımızın vitrininde hesap zaten işe yarar çünkü sipariş bizde tamamlanacak. ⚠️ Faz 5'i (dış marka) **durdurur** |
| 2   | **FASHN mi `idm-vton` mu?** `.env:54` `idm-vton` diyor, `tryon-kategori-destegi.md` gerekçesini FASHN v1.6 ile yazıyor                                                                    | Ürün + teknik              | Faz 1'i bloklar. Karar verilmezse ya kategori doktrini dayanaksız kalır ya defter %25 sapar                                                                                                                              |
| 3   | **Yurt dışı aktarım mekanizması** (`kvkk-veri-akisi.md:18,105` — `[ ]` işaretli)                                                                                                          | Hukukçu                    | Faz 1-4 bugünkü akışla yürür (sorumlu biziz). Faz 5'in **sert ön koşulu**                                                                                                                                                |
| 4   | **AB/TR barındırma hacim eşiğini beklemeden tetiklenecek mi?** Matematik "hayır" diyor (§8 Faz 5), KVKK itirazı "belki" diyebilir                                                         | Ürün sahibi                | Ertelenirse Faz 5'te satış itirazı olarak geri gelir                                                                                                                                                                     |
| 5   | **İlk gönüllü satıcı kim?** Faz 3'ün ön koşulu ve kimse görevlendirilmedi                                                                                                                 | Ürün sahibi                | Faz 2 biter, Faz 3 başlayamaz                                                                                                                                                                                            |
| 6   | **Aylık taban ücret ne kadar?** Formül var (§4.4), rakam yok — birim ölçümü gelmeden yazılamaz                                                                                            | Ürün sahibi, Faz 1 sonrası | Fiyatsız satış görüşmesi yapılamaz                                                                                                                                                                                       |
| 7   | **"Satın Al" düğmesinin markanın sitesinde kalması** talebi geldiğinde ne denecek? Bu "müşteri platforma aittir" kararını bozar                                                           | Ürün sahibi                | Karar yazılı değilse ilk satış görüşmesinde doğaçlama verilir — bu depoda en pahalı hata tipi                                                                                                                            |
| 8   | **Preact/compat'a inilecek mi?** 92,5 KB gzip buna bağlı, `@radix-ui/react-dialog` uyumu ölçülmedi                                                                                        | Teknik, Faz 3'te ölçümle   | Ölçülmezse 30-50 KB hedefi tutmaz ve hedef sessizce terk edilir                                                                                                                                                          |
