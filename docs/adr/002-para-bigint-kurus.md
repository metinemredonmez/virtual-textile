# ADR-002 — Para BigInt + kuruş

**Durum:** Kabul

## Bağlam

Platform komisyon hesaplıyor, indirim dağıtıyor, satıcı hakedişi çıkarıyor ve iade
yapıyor. Bu hesapların kuruşu kuruşuna tutması gerekiyor.

## Karar

Tüm tutarlar `BigInt` ve **kuruş** (minor unit). `123,45 ₺` → `12345n`.
Komisyon oranları **basis point** tam sayı (1250 = %12,50).

API sınırında `string` olarak taşınır (JSON `bigint` desteklemez).

## Gerekçe

`0.1 + 0.2 === 0.30000000000000004`. Bir siparişte fark edilmez; on bin siparişte
mutabakat tutmaz ve nerede kaybolduğu bulunamaz.

`Number`'a çevirmek de yeterli değil: 2^53 kuruşun üstündeki tutarlar sessizce bozulur.

## Sonuçlar

**Olumlu:** Yuvarlama hataları imkânsız. Yuvarlama yalnızca `applyBps()` içinde, açıkça
half-up olarak ve kalanı bildirerek yapılır. `allocate()` bir tutarı ağırlıklara göre
**kuruş kaybı olmadan** böler.

**Olumsuz:** `bigint` serileştirme her sınırda ele alınmalı. `serializeBigInts()` ve
`EnvelopeInterceptor` bunu merkezîleştirir.

**Zorlama:** `money()` tam sayı olmayan değeri reddeder; veritabanında `CHECK` kısıtları
negatif tutarı ve kalemi aşan komisyonu engeller.
