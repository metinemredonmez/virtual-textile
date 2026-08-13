# Medya dağıtımı — neden `r2.dev` kullanılmıyor

> Bu dosya bir tercih anlatmıyor, bir **ölçüm** anlatıyor. Aşağıdaki her sayı
> komutla üretildi ve komutu yazılı; iddia edilen hiçbir şey varsayılmadı.

## Kısa cevap

`pub-<hash>.r2.dev` Cloudflare'in **geliştirme** adresidir. Belgelerinde üretim
için tasarlanmadığı ve **hız sınırlı** olduğu yazar. Ölçtük: gerçekten sınırlı,
ve sınıra takılan istek nazikçe `429` dönmüyor — **TLS el sıkışması düşüyor**.

Çözüm: görseller kendi nginx'imizden `/medya/` altında **önbelleklenerek**
servis ediliyor. Ne tarayıcı ne Next'in görsel iyileştiricisi r2.dev'e gidiyor.

---

## Ölçüm 1 — arıza gerçek ve ada yapışık

```bash
K=https://pub-7fbed3fcd71b47f79a9a44b6fb43f91b.r2.dev/products/<...>/original
for i in $(seq 8); do curl -s -o /dev/null -w '%{http_code}/%{exitcode} ' --max-time 12 "$K"; done
# 200/0 200/0 000/35 000/35 200/0 000/35 200/0 000/35     → 8 istekte 4 hata
```

`exitcode 35` = _SSL connect error_. TCP kuruluyor, **TLS el sıkışması
düşürülüyor**; gövde yok, durum kodu yok. nginx'in kendi günlüğünde aynı olay:

```
SSL_do_handshake() failed (SSL: error:0A00010B:SSL routines::wrong version number)
  while SSL handshaking to upstream, upstream: "https://104.18.50.34:443/..."
```

Tek bir kötü kenar sunucusu değil — ad iki adrese çözülüyor ve **ikisi de**
düşürüyor:

```bash
dig +short pub-…r2.dev A     # 104.18.54.45 · 104.18.50.34   (TTL 148 sn)
# her iki adrese ayrı ayrı 4'er istek: ikisinde de 3/4 ve 1/4 hata
```

Kontrol grubu olarak `cloudflare.com` aynı makineden temiz geçiyor: sorun ağ
değil, **bu ada özgü**.

## Ölçüm 2 — görevdeki teşhisin düzeltmesi

"Tarayıcı r2.dev'e gidiyor, oraya hiç gitmemeli" **doğru değildi**. Canlı ana
sayfanın HTML'i okundu:

```bash
curl -s http://91.99.183.64/ | grep -o 'src="[^"]*_next/image[^"]*"'
# src="/_next/image?url=https%3A%2F%2Fpub-…%2Foriginal&w=3840&q=75"   ×9
```

Her görsel zaten **bizim** sunucumuzdan geçiyor. r2.dev'e giden, Next'in görsel
iyileştiricisi — **sunucu tarafından**.

Asıl israf **değişken başına yeniden çekim**: Next'in görsel önbelleği
`(url, genişlik, kalite, Accept)` ile anahtarlanır. Aynı kaynak, 8 genişlik ×
3 format ≈ **kaynak başına ~24 ayrı upstream çekimi**. Kaynak seviyesinde
önbellek yoktu. Her çekim, hata olasılığı ~%50 olan bir zar atışı.

**nginx önbelleğinin gerçek işi 24'ü 1'e indirmek.** Kırık görselin sebebi
"r2.dev yavaş" değil, **ona gereğinden 24 kat fazla gitmemiz**.

## Ölçüm 3 — çözüm gerçekten çalışıyor

nginx yerelde ayağa kaldırıldı ve `infra/nginx/vt.conf` içindeki `location
/medya/` bloğu **dosyadan çıkarılarak** (yeniden yazılmadan) test edildi:

| Senaryo                                       | Sonuç                      |
| --------------------------------------------- | -------------------------- |
| doğrudan r2.dev, 9 anahtar, soğuk             | **2/8** ✗                  |
| nginx üzerinden, 9 anahtar, **soğuk**         | **4/8** ✗                  |
| nginx üzerinden, önbellek **sıcak**, 20 istek | **20/20** ✓                |
| ısıtma döngüsü (anahtar başına ≤6 deneme)     | **9/9**, toplam 14 istek ✓ |

Okunacak iki şey var:

1. **Sıcak önbellekte arıza tamamen kayboluyor.** 20/20.
2. **Soğuk önbellek tek başına yetmiyor.** Bu yüzden dağıtım betiği
   önbelleği **deneyerek ısıtıyor** — tek geçişlik bir döngü işe yaramaz.

