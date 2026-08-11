# KVKK Metinleri — TASLAK

> ⚠️ **Bu bir taslaktır, hukuki görüş değildir.** Avukat incelemesinden geçmeden
> yayına alınmamalıdır. Yazılımı geliştiren taraf hukuki yeterlilikten sorumlu
> değildir; bu metinler teknik gerçekliği doğru yansıtsın diye hazırlanmıştır.
>
> `[ ]` alanları doldurulacak. Teknik iddiaların hepsi koda karşılık gelir —
> avukat metni değiştirirse teknik tarafın da değişmesi gerekebilir, o yüzden
> değişiklikleri bize bildirin.

**Kaynaklar:** KVKK md. 5, 6, 9, 10, 11 · Aydınlatma Yükümlülüğü Tebliği ·
GDPR uygulamasındaki biyometrik veri ve açık rıza standartları (aşağıda referanslı)

---

## Neden bu metin standart bir e-ticaret metni değil

Üç noktada ayrışıyor, üçü de yabancı uygulamada en çok ceza alınan başlıklar:

1. **Yüz ve vücut fotoğrafı özel nitelikli veridir.** Sıradan bir "üyelik
   sözleşmesini kabul ediyorum" onayının içine gömülemez. Ayrı, açık ve
   anlaşılır olmalıdır.
2. **Rıza paketlenemez (bundling).** "Kullanım koşullarını ve fotoğraf işlemeyi
   kabul ediyorum" tek kutu olamaz. Her amaç ayrı kutu.
3. **Önceden işaretli kutu geçersizdir.** Kullanıcının olumlu bir eylemi şart.
   Sistemde varsayılan **kapalıdır**.

---

# BÖLÜM 1 — AYDINLATMA METNİ

## Kişisel Verilerin İşlenmesine İlişkin Aydınlatma Metni

**Son güncelleme:** `[ ]` · **Sürüm:** v1.0

### 1. Veri sorumlusu

|         |       |
| ------- | ----- |
| Unvan   | `[ ]` |
| Adres   | `[ ]` |
| E-posta | `[ ]` |
| VERBİS  | `[ ]` |

Aşağıda "**Platform**" olarak anılacaktır.

### 2. Hangi verilerinizi işliyoruz

**Üyelik ve alışveriş için**
Ad, soyad, e-posta, telefon, teslimat ve fatura adresi, sipariş geçmişi,
ödeme kaydı (kart numarası **değil**; yalnızca maskeli gösterim ve ödeme
kuruluşunun ürettiği güvenli anahtar), IP adresi ve cihaz bilgisi.

**Sanal deneme için — özel nitelikli**
Yüklediğiniz **yüz ve tam boy fotoğrafınız** ve bu fotoğraftan üretilen deneme
görselleri. Beden önerisi kullanırsanız: boy, kilo, göğüs, bel ve kalça ölçüsü.

> Fotoğrafınız 6698 sayılı Kanun anlamında **özel nitelikli kişisel veridir**.
> Bu nedenle yalnızca **açık rızanızla** işlenir ve rızanız olmadan hiçbir işlem
> yapılmaz.

### 3. Hangi amaçla

| Amaç                                         | Hukuki sebep                         |
| -------------------------------------------- | ------------------------------------ |
| Üyelik oluşturma, giriş, hesap güvenliği     | Sözleşmenin kurulması / ifası        |
| Sipariş, ödeme, kargo, iade                  | Sözleşmenin ifası, hukuki yükümlülük |
| Fatura ve muhasebe kayıtları                 | Hukuki yükümlülük                    |
| Sahtecilik ve kötüye kullanım önleme         | Meşru menfaat                        |
| **Kıyafeti fotoğrafınız üzerinde göstermek** | **Açık rıza**                        |
| **Fotoğrafınızın profilinizde saklanması**   | **Açık rıza**                        |
| **Yapay zekâ modeli eğitimi**                | **Açık rıza — varsayılan KAPALI**    |
| Ticari elektronik ileti                      | Açık rıza                            |

Rızaya dayanan işlemleri **istediğiniz an durdurabilirsiniz**. Durdurmanız
üyeliğinizi veya alışveriş yapmanızı etkilemez — yalnızca ilgili özellik
kullanılamaz hâle gelir.

### 4. ⚠️ Fotoğrafınızın yurt dışına aktarılması

Sanal deneme, görseli üreten yapay zekâ hizmetinin **yurt dışındaki sunucularında**
çalışır. Bu nedenle fotoğrafınız yurt dışına aktarılır.

**Aktarılan**

- Fotoğrafınız
- Denemek istediğiniz ürünün görseli
- Kıyafet kategorisi (üst giyim / alt giyim / elbise / dış giyim)

**Aktarılmayan**

- Adınız, soyadınız
- E-posta ve telefonunuz
- Adresiniz
- Sipariş ve ödeme bilgileriniz
- Hesap kimliğiniz

Sağlayıcı sizi tanımlayan hiçbir bilgi görmez; yalnızca görseli ve geçici bir
işlem numarasını alır.

