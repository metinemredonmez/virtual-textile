# Tasarım Yönü

> Karar verildi, tartışma kapandı. Yeni bir ekran yazarken önce buraya bak.
> Referanslar taklit edilmek için değil, **çözülmüş problemleri yeniden
> çözmemek** için burada.

---

## Tek cümlelik ilke

**Her yerde sade; yalnızca finansal tablolarda yoğun.**

Sayı yoğunluğu ledger'da bir zorunluluktur, başka hiçbir yerde süs değildir.

---

## Neden minimal — gerekçe

Bu platformun ayrıştırıcısı sanal deneme görselidir. O görselin işe yaraması için
etrafın **susması** gerekir.

Ürün fotoğrafları zaten renklidir. Arayüz de renkliyse ikisi yarışır ve moda
ürünü kaybeder. Bu yüzden akromatik palet bir estetik tercih değil, **işlevsel
bir karardır**.

---

## Referans haritası

| Ekran                                | Referans                                                                     | Ne alınıyor                                           |
| ------------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------- |
| Müşteri arayüzü                      | [SSENSE](https://www.ssense.com)                                             | Sadelik, tipografi hiyerarşisi, görselin hâkimiyeti   |
| Mağaza gösterimi                     | [Farfetch](https://www.farfetch.com)                                         | **Yalnızca** çok satıcılı üründe mağaza adının sunumu |
| Mobil filtre                         | [Grailed](https://www.grailed.com)                                           | Yalnızca çekmece kalıbı                               |
| Sanal deneme                         | [DRESSX](https://dressx.com)                                                 | Sonuç görseli sunumu, paylaşım ergonomisi             |
| Satıcı paneli                        | [Polaris](https://polaris.shopify.com) + [Medusa](https://demo.medusajs.com) | Ürün formu, varyant matrisi, toplu düzenleme          |
| Admin iskelet                        | [Linear](https://linear.app) + [Supabase](https://supabase.com/dashboard)    | Menü, sayfa yapısı, koyu tema, tek vurgu              |
| **Ledger · komisyon · payout · GMV** | **[Stripe](https://stripe.com/docs/dashboard)**                              | **Sayısal tablo tasarımı**                            |

### Taklit edilmeyecekler

- **Farfetch geneli** — kalabalık. Yapmak istemediğimiz şeyin örneği.
- **Polaris kodu** — bileşenleri almıyoruz, stack'imiz shadcn/ui. Kararlarını alıyoruz.

---

## Müşteri arayüzü

```
Palet       Akromatik: siyah / beyaz / gri + TEK vurgu rengi
Tipografi   Tek aile; hiyerarşi boyutla değil AĞIRLIKLA kurulur
Görsel      4:5 oran, tam genişlik, kenarlık yok, gölge yok
Kenar       Yumuşak köşe (8–12px), abartı yok
```

### Değişmez kural

**"Üzerimde Dene" ile "Sepete Ekle" aynı görsel ağırlıkta olur.**

Try-on ikincil bir özellik değil, ürünün kendisidir. İkincil düğme gibi
görünürse kullanıcı denemeden satın alır ve ayrıştırıcımız işe yaramaz.

### Çok satıcılı gösterim

```
Keten Oversize Gömlek        ← birincil, ağırlık 600
Atölye Nord                  ← ikincil, ağırlık 400, gri
1.290,00 ₺                   ← birincil
```

Mağaza adı görünür ama ürünün önüne geçmez.

---

## Satıcı paneli

Polaris'ten alınan kararlar:

- **Varyant matrisi** renk × beden tablosu olarak; her hücre stok + fiyat
- **Toplu düzenleme** satır seçimi + üst çubukta eylem
- **Ürün durumu** taslak / incelemede / yayında — her zaman görünür
- **Boş durumlar** ne yapılacağını söyler, sadece "kayıt yok" demez

Try-On Uygunluk Skoru satıcıya **somut** gösterilir:

> Skor 42/100 — "Arka planı sade bir görsel ekleyin, sanal deneme kalitesi
> belirgin biçimde artar."

Sayı tek başına eyleme dönüşmez; ne yapılacağı yazılır.

---

## Yönetim paneli

İkiye bölünür çünkü iki ayrı problem var:

### İskelet — Linear / Supabase

Koyu tema, tek vurgu rengi, düşük kontrastlı çizgiler, 36px satır yüksekliği,
klavye öncelikli gezinme. Az öğeyi rahat gösterir.

### Finansal tablolar — Stripe

Ledger, komisyon dökümü, payout listesi, GMV raporu: yüzlerce satır sayı.
Linear bu problemi çözmedi, Stripe çözdü.

```
1.290,00 ₺      ← sağa yaslı
   89,00 ₺      ← virgüller HİZALI
  399,80 ₺
```

⚠️ **Tabular rakam yazı tipi zorunlu** (`font-variant-numeric: tabular-nums`).
Rakamlar eşit genişlikte olmazsa virgüller kayar ve tablo okunamaz hâle gelir.
Para gösterilen her yerde geçerlidir.

Ayrıca:

- Satır içi mini grafikler (son 7 gün)
- Tablo üstünde 3–4 özet rakam, fazlası değil
- Varsayılan görünümde 5–9 öğe

---

## İkonlar — Lucide

Supabase ve Linear'ın kullandığı set. **shadcn/ui'de varsayılan olarak geliyor**,
ek kurulum yok.

```
Çizgi kalınlığı   1.5px, HER ikonda aynı
Boyut             16px (menü) · 20px (eylem) — metin satırıyla hizalı
Renk              beyaz DEĞİL, metinden bir ton SOLUK gri
Dolgu             yok, yalnızca çizgi
```

⚠️ Renk kuralı önemli: ikon menü metninden daha soluk olur. Göz önce yazıyı
okur, ikon yalnızca tanımaya yardım eder. Ikonu metinden parlak yapmak —
çoğu panelin yaptığı — gürültü üretir.

Aynı ekranda dolu ve çizgi ikon karıştırılmaz.

---

## Ekran başına öğe bütçesi

| Ekran          | Azami                                          |
| -------------- | ---------------------------------------------- |
| Ana sayfa      | 3 bölüm                                        |
| Ürün detay     | 1 görsel bloğu + 1 eylem bloğu + 1 bilgi bloğu |
| Admin panosu   | 5–9 öğe                                        |
| Finansal tablo | Sınırsız satır, ama **3–4 özet rakam**         |

Bütçe aşılıyorsa yeni bir ekran gerekiyordur, sıkıştırma değil.

---

## Gözden geçirme

Bu yön, ilk gerçek try-on görselleri üretildikten sonra tekrar değerlendirilir.
Görsel kalitesi beklenenin altındaysa arayüzün onu nasıl çerçevelediği değişebilir
(güven skorunun sunumu, uyarı metninin yeri).