## Ölçüm 4 — denenip **reddedilen** yol

`upstream {}` bloğu + `keepalive` + `max_fails=0` denendi. Hipotez: arıza el
sıkışmasındaysa, bağlantıyı yeniden kullanmak arızayı atlar.

| Varyant                                  | Soğuk sonuç |
| ---------------------------------------- | ----------- |
| değişken + `resolver` (seçilen)          | 4/8         |
| `upstream` + `keepalive` + `max_fails=0` | **4/9**     |

**Fark yok** — el sıkışma zaten düşerken kalıcı bağlantı hiç kurulamıyor.
Kazanç sıfır, bedeli ise gerçek: `upstream` bloğu adı **yalnızca açılışta**
çözer ve IP'yi reload'a kadar sabitler. TTL 148 saniye. Bu yüzden reddedildi ve
`proxy_pass https://$r2_kok;` + `resolver` tercih edildi.

---

## Bugün ne var

| Katman            | Nereden okur                            |
| ----------------- | --------------------------------------- |
| Tarayıcı          | `http://91.99.183.64/_next/image?url=…` |
| Next iyileştirici | `http://91.99.183.64/medya/<anahtar>`   |
| nginx `/medya/`   | önbellek → (MISS ise) r2.dev            |

Dosyalar:

- `infra/nginx/vt-cache.conf` → `/etc/nginx/conf.d/vt-cache.conf`
  Yalnızca `proxy_cache_path`. **Ayrı dosya zorunlu**: bu yönerge yalnızca
  `http{}` bağlamında geçerli, `vt.conf` ise baştan sona tek bir `server{}`.
- `infra/nginx/vt.conf` → `location /medya/` bloğu.
- `apps/web/next.config.ts` → `images.remotePatterns`, `NEXT_PUBLIC_MEDIA_URL`den
  **türetilir** (elle ikinci bir liste tutulmaz).

### Hatalı yanıt önbelleğe **alınmaz**

`proxy_cache_valid` yalnızca iki satır:

```nginx
proxy_cache_valid 200 90d;
proxy_cache_valid 404 1m;
```

- **5xx, bağlantı hatası ve zaman aşımı hiçbir koşulda yazılmaz.** r2.dev'in
  arızası tam olarak bu sınıftır (TLS düşmesi → 502). Onu önbelleğe almak,
  geçici bir arızayı **kalıcı kırık görsele** çevirirdi. `proxy_cache_valid any`
  bu yüzden yok ve eklenmemeli.
- **404 tek istisna, yalnızca 1 dakika.** Sıfır olsaydı var olmayan bir anahtar
  r2.dev'i döverdi; uzun olsaydı **yeni yüklenen afiş** o süre boyunca kırık
  görünürdü.

Doğrulandı:

```
aynı 404 anahtarı 3 kez → 502 (MISS) · 404 (MISS) · 404 (HIT)
```

502 önbelleğe **girmedi**, 404 girdi. İstenen davranış bu.

### Ölçülebilirlik

Her yanıt `X-Medya-Onbellek: HIT|MISS|EXPIRED|STALE|UPDATING` taşır.
**Bu başlık görülmeden hiçbir şey "çözüldü" sayılmaz.** Dağıtım betiği bunu
okuyor; başlık yoksa dağıtımı **durduruyor** — çünkü başlığın yokluğu
`location /medya/`nın devrede olmadığı, yani sitenin görselsiz servis edildiği
anlamına gelir.

---

## Yerel geliştirme — nginx yok, ne oluyor?

**Hiçbir şey değişmiyor, kod da dallanmıyor.** Ayrım tek bir ortam
değişkeninde:

|                                         | `NEXT_PUBLIC_MEDIA_URL`          |
| --------------------------------------- | -------------------------------- |
| Yerel (`apps/web/.env.local`)           | `https://pub-…r2.dev` — doğrudan |
| Üretim (`/etc/virtual-textile/web.env`) | `http://91.99.183.64/medya`      |

`next.config.ts` her iki durumu da tanır: `remotePatterns` bu değerden türetilir
**ve** `**.r2.dev` listede kalır.

Yerelde önbellek olmaması neden sorun değil: tek geliştirici, düşük hacim, ve
Next indirdiği görseli `.next/cache/images` altında zaten saklıyor.

**Yerelde de "resimler kırık" görürseniz** sebep büyük olasılıkla aynı hız
sınırıdır. İki çıkış yolu:

1. `.next/cache/images` dolduktan sonra sorun kendiliğinden geçer (sayfayı
   birkaç kez yenileyin).
