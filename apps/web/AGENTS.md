<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# apps/web — ekran yazarken uyulacak kurallar

> Yukarıdaki blok Next'in kendi ürettiği ve `next dev` çalıştıkça geri yazdığı
> bir bloktur; SİLMEYİN. Aşağısı bu depoya aittir.
>
> Kod yorumları **Türkçe** ve **NEDEN** yazar, NE yazmaz. `⚠️` yalnızca gerçek
> bir tuzağı işaretler.

---

## 0. Paylaşılan dosyalar — önce buraya bakın

Beş ekran paralel yazıldı ve her biri kendi klasöründe kalarak "bunu paylaşılana
taşıyın" notu bıraktı. Taşımalar yapıldı. **Yeni bir ekran yazarken aşağıdaki
listeyi okumadan hiçbir yardımcı yeniden yazılmaz** — bu depoda iki kopyanın
ayrışması teorik değil, ÖLÇÜLMÜŞ bir olay (ürün kartının bir kopyasında
`flex-wrap` düzeltmesi vardı, diğerinde yoktu).

| İhtiyaç                                       | Tek yer                                                    |
| --------------------------------------------- | ---------------------------------------------------------- |
| Para gösterimi                                | `components/fiyat/fiyat.tsx`                               |
| Para okuma / "sıfırdan büyük mü"              | `lib/money.ts` (`readMinor`, `formatMinor`, `paraPozitif`) |
| Ürün kartı / ızgara / boş sonuç               | `components/urun/`                                         |
| Genel (kimliksiz) sunucu isteği               | `lib/api/server.ts` → `serverFetch`                        |
| **Kimlikli** Sunucu Bileşeni isteği           | `lib/api/server-authed.ts` (`kimligiCoz`, `hesapFetch`)    |
| Vekil (tarayıcıdan gelen her kimlikli istek)  | `lib/api/proxy.ts`                                         |
| Hata kodu → yeniden deneme davranışı          | `lib/api/retry-policy.ts`                                  |
| Hata kodu → hangi alanın altına basılır       | `lib/api/hata-kapsami.ts`                                  |
| Sunucu hatasını istemciye taşıma              | `components/hata/hata-koprusu.ts` + `sunucu-hatasi.tsx`    |
| Hata gösterimi                                | `components/hata/hata-gosterimi.tsx`                       |
| 404 gövdesi                                   | `components/hata/bulunamadi.tsx`                           |
| Tarih biçimi (sabit `Europe/Istanbul`)        | `lib/tarih.ts`                                             |
| `?next=` temizleme (açık yönlendirme kapısı)  | `lib/donus-yolu.ts`                                        |
| Bekleyen ödeme (sunucu tarafı akış durumu)    | `lib/session/bekleyen-odeme.ts`                            |
| Tel tipleri                                   | `@vt/contracts` → `wire/`                                  |
| Tarayıcıda kullanılacak sabitler              | `@vt/config/constants` (⚠️ kökten DEĞİL)                   |
| **Kullanıcının yazdığı** tutar gösterimi      | `components/fiyat/tutar.tsx` (⚠️ `<Fiyat>` DEĞİL — §3)     |
| Metin → tam sayı (tutar / adet / yüzde)       | `lib/sayi.ts` (`kurusCoz`, `adetCoz`, `yuzdeCoz`)          |
| Para OLMAYAN sayı biçimi (bps, oran, µUSD)    | `lib/sayi-bicim.ts`                                        |
| Kategori ağacı çekme / arama                  | `lib/kategori.ts`                                          |
| URL sorgusu okuma / bağlantı üretme           | `lib/sorgu.ts` (`tekil`, `baglanti`)                       |
| Durum → etiket + rozet rengi                  | `lib/durum-etiketleri.ts`                                  |
| Sanal deneme kategori etiketleri              | `components/tryon/kategori-etiketleri.ts`                  |
| Try-on uygunluk önerisi ve eşiği              | `components/tryon/tryon-oneriler.ts`                       |
| Hata `details`inden tutar okuma               | `lib/api/hata-tutari.ts`                                   |
| **Panel** okuması (`Okuma<T>`, liste/tekil)   | `lib/api/okuma.ts`                                         |
| **Panel** iskeleti (başlık, sekme, sayfalama) | `components/panel/duzen.tsx`                               |
| **Panel** sol menüsü                          | `components/panel/yan-menu.tsx`                            |
| **Panel** karar formu (onay/ret + gerekçe)    | `components/panel/karar-kutusu.tsx`                        |

⚠️ `app/**/_lib/` ve `_bilesenler/` klasörleri **o ekrana özgü** şeyler
içindir. İkinci bir ekran aynı şeye ihtiyaç duyduğu anda dosya yukarıdaki
tabloya taşınır; ikinci kopya yazılmaz.

⚠️ **BU TABLONUN ALT YARISI BİR BÜTÜNLEME TURUNUN ÜRÜNÜ, ve neyin yanlış
gittiğini bilmek onu tekrarlamamanın tek yolu.** Dört ajan paralel panel yazdı,
dördü de kendi klasöründe kaldı, dördü de "paylaşılana taşıyın" notu bıraktı.
Ortaya çıkan ayrışmalar teorik değildi:

- Aynı uç için **iki tip**: `SellerPackageSummaryWire` ↔ `SaticiPaketOzetiWire`,
  `SellerBalanceWire` ↔ `SaticiBakiyeWire`.
- **Farklı uçlar için aynı ad**: `PayoutTalebiWire` hem satıcının talep yanıtı
  hem yönetimin payout kuyruk satırıydı — şekilleri farklı.
- Aynı işi yapan **iki `Okuma<T>`**: `{ok, veri, govde}` ↔ `{tamam, veri, hata}`.
  Derleme kırılmıyor; yalnızca `if` yanlış dala giriyordu.
- Sekmelerin **üç ayrı görünümü** (dolgulu hap · alt çizgi · düz liste) ve
  sayfalamanın **iki ayrı metni** ("Sonraki sayfa" ↔ "Daha eski hareketler").
- Aynı oran **iki farklı biçimde**: kuponlarda `%10`, komisyon tablosunda
  `%10,00` — iki ayrı bps çeviricisi.
- Aynı sekiz kategori etiketi **dört yerde**.
- Aynı try-on eşiği (60) **üç yerde**: backend sabiti, `TRYON_ESIK`,
  `TRYON_UYGUNLUK_ESIGI`. Artık `@vt/config` → `TRYON.minProductReadinessScore`.

Hepsi tek yere indirildi, kopyalar SİLİNDİ.

