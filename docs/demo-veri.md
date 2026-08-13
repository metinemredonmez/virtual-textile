# Demo veri (seed)

`pnpm db:seed` vitrini, filtreleri, arama fasetlerini, satıcı panelini ve
yönetim panelini **gerçekten dolduran** bir veri seti yazar — ve yazdığını geri
okuyup doğrular.

```bash
pnpm infra:up          # postgres + redis ayakta olmalı
pnpm db:migrate
pnpm db:seed           # kök .env'i kendisi yükler
```

Görsel yer tutucularını yeniden üretmek (nadiren gerekir, çıktı depoda durur):

```bash
pnpm --filter @vt/db seed:varlik
```

## Demo hesaplar

Parola hepsinde aynı: `DemoParola2026`

| Rol           | E-posta                             | Ne için                                  |
| ------------- | ----------------------------------- | ---------------------------------------- |
| `CUSTOMER`    | `demo@example.com`                  | sipariş geçmişi, gardırop, favoriler     |
| `CUSTOMER`    | `ayse@example.com`                  | teslim edilmiş + iade edilmiş siparişler |
| `CUSTOMER`    | `mehmet@example.com`                | kargodaki sipariş                        |
| `CUSTOMER`    | `zeynep@example.com`                | iptal / ödeme başarısız                  |
| `ADMIN`       | `yonetici@example.com`              | tüm yönetim paneli                       |
| `SELLER_USER` | `satici@atolye-nord.example.com`    | satıcı paneli (owner)                    |
| `SELLER_USER` | `satici@mavra.example.com`          | en yüksek bakiye, payout talebi          |
| `SELLER_USER` | `satici@denim-atolyesi.example.com` | iade akışı                               |
| `SELLER_USER` | `satici@kuzey-spor.example.com`     | düşük kalite skoru                       |

> ⚠️ Satıcı hesapları `seller_users` üyeliğiyle birlikte yazılır. Bu üyelik
> olmadan `SellerScopeGuard` `request.sellerId`i çözemez ve satıcı panelinin
> **her ucu 403 döner** — panel açılır ama boştur. Bu, seed'den önceki
> durumdu ve satıcı/yönetim panellerini ölçülemez hâlde bırakıyordu.

## Ne yazılıyor

