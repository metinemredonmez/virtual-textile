# KVKK — Teknik Veri Akışı Eki

> **Bu doküman hukukçu için hazırlanmıştır.** Sistemin kişisel veriyi teknik olarak
> nasıl işlediğini anlatır. Aydınlatma metni, açık rıza metinleri ve hukuki
> değerlendirme bu belgeye dayanılarak yazılacaktır.
>
> `[ ]` işaretli alanlar hukukçu/işletme tarafından doldurulacaktır.
> Teknik bölümler doldurulmuş hâldedir ve koda karşılık gelir.

---

## 0. Doldurulacak alanlar (özet)

| # | Alan | Kim doldurur |
|---|---|---|
| 1 | Veri sorumlusu unvanı, adresi, VERBİS kaydı | İşletme |
| 2 | İrtibat kişisi / veri koruma sorumlusu | İşletme |
| 3 | Yurt dışı aktarım mekanizması (taahhütname / standart sözleşme / açık rıza) | Hukukçu |
| 4 | Sağlayıcılarla imzalanacak veri işleme sözleşmeleri | Hukukçu |
| 5 | Saklama sürelerinin hukuki dayanağı | Hukukçu |
| 6 | Aydınlatma metni ve açık rıza metinleri | Hukukçu |
| 7 | İhlal bildirim prosedürü ve yetkili kişi | Hukukçu + İşletme |

---

## 1. Veri sorumlusu

| Alan | Değer |
|---|---|
| Unvan | `[ ]` |
| Adres | `[ ]` |
| VERBİS kayıt no | `[ ]` |
| İrtibat kişisi | `[ ]` |

Yazılımı geliştiren taraf **veri işleyen** sıfatıyla hareket eder; veriyi yalnızca
veri sorumlusunun talimatı ve sözleşmenin ifası doğrultusunda işler.

---

## 2. İşlenen kişisel veri envanteri

Aşağıdaki tablo doğrudan veritabanı şemasından çıkarılmıştır.

| Veri | Nerede tutulur | Nitelik | Saklama | Silinebilir mi |
|---|---|---|---|---|
| Ad, soyad | `user_users` | Kişisel | Hesap ömrü | ✅ |
| E-posta | `user_users` | Kişisel | Hesap ömrü | ✅ |
| Telefon | `user_users` | Kişisel | Hesap ömrü | ✅ |
| Parola | `user_users` | Kişisel | Hesap ömrü | Geri döndürülemez özet (argon2id) |
| Teslimat/fatura adresi | `user_addresses` | Kişisel | Hesap ömrü | ✅ |
| Vücut ölçüleri (boy, kilo, göğüs, bel, kalça) | `user_body_profiles` | Kişisel | Hesap ömrü | ✅ |
| **Yüz / tam boy fotoğrafı** | `ai_user_photos` + nesne deposu | **Özel nitelikli** | 24 saat veya 90 gün | ✅ |
| **Sanal deneme çıktısı** (kişinin görüntüsü) | `ai_tryon_jobs` + nesne deposu | **Özel nitelikli (türetilmiş)** | Kaynak fotoğrafla birlikte | ✅ |
| IP adresi, tarayıcı bilgisi | `user_sessions`, `consent_records` | Kişisel | Oturum + denetim | ❌ (denetim kaydı) |
| Sipariş geçmişi, tutarlar | `order_*` | Kişisel + ticari | `[ ]` yasal saklama süresi | ❌ anonimleştirilir |
| Ödeme kaydı (maskeli kart, token) | `payment_intents` | Kişisel | `[ ]` | ❌ |
| Satıcı IBAN / vergi no | `seller_sellers` | Kişisel | Sözleşme ömrü | Şifreli (AES-256-GCM) |
| Rıza kayıtları | `consent_records` | Denetim | Kalıcı | ❌ |

> ⚠️ **Kart numarası, son kullanma tarihi ve CVC bu sisteme hiç girmez.** Ödeme
> bilgileri tarayıcıdan doğrudan ödeme kuruluşunun 3D Secure sayfasına gider.
> Sistem yalnızca maskeli gösterim (`5528 **** **** 4682`) ve sağlayıcının
> ürettiği token'ı saklar.

---

## 3. ⚠️ En kritik başlık: yurt dışına aktarım

### Ne oluyor

Sanal deneme özelliği, kullanıcının fotoğrafını **yurt dışında bulunan yapay zekâ
hizmet sağlayıcılarına** gönderir. Bu bir **yurt dışına veri aktarımıdır**.

### Aktarım zinciri

```
Kullanıcı tarayıcısı
   └─► Nesne deposu (private kova)          [konum: [ ] ]
         └─► Sunucu, kısa ömürlü imzalı bağlantı üretir (10 dk, tek kullanımlık)
               └─► AI sağlayıcısı bağlantıdan fotoğrafı çeker    [konum: ABD]
                     └─► Üretilen görsel sunucuya döner
                           └─► Filigran eklenir, private kovaya yazılır
```