⚠️ **KOPYA İLE KARŞILIK AYNI ŞEY DEĞİLDİR** — ve bu ayrım tabloyu okurken en
kolay kaçırılan şey. `AWAITING_APPROVAL` müşteriye "Satıcı onayı bekleniyor",
satıcıya "Onayınız bekleniyor"dur; `REQUESTED` satıcıya "Talep alındı" (bilgi),
yöneticiye "Karar bekliyor" (İŞ). Bunları tek tabloya indirmek, kime
seslendiğini bilmeyen bir ekran üretir. Bu yüzden müşteri dilindeki tablolar
`lib/durum-etiketleri.ts`te, satıcı/yönetim dilindekiler kendi `_lib`lerinde —
ve **hepsi aynı wire enum'ıyla `satisfies` ile kapalı**, yani sunucuya yeni bir
durum eklendiğinde hepsi birden derlemeyi kırar.

---

## 1. Veri nereden gelir

| Uç türü                                   | Yol                                         | Dosya                           |
| ----------------------------------------- | ------------------------------------------- | ------------------------------- |
| Genel, önbelleklenebilir (ürün, kategori) | Sunucu Bileşeni → **doğrudan API**          | `lib/api/server.ts`             |
| Kimlikli, **Sunucu Bileşeninden**         | Sunucu Bileşeni → **doğrudan API + Bearer** | `lib/api/server-authed.ts`      |
| Kimlikli, **tarayıcıdan**                 | İstemci → **`/api/*` vekili**               | `lib/api/proxy.ts`, `client.ts` |

Kalıp örneği: **`app/(magaza)/products/page.tsx`**. Yeni sayfa yazmadan önce onu okuyun.

- ⚠️ Erişim jetonu `localStorage`/`sessionStorage`'a **yazılmaz**. Tarayıcı yalnızca
  üç opak httpOnly çerez görür: `vt_sid`, `vt_gid` (ve API tarafında `vt_rt`).
