# Sanal Deneme — Kategori Desteği

> Hangi ürün kategorisinde "Üzerimde Dene" düğmesi çıkar, çıkmayanlarda neden
> çıkmaz. Karar sağlayıcı yeteneğine dayanır, isteğe değil.

---

## Bugünkü durum

| Kategori          | Try-on | Sebep                                    |
| ----------------- | ------ | ---------------------------------------- |
| `UPPER_BODY`      | ✅     | FASHN v1.6 destekliyor                   |
| `LOWER_BODY`      | ✅     | FASHN v1.6 destekliyor                   |
| `DRESS`           | ✅     | FASHN v1.6 destekliyor                   |
| `OUTERWEAR`       | ✅     | FASHN v1.6 destekliyor                   |
| `SHOES`           | ❌     | **sağlayıcıda model yok**                |
| `JEWELRY`         | ❌     | **sağlayıcıda model yok**                |
| `BAG`             | ❌     | **sağlayıcıda model yok**                |
| `ACCESSORY`       | ❌     | **sağlayıcıda model yok**                |

Ürünler bu kategorilerde **satılır**; yalnızca sanal deneme kapalıdır.

---

## Araştırma bulgusu (2026-08-12)

fal.ai üzerindeki try-on modelleri — FASHN v1.6, Kling Kolors v1.5,
image-apps-v2 — **giysiye özgüdür**. Ayakkabı, takı veya çanta için ayrılmış
bir model yoktur.

Piyasada aksesuar "try-on" diye pazarlanan araçlar var (SellerPic, Pic Copilot,
Bandy). ⚠️ **Yaptıkları iş bizimkinden farklıdır:** ürünü, AI'nin ürettiği bir
mankenin üzerinde gösteriyorlar. Bizim vaadimiz _kullanıcının kendi
fotoğrafında_ görmesi.

Aradaki fark pazarlama değil, ürün farkıdır:

```
Onlar     ürün görseli  →  yapay manken üzerinde ürün görseli
                           (satıcı için görsel üretme aracı)

Biz       ürün görseli  →  MÜŞTERİNİN FOTOĞRAFI üzerinde ürün
          + kullanıcı fotoğrafı
```

Aksesuar araçlarını entegre etmek bize müşteri denemesi kazandırmaz; satıcıya
katalog görseli üretir. Bu ayrı bir özelliktir ve ayrı değerlendirilmelidir —
"ayakkabı try-on'u geldi" diye sunulamaz.

### Neden ayrı bir teknik problem

Giysi denemesi gövdeye örtü bindirmektir. Diğerleri değil:

- **Ayakkabı** — ayağın açısı, zemin teması ve gölgesi. Yanlış oturduğunda
  kullanıcı "havada duruyor" der; kıyafette aynı hata fark edilmez.
- **Takı** — milimetrik ölçek. Yüzük parmağa göre iki kat büyük çizilirse
  görsel değersizdir; kıyafette %10 hata tolere edilir.
- **Çanta** — giyilen değil **tutulan** nesne. El pozunu ve kavrayışı
  modellemek gerekir; bu, örtü bindirmekten farklı bir problemdir.

---

## Kod tarafındaki karşılığı

⚠️ `TRYONABLE_CATEGORIES` **elle yazılan bir liste değildir**; sağlayıcı
yetenek matrisinden türetilir. Elle yazılsaydı iki gerçek (sağlayıcının
yapabildiği ile listenin iddiası) ayrışabilirdi ve arada kalan kullanıcı
düğmeye basıp para harcayan ama sonuç alamayan kişi olurdu.

Enum değerleri şemada **vardır** ama try-on kapalıdır. Bu, "ölü şema" değildir:
değerler ürün kategorisi olarak bugün kullanılır (mağazada ayakkabı satılıyor),
yalnızca deneme yeteneği yoktur.

**Bir kategori açıldığında yapılacak tek şey matrise satır eklemektir.**
Migration gerekmez, şema değişmez.

---

## Açma koşulu

Bir kategoriyi açmadan önce üçü birden:

1. Sağlayıcının o kategori için **modeli olmalı** (pazarlama sayfası değil, API
   ucu)
2. **Birim maliyet** ölçülmeli ve komisyon marjıyla karşılaştırılmalı
3. **Kalite ölçülmeli** — 30 ürün × 10 kişi, ortalama ≥ 3,5/5
   (`docs/ozellik-yol-haritasi.md` içindeki statik kalite eşiğinin aynısı)

⚠️ Sıra önemli: 1 olmadan 2 ve 3 anlamsızdır. "İstiyorum" bir açma gerekçesi
değildir — video try-on kararında da aynı kural uygulanıyor.
