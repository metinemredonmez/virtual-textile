# Gizlilik ve Kullanıcı Fotoğrafları (KVKK)

> Bu doküman **teknik uygulamayı** anlatır. Aydınlatma metinleri, açık rıza içerikleri
> ve hukuki uyum yükümlülüğü veri sorumlusuna aittir.

Platform sanal deneme için kullanıcıların yüz ve tam boy fotoğraflarını işler. Bu
**özel nitelikli kişisel veridir** ve projenin en kritik hukuki başlığıdır.

---

## 1. En büyük risk: yurt dışına aktarım

MVP'de sanal deneme, barındırılan model API'leri üzerinden çalışır. Kullanıcı
fotoğrafının bu sağlayıcılara gönderilmesi **yurt dışına veri aktarımıdır (KVKK md. 9)**.

Bunun için:

- Fotoğraf işlemeden **ayrı** bir açık rıza alınır (`CROSS_BORDER_TRANSFER`)
- Rıza yoksa istek `403 CONSENT_CROSS_BORDER_REQUIRED` ile reddedilir — çağrı yapılmaz
- Sağlayıcıyla aktarım mekanizması (standart sözleşme / taahhütname) kurulmuş olmalıdır
- Sağlayıcının veri saklama ve model eğitimi politikası yazılı teyit edilmelidir

**Bu madde hukuki onay olmadan üretime çıkmamalıdır.**

---

## 2. Rıza akışı

Kullanıcı ilk kez "Üzerimde Dene"ye bastığında, ayrı ayrı işaretlenebilir onaylar:

```
□ Fotoğrafımın sanal deneme için işlenmesine izin veriyorum.        [ZORUNLU]
□ Fotoğrafımın yurt dışındaki hizmet sağlayıcılarına
  aktarılmasına izin veriyorum.                                      [ZORUNLU]
□ Fotoğrafım profilimde saklansın.                                   [opsiyonel]
□ Fotoğrafım yapay zekâ modeli eğitiminde kullanılabilir.  [opsiyonel, VARSAYILAN KAPALI]
```

Her onay `ConsentRecord` tablosuna **append-only** yazılır: tip, verilip verilmediği,
onaylanan metnin sürümü, IP, user-agent, zaman. Rıza geri çekilirse `granted: false` ile
**yeni satır** yazılır; eski satır silinmez.

Kullanıcı hesabını silse bile rıza kayıtları korunur — rızanın varlığı veya yokluğu
denetlenebilir olmalıdır.

---

## 3. Saklama ve silme

| Amaç                            | Saklama                              | Nerede       |
| ------------------------------- | ------------------------------------ | ------------ |
| "Yalnızca bu işlem için kullan" | **24 saat**                          | private kova |
| "Profilimde sakla"              | **90 gün**, her kullanımda yenilenir | private kova |
| Try-on sonucu                   | Kaynak fotoğrafla birlikte silinir   | private kova |

Silme cron'u saatte bir çalışır ve `expiresAt` geçmiş kayıtları hem depodan hem
veritabanından siler.

> ⚠️ **Cron çalışmazsa alarm üretilir.** Sessizce durması, saklama süresi taahhüdünün
> ihlal edilmesi demektir. Bu alarm 🔴 aciliyetindedir.

### Silme akışı (cascade)

Kullanıcı "Tüm görsel verilerimi sil" dediğinde:

1. `UserPhoto` → depo nesnesi silinir + kayıt silinir
2. `TryOnJob` → sonuç görselleri silinir, kayıt anonimleştirilir (metrik için sayı kalır)
3. Önbellek anahtarları geçersiz kılınır
4. AI sağlayıcısında saklama kaydı varsa silinir
5. `ConsentRecord` **silinmez** — silme talebinin kendisi de kayıt altında kalmalı
6. `AuditLog`'a yazılır, kullanıcıya e-posta ile teyit gider

> ⚠️ **Depo kovasında sürümleme (versioning) KAPALI olmalıdır.** Açıksa "sildim"
> dediğin fotoğraf sürüm geçmişinde kalır ve silme talebi yerine getirilmemiş olur.

