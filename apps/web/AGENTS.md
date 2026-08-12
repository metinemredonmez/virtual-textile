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

Kalıp örneği: **`app/(magaza)/urunler/page.tsx`**. Yeni sayfa yazmadan önce onu okuyun.

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

- `hesapFetch(path, donusYolu)` → oturum yoksa **`/giris`e yönlendirir**. Hesap,
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
  kullanıcı `/giris` yerine "Beklenmeyen bir hata oluştu" kutusu görüyordu.
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
- ⚠️ Koyu tema **yalnızca** `(yonetim)` bölgesinde (`.tema-koyu` sınıfı).
  ⚠️ **PORTAL TUZAĞI:** `Dialog`/`Sheet` içeriği `document.body`ye taşır, yani
  `.tema-koyu` kabuğunun DIŞINA — koyu panelde açılan bir modal AÇIK temada
  çizilir. Bugün hiçbir panel ekranı bu ikisini kullanmıyor, o yüzden arıza
  görünmüyor; ilk kullananla birlikte görünür. Gerekçe ve düzeltme yönü
  `components/ui/dialog.tsx` başlığında. Sabit renk sınıfı (`bg-white`,
  `text-gray-*`) panelde HİÇ kullanılmaz — hepsi anlamsal token.
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
Bu yüzden `(magaza)/loading.tsx`, `urun/[slug]/loading.tsx` ve
`urun/[slug]/dene/loading.tsx` silindi.

- 404 üretmeyen ekranlarda iskelet duruyor ve durmalı: `/urunler`, `/sepet`,
  `/odeme`, `/hesabim`, `/koleksiyon`, `/hesaplayici`.
- 404 üreten bir rotada iskelet isteniyorsa yol `generateStaticParams` +
  `dynamicParams: false` (`koleksiyon/[koleksiyon]`, `hukuki/[belge]`).
  ⚠️ **VE O ROTADA `dynamic = 'force-dynamic'` YAZILMAZ.** `force-dynamic`
  `generateStaticParams`ı devre dışı bırakır, yönlendiricinin
  karşılaştıracağı slug listesi hiç oluşmaz ve kapı SESSİZCE düşer.
  `koleksiyon/[koleksiyon]` tam olarak bu yüzden aylarca 200 döndü. Belirti
  `next build` rota tablosunda görünür: kapı çalışıyorsa satır `●` (SSG),
  düşmüşse `ƒ` (Dynamic).
- `hesabim/loading.tsx` bilerek duruyor: altındaki `siparisler/[siparisNo]`
  yumuşak 404 üretir ama o ekran girişin arkasında, indekslenmiyor.

⚠️ **HER 404 İDDİASI `next build && next start` ÜZERİNDE ÖLÇÜLÜR.**
`next dev` ölçümü KANIT DEĞİLDİR: `/koleksiyon/canta` dev'de 404, üretim
derlemesinde 200 dönüyordu ve bu fark bir ölçüm tablosunun tamamını
geçersiz kıldı.

**ÖLÇÜM (`next build && next start`, üretim derlemesi):**

```
/kategori/yok-boyle-kategori  404   /koleksiyon/canta      404
/urun/yok-boyle-urun          404   /koleksiyon/yok-boyle  404
/hukuki/yok                   404   /koleksiyon/xyz        404
/rastgele-adres               404   /magaza/atolye-nord    404
```

Beşi de aynı Türkçe ekranı, vitrin kabuğunun içinde gösteriyor
(`components/hata/bulunamadi.tsx`). İki giriş noktası var ve ikisi de gerekli:
`(magaza)/not-found.tsx` grup içinden çağrılan `notFound()` için,
`app/not-found.tsx` hiçbir rotaya uymayan adresler ve `dynamicParams:false`
rotalarının yönlendirici düzeyindeki 404'ü için.

## 9. Yeni sayfa nasıl eklenir

1. Doğru rota grubuna koyun: `(magaza)` açık tema/SEO, `(satici)` `/satici/*`,
   `(yonetim)` `/yonetim/*` koyu tema.
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
   dizisine (`(satici)/layout.tsx` ya da `yonetim/_kabuk/yan-menu.tsx`) satır
   eklemek zorunludur; eklemezseniz `vitest` kırmızı olur.
   ⚠️ Vitrin (`(magaza)`) gezinmesi bu testin kapsamında DEĞİL — bağlantılar
   orada düz metin içinde geçiyor, dizide değil. Oradaki kural hâlâ elle
   uygulanıyor.

