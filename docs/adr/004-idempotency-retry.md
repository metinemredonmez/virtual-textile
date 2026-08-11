# ADR-004 — Idempotency anahtarı yoksa retry yok

**Durum:** Kabul

## Bağlam

Dış servis çağrıları başarısız olur. Yeniden deneme çoğu zaman doğru davranıştır —
ama ödeme çekiminde değil.

## Karar

`resilient()` sarmalayıcısı, `idempotencyKey` verilmediyse **retry yapmaz**.
`retryAttempts: 5` yazılsa bile tek deneme yapılır.

Bu yorumla rica edilmez, kodda zorlanır:

```ts
const maxAttempts = options.idempotencyKey ? Math.max(1, options.retryAttempts ?? DEFAULT) : 1;
```

## Gerekçe

Ağ zaman aşımı, isteğin karşı tarafa ulaşmadığı anlamına gelmez. Ödeme çekimi zaman
aşımına uğrayıp yeniden denenirse ve ilk istek aslında işlendiyse, müşteriden **iki kez
para çekilir**.

Bu hatanın maliyeti: para iadesi, müşteri güveni, muhasebe mutabakatının bozulması ve
şikâyet. Hata dönmek her zaman daha ucuzdur.

`idempotencyKey`'in varlığı çağıran tarafın "bu çağrıyı tekrarlamak güvenlidir"
taahhüdüdür — sağlayıcıya her denemede aynı anahtar gider.

## İşlem bazında

| İşlem         | Retry | Anahtar                                 |
| ------------- | ----- | --------------------------------------- |
| `initiate3ds` | ✅    | `conversationId` = `orderId`            |
| `complete3ds` | ❌    | Hata → `inquire()` ile durum sorgulanır |
| `refund`      | ✅    | `refundRef` = `returnId`                |
| `payout`      | ✅    | `payoutRef` = `payoutId`                |
| try-on        | ✅    | `cacheKey`                              |

## Sonuçlar

Yeni bir adapter yazarken retry istiyorsan önce idempotency anahtarını tanımlamak
zorundasın. Bu, doğru soruyu doğru zamanda sordurur.

Kural [`resilient.test.ts`](../../packages/adapters/src/resilience/resilient.test.ts)
içinde sabitlenmiştir.