2. Kalıcı çözüm: `apps/web/.env.local` içinde kökü sunucunun önbelleğine
   çevirin ve `dev`i yeniden başlatın:
   ```
   NEXT_PUBLIC_MEDIA_URL=http://91.99.183.64/medya
   ```
   Ek ayar gerekmez — `remotePatterns` bu değerden türetiliyor.

> ⚠️ **Göreli `/medya` yazmayın.** Next `/` ile başlayan `src`i yerel sayıp
> kendi istek işleyicisine yönlendirir, nginx'i hiç görmez ve her görsel 404
> olur. Adres **mutlak** olmalı. Dağıtım betiği bunu ayrıca denetliyor.

> ⚠️ **`127.0.0.1`/`localhost` kestirmesi kapalı — ölçüldü.** Next'in görsel
> iyileştiricisi `fetchExternalImage()` içinde upstream adını çözüp **özel IP**
> ise isteği reddediyor (`"url" parameter is not allowed`, SSRF koruması).
> Next'in kendi işleviyle sınandı:
>
> ```
> 91.99.183.64  → özel mi: false   ✓ izinli
> 127.0.0.1     → özel mi: true    ✗ reddedilir
> 192.168.1.10  → özel mi: true    ✗ reddedilir
> ```
>
> Yani üretimde Next → nginx çağrısı kendi **genel** IP'mize saç tokası yapar;
> bu kabul edilmiştir. `images.dangerouslyAllowLocalIP` bir SSRF anahtarıdır,
> tek bir sıçrama için açılmaz. Aynı sebeple yerelde kökü `127.0.0.1`e bakan
> bir nginx'e çeviremezsiniz — yerelde ya doğrudan r2.dev ya sunucunun
> genel adresi kullanılır.

---

## Özel alan adı bağlanınca ne değişir

Bu blok bir **köprüdür**, kalıcı mimari değil. Asıl çözüm R2 kovasına özel bir
alan adı bağlamaktır (`medya.<alan-adi>`): o zaman adres gerçek CDN olur, hız
sınırı kalkar ve araya bir vekil koymaya gerek kalmaz.

O gün **üçü birlikte** kaldırılır:

1. `infra/nginx/vt.conf` → `location /medya/` bloğu
2. `infra/nginx/vt-cache.conf` → dosyanın tamamı + `/var/cache/nginx/vt-medya`
3. `NEXT_PUBLIC_MEDIA_URL` → `https://medya.<alan-adi>`

Ardından `next build` (değer pakete gömülü) ve `pm2 reload vt-web`.
`scripts/deploy.sh` içindeki medya adımları kökün `/medya` taşıyıp taşımadığına
bakıyor; kök değiştiği anda o adımlar kendiliğinden devre dışı kalır — silinecek
kod yok.

Bu not olmadan köprü kalıcılaşır. `vt.conf` içindeki blokta da aynı **kaldırılma
koşulu** yazılı.

---

## Dağıtım günü — bilinen tek risk

`NEXT_PUBLIC_MEDIA_URL` değiştiği an Next'in görsel önbelleği **tamamen**
geçersizleşir (anahtar tam adresi içerir) ve nginx önbelleği de boştur. İlk
trafik dalgası %100 MISS demektir — yani hız sınırını tetiklemek için ideal
koşul. `proxy_cache_use_stale` burada **tanımı gereği** yardım edemez: elde
bayat kopya yoktur.

Yani bugün seyrek görülen arıza, düzeltmenin dağıtıldığı gün **tepe noktasına
çıkabilir**. Karşı önlemler:

1. `scripts/deploy.sh` (adım `9b/9`) ana sayfadaki gerçek anahtarları
   **deneyerek** ısıtır (anahtar başına ≤6 deneme). Ölçüldü: 9/9, ~30 saniye.
2. Aynı adım `X-Medya-Onbellek` başlığını **kanıt olarak** okur; başlık yoksa
   dağıtım durur.
3. Dağıtımı düşük trafik saatinde yapın.
4. `proxy_cache_lock on` — aynı anahtarı isteyen N eşzamanlı istekten yalnızca
   biri upstream'e gider. Isınma anındaki eşzamanlı istek sayısını, dolayısıyla
   sınırı tetikleme olasılığını düşürür.

---

## İlgili, ama bu turun işi değil

**Hazır türevler servis edilmiyor.** `…/320.webp`, `640.webp`, `1024.webp`
R2'de **var** ve 200 dönüyor; ama katalog `…/original` döndürüyor ve Next her
seferinde büyük dosyayı indirip yeniden boyutlandırıyor. Gerçek bir israf,
fakat düzeltmesi katalogun `storageKey` sözleşmesini değiştirir — **ayrı iş**.
Önbellek bu israfın _tekrarını_ kaldırıyor, kendisini değil.