## 10. Bugün EKSİK olan, bilerek yapılmayan

Bunlar unutulmuş değil; her birinin gerekçesi ilgili dosyada yazılı.

- ~~**`/stil-danismani` ekranı YOK.**~~ **YAZILDI.** Ekran
  `(magaza)/stil-danismani/`; akış `fetch` + `ReadableStream` ile okunuyor
  (`EventSource` gövdeli `POST` atamaz), SSE çözücü `_lib/akis.ts`te ve orada
  test ediliyor. Gezinme bağlantısı `(magaza)/layout.tsx`e eklendi.
  **ÖLÇÜLDÜ** (üretim derlemesi, canlı API, gerçek oturum):
  oturumsuz `307 → /giris?next=%2Fstil-danismani`; oturumla `200`;
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
  (`sepet/paket.tsx` → `href="/magaza/${storeSlug}"`, canlıda 404); bağlantı
  kaldırıldı, metin kaldı. Kural iki yerde değil, HER yerde geçerli.
- **`/kullanim-kosullari` ve `/aydinlatma-metni` sayfaları VAR, METİNLERİ YOK.**
  `hukuki/metinler.ts` bilerek uydurulmuş bir sözleşme metni içermiyor; sayfa
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
  **BUGÜN ÖLÇÜLEN** (üretim derlemesi + canlı API + gerçek oturum çerezi):
  satıcı 8 rota `200`, yönetim 11 rota `200`, oturumsuz 19/19 `307 → /giris?next=…`.
  Dolu ekran: satıcı panosu "İncelemedeki ürün 1", yönetim moderasyon kuyruğu
  dolu tablo, "Defter toplamı ₺0,00". Yazma yolları: kupon `PATCH` (`200`,
  `usageLimit` kalıcı) ve ürün moderasyon reddi gerekçeyle (`200`, `REJECTED`).
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
  `lib/api/retry-policy.ts`, `hesaplayici/hesap.ts`,
  `urunler/_liste/liste-sorgusu.ts`, `satici/siparisler/_lib/sorgu.ts`,
  `stil-danismani/_lib/akis.ts`, `components/panel/yan-menu.test.ts`.
  ⚠️ jsdom + testing-library kurulmadı; **render testi yok**. Yarım bir kurulum
  "bileşenler test ediliyor" yanılsaması üretirdi. Yani `components/panel/`
  altındaki iskelet bileşenlerinin ÇİZİMİ test edilmiyor — yalnızca menü
  içeriğinin rota tablosuyla tutarlılığı ediliyor.
  ⚠️ `yan-menu.test.ts` artık İKİ tarama yapıyor: menü dizileri **ve** panel
  ekranlarında SABİT yazılmış her `href`. İkincisi eklendi çünkü ilkinin
  yapısal kör noktası ölçüldü — yönetim panosu, VAR OLAN `/yonetim/payout`
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
- **Ürün görselleri 404** — seed'in işaret ettiği demo nesneler kovaya hiç
  yüklenmemiş; nesneler bu depoda da yok, yani frontend'den kapatılamaz.
  ⚠️ `next/image` üstteki 404'ü istemciye **500** olarak çeviriyordu ve
  `blurhash` seed'de `null` olduğu için hiçbir yedek yoktu: kullanıcı KIRIK
  RESİM İKONU görüyordu. `components/urun/urun-gorseli.tsx` artık `onError`
  ile nötr bir kutuya düşüyor — eksikliği GİZLEMEZ, yalnız kırık ikonu
  kaldırır.
  ⚠️ Kabul ölçütü de değişti: "sayfa 200" YETMEZ, alt kaynakların durum
  kodları da sayılır.
- **`POST /v1/payments/3ds/callback` 200 + JSON dönüyor, 303 değil** →
  bankanın yönlendirdiği tarayıcı API kökeninde ham JSON'da kalıyor. Ödeme
  akışının bugünkü kopuk halkası. (`/checkout/sonuc` → `/odeme/sonuc` köprüsü
  `next.config.ts`te ve 308 döndüğü ölçüldü, ama köprü ancak tarayıcı buraya
  GELİRSE işe yarar.)
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
```

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