**Nasıl aktarılıyor:** fotoğrafınıza kalıcı bir bağlantı verilmez. Yalnızca
**10 dakika geçerli, tek kullanımlık** bir bağlantı üretilir; sağlayıcı görseli
o bağlantıdan çeker, süre dolunca bağlantı geçersiz olur.

|                      |                                                     |
| -------------------- | --------------------------------------------------- |
| Aktarım yapılan ülke | `[ ]`                                               |
| Sağlayıcı(lar)       | `[ ]`                                               |
| Aktarım dayanağı     | `[ ]` (standart sözleşme / taahhütname / açık rıza) |

> **Avukata not:** 2024 değişikliği sonrası KVKK md. 9'da yeterlilik kararı,
> standart sözleşme, taahhütname ve bağlayıcı şirket kuralları esas yol hâline
> geldi; açık rıza arızi aktarımlar için istisnai yol olarak konumlandı.
> Bu özellik **süreklilik arz eden** bir aktarım olduğundan, yalnızca açık rızaya
> dayanmanın yeterli olup olmadığı değerlendirilmelidir. → `[ ]`

### 5. Verileriniz kimlere aktarılıyor

| Alıcı                     | Ne için            | Ne aktarılıyor                                       |
| ------------------------- | ------------------ | ---------------------------------------------------- |
| Ödeme kuruluşu            | Ödeme alma, iade   | Ad, iletişim, tutar (**kart bilgisi bizde hiç yok**) |
| Kargo firması             | Teslimat           | Ad, adres, telefon                                   |
| Satıcı (mağaza)           | Siparişi hazırlama | Ad, teslimat adresi, sipariş içeriği                 |
| Yapay zekâ sağlayıcısı    | Sanal deneme       | **Yalnızca fotoğraf ve ürün görseli**                |
| E-posta / SMS sağlayıcısı | Bildirim           | E-posta, telefon                                     |
| Yetkili kamu kurumları    | Yasal talep        | Talebin kapsamıyla sınırlı                           |

**Satıcılar fotoğrafınızı göremez.** Yönetici hesapları da göremez.

### 6. Ne kadar süre saklıyoruz

| Veri                                              | Süre                                           |
| ------------------------------------------------- | ---------------------------------------------- |
| "Yalnızca bu deneme için kullan" seçilen fotoğraf | **24 saat**                                    |
| "Profilimde saklansın" seçilen fotoğraf           | **90 gün**, her kullanımda yenilenir           |
| Deneme görselleri                                 | Kaynak fotoğrafla birlikte silinir             |
| Üyelik bilgileri                                  | Üyelik süresince                               |
| Hesap silme sonrası bekleme                       | **30 gün** (fikrinizi değiştirebilirsiniz)     |
| Sipariş, fatura, mali kayıtlar                    | `[ ]` yasal süre — kimlik bağlantısı koparılır |

Süre dolduğunda silme **otomatik** yapılır; talebinizi beklemez.

### 7. Haklarınız (KVKK md. 11)

Kişisel verileriniz hakkında:
işlenip işlenmediğini öğrenme · bilgi talep etme · işlenme amacını ve amacına
uygun kullanılıp kullanılmadığını öğrenme · yurt içinde/dışında aktarıldığı
üçüncü kişileri bilme · eksik veya yanlış işlenmişse düzeltilmesini isteme ·
silinmesini veya yok edilmesini isteme · bu işlemlerin aktarım yapılan üçüncü
kişilere bildirilmesini isteme · münhasıran otomatik sistemlerle analiz edilmesi
sonucu aleyhinize bir sonuç doğmasına itiraz etme · zarara uğramanız hâlinde
zararın giderilmesini talep etme.

**Uygulama içinden tek tıkla yapabilecekleriniz:**

- Fotoğrafımı sil
- Deneme geçmişimi sil
- Tüm görsel verilerimi sil
- Verilerimi indir
- Hesabımı sil
- Rızalarımı tek tek geri çek

Yazılı başvuru: `[ ]`

### 8. Yapay zekâ görselleri hakkında

Sanal deneme çıktısı **gerçek bir fotoğraf değildir**; yapay zekâ tarafından
üretilmiş bir tahmindir. Üretilen her görselin üzerinde bu uyarı yer alır ve
görseli indirseniz de uyarı görselin içinde kalır.

Kıyafetin görselde iyi durması, size **fiziksel olarak uyacağı anlamına gelmez**.
Beden önerisi bir tahmindir, garanti değildir.

---

# BÖLÜM 2 — AÇIK RIZA METNİ

> **Ekranda nasıl görünecek:** her madde ayrı kutu, hiçbiri önceden işaretli
> değil, zorunlu olanlar açıkça belirtilmiş. "Hepsini kabul et" düğmesi
> **yoktur** — paketlenmiş rıza geçersizdir.

---

### Sanal deneme için izniniz

Kıyafeti kendi fotoğrafınız üzerinde görebilmek için fotoğrafınızı işlememiz
gerekiyor. Fotoğrafınız **özel nitelikli kişisel veridir**; bu yüzden sizden ayrı
ayrı izin istiyoruz.

<br>

**☐ Fotoğrafımın sanal deneme için işlenmesine izin veriyorum.** · _zorunlu_

