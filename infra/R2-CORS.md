# R2 kova CORS'u — sanal denemenin KABUL KAPISI

> Bu dosya bir "yapılacaklar" notu değil, bir **kabul ölçütü**dür. Bu ayar
> yapılmadan sanal denemenin tarayıcıda çalıştığı İDDİA EDİLEMEZ.

## Sorun (ölçüldü, 2026-08-12)

Kullanıcı fotoğrafı `POST /v1/me/photos` ile alınan **imzalı URL**'e tarayıcıdan
doğrudan `PUT` edilir (vekilden geçmez — 10 MB'a kadar her fotoğraf Next
sürecine tamponlanırdı). `content-type: image/jpeg` CORS'un güvenli listesinde
olmadığı için tarayıcı önce bir **ön uçuş** gönderir; özel kovada CORS
tanımlı olmadığı için bu istek reddedilir:

```
$ curl -D - -o /dev/null -X OPTIONS "<imzali-url>" \
    -H 'origin: http://localhost:3000' \
    -H 'access-control-request-method: PUT' \
    -H 'access-control-request-headers: content-type'
HTTP/1.1 403 Forbidden
Server: cloudflare
          ← tek bir `access-control-*` başlığı YOK

$ curl -o /dev/null -w '%{http_code}' -X PUT "<ayni-url>" \
    -H 'content-type: image/jpeg' --data-binary @foto.jpg
200                                    ← curl CORS uygulamaz
```

Yani sunucu tarafı ve imza **doğru**; eksik olan tek şey kova ayarı.
Tarayıcıda sonuç: `fetch` `TypeError` ile düşer, modal açılır ama akış bir adım
sonra kırılır — DEĞİŞMEZ KURAL #4'te "ürünün kendisi" diye tanımlanan özellik
hiçbir gerçek kullanıcıda tamamlanamaz.

## ⚠️ Uygulamadaki jeton bu ayarı YAPAMAZ

`.env` içindeki `R2_ACCESS_KEY_ID` yalnızca nesne okuma/yazma yetkisine sahip:

```
GetBucketCors vt-private-user-photos → AccessDenied
GetBucketCors vt-public-products     → AccessDenied
```

Bu **doğru** bir yetki daraltmasıdır; uygulama jetonunun kova ayarlarını
değiştirebilmesi istenmez. Dolayısıyla ayar ya Cloudflare panelinden ya da
**ayrıca üretilmiş, yalnız bu iş için kullanılan** admin kapsamlı bir jetonla
yapılır.

## Uygulanacak kural

`r2-cors.json` — kova: `R2_BUCKET_PRIVATE` (`vt-private-user-photos`).

`AllowedOrigins` **iki kökeni de sayar**: `http://localhost:3000` (geliştirme) ve
`http://91.99.183.64` (üretim `APP_URL`i). `*` yazılmaz — imzalı URL'ler kısa
ömürlüdür ama süre dolana kadar herhangi bir sitenin tarayıcıdan kullanmasına
izin vermek için bir sebep yok.

> ⚠️ **ESKİDEN "üretimde `APP_URL` ile DEĞİŞTİRİLİR" YAZIYORDU; DEĞİŞTİ.**
> Dosyada yalnız `localhost:3000` duruyordu, yani kural bir İNSAN ADIMIna
> bırakılmıştı. O adım atlanırsa arıza SESSİZDİR ve tam olarak yukarıda
> ölçülen biçimde döner: `curl PUT` 200 verir (curl CORS uygulamaz), sunucu
> ve imza doğrudur, yalnız **tarayıcının** ön uçuşu 403 alır — yerelde çalışan
> akış canlıda kırılır ve hiçbir log satırı bunu söylemez. İki köken aynı
> listede durunca atlanacak adım kalmıyor.
>
> Bu kayıt yeni **site görselleri** (afiş/kapak) yüklemesini de kapsar: aynı
> imzalı akış, aynı özel kova (`staging/site/…`), aynı `PUT` + `content-type`.
> Ayrı bir CORS kaydı gerekmez.
>
> Alan adı bağlanınca `https://…` kökeni bu listeye EKLENİR; eskisi geçiş
> bitene kadar silinmez.

Genel ürün kovasına (`R2_BUCKET_PUBLIC`) CORS **gerekmez**: o görseller
`next/image` üzerinden SUNUCUDAN çekiliyor, tarayıcı çapraz köken isteği
yapmıyor.

## Doğrulama (bu iki satır geçmeden iş bitmedi)

1. Yukarıdaki `OPTIONS` isteği **204** (ya da 200) dönmeli ve yanıtta
   `access-control-allow-origin` başlığı bulunmalı.
2. Tarayıcıda uçtan uca bir deneme işi: fotoğraf yüklenir, `POST /v1/tryon`
   `QUEUED` döner ve yoklama `SUCCEEDED`e ulaşır.

Ekran görüntüsü veya `curl` çıktısı kanıttır; başarılı bir `build` kanıt
değildir.


## Durum: UYGULANDI (2026-08-14)

Kural Cloudflare panelinden `vt-private-user-photos` kovasına işlendi ve
sunucudan doğrulandı:

```
$ curl -sS -D - -o /dev/null -X OPTIONS \
    "https://vt-private-user-photos.<hesap>.r2.cloudflarestorage.com/deneme" \
    -H "Origin: http://91.99.183.64" \
    -H "Access-Control-Request-Method: PUT" \
    -H "Access-Control-Request-Headers: content-type"

HTTP/1.1 204 No Content
Access-Control-Allow-Origin: http://91.99.183.64
Access-Control-Allow-Headers: content-type
Access-Control-Allow-Methods: PUT
Access-Control-Max-Age: 3600
```

⚠️ ÖNCESİNDE 403 DÖNÜYORDU ve arıza tam da bu belgenin tarif ettiği gibiydi:
   `POST /v1/me/photos` **201** (bilet alınıyor), ardından tarayıcının ön
   uçuşu **403**, gerçek `PUT` hiç gitmiyor. Uygulama loglarında tek satır iz
   yok — çünkü istek sunucumuza hiç ulaşmıyor.

⚠️ BU KAYIT BİR İNSAN ADIMINI BELGELİYOR VE SORUN DA BU. Kural kod tarafından
   yazılamıyor (uygulamanın jetonu `GetBucketCors` → `AccessDenied`), yani her
   yeni ortamda birinin panele girmesi gerekiyor. Adım atlandığında arıza
   sessiz. Bu yüzden kullanıcı fotoğrafı yüklemesi SUNUCU TARAFINA taşınıyor
   (ayrı iş): tarayıcı R2'ye hiç gitmezse bu belgeye de gerek kalmaz.

   Taşıma bittiğinde bu kayıt SİLİNMEZ — ürün görseli ve site görseli (afiş,
   kapak) yüklemeleri hâlâ imzalı akışı kullanıyorsa CORS onlar için gerekli
   olmaya devam eder. Hangi akışın hangi yolu kullandığı taşıma turunda
   ölçülüp buraya yazılacak.