- ⚠️ **Vekil TARAYICININ kapısıdır, sunucunun değil.** Bir Sunucu Bileşeninden
  `/api/*`e HTTP atmak iki şeyi birden bozar: fazladan bir tur, ve vekilin
  `cookies().set()` ile ürettiği misafir kimliğinin tarayıcıya HİÇ ULAŞMAMASI
  (her SSR'da yeni `vt_gid`, hiçbiri yapışmaz, sepet her yenilemede boş görünür).
  Gerekçe `lib/api/server-authed.ts` başlığında.
- ⚠️ Hız limiti `scope:'ip'` olan uçlarda `serverFetch(..., { forwardClientIp: true })`
  kullanın. Unutulursa tüm ziyaretçiler API'de **tek kovaya** düşer.

### `server-authed.ts` içinde iki davranış var, karıştırmayın

- `hesapFetch(path, donusYolu)` → oturum yoksa **`/login`e yönlendirir**. Hesap,
  sipariş, gardırop, KVKK ekranları.
- `kimligiCoz()` + `kimlikBasliklari()` → ham kimlik. Misafirin de görebildiği
  kaynaklar (sepet, ödeme) bunu kullanır; girişe atmak, ürün eklemiş bir
  ziyaretçiyi sepetine bakmak istediği anda kaybetmek olurdu.

## 2. Zarf

Başarı: `{ data, meta: { requestId, nextCursor?, total? } }`
Hata: `{ error: { code, message, httpStatus, retryable, details?, requestId, retryAfterSeconds? } }`

- ⚠️ `nextCursor`/`total` **`meta` içindedir**, `data` içinde değil.
- ⚠️ Liste uçlarında `data` ya çıplak dizi ya nesnedir. İkisini de `list()` açar
  (`lib/api/core.ts`). Elle `data.items` okumayın.
- ⚠️ 204'ün gövdesi yoktur; `unwrap()` bunu ele alıyor, elle `res.json()` çağırmayın.

## 3. Para — üç kural

```
string (MinorString) → BigInt → biçim
```

1. Ekrana para yalnızca **`<Fiyat value={...} />`** ile çıkar (`components/fiyat`).
   Bileşen dönüşümü, `tabular-nums` sınıfını **ve** `flex-wrap`ı kendi taşır.
2. `Number()`, `parseInt()`, `+x` ile para okumak **lint hatası**dır.
3. Toplam/indirim frontend'de **hesaplanmaz** — sunucu `totalMinor` gönderiyor.

⚠️ **RSC sınırını yalnızca `MinorString` geçer.** `Money`/`bigint` prop olarak
İstemci Bileşenine verilmez (serileştirilemez). `@vt/config`'teki `10_000n` gibi
sabitler de öyle; gerekiyorsa sunucuda `.toString()`.

⚠️ Wire tipinde para alanının **adı değiştirilmez** (`totalMinor` → `total`
yapmak lint korumasını sessizce kapatır).

⚠️ **Kullanıcının yazdığı tutar para değildir.** `MinorString` markası "bu para
API yanıtından doğdu" güvencesidir; hesaplayıcı/filtre/payout girdilerine
`unsafeMinorString` ile marka basmak o güvenceyi bütün depo için deler.
Yol ikiye ayrılır ve **ikisi karıştırılmaz**:

```
API yanıtından gelen tutar   →  <Fiyat value={...Minor} />
kullanıcının yazdığı tutar   →  lib/sayi.ts (kurusCoz) → bigint → <Tutar minor={...} />
```

Her iki bileşen de `rakam` sınıfını KENDİ taşır; çağıran unutamaz.

⚠️ **Bu ayrım ters yönde de ihlal edilebilir ve edildi:** payout formu sunucudan
dönen `sonuc.amountMinor`ı elle `Money.formatMoney(...)` ile basıyordu — yani
telden gelen para için ekranda ikinci bir biçimleme yolu vardı. Kural tek
cümleyle: **telden gelen tutar `<Fiyat>`e, kullanıcının yazdığı `<Tutar>`a.**
`Money.formatMoney` çağrısı ekran kodunda HİÇ görünmez.

⚠️ Yüzde/oran/mikro-USD **para değildir** ve `<Fiyat>`e verilmez (`₺` ile
biçimlenip doğru görünen yanlış rakam üretir). Biçimleri `lib/sayi-bicim.ts`te;
`yuzdeBps` iki hane SABİT basar (`%10,00`) çünkü tabloda virgüller hizalanmalı.

## 4. Hata

- `error.message` **olduğu gibi** gösterilir. `<HataGosterimi error={...} />`.
- `error.code` yalnızca **davranış** seçer → `lib/api/retry-policy.ts`.
- Hatanın **yeri** de bilgidir → `lib/api/hata-kapsami.ts`
  (`satir | kupon | sepet | sayfa`). Sepette "en fazla 2 adet alabilirsiniz"
  cümlesi sayfa tepesinde hangi ürün olduğunu söylemez.
- ⚠️ `retryable === true`, "Tekrar dene düğmesi" **demek değildir**. Karar
  `retry-policy.ts`tedir; katalogda yeni kod açılırsa o dosya derlenmez.
- ⚠️ **DÖRT DAVRANIŞIN DÖRDÜNÜN DE BİR TÜKETİCİSİ VAR — ve olmak zorunda.**
  Bir süre yalnız ikisi uygulanmıştı (`dugme`, `geri-sayim`); `otomatik` ve
  `yonlendir` hiçbir yerde okunmuyordu. Sonucu somuttu: `PAYMENT_TIMEOUT`
  ("siparişlerinizi kontrol edin") ekranında ne bağlantı ne düğme vardı,
  `IDEMPOTENCY_IN_PROGRESS` ise iade formunda düğmesiz bir "lütfen bekleyin"
  cümlesiydi. Tip yeni kodda derlemeyi kırıyordu ama **davranışın var
  olmadığını hiçbir şey söylemiyordu**.
  - `yonlendir` → `HataGosterimi` katalogdaki `href` + `etiket` ile `<Link>`
    basar.
  - `otomatik` → `otomatikTekrarla()` ile **çağrı yerinde**; gösterici bunu
    yapamaz, çünkü güvenliğin şartı çağıranda: **aynı Idempotency-Key**.
    Denemeler tükenince `HataGosterimi` düğmeye düşer.
  - ⚠️ `otomatikTekrarla`ya verilen kapanışın içinde `newIdempotencyKey()`
    ÇAĞRILMAZ; anahtar sarmalayıcının DIŞINDA üretilir. Aksi hâlde tek bir
    hata üç ayrı iade/sipariş açar.
- ⚠️ Tek istisna `details.fields[].message`: Türkçe olmayabilir,
  `components/hata/alan-hatalari.ts` üzerinden eşlenir.
  ⚠️ **SIRA DÜZELTİLDİ (ölçüldü):** eşleme önce `rule` tablosuna bakıyordu ve
  sunucunun ÖZELLİKLE yazdığı Türkçe cümleyi çöpe atıyordu — gönderilen
  `{rule:'too_small', message:'Gerekçe en az 10 karakter olmalı.'}` ekranda
  "Girilen değer çok kısa." oluyordu, yani kaç karakter gerektiği kayboluyordu.
  Artık sunucu metni İngilizce Zod varsayılanı DEĞİLSE olduğu gibi kazanır;
  kural tablosu yalnızca varsayılan cümleler için yedektir.
- ⚠️ **`ApiFailure` RSC sınırından GEÇEMEZ** (sınıf örneği). Sunucu Bileşeninde
  yakalanan hatayı prop olarak vermek sayfanın tamamını düşürür — yani hatayı
  göstermeye çalışmak hatadan büyük bir hata üretir. Yol:
  `hataYuku(error)` → `<SunucuHatasi govde={...} />`.
- ⚠️ **`redirect()` VE `notFound()` HATA DEĞİLDİR — `hataYuku` onları yeniden
  fırlatır.** Next bu ikisini `throw` ile yapıyor; panel sayfaları veriyi
  `try/catch` içinde okuduğu için sinyal `catch`e düşüyordu ve oturumu düşmüş
  kullanıcı `/login` yerine "Beklenmeyen bir hata oluştu" kutusu görüyordu
  (o gün adres `/giris`ti; ölçüm kaydı olduğu için tarihlendirildi).
  Kapı tek yerde (`hata-koprusu.ts`, `digest` öneki kontrolü); her `catch`
  bloğuna ayrı yazılsaydı bir sonraki ekranda unutulurdu.
- Özel davranışlar: `CONSENT_REQUIRED` ve `CONSENT_CROSS_BORDER_REQUIRED`
  **ayrı** modallar.
- ⚠️ **`INSUFFICIENT_STOCK` DÜZELTMESİ (ölçüldü, eski kural yanlıştı):**
  reddedilen `PATCH` sepeti DEĞİŞTİRMEZ; yeniden çekilen sepette
  `issue=null, maxAvailable=null` gelir. Azami adet yalnızca **mesajın içinde**
  olduğu için mesaj olduğu gibi satıra basılır. `maxAvailable` yalnızca sepetin
  KENDİSİ bayatladığında dolar ve orada adet tavanını kısar.

## 5. Idempotency

- Anahtar **otomatik üretilmez**. `IdempotentPath` listesindeki bir yola
  `idempotencyKey` vermeden istek atmak **derlenmez**.
- Kullanıcı niyeti başına **bir kez** üretilir ve `useRef`te tutulur.
  ⚠️ `useState` değil: render sırasında yeni anahtar üretmek ikinci bir sipariş yaratır.
- ⚠️ Try-on **kombin yoklaması** her seferinde **yeni** anahtarla gider; sabit
  anahtar ilk `QUEUED` yanıtını 24 saat geri oynatır ve ekran sonsuza kadar bekler.
- ⚠️ `POST /v1/checkout/init` **idempotent DEĞİL** (ölçüldü: art arda iki çağrı
  iki sipariş + iki rezervasyon üretti). Koruma bugün tamamen frontend'de:
  bekleyen sipariş `lib/session/bekleyen-odeme.ts` ile sunucu tarafında,
  kimlik başına tutulur. O dosya silinirse F5'e basan her kullanıcı ikinci bir
  sipariş yaratır.

## 6. Try-on

- Yoklama için `components/tryon/use-tryon-job.ts` kullanılır, yeniden yazılmaz.
- ⚠️ Durum enum'ı **altı** değerli (`FAILED_PERMANENT` ve `CANCELLED` dahil).
  `switch`'i `assertNever` ile kapatın.
- ⚠️ `POST /tryon` önbellek isabetinde **200 + hazır sonuç** döner; dallanma
  HTTP koduyla değil **`cached` alanıyla** yapılır.
- İlerleme çubuğu **%95'te durur**; `estimatedSeconds` submit anında yakalanır.
- `FAILED` → "Tekrar dene" (**yeni** Idempotency-Key ile).
  `FAILED_PERMANENT` → "Başka fotoğraf yükle", tekrar dene **yok**.
- ⚠️ **Kapı iki yarımdır** ve `tryOnable` tek başına YETMEZ (ölçüldü: `BAG`
  kategorisindeki ürün `tryOnable:true` dönüyordu). İkinci yarı
  `isTryOnSupported(tryOnCategory)`. Liste kartında yalnız birinci yarı var, o
  yüzden orada **rozet** çıkar; **düğme** ürün detayında, iki yarı da
  kapandığında çıkar.

## 7. Görsel dil

- Palet **akromatik**; **renk yalnızca DURUM taşır** (`<Badge durum="...">`).
  Menü ikonu, başlık, sekme, kart kenarlığı renksizdir.
- ⚠️ "Durum" listesi `design-system.md`de yazılı ve DAR: sipariş durumu, satıcı
  onay durumu, payout durumu, try-on eşiği, stok uyarısı. **İndirim yüzdesi bu
  listede yok** — `<Fiyat>` içindeki `%23` bir zamanlar `text-tehlike` ile
  kırmızıydı ve düzeltildi: her kartta kırmızı bir yüzde varken kullanıcı
  gerçek uyarıyı ("Tükendi") ayırt edemez.
- İkonlar Lucide, 1.5px, metinden bir ton **soluk** (`text-ikon`). Tek istisna
  düğme içi ikonlar (düğme metniyle aynı renkte olmalı) ve durum ikonları.
- Ürün görseli **4:5** (`aspect-urun`), kenarlıksız, gölgesiz.
- ⚠️ **"Üzerimde Dene" ile "Sepete Ekle" aynı ağırlıkta** — ikisi de
  `<Button variant="birincil" size="lg" className="w-full">`. HTML'de sınıf
  dizgileri BİREBİR aynı olmalı; bu ölçülebilir bir kuraldır.
- ⚠️ **KOYU TEMA ARTIK KULLANICININ SEÇİMİ VE SİTE GENELİNDE GEÇERLİ.** Üç
  seçenek (`açık` / `koyu` / `sistem`, varsayılan `sistem`), çerez `vt_tema`,
  sınıf `<html>` üzerinde. Tek kaynak `src/lib/tema.ts`; anahtar
  `components/tema/tema-secici.tsx` (vitrin alt bilgisi + panel yan menüsü).
  `(yonetim)` artık zorunlu koyu DEĞİL ve yönetime özel varsayılan da YOK —
  gerekçesi `(yonetim)/layout.tsx` başlığında.
  ⚠️ **FOUC yasağı:** tema sınıfını `<body>`nin İLK ÇOCUĞU olan bloklayan bir
  satır içi betik yazar. Kök düzende `cookies()` **çağrılmaz** (§8'in statik
  rota kapısını düşürür) ve `sistem` sunucuda zaten çözülemez.
  **ÖLÇÜLDÜ** (üretim derlemesi, Chrome, x20 kısılmış CPU): 5 senaryoda da
  tema sınıfı FCP'den 40–60 ms ÖNCE uygulandı; ekran kaydında beyaz kare 0.
  Ölçümün duyarlı olduğu KONTROL KOŞUSUYLA kanıtlandı — betik HTML'den
  sökülünce aynı kayıt 4–5 beyaz kare gördü.
  ⚠️ DÜRÜST SINIR: **JS kapalıyken tema tercihi uygulanamaz**, sayfa açık
  varsayılanda çizilir. Sunucu tarafı bir yol bilinçli olarak yok.
  ⚠️ **PORTAL TUZAĞI KAPANDI (yapısal).** `Dialog`/`Sheet` içeriği hâlâ
  `document.body`ye taşınıyor ama tema `<html>` üzerinde olduğu için
  `document.body` zaten kapsamın İÇİNDE. `Portal`a `container` VERİLMEDİ
  (gerekçe `components/ui/dialog.tsx` başlığında). **ÖLÇÜLDÜ**: koyu temada
  açılan gerçek `Sheet` içeriğinin `backgroundColor` değeri `rgb(13, 14, 17)`.
  Sabit renk sınıfı (`bg-white`, `text-gray-*`, `bg-black/40`) HİÇ kullanılmaz —
  hepsi anlamsal token; modal perdesi `--perde`. Kapısı
  `src/lib/tema.test.ts` (sabit renk taraması + `tema-koyu` elle yazılamaz).
- ⚠️ **Öğe bütçesi**: ana sayfa 3 bölüm, ürün detay 3 blok. Dördüncü bir blok
  gerekiyorsa yeni bir EKRAN gerekiyordur, sıkıştırma değil.
- ⚠️ **Panel ekranı elle iskelet çizmez.** Sayfa başlığı, süzgeç sekmeleri, boş
  sonuç, özet şeridi ve sayfalama `components/panel/duzen.tsx`ten gelir. Bu bir
  üslup tercihi değil: dört ajan kendi iskeletini yazdığında sekmelerin üç ayrı
  görünümü oldu ve aynı panelde ekran değiştiren kullanıcı her seferinde başka
  bir uygulama kullandığını sandı. `OzetSeridi` tip düzeyinde **3 veya 4** kart
  dayatır (`design-system.md`); beşinciyi eklemek derlenmez.

## 8. `loading.tsx` ve 404 — birbirine bağlıdır

⚠️ **ÖLÇÜLDÜ: bir Suspense sınırının ardındaki `notFound()` HTTP 200 döner.**
Next kabuğu 200 ile hemen gönderilir ve durum kodu artık değiştirilemez.
Kullanıcı doğru ekranı görür; arama motoru uydurma her adresi indekslenebilir
bir sayfa sanır.

Kural: **`notFound()` çağıran bir rotanın üstünde `loading.tsx` olmaz.**
Bu yüzden `(magaza)/loading.tsx`, `product/[slug]/loading.tsx` ve
`product/[slug]/try-on/loading.tsx` silindi.

- 404 üretmeyen ekranlarda iskelet duruyor ve durmalı: `/products`, `/cart`,
  `/checkout`, `/account`, `/collection`, `/calculator`.
- 404 üreten bir rotada iskelet isteniyorsa yol `generateStaticParams` +
  `dynamicParams: false` (`collection/[koleksiyon]`, `legal/[belge]`).
  ⚠️ **VE O ROTADA `dynamic = 'force-dynamic'` YAZILMAZ.** `force-dynamic`
  `generateStaticParams`ı devre dışı bırakır, yönlendiricinin
  karşılaştıracağı slug listesi hiç oluşmaz ve kapı SESSİZCE düşer.
  `collection/[koleksiyon]` tam olarak bu yüzden aylarca 200 döndü. Belirti
  `next build` rota tablosunda görünür: kapı çalışıyorsa satır `●` (SSG),
  düşmüşse `ƒ` (Dynamic).
- `account/loading.tsx` bilerek duruyor: altındaki `orders/[siparisNo]`
  yumuşak 404 üretir ama o ekran girişin arkasında, indekslenmiyor.

⚠️ **HER 404 İDDİASI `next build && next start` ÜZERİNDE ÖLÇÜLÜR.**
`next dev` ölçümü KANIT DEĞİLDİR: `/koleksiyon/canta` dev'de 404, üretim
derlemesinde 200 dönüyordu ve bu fark bir ölçüm tablosunun tamamını
geçersiz kıldı.

**ÖLÇÜM (`next build && next start`, üretim derlemesi) — ROTA GÖÇÜ ÖNCESİ:**

```
/kategori/yok-boyle-kategori  404   /koleksiyon/canta      404
/urun/yok-boyle-urun          404   /koleksiyon/yok-boyle  404
/hukuki/yok                   404   /koleksiyon/xyz        404
/rastgele-adres               404   /magaza/atolye-nord    404
```

⚠️ **YUKARIDAKİ TABLO BİR KAYITTIR, ÇALIŞTIRILACAK BİR LİSTE DEĞİL** — ve bugün
tekrar çekilirse YANILTIR. Adresler o günden sonra İngilizceye taşındı; bu
adreslerin bugün 404 vermesinin sebebi `dynamicParams:false` kapısı DEĞİL,
rotanın hiç var olmamasıdır. Yani tablo bugün "geçiyor" gibi görünürken
aslında hiçbir şey ölçmez. Kapıyı bugün ölçmek için İngilizce karşılıkları
kullanın:

```
/category/yok-boyle-kategori  404   /collection/canta      404
/product/yok-boyle-urun       404   /collection/yok-boyle  404
/legal/yok                    404   /collection/xyz        404
/rastgele-adres               404
```

Göç 301/308 haritası **kurmadı** (tek istisna ödeme dönüş köprüsü,
`@vt/config` → `CHECKOUT_RESULT_LEGACY_PATH`): eski Türkçe adresler bilerek
yüksek sesle 404 verir. Ölü bağlantı kapısı `src/rota/rota-tablosu.test.ts`.

Beşi de aynı Türkçe ekranı, vitrin kabuğunun içinde gösteriyor
(`components/hata/bulunamadi.tsx`). İki giriş noktası var ve ikisi de gerekli:
`(magaza)/not-found.tsx` grup içinden çağrılan `notFound()` için,
`app/not-found.tsx` hiçbir rotaya uymayan adresler ve `dynamicParams:false`
rotalarının yönlendirici düzeyindeki 404'ü için.

## 9. Yeni sayfa nasıl eklenir

1. Doğru rota grubuna koyun: `(magaza)` vitrin/SEO, `(satici)` `/seller/*`,
   `(yonetim)` `/admin/*`.
   ⚠️ Rota grubu adları **Türkçe kalır** — URL'ye girmezler; İngilizceye geçen
   yalnız URL segmentleridir (`app/(satici)/seller/…`).
   ⚠️ "Yönetim koyu tema" **artık doğru değil**: tema kullanıcı tercihidir
   (`src/lib/tema.ts`), rota grubuna bağlı değildir.
   ⚠️ Panel sayfaları URL öneki **almak zorunda** — `proxy.ts` matcher'ı ve
   `(magaza)` ile çakışmama buna bağlı.
2. Tipi `@vt/contracts`'tan alın. Yoksa `packages/contracts/src/wire/` içine
   **çalışan API'den ölçerek** ekleyin ve `wire/index.ts`e export satırı yazın;
   tahmin etmeyin.
3. Veri yolunu §1'e göre seçin. Kimlikli okuma için `server-authed.ts`.
4. `loading.tsx` gerçek düzenin ölçülerini taklit etsin — ve §8'i okuyun.
5. `metadataBase` **kök düzende**, tekrar verilmez. Sayfa yalnızca göreli
   `alternates.canonical` yazar.
6. ⚠️ `apps/web` altında **`modules/`** adlı klasör açmayın — kökteki
   `no-restricted-imports` deseni beklenmedik şekilde tetiklenir.
7. ⚠️ `@vt/db` **import edilmez** (bağımlılık listesinde yok, ayrıca lint yasağı var).
8. ⚠️ İstemci Bileşeninde sabit lazımsa **`@vt/config/constants`**'tan alın,
   `@vt/config` kökünden değil.
   ÖLÇÜLDÜ: kökten alındığında `env.ts` istemci paketine giriyor (Turbopack
   `z.object(...)` çağrısını yan etkili sayıp modülü atamıyor) ve
   `JWT_ACCESS_SECRET`, `FIELD_ENCRYPTION_KEY` gibi **anahtar adları**
   `.next/static` içinde görünüyor. `pnpm --filter @vt/web verify:bundle` bunu
   yakalar ve derlemeyi kırar.
   ⚠️ Ters yön de var: **`apps/api` alt yolu KULLANAMAZ** (`moduleResolution:
Node`, `exports` alt yollarını görmez) ve kökten import eder. Aynı sabit iki
   pakette iki farklı yolla okunuyorsa sebebi budur.
9. Gezinme çubuğuna bağlantı eklemeyi unutmayın. ⚠️ Bu depoda üç kez yaşanan
   hatanın frontend karşılığı: sayfa yazıldı, derlendi, hiçbir yerden
   çağrılmadı. Tersi de geçerli — **olmayan sayfaya bağlantı konmaz.**
   ⚠️ **PANELDE BU ARTIK TESTLE KAPALI:** `components/panel/yan-menu.test.ts`
   menü dizilerini `app/**/page.tsx` taramasıyla karşılaştırıyor ve İKİ YÖNÜ de
   kırıyor — menüde olup sayfası olmayan da, sayfası olup menüde olmayan da.
   Test kırık yolun ADINI yazar. Yeni panel sayfası eklerken ilgili menü
   dizisine (`(satici)/layout.tsx` ya da `(yonetim)/admin/_kabuk/yan-menu.tsx`) satır
   eklemek zorunludur; eklemezseniz `vitest` kırmızı olur.
   ⚠️ Vitrin (`(magaza)`) gezinmesi bu testin kapsamında DEĞİL — bağlantılar
   orada düz metin içinde geçiyor, dizide değil. Oradaki kural hâlâ elle
   uygulanıyor.

## 10. Bugün EKSİK olan, bilerek yapılmayan

Bunlar unutulmuş değil; her birinin gerekçesi ilgili dosyada yazılı.

- ~~**`/stylist` ekranı YOK.**~~ **YAZILDI.** Ekran
  `(magaza)/stylist/`; akış `fetch` + `ReadableStream` ile okunuyor
  (`EventSource` gövdeli `POST` atamaz), SSE çözücü `_lib/akis.ts`te ve orada
  test ediliyor. Gezinme bağlantısı `(magaza)/layout.tsx`e eklendi.
  **ÖLÇÜLDÜ** (üretim derlemesi, canlı API, gerçek oturum — ⚠️ ölçüm ROTA
  GÖÇÜNDEN ÖNCE alındı, adresler o günün adresleri):
  oturumsuz `307 → /giris?next=%2Fstil-danismani` (bugünkü karşılığı
  `307 → /login?next=%2Fstylist`); oturumla `200`;
  `POST /api/stylist/conversations` → `201`;
  `POST /api/stylist/conversations/:id/messages` → `200 text/event-stream`,
  `x-accel-buffering: no`, 7 çerçeve (`start` · 5×`delta` · `done`) ve gerçek
  Türkçe yanıt. Kaydedilen gövde 37 baytlık parçalara bölünüp `AkisCozucu`ya
  verildiğinde aynı yanıt yeniden kuruldu — parça sınırında bölünen çerçeve
  arızası kapalı.
  ⚠️ AÇIK KALAN: `done.suggestedProductIds` ürün KARTINA çevrilemiyor ve
  `action: tryon.open` doğrudan deneme ekranına bağlanamıyor; ikisinin de tek
  sebebi aynı eksik uç — kataloğun `GET /products/:slug` dışında kimlikle ürün
  döndüren bir ucu yok. Ekran bugün ürün ADIYLA aramaya bağlanıyor; uydurma
  adres kurulmadı.
- **`/magaza/[slug]` (satıcı vitrini) YOK.** Ürün detayında mağaza adı görünür
  ama bağlantı değildir. ⚠️ **Sepet paketi başlığı bu kurala uymuyordu**
  (`cart/paket.tsx` → `href="/magaza/${storeSlug}"`, canlıda 404); bağlantı
  kaldırıldı, metin kaldı. Kural iki yerde değil, HER yerde geçerli.
- **`/kullanim-kosullari` ve `/aydinlatma-metni` sayfaları VAR, METİNLERİ YOK.**
  `legal/metinler.ts` bilerek uydurulmuş bir sözleşme metni içermiyor; sayfa
  metnin yayınlanmadığını söylüyor ve `robots: noindex` taşıyor.
  ⚠️ **KVKK'da metnin gösterilmiş olması rızanın geçerlilik şartıdır** — yani
  bu, açılış öncesi kapatılması gereken bir eksiktir, kozmetik değil.
- **`(satici)` ve `(yonetim)` panelleri artık YAZILDI** (satıcı 8 rota, yönetim
  11 rota) ve menüleri `<Link>` taşıyor; "yakında" düz metni kalmadı. Kaldırılan
  yedi kırık bağlantının hikâyesi §9.9'da duruyor çünkü kuralın ikinci yarısı
  hâlâ geçerli.
  ⚠️ **PANELLER ARTIK GERÇEK ROLLE ÖLÇÜLDÜ — VE İLK ÖLÇÜM 19/19 HTTP 500
  BULDU.** Kabul kapısı aylarca açık kaldığı için arıza hiç görünmemişti:
  `MenuSatiri.Ikon` bir Lucide bileşeni taşıyordu ve menü dizileri SUNUCU
  bileşeni olan kabuklarda tanımlıydı; `forwardRef` nesnesi RSC sınırından
  geçemiyor ("Functions cannot be passed directly to Client Components").
  `next build`, `tsc` ve `vitest` üçü de sessizdi — arıza YALNIZCA rolü olan
  bir oturumla sayfa açıldığında görünüyor. İkon artık ADLA taşınıyor
  (`components/panel/yan-menu.tsx` → `IKONLAR`); dizgi her zaman serileşir.
  **ROTA GÖÇÜNDEN ÖNCE ÖLÇÜLEN** (üretim derlemesi + canlı API + gerçek oturum
  çerezi): satıcı 8 rota `200`, yönetim 11 rota `200`, oturumsuz 19/19
  `307 → /giris?next=…` (bugünkü karşılığı `/login`).
  Dolu ekran: satıcı panosu "İncelemedeki ürün 1", yönetim moderasyon kuyruğu
  dolu tablo, "Defter toplamı ₺0,00". Yazma yolları: kupon `PATCH` (`200`,
  `usageLimit` kalıcı) ve ürün moderasyon reddi gerekçeyle (`200`, `REJECTED`).
  ⚠️ **307 BİR ROTA KANITI DEĞİLDİR — VE RAPORLARDA ÖYLE YAZILDI.**
  `proxy.ts` matcher'ı `/admin/:path*` deseni taşıdığı için önek altındaki HER
  yol 307 alır, rota olsun olmasın. ÖLÇÜLDÜ:
  `/admin/kesinlikle-yok` → `307 → /login?next=%2Fadmin%2Fkesinlikle-yok`; aynı
  uydurma ad önek DIŞINDA 404 (`/products/kesinlikle-yok`,
  `/legal/olmayan-belge`, `/collection/olmayan`, `/product/olmayan-urun`). Yani
  307 ölçümü "matcher çalışıyor"u kanıtlar, "rota var"ı DEĞİL.
  **Panel iddiası İKİ şeyle yazılır ve ikisi de ölçüldü** (üretim derlemesi,
  canlı API, gerçek oturum çerezi, 2026-08-13):
  1. **Derleme manifestiyle eşleşme** — kaynaktaki 150 iç bağlantının 150'si
     `.next/app-path-routes-manifest.json` ile oturuyor; panel bölgesindeki 73
     bağlantı dahil, karşılığı olmayan **0**.
  2. **ROLÜ OLAN oturumla `200` + DOLU EKRAN.** Ölçülen şey durum kodu DEĞİL,
     `<main>` içindeki metin uzunluğu ve ilk cümlesi — 19/19 `500` arızası tam
     olarak "200 sayıldı, içerik sayılmadı" yüzünden aylarca görünmemişti.
     - **ADMIN** (`yonetici@example.com`), 10 rota `200`: `/admin` (582 karakter,
       "Karar bekleyen işler") · `/admin/sellers` (2 619) · `/admin/moderation`
       (1 578) · `/admin/orders` (1 319) · `/admin/categories` (25 950) ·
       `/admin/commission` (4 124) · `/admin/payout` (755) · `/admin/reports`
       (832) · `/admin/reports/ai` (1 645) · `/admin/audit` (7 717).
     - **SELLER_USER** (`satici@mavra.example.com`), 8 rota `200`: `/seller`
       ("Mavra · Onay bekleyen sipariş 5") · `/seller/products` ·
       `/seller/products/new` · `/seller/products/bulk-upload` ·
       `/seller/orders` · `/seller/returns` · `/seller/coupons` ·
       `/seller/finance` (2 382).
     - Oturumsuz: `/admin` · `/seller` · `/account` → `307 → /login?next=…`.
     - Tarama boyunca sunucu logunda `⨯` satırı: **0**.
       ⚠️ **ROLLE ÖLÇÜM YAPACAK BİR SONRAKİ AJAN İÇİN TUZAK:** `/api/auth/login`
       vekili CSRF denetiminden geçiyor (`lib/api/csrf.ts`). Düz `curl` **403
       `AUTH_FORBIDDEN`** alır ve bu "giriş bozuk" sanılır. Gerekli iki başlık:
       `-H 'Origin: http://localhost:3000' -H 'Sec-Fetch-Site: same-origin'` — Origin
       `APP_URL` ile BİREBİR eşleşmeli, `127.0.0.1` yazmak da 403 verir.
       ⚠️ HÂLÂ ÖLÇÜLMEDİ: kargo bildirimi, iade kararı ve payout kararı — üçü de
       önce sipariş/defter verisi gerektiriyor.
       ⚠️ Rol kapısı artık kod: `packages/db/scripts/rol-ata.ts`
       (`pnpm --filter @vt/db rol:ata -- --eposta=… --rol=…`). Kullanıcı NORMAL
       yoldan (`POST /v1/auth/register`) açılır, betik yalnız rolü yükseltir ve
       SELLER_USER için APPROVED mağaza + üyelik kurar; parola özeti ikinci bir
       yerde uygulanmaz. Üretimde çalışmayı reddediyor.
       **"Panel çalışıyor" YAZILMADAN önce rolü olan bir oturumla dolu ekran
       ölçülmelidir** — bu kural yerinde duruyor; yukarıdaki 500 tam olarak neden
       durduğunu gösteriyor.
- **Bileşen testi yok.** `apps/web/vitest.config.ts` VAR ve kök projeye
  bağlı (`environment: 'node'`); SAF modüller ve dosya sistemi sapması test
  ediliyor — `lib/money.ts`, `lib/sayi.ts`, `lib/tarih.ts`,
  `lib/api/retry-policy.ts`, `(magaza)/calculator/hesap.ts`,
  `(magaza)/products/_liste/liste-sorgusu.ts`,
  `(satici)/seller/orders/_lib/sorgu.ts`, `(magaza)/stylist/_lib/akis.ts`,
  `components/panel/yan-menu.test.ts`, `src/rota/rota-tablosu.test.ts`,
  `src/lib/tema.test.ts`, `src/i18n/*.test.ts`,
  `components/hata/alan-hatalari.test.ts`.
  ⚠️ jsdom + testing-library kurulmadı; **render testi yok**. Yarım bir kurulum
  "bileşenler test ediliyor" yanılsaması üretirdi. Yani `components/panel/`
  altındaki iskelet bileşenlerinin ÇİZİMİ test edilmiyor — yalnızca menü
  içeriğinin rota tablosuyla tutarlılığı ediliyor.
  ⚠️ `yan-menu.test.ts` artık İKİ tarama yapıyor: menü dizileri **ve** panel
  ekranlarında SABİT yazılmış her `href`. İkincisi eklendi çünkü ilkinin
  yapısal kör noktası ölçüldü — yönetim panosu, VAR OLAN `/admin/payout`
  ekranı için `href: null` taşıyor ve ekranda "Payout ekranı yok" yazıyordu;
  menü testi yeşildi çünkü pano kartlarının `href`ine hiç bakmıyordu.
  ⚠️ Bu dosya YOKKEN `pnpm exec vitest run` yeşildi ama `grep -c '|web|'`
  sıfır dönüyordu: kök yapılandırma projeleri `apps/*/vitest.config.ts`
  glob'uyla topluyor. Kapının kendisi sessizce eksikti.

## 11. Frontend'den kapatılamayan, ölçülmüş engeller

- ⚠️ **R2 kova CORS'u yok → SANAL DENEME TARAYICIDA TAMAMLANAMIYOR. Bu bir
  KABUL KAPISIDIR, bir dipnot değil.** Ölçüm ve uygulanacak kural:
  `infra/R2-CORS.md`. Özeti: ön uçuş `OPTIONS` → **403**, aynı imzalı adrese
  `curl PUT` → **200**. Uygulamanın R2 jetonu bu ayarı YAPAMAZ
  (`GetBucketCors` → `AccessDenied`); panel ya da admin kapsamlı ayrı bir
  jeton gerekiyor.
  ⚠️ Yüklemeyi vekile taşımak çözüm DEĞİL: 10 MB'a kadar her fotoğraf Next
  sürecine tamponlanır.
  ⚠️ **Bu ayar yapılıp `OPTIONS` 204 dönmeden ve tarayıcıda bir deneme işi
  `QUEUED → SUCCEEDED` ölçülmeden "try-on çalışıyor" YAZILMAZ.** DEĞİŞMEZ
  KURAL #4'te ürünün kendisi diye tanımlanan özellik budur.
- ~~**Ürün görselleri 404** — demo nesneler kovaya hiç yüklenmemiş; nesneler bu
  depoda da yok.~~ **BU ENGEL KAPANDI (2026-08-13 ölçümü).**
  `packages/db/prisma/seed-assets/urunler/` 57 dosya / 680 KB taşıyor ve seed
  onları kovaya yüklüyor. `/`, `/products`, `/product/keten-gomlek-oversize`,
  `/collection/denim` sayfalarındaki 25 benzersiz `/_next/image` adresinin
  **24'ü 200** (her biri 3 denemeli).
  ⚠️ **YEDEK YİNE DE GEREKLİ VE KALDIRILMAYACAK.** Aynı ölçümde 24 üründen biri
  (`e2e-gomlek-730f-50c-f3d8e649`, bir e2e artığı) üç denemenin üçünde de
  **500** döndü — yani vitrinin İLK EKRANINDA bugün de bir kırık görsel var,
  zarif yedek onu örtüyor. Bu bir seed sorunu değil ÜRÜN sorunu: üretimde
  satıcının nesnesi de silinebilir, taşınabilir, CDN'de düşebilir.
  ⚠️ Kirliliğin kendisi ayrı bir iş: yerel veritabanında yüzlerce e2e satırı
  var ve `/category` hepsini listeliyor. Seed artık bunu SAYIYOR ve uyarı
  basıyor (`prisma/seed/dogrula.ts` → `vitrinKirliligi`) ama SİLMİYOR — seed'in
  ikinci değişmezi "hiçbir veri silinmez".
  ⚠️ `next/image` nesne erişilemediğinde istemciye **404 ya da 500** döndürüyor
  (ölçüldü: aynı sayfada ikisi birden) ve `blurhash` seed'de `null` olduğu için
  hiçbir ara görsel yok: kullanıcı KIRIK RESİM İKONU görüyordu.
  ⚠️ **YEDEK ARTIK İKİ KATMANLI ve asıl düzeltme ZAMANLA ilgiliydi.** ÖLÇÜLDÜ:
  `onError` bir React sentetik olayı, hidrasyona kadar bağlanmıyor ve React
  kaçırdığı `error`ı geri oynatmıyor → kırık ikon penceresi 316 ms (x4 CPU'da
  501 ms), **JS kapalıyken kalıcı**. Birinci katman artık CSS:
  `globals.css` → `.gorsel-yedek` (`::before` zemin + Lucide `ImageOff`,
  `::after` **ürün adı**, `attr(data-yedek-ad)`), SSR HTML'inde bulunur, JS
  gerektirmez. Üretilmiş içerik değiştirilmiş elemanlarda yalnız görsel
  ÇİZİLEMEDİĞİNDE boyanır, yani sağlam görselde örtü hiç görünmez.
  `onError` yolu GARANTİ katman olarak duruyor (Safari'de `::after` davranışı
  tarihsel olarak tutarsız) ve İKİSİ AYNI CSS SINIFINI kullanır, ayrışamazlar.
  Yedek eksikliği GİZLEMEZ; ürün adını taşıdığı için "boş gri kutu" da değildir.
  ⚠️ Ürün fotoğrafı çerçevesi `--urun-zemin` (tema başına DEĞİŞMEZ) — koyu
  temada beyaz fonlu fotoğrafın kesim çizgileri bu yüzden kaybolmuyor.
  ⚠️ Kabul ölçütü de değişti: "sayfa 200" YETMEZ, alt kaynakların durum
  kodları da sayılır — ve "sonunda doğru" YETMEZ, İLK KAREDE doğru olmalı.
- **`POST /v1/payments/3ds/callback` 200 + JSON dönüyor, 303 değil** →
  bankanın yönlendirdiği tarayıcı API kökeninde ham JSON'da kalıyor. Ödeme
  akışının bugünkü kopuk halkası. (`/checkout/sonuc` → `/checkout/result`
  köprüsü `next.config.ts`te ve 308 döndüğü ölçüldü, ama köprü ancak tarayıcı
  buraya GELİRSE işe yarar. Dönüş yolunu artık backend de frontend de
  `@vt/config` → `CHECKOUT_RESULT_PATH` üzerinden okuyor; köprü yalnız göç
  anında uçuşta olan 3DS ödemeleri için duruyor.)
- **Adres CRUD ucu yok** → `checkoutInitSchema` `addressId` kabul ediyor ama
  listeleyecek uç olmadığı için adres her seferinde gövdede gidiyor.
- **`GET /me/photos` ucu yok** → fotoğraf kimliğini bilen tek yer istemci
  belleği; sekme yenilenince kayboluyor.
- **`GET /tryon/:jobId` `errorMessage` döndürmüyor** → katalog metni
  `{reason}` yer tutucusu taşıdığı için istemci onu kullanamıyor.

## 12. Bitirmeden önce

```bash
pnpm exec turbo run build typecheck lint --force
pnpm exec vitest run          # ⚠️ 1245'ten AŞAĞI DÜŞMEMELİ
pnpm format && pnpm format:check
pnpm --filter @vt/web verify:bundle
pnpm i18n:kapsam              # ⚠️ üretim derlemesi ayaktayken
```

⚠️ **`pnpm i18n:kapsam` BU LİSTEDE OLMAK ZORUNDA.** `docs/i18n.md` §8.A
ertelemeyi bir ŞARTA bağlıyor — "her turda koşulur ve sayı küçülür" — ama betik
uzun süre HİÇBİR `package.json`a bağlı değildi ve bu listede de yoktu. Yani
"her turda koşulur" diyen mekanizmanın kendisi hiç koşmuyordu; erteleme
görünmez olduğu an kalıcılaşır.
⚠️ Bu betik ile `gomulu-metin.test.ts` AYNI ŞEYİ ÖLÇMEZ: birincisi ÇALIŞMA
ZAMANI yüzeyini (çekilen HTML'de hangi dil), ikincisi KAYNAK borcunu (sözlüğe
taşınmamış metin sayısı) ölçer. Biri diğerinin yerine geçmez.

⚠️ **TOPLAM SAYI FRONTEND HAKKINDA HİÇBİR ŞEY SÖYLEMEZ.** Bir dönem "1175 test
geçti" bir doğrulama kanıtı gibi sunuldu; oysa `apps/web/vitest.config.ts`
yoktu ve 1175 testin TAMAMI api/worker/packages'a aitti. Frontend'in
ölçüldüğünü görmek için sayıya değil PROJE ADINA bakın:

```bash
pnpm exec vitest run --project web     # bugün 86 test, 9 dosya
```

⚠️ **"Derleniyor" ≠ "çalışıyor".** Geliştirme sunucusunu gerçekten kaldırın,
sayfayı gerçekten açın, ağ isteğinin gerçekten 200 döndüğünü görün. Ekran
görüntüsü veya `curl` çıktısı kanıttır; başarılı bir `build` kanıt değildir.

⚠️ **404 ve yönlendirme iddiaları `next dev`te ÖLÇÜLMEZ** — §8'deki gerekçe.
Sayfa alt kaynakları da sayılır: `/_next/image` 500 dönerken "sayfa 200"
demek, kullanıcının gördüğü kırık ekranı raporda görünmez kılar.

⚠️ **DURUM KODU TEK BAŞINA KANIT DEĞİLDİR — VE BUNUN ÖLÇÜLMÜŞ İKİ BİÇİMİ VAR.**
Bir tarama "hepsi 200" diyorsa yanıltıcı olabileceği iki yol biliniyor:

1. **Hata sınırına düşmüş sayfa 200 döner.** Hız limiti kasten tetiklendiğinde
   `/products?q=zzz1` → **200**, gövde 38 733 bayt, ürün kartı **0**, içerik
   "Beklenmeyen bir hata". Sunucu logunda ise
   `⨯ ApiFailure: RATE_LIMITED … httpStatus: 429, retryAfterSeconds: 50`.
   → **KABUL ŞARTI: tarama boyunca web sunucusu logunda `⨯` satırı OLMAYACAK.**
   Log okunduğu için bilinebiliyor: 443 çekimlik bir turda `⨯` sayısı 5'ti ve
   beşi de kasten tetiklenen testin kendisiydi; kalan 438×200 gerçekten çizilmiş
   sayfalardır.
2. **Panel öneki altında 307 her zaman gelir.** `proxy.ts` matcher'ı
   `/admin/:path*` deseni taşıdığı için `/admin/kesinlikle-yok` da `307` alır.
   → **Panel rotası iddiası `.next/app-path-routes-manifest.json` ile eşleşme +
   rolü olan oturumla `200` ile yazılır** (ayrıntı §10).

API'yi ayağa kaldırmak (⚠️ kök `.env` **kendiliğinden yüklenmez**):

```bash
pnpm exec dotenv -e .env -- pnpm --filter @vt/api dev
```

⚠️ **`turbo run` sonrası `packages/config` ya da `packages/contracts` dist'i
bayatlayabilir.** Bu tam olarak yaşandı: `@vt/config`e yeni bir sabit eklendi,
`build` çalıştı, sonra `turbo run typecheck` önbellekten eski `dist`i geri
koydu ve `next dev` "Export NATURAL_SEARCH doesn't exist" dedi — kaynak
doğruyken. Belirtiyi görürseniz `pnpm --filter @vt/config build` (ya da
`@vt/contracts`) tekrar çalıştırın.