### Aktarılan veri

| Aktarılan | Aktarılmayan |
|---|---|
| Kullanıcı fotoğrafı (yüz + vücut) | Ad, soyad |
| Ürün görseli | E-posta, telefon |
| Kıyafet kategorisi (üst/alt/elbise) | Adres |
| — | Sipariş geçmişi, ödeme bilgisi |
| — | Kullanıcı kimliği (yalnızca anonim iş kimliği) |

### Sağlayıcılar

| Sağlayıcı | Amaç | Ülke | Sözleşme durumu |
|---|---|---|---|
| `[ ]` (birincil try-on) | Görsel üretimi | ABD | `[ ]` |
| `[ ]` (yedek try-on) | Görsel üretimi | ABD | `[ ]` |
| `[ ]` (stil danışmanı) | Metin üretimi — **fotoğraf gönderilmez** | ABD | `[ ]` |

### Hukukçudan beklenen

1. Hangi aktarım mekanizması kullanılacak: taahhütname mi, standart sözleşme mi,
   yoksa yalnızca açık rızaya mı dayanılacak? → `[ ]`
2. Sağlayıcılarla imzalanacak veri işleme sözleşmesi metni → `[ ]`
3. Sağlayıcının kendi saklama ve model eğitimi politikasının yazılı teyidi → `[ ]`

### Sistemin teknik güvencesi

- Aktarım için **ayrı bir açık rıza** alınır (`CROSS_BORDER_TRANSFER`).
- Bu rıza yoksa istek **reddedilir ve sağlayıcıya hiçbir çağrı yapılmaz**.
  Kodda bu kontrol atlanabilir değildir.
- Fotoğraf kalıcı bağlantıyla değil, **10 dakika ömürlü tek kullanımlık** bağlantıyla
  paylaşılır.
- Sağlayıcıya kullanıcı kimliği gönderilmez.

---

## 4. Alınan rızalar

Kullanıcı ilk kez sanal deneme kullanmak istediğinde, **ayrı ayrı işaretlenebilir**
onaylar sunulur:

| Rıza tipi | Zorunlu mu | Varsayılan | Ne için |
|---|---|---|---|
| `PHOTO_PROCESSING` | Zorunlu | Kapalı | Fotoğrafın sanal deneme için işlenmesi |
| `CROSS_BORDER_TRANSFER` | Zorunlu | Kapalı | Yurt dışı sağlayıcıya aktarım |
| `PHOTO_STORAGE` | Opsiyonel | Kapalı | Fotoğrafın profilde saklanması |
| `MODEL_TRAINING` | Opsiyonel | **Kapalı** | Model eğitiminde kullanım |
| `MARKETING` | Opsiyonel | Kapalı | Pazarlama iletişimi |

Her rıza kaydı **değiştirilemez** biçimde saklanır: rıza tipi, verilip verilmediği,
onaylanan metnin sürüm numarası, IP adresi, tarayıcı bilgisi, tarih-saat.

Rıza geri çekildiğinde kayıt silinmez; `granted: false` olan **yeni bir satır** yazılır.
Böylece "ne zaman verildi, ne zaman geri çekildi" her zaman gösterilebilir.

> **Hukukçuya not:** metin sürümlendirilmelidir (`v1.0`, `v1.1` …). Metin
> değiştiğinde eski rızanın hangi metne verildiği kayıttan okunabilir.
>
> Aydınlatma metni ve açık rıza metinleri → `[ ]`

---

## 5. Saklama süreleri

| Veri | Süre | Nasıl uygulanıyor |
|---|---|---|
| Fotoğraf — "yalnızca bu işlem için" | **24 saat** | Saatlik otomatik silme görevi |
| Fotoğraf — "profilimde sakla" | **90 gün**, kullanımda yenilenir | Aynı görev |
| Sanal deneme çıktısı | Kaynak fotoğrafla birlikte | Zincirleme silme |
| Hesap silme talebi sonrası bekleme | **30 gün** (geri alma penceresi) | Sonra kalıcı silme |
| Sipariş ve mali kayıtlar | `[ ]` yasal süre | Silinmez, **anonimleştirilir** |
| Rıza kayıtları | Kalıcı | Denetlenebilirlik için |

> **Hukukçuya not:** sipariş ve mali kayıtların saklama süresinin hukuki dayanağı
> belirtilmelidir → `[ ]`

### Silme nasıl yapılıyor

1. Önce **nesne deposundan** silinir (dosyanın kendisi)
2. Sonra veritabanı kaydı işaretlenir
3. Depodan silme başarısız olursa kayıt açık kalır ve tekrar denenir —
   "sildim" deyip silmemiş olmamak için sıra bu şekildedir