---

## 4. Erişim kısıtı

| Rol                  | Kullanıcı fotoğrafına erişim |
| -------------------- | ---------------------------- |
| Kullanıcının kendisi | ✅ imzalı URL, 5 dk          |
| Satıcı               | ❌                           |
| Destek               | ❌                           |
| **Admin**            | ❌ **serbest erişim yok**    |

Moderasyon veya şikâyet gerektirirse **break-glass** akışı kullanılır: gerekçe girilir,
`AuditLog` yazılır, kullanıcıya bildirim gider. Denetimde bu kayıt aranır.

---

## 5. Teknik önlemler

| Gereklilik            | Uygulama                                                 |
| --------------------- | -------------------------------------------------------- |
| Amaçla sınırlı işleme | Fotoğraf yalnızca try-on işinde kullanılır               |
| Süreli saklama        | `expiresAt` + saatlik silme cron'u + alarm               |
| Şifreleme (beklemede) | Depo tarafında SSE, private kova                         |
| Şifreleme (aktarımda) | TLS 1.3, HSTS                                            |
| **EXIF temizliği**    | Yüklemede zorunlu — **GPS konumu sızmasın**              |
| Erişim kısıtı         | RBAC + break-glass + `AuditLog`                          |
| Silme hakkı           | `DELETE /me/photos/:id`, `/tryon/history`, `/me/account` |
| Veri taşınabilirliği  | `POST /me/data-export` → ZIP, bağlantı 48 saat           |
| Model eğitimi         | Varsayılan **kapalı**; sağlayıcıya `no-training` bayrağı |
| Yapay zekâ uyarısı    | Her try-on çıktısında **piksel içine gömülü**            |

### Zorunlu görsel uyarısı

Üretilen her sanal deneme görseline şu metin **piksel düzeyinde** eklenir:

> "Yapay zekâ ile oluşturulmuştur; ürünün gerçek kalıbı farklılık gösterebilir."

CSS overlay yeterli değildir — görsel indirildiğinde veya paylaşıldığında uyarı
kaybolmamalıdır.

Ayrıca **görsel güven** ile **beden güveni** ayrı skorlar olarak gösterilir. Bir kıyafetin
görselde iyi durması, fiziksel olarak doğru beden olduğu anlamına gelmez.

---

## 6. Veri envanteri

| Veri                    | Sınıf                           | Saklama                  | Silinebilir         |
| ----------------------- | ------------------------------- | ------------------------ | ------------------- |
| Yüz / tam boy fotoğraf  | **Özel nitelikli**              | 24 saat – 90 gün         | ✅                  |
| Try-on sonucu           | **Özel nitelikli (türetilmiş)** | Kaynakla birlikte        | ✅                  |
| Vücut ölçüleri          | Kişisel                         | Hesap ömrü               | ✅                  |
| Adres, telefon, e-posta | Kişisel                         | Hesap ömrü               | ✅                  |
| Sipariş kayıtları       | Kişisel + ticari                | **Yasal saklama süresi** | ❌ anonimleştirilir |
| IBAN, vergi no (satıcı) | Kişisel                         | Sözleşme ömrü            | Şifreli             |
| Rıza kayıtları          | Denetim                         | Kalıcı                   | ❌                  |
| Ledger / komisyon       | Mali                            | **Yasal saklama süresi** | ❌                  |

Sipariş ve mali kayıtlar silinmez, **anonimleştirilir**: kullanıcı bağlantısı kesilir,
tutarlar ve tarihler korunur. Aksi hâlde muhasebe bütünlüğü bozulur.

---

## 7. İhlal durumunda

Kişisel veriye yetkisiz erişim tespit edilirse:

1. Erişimi kes, anahtarları döndür ([`secrets.md`](secrets.md) §7)
2. Kapsamı belirle: hangi veri, kaç kullanıcı, hangi süre
3. **72 saat içinde** yetkili kuruma bildirim
4. Etkilenen kullanıcılara bildirim
5. `docs/runbook/kvkk-breach.md` adımlarını izle ve olay kaydı tut
