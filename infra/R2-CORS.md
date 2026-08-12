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

`AllowedOrigins` **üretimde `APP_URL` ile değiştirilir**; `*` yazılmaz. İmzalı
URL'ler kısa ömürlüdür ama süre dolana kadar herhangi bir sitenin
tarayıcıdan kullanmasına izin vermek için bir sebep yok.

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