4. Sanal deneme kayıtları silinmez, **anonimleştirilir**: görsel gider,
   istatistik (kaç deneme yapıldı) kalır

> ⚠️ Nesne deposunda **sürüm geçmişi kapalı olmalıdır**. Açık olursa silinen
> fotoğraf sürüm geçmişinde kalır ve silme talebi fiilen yerine getirilmemiş olur.

---

## 6. Kullanıcıya sunulan haklar

| Hak | Nasıl kullanılıyor | Süre |
|---|---|---|
| Fotoğrafını silme | Profil ekranından tek tıkla | Anında |
| Deneme geçmişini silme | Profil ekranından | Anında |
| Tüm görsel verilerini silme | Profil ekranından | 1 saat içinde |
| Verilerini indirme | Talep → hazırlanınca e-posta ile bağlantı | Bağlantı 48 saat geçerli |
| Hesabını silme | Talep → 30 gün geri alma → kalıcı silme | 30 gün |
| Rızasını geri çekme | Ayar ekranından her rıza ayrı ayrı | Anında |

---

## 7. Erişim kısıtları

| Rol | Kullanıcı fotoğrafına erişim |
|---|---|
| Kullanıcının kendisi | ✅ Yalnızca 5 dakika ömürlü imzalı bağlantı ile |
| Satıcı | ❌ Hiçbir koşulda |
| Müşteri destek | ❌ Hiçbir koşulda |
| **Sistem yöneticisi** | ❌ **Serbest erişim yok** |

Moderasyon veya şikâyet nedeniyle erişim zorunlu olursa **istisnai erişim** akışı
işletilir: gerekçe girilmesi zorunludur, işlem denetim kaydına yazılır ve
kullanıcıya bildirim gider.

> **Hukukçuya not:** bu akışın hangi hâllerde işletilebileceği yazılı olarak
> tanımlanmalıdır → `[ ]`

---

## 8. Güvenlik önlemleri

| Önlem | Durum |
|---|---|
| Aktarımda şifreleme (TLS 1.3) | Uygulanıyor |
| Beklemede şifreleme (nesne deposu) | Uygulanıyor |
| Hassas alanların şifrelenmesi (IBAN, vergi no) | AES-256-GCM |
| Parola özetleme | argon2id |
| Fotoğraflardan konum bilgisi (EXIF) temizliği | Uygulanıyor |
| Kullanıcı fotoğrafları için ayrı, dışa kapalı depolama alanı | Uygulanıyor |
| Rol tabanlı yetkilendirme | Uygulanıyor |
| Denetim kayıtları (değiştirilemez) | Uygulanıyor |
| Kayıtlarda parola/token/kart gizleme | Uygulanıyor |
| Oturum çalınması tespiti ve tüm oturumların düşürülmesi | Uygulanıyor |

---

## 9. Yapay zekâ çıktısına ilişkin bilgilendirme

Üretilen her sanal deneme görseline, **görselin kendi piksellerine gömülü** olarak
şu uyarı eklenir:

> "Yapay zekâ ile oluşturulmuştur; ürünün gerçek kalıbı farklılık gösterebilir."

Uyarı yalnızca ekranda değil görselin içindedir; kullanıcı görseli indirdiğinde
veya paylaştığında uyarı görselle birlikte gider.

Ayrıca **görsel benzerlik** ile **beden uyumu** ayrı güven skorlarıyla gösterilir.
Bir kıyafetin görselde iyi durması, fiziksel olarak doğru beden olduğu anlamına
gelmez; sistem beden konusunda kesinlik iddia etmez, "tahmin/öneri" olarak sunar.

---

## 10. Veri ihlali durumu

Yetkisiz erişim tespit edilirse:

1. Erişim kesilir, anahtarlar değiştirilir
2. Kapsam belirlenir: hangi veri, kaç kişi, hangi zaman aralığı
3. **72 saat içinde** yetkili kuruma bildirim
4. Etkilenen kullanıcılara bildirim
5. Olay kaydı tutulur

> **Hukukçuya not:** bildirimden sorumlu kişi ve iletişim kanalı → `[ ]`

---

## 11. Hukukçuya sorular

1. Yurt dışı aktarım için hangi mekanizmaya dayanacağız?
2. Açık rıza tek başına yeterli mi, yoksa taahhütname de gerekli mi?
3. Sipariş ve mali kayıtların saklama süresi ne olmalı?
4. 16 yaş altı kullanıcılar için ek bir kısıt gerekiyor mu? Sistemde şu an
   yaş doğrulaması **yoktur** — gerekiyorsa eklenmesi gerekir.
5. Sanal deneme görselinin kullanıcı tarafından sosyal medyada paylaşılması
   ek bir aydınlatma gerektirir mi?
6. Satıcıların yüklediği ürün görsellerinde model kişilerin rızası kimin
   sorumluluğunda? Satıcı sözleşmesine madde eklenmeli mi?
