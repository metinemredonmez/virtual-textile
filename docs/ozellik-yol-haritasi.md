# Özellik Yol Haritası

> Referans karşılaştırması DRESSX üzerinden yapıldı — sektörde bu işi en geniş
> yapan oyuncu o. Aşağıdaki tablo "onlarda var, bizde ne durumda" sorusunun
> cevabıdır.

---

## Karşılaştırma

| Özellik                                              | Durum      | Faz             |
| ---------------------------------------------------- | ---------- | --------------- |
| Gerçek fotoğraf üzerinde fotogerçekçi deneme         | ✅ **var** | MVP             |
| Renk / parça değiştirme                              | ✅ **var** | MVP             |
| AI kombin önerisi (stil danışmanı)                   | ✅ **var** | MVP             |
| Try-on uygunluk skoru + görsel kalite geri bildirimi | ✅ **var** | MVP             |
| Beden önerisi (kural motoru)                         | ✅ **var** | MVP             |
| **Markalar arası tam kombin**                        | 🔶 planlı  | **Faz 2**       |
| ML tabanlı beden/uyum motoru                         | 🔶 planlı  | Faz 2           |
| Doğal dilde arama                                    | 🔶 kısmi   | Faz 2           |
| Dijital gardırop                                     | 🔶 planlı  | Faz 2           |
| Video tabanlı deneme (kumaş hareketi)                | ❌         | Faz 3           |
| 3D avatar                                            | ❌         | Faz 3           |
| Mağaza içi AR ayna                                   | ❌         | **kapsam dışı** |

---

## Faz 2 — asıl ayrıştırıcı burada

**Markalar arası kombin MVP'nin hemen ardından gelmeli.**

Tek ürün denemesi artık ayrıştırıcı değil; Google Shopping ve büyük perakendeciler
de sunuyor. Bizim iddiamız _bir mağazanın ceketi + ikincinin pantolonu + üçüncünün
şapkası, aynı kişide, tek sepette_ — bunu yapan yok.

Teknik hazırlık zaten var:

- `Outfit` (kombin) veri modeli yazıldı
- Kombin tabanlı sepet çalışıyor
- Çok satıcılı sipariş ve komisyon paylaşımı çalışıyor
- `generateWithFallback` zinciri çoklu parçaya genişletilebilir

Eksik olan yalnızca **katman sırasına göre birleştirme** ve **parça bazlı yeniden
üretim** — kullanıcı bir parçayı değiştirince tüm görsel değil yalnızca ilgili
bölge yeniden üretilir. Bu hem hız hem maliyet kazancıdır ve arayüz tarafındaki
karusel kararı buna göre verildi (bkz. `design-system.md`).

---

## Faz 3 — video try-on

DRESSX'in en güçlü teknik iddiası: statik görsel yerine **videodan** öğrenerek
kumaşın dökülmesini, kırışmasını ve hareketini modellemek. Doğru bir iddia,
sonuç gözle görülür şekilde daha inandırıcı.

⚠️ **Ama birim ekonomiyi baştan yazar.** Video üretimi görsel üretiminden kat
kat pahalıdır: try-on başına ~$0,08 yerine muhtemelen $0,50–1,00 mertebesi.
`AI_DAILY_BUDGET_USD` ve komisyon marjı yeniden hesaplanmadan girilmemeli.

**Karar sırası:**

1. MVP'de statik kaliteyi ölç (30 ürün × 10 kişi, ort. ≥3,5/5 hedefi)
2. Gerçek try-on hacmini gör (`AiUsageLog` bunu tutuyor)
3. Video sağlayıcı fiyatını al, birim ekonomiyi yeniden çıkar
4. **Sonra** karar ver

"İstiyorum" demek yeterli değil; rakam görülmeden girilirse marj sessizce erir.

---

## Kapsam dışı — mağaza içi AR ayna

DRESSX Mirror insan boyutunda dokunmatik ekran; mağazada müşterinin yansımasına
kıyafet bindiriyor.

Bu bir **donanım ve perakende operasyonu** işidir, yazılım projesi değil.
Farklı bir iş kolu, farklı bir satış modeli, farklı bir ekip. Bu projenin
kapsamına alınması önerilmez.

---

## Kısa vadede sıralama

```
1. MVP'yi bitir          → frontend (backend hazır)
2. İlk gerçek try-on     → kalite ölç, sağlayıcı kararını veriyle ver
3. Faz 2                 → markalar arası kombin  ← ASIL İDDİA
4. Faz 3                 → video, maliyet görüldükten sonra
```

⚠️ Faz 2'yi Faz 3'ten önce yapmak kritik: markalar arası kombin **düşük ek
maliyetle** yapılabilir (aynı görsel üretimi, sadece çok parçalı), video ise
maliyeti katlar. Ayrıştırıcıyı ucuz olanla kurup pahalı olanı sonra eklemek
doğru sıradır.