| Alan           | Hacim                                                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Kategori       | 32, üç seviye (`kadin-denim`, `abiye-gelinlik`, `kadin-spor-giyim`, `kadin-elbise` dâhil — koleksiyon iniş sayfaları bu slug'ları arıyor) |
| Satıcı         | 6 — 4 `APPROVED`, 1 `PENDING` (belgeleriyle), 1 `SUSPENDED`                                                                               |
| Ürün           | 28 — 25 `PUBLISHED`, 3 `PENDING_REVIEW` (moderasyon kuyruğu dolsun)                                                                       |
| Varyant / stok | 178 / 178                                                                                                                                 |
| Görsel         | 56 (ürün başına ön + arka), her biri R2'de gerçekten var                                                                                  |
| Sipariş        | 16 — `OrderStatus`un **10 değerinin 10'u** da temsil ediliyor                                                                             |
| Ledger         | 55 kayıt; `SALE`, `COMMISSION`, `SHIPPING_SHARE`, `REFUND`, `COMMISSION_REVERSAL`, `PAYOUT`, `ADJUSTMENT`                                 |
| İade / payout  | 4 / 3 (`REQUESTED` olanlar dâhil)                                                                                                         |
| Komisyon       | Bir kuralda **iki versiyon** (`validTo` dolu + `null`) — snapshot'ın anlamı ancak böyle görünür                                           |
| Diğer          | kupon + kullanım, yorum, favori, sepet, gardırop, adres, denetim izi, AI kullanım kaydı, arama eş anlamlıları                             |

Cinsiyet dağılımı `WOMAN` dışında `MAN`/`UNISEX`/`KIDS` de içerir — bu filtreler
seed'den önce sıfır sonuç veriyordu.

## Görseller

Kaynak yer tutucular depoda: `packages/db/prisma/seed-assets/urunler/*.webp`
(56 dosya, 1200×1600, toplam ~680 KB). Sentetik ve akromatik — `docs/design-system.md`
paletiyle uyumlu; renkli stok fotoğrafı "renk yalnızca DURUM taşır" kuralının
görsel olarak yanlış okunmasına davetiye olurdu.

Seed bunları **uygulamanın kendi portundan** yükler:

- `StorageProvider.put()` + `storageKeys` şeması →
  `products/{productId}/{imageId}/original`
- `320/640/1024.webp` türevleri seed sırasında `sharp` ile üretilir; **depoya konmaz**
- `put()` üzerine yazar → yükleme kendiliğinden idempotent

> ⚠️ Eski seed `demo/{slug}/front.webp` yazıyordu. O ön ek uygulamanın anahtar
> şemasında **hiç yok** ve `r2.config.ts → KNOWN_KEY_PREFIXES` listesinde de
> yok. Yani dosyayı yüklemiş olsaydı bile uygulamanın hiç ürettiği bir anahtar
> biçimini yazıyordu; vitrinde kırık ikon çıkmasının sebebi buydu.

**Depolama yapılandırılmamışsa** (CI'da `R2_*` boş) yükleme atlanır, veritabanı
satırları yine yazılır ve konsola yüksek sesle uyarı basılır. Yerelde ve
sunucuda kök `.env` gerçek R2 anahtarlarını taşıdığı için ikisi de aynı dalı
koşar ve nesneler **aynı kovaya, aynı anahtarla** gider — "yerelde çalışıp
sunucuda çalışmayan" durum bu yüzden yapısal olarak imkânsız.

## İdempotency

İki kez çalıştırmak güvenlidir; **hiçbir veri silinmez**.

Bu bir nöbetçi bayrağına değil **yazım biçimine** dayanır: her yazım doğal bir
anahtar üzerinden `upsert` ya da "yoksa yaz" biçimindedir ve mutlak değer yazar,
artırım yazmaz. Sonucu: yarım kalmış bir koşu ikinci koşuda **kendini onarır**.

> ⚠️ Eski seed tek bir satıra bakıyordu (`store.findUnique({slug:'atolye-nord'})`).
> Bu bir tuzaktı: mağaza satırı dururken ürün/sipariş tabloları boşaltılıp seed
> tekrar koşulduğunda "Demo veri zaten yüklü" basıp `products 0 · orders 0`
> bırakıyordu.

Arka arkaya iki tam koşuda **tek fark** `infra_audit_logs` +1'dir: her koşu
sonunda `seed.completed` kaydı yazılır. Bu kayıt bir nöbetçi **değil**, "son tam
koşu ne zaman bitti" sorusunun cevabıdır ve `/admin/audit` ekranında görünür.

Sipariş numaraları sabittir (`VT-DEMO-0001`…) — tarihten üretilseydi her gün
yeni sipariş doğar ve ledger mükerrer `SALE` satırlarıyla dolardı.

## Doğrulama adımı

Seed bitmeden önce kendi ürettiğini geri okur:

1. Her `storageKey` için `storage.exists()` (HeadObject) — nesne kovada gerçekten var mı
2. **Vitrine seed DIŞI satır düşüyor mu** (`vitrinKirliligi`) — aşağıda
3. Bastığı her adres `apps/web/app` ağacından **türetilen** rota tablosunda var mı
   (elle liste yazılmaz; parantezli klasörler rota grubudur, URL'ye girmez)
4. Demo hesap **gerçekten giriş yapabiliyor mu** — aşağıda

Herhangi biri hata seviyesinde düşerse seed `throw` eder. Konsola basılan
sayılar döngüden üretilir, sabit yazılmaz.

### Giriş doğrulaması — önce KENDİ bağlantısı, sonra API

> ⚠️ **BU ADIM BİR SÜRE SESSİZ YALANCIYDI.** Yalnızca `POST /v1/auth/login`
> atıyordu; o süreç kendi `DATABASE_URL`ini kullanır ve seed'inkiyle aynı olmak
> zorunda değildir. ÖLÇÜLDÜ: seed `DATABASE_URL=…vt_kanit` ile koşarken
> `API_URL` kök `.env`ten `http://localhost:3001` geldi ve oradaki API
> `virtual_textile`e bağlıydı. İki API aynı slug için farklı satır döndürüyordu
> (`yuksek-bel-mom-jean` → `019ff80d-…` ve `019ff89e-…`) ama seed üç koşuda da
> `✓ Giriş doğrulandı (API)` bastı. Onay, seed'in o koşuda **hiç dokunmadığı**
> bir veritabanından geliyordu.

Bugünkü sıra:

1. Hesap seed'in **kendi Prisma bağlantısında** var mı ve `passwordHash` dolu mu
   (HTTP'siz de ölçülebilen tek gerçek iddia; boşsa `auth.service` kullanıcıyı
   yok sayar).
2. API ile seed **aynı veritabanına** mı bakıyor: demo bir slug'ın kimliği iki
   tarafta karşılaştırılır. Ayrışıyorsa giriş denenmez ve **uyarı** basılır —
   "hata" değil, çünkü iki ortamlı bir makinede çalışmak arıza değildir; arıza
   olan ölçülmemişi ölçülmüş göstermekti.
   ⚠️ Ayırt edici olarak `/health`e veritabanı adı **eklenmedi**: o uç
   `@Public()` ve bağlantı hedefini kimliksiz herkese söylemek, bir ölçüm
   kolaylığı için kalıcı bir bilgi sızıntısı açmak olurdu.
3. Ancak o zaman `POST /v1/auth/login`.

> ⚠️ **DUYARLILIK KONTROL KOŞUSUYLA KANITLANDI.** `/health`i `ok`,
> `/v1/auth/login`i `200`, `/v1/products/:slug`i BAŞKA bir kimlikle dönen bir
> taklit sunucuya karşı koşuldu: eski kod `✓ Giriş doğrulandı (API)` basardı,
> bugünkü kod `⚠️ … BAŞKA bir veritabanına bakıyor (aynı slug, farklı kimlik) —
giriş doğrulaması ATLANDI` basıyor. Gerçek API'ye karşı aynı fonksiyon yine
> `✓` basıyor, yani kapı yalnızca ayrışmada kapanıyor.

> ⚠️ Giriş doğrulaması **tek hesap** dener. `RATE_LIMITS.login` 15 dakikada 5
> deneme; üç hesabı deneyen ilk sürüm arka arkaya iki koşuda kilidi açtırdı ve
> seed 423 ile düştü — doğrulama adımının kendisi seed'i kırdı. `423/429` bir
> başarısızlık değil "ölçülemedi" durumudur ve uyarı olarak geçilir.

### E2E kalıntıları — SAYILIR, SİLİNMEZ

`vitrinKirliligi` seed'in olmayan ama **vitrinde çizilen** satırları sayar:
yayında ürünler ve kategoriler. **Bugünkü koşunun bastığı satır** (yerel
veritabanı, 2026-08-13):

```
⚠️  Vitrine seed DIŞI satırlar düşüyor: 323 yayında ürün · 301 kategori
    (örnek: e2e-gomlek-360f-991-310374de, e2e-gomlek-e6fa-100-dca78a74, …)
```

`/category` bu 301 kategoriyi listeliyor ve `/products` ilk sayfasında bir e2e
ürünü duruyor — görseli `/_next/image` üzerinden **500** dönüyor (zarif yedek
örtüyor, yani kullanıcı kırık ikon değil ürün adlı bir kutu görüyor).

> ⚠️ **"Seed görselleri 23/23 200" DOĞRU AMA EKSİK BİR CÜMLEDİR.** Kabul ölçütü
> "seed görselleri" üzerinden değil **"vitrinde çizilen görseller"** üzerinden
> kurulur; ilk ekranda kırık bir görsel varken seed'in kendi nesnelerinin
> kusursuz olması kullanıcı için bir şey ifade etmez.

> ⚠️ `sayimlariOku` bunu YAKALAYAMAZ ve yakalamamalı: o fonksiyon sayımları
> bilerek demo kümesine daraltıyor (iki koşu arasındaki farkın okunabilmesi
> için). İki kontrol birbirinin yerine geçmez.

Temizlik **bu seed'in işi değil**: ikinci değişmez "hiçbir veri silinmez" ve
bir kez `wipe` yapan seed ledger'ı geri alınamaz biçimde bozardı. Kalıntıların
temizliği ayrı bir karttır; o iş yapılana kadar sayı her koşuda basılır.

## Üretimde çalışmaz

Üç bağımsız şart birden sağlanmalı (`prisma/seed/kapi.ts`):

1. `NODE_ENV !== 'production'`
2. `DATABASE_URL` host'u `localhost` / `127.0.0.1`
3. `APP_URL` varsa o da yerel

Tek şartlı nöbetçi yetmiyordu: sunucuda yetkili env dosyası
`/etc/virtual-textile/api.env` ve kök `.env` orada olmayabilir — o durumda
`NODE_ENV` tanımsız kalıp nöbetçi geçerdi.

> ⚠️ "Demo modu bayrağı" **eklenmez**. Bayrak "üretimde demo veri ne zaman
> doğru olur?" sorusunu açık bırakır ve o soru bir gün "sadece bir kez, canlıyı
> göstermek için" diye cevaplanır. O andan itibaren gerçek
> `finance_ledger_entries` içinde sahte `SALE`/`COMMISSION` kayıtları durur ve
> **ledger append-only olduğu için geri alınamaz**. Sahte satıcının `ibanEnc`
> değeri de `demo:not-encrypted`; payout akışı çözmeye çalıştığında patlar.

## Rol atama — güvenlik gerekçesi

Seed `ADMIN` ve `SELLER_USER` rolleri atar. Bu yeni bir kapı **açmıyor**:

1. Seed üretimde hiç çalışmıyor (yukarıdaki üç şart).
2. `packages/db/scripts/rol-ata.ts` ile **aynı** kapı; yeni bir yetki yolu değil.
3. Veritabanına yazabilen biri zaten `UPDATE user_users SET role='ADMIN'` yazabilir.

Parola özeti `apps/api/.../password.service.ts` ile **aynı** argon2id
parametreleriyle üretilir (memoryCost 19456, timeCost 2, parallelism 1; pepper
yok — ölçüldü). Parametreler özetin içinde kodlu olduğu için API bir gün
sıkılaştırsa bile `argon2.verify` doğrulamaya devam eder ve `auth.service.ts`
`needsRehash` ile ilk girişte yükseltir.

> ⚠️ **Var olan bir hesabın parolası ezilmez.** Yalnızca `passwordHash`i hiç
> olmayan hesaplara yazılır; aksi hâlde e2e koşularının ve elle açılmış
> hesapların parolası sessizce değişir ("dün giriyordum, bugün giremiyorum").

## Dosya düzeni

```
packages/db/prisma/
  seed.ts                 # giriş noktası, sıralama ve rapor
  seed/
    veri.ts               # bildirimsel veri tablosu — tek kaynak
    kapi.ts               # ortam kapısı (üretimde çalışmaz)
    para.ts               # kuruş / BigInt / bps yardımcıları
    gorsel.ts             # R2 yükleme + sharp türevleri
    katalog.ts            # kategori, komisyon, satıcı, ürün, varyant, stok
    hesap.ts              # kullanıcı, rol, mağaza üyeliği, adres, rıza
    ticaret.ts            # sipariş, paket, ledger, iade, payout, kupon
    musteri.ts            # yorum, favori, sepet, gardırop
    denetim.ts            # denetim izi, AI kullanımı, arama eş anlamlıları
    dogrula.ts            # geri okuma / doğrulama
  seed-assets/
    uret.ts               # yer tutucu görsel üreticisi
    urunler/*.webp        # 56 kaynak görsel
```

`seed-assets/uret.ts` ile `seed/veri.ts` **aynı** ürün tablosunu okur; bu yüzden
"görseli üretilmemiş ürün" ya da "ürünü olmayan görsel" durumu doğamaz.

> ⚠️ **`seed/` VE `seed-assets/` SÜRÜM KONTROLÜNE `seed.ts` İLE BİRLİKTE
> GİRMEK ZORUNDA.** `seed.ts` izlenen bir dosya ve `./seed/katalog.js`,
> `./seed/dogrula.js` … import ediyor; alt dizin izlenmiyorken `seed.ts`
> commit edilirse temiz bir klonda `pnpm db:seed` **modül bulunamadı** ile
> düşer. Bu yollar `.gitignore`da DEĞİL (`git check-ignore` boş dönüyor) —
> yalnızca eklenmemiş olabilirler. Aynısı `apps/web/src/lib/tema.ts`,
> `src/components/tema/`, `src/i18n/`, `src/rota/` ve
> `packages/contracts/src/i18n/` için de geçerli: belge yeni davranışı
> anlatırken kod depoda olmazsa hiçbir ölçüm başka bir makinede tekrarlanamaz.