Fotoğrafınız yalnızca seçtiğiniz ürünü üzerinizde göstermek için kullanılır.
Başka hiçbir amaçla kullanılmaz.

<br>

**☐ Fotoğrafımın yurt dışındaki hizmet sağlayıcısına aktarılmasına izin veriyorum.** · _zorunlu_

Görseli üreten hizmet yurt dışında çalışıyor. Fotoğrafınız 10 dakika geçerli,
tek kullanımlık bir bağlantıyla oraya gönderilir. **Adınız, iletişim bilginiz ve
sipariş geçmişiniz gönderilmez.** Aktarım yapılan ülke: `[ ]`

<br>

**☐ Fotoğrafım profilimde saklansın.** · _isteğe bağlı_

İşaretlemezseniz fotoğrafınız **24 saat** içinde silinir ve her denemede yeniden
yüklemeniz gerekir. İşaretlerseniz **90 gün** saklanır, kullandıkça uzar.
İstediğiniz an silebilirsiniz.

<br>

**☐ Fotoğrafım yapay zekâ modelinin geliştirilmesinde kullanılabilir.** · _isteğe bağlı_

**Bu kutu varsayılan olarak kapalıdır.** İşaretlemezseniz fotoğrafınız model
eğitiminde kullanılmaz — ürünün çalışmasını hiçbir şekilde etkilemez.

<br>

**☐ Kampanya ve indirim bildirimleri almak istiyorum.** · _isteğe bağlı_

<br>

---

_Zorunlu iki izni vermezseniz sanal deneme özelliğini kullanamazsınız; üyeliğiniz
ve alışverişiniz etkilenmez._

_Verdiğiniz izinleri istediğiniz an **Hesabım → Gizlilik** sayfasından geri
çekebilirsiniz. Geri çekmeniz geçmişe etkili değildir; geri çekildiği andan
itibaren işlem durur ve talep ederseniz verileriniz silinir._

[Aydınlatma Metnini Oku] · [Vazgeç] · [Onayla ve Devam Et]

---

# BÖLÜM 3 — Teknik notlar (avukat için)

Metindeki her teknik iddia kodda karşılığı olan bir davranıştır:

| Metindeki ifade                               | Kodda karşılığı                                                               |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| "Rızanız olmadan hiçbir işlem yapılmaz"       | Rıza kontrolü atlanamaz; yoksa istek reddedilir ve sağlayıcıya çağrı yapılmaz |
| "10 dakika geçerli, tek kullanımlık bağlantı" | İmzalı URL, süre sabiti yapılandırmada tanımlı                                |
| "Adınız gönderilmez"                          | Sağlayıcıya yalnızca görseller ve anonim iş numarası gider                    |
| "24 saat / 90 gün"                            | Kayıtta bitiş tarihi tutulur, saatlik silme görevi çalışır                    |
| "Otomatik silinir"                            | Zamanlanmış görev; çalışmazsa alarm üretir                                    |
| "Satıcılar ve yöneticiler göremez"            | Yetkilendirme kuralı; istisnai erişim gerekçe ve denetim kaydı ister          |
| "Uyarı görselin içinde kalır"                 | Filigran piksel düzeyinde gömülür                                             |
| "Varsayılan kapalı"                           | Model eğitimi rızası varsayılan olarak verilmemiş kabul edilir                |

### Avukatın karar vermesi gereken beş konu

1. **Yurt dışı aktarım dayanağı** — standart sözleşme mi, taahhütname mi, açık
   rıza mı? Süreklilik arz eden aktarımda açık rızanın tek başına yeterliliği
   tartışmalıdır.
2. **Mali kayıtların saklama süresi** ve dayanağı.
3. **Yaş sınırı** — sistemde şu an yaş doğrulaması **yoktur**. Gerekiyorsa
   kayıt akışına eklenmesi gerekir; bu bir geliştirme işidir.
4. **Satıcı görsellerindeki model kişilerin rızası** kimin sorumluluğunda?
   Satıcı sözleşmesine madde gerekiyor mu?
5. **Kullanıcının deneme görselini sosyal medyada paylaşması** ek aydınlatma
   gerektiriyor mu?

---

**Kaynaklar (yabancı uygulama):**
[Biometric Consent: A GDPR Compliance Guide](https://didit.me/blog/biometric-consent-gdpr-compliance/) ·
[Processing biometric data? Be careful, under the GDPR — IAPP](https://iapp.org/news/a/processing-biometric-data-be-careful-under-the-gdpr) ·
[Biometric Data GDPR Compliance](https://gdprlocal.com/biometric-data-gdpr-compliance-made-simple/) ·
[The Hidden Biometric Compliance Crisis in Immersive Tech](https://secureprivacy.ai/blog/vr-ar-biometric-compliance-immersive-tech-consent) ·
[Transfers to third countries — Irish DPC](https://www.dataprotection.ie/en/organisations/international-transfers/transfers-personal-data-third-countries-or-international-organisations) ·
[What rules apply if my organisation transfers data outside the EU — European Commission](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/obligations/what-rules-apply-if-my-organisation-transfers-data-outside-eu_en)
