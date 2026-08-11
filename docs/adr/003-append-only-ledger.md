# ADR-003 — Append-only ledger, bakiye kolonu yok

**Durum:** Kabul

## Bağlam

Satıcı hakedişi hesaplanmalı, iade edilen siparişte komisyon geri verilmeli, payout
yapıldığında bakiye düşmeli. Bunların hepsi denetlenebilir olmalı.

## Karar

Her mali olay `LedgerEntry` tablosuna **bir satır** olarak yazılır. Satırlar
güncellenmez veya silinmez.

**Satıcı bakiyesi ayrı bir kolonda tutulmaz**, her zaman hesaplanır:

```sql
SELECT SUM(amount_minor) FROM finance_ledger_entries WHERE seller_id = ?
```

## Gerekçe

Bir `balance` kolonu er geç tutarsızlaşır: bir kod yolu güncellemeyi unutur, bir başkası
transaction dışında günceller, bir üçüncüsü yarış durumuna girer. Sonra "bakiye neden
yanlış?" sorusunun cevabı yoktur çünkü geçmiş yoktur.

Ledger'da her kuruşun bir sebebi ve zaman damgası vardır.

## Örnek

1.000 ₺ ürün, %12 komisyon, 50 ₺ kargo satıcıda:

| Olay              | type                  | amountMinor |
| ----------------- | --------------------- | ----------- |
| Sipariş ödendi    | `SALE`                | +100000     |
| Komisyon          | `COMMISSION`          | −12000      |
| Kargo payı        | `SHIPPING_SHARE`      | −5000       |
| **Bakiye**        |                       | **+83000**  |
| İade              | `REFUND`              | −100000     |
| Komisyon iadesi   | `COMMISSION_REVERSAL` | +12000      |
| Kargo payı iadesi | `SHIPPING_REVERSAL`   | +5000       |
| **Yeni bakiye**   |                       | **0**       |

## Sonuçlar

**Olumlu:** Denetlenebilir, düzeltmeler ters kayıtla yapılır, geçmiş yeniden üretilebilir.

**Olumsuz:** Bakiye sorgusu toplama gerektirir. `(sellerId, createdAt)` indeksi var;
satır sayısı sorun olursa dönemsel özet tablosu eklenir — ledger yine kaynak kalır.

**Ödenebilirlik:** `availableAt` alanı iade penceresi kapandıktan sonra dolar. Erken
payout, iade durumunda satıcıdan geri tahsilat gerektirir.
