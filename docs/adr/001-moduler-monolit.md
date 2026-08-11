# ADR-001 — Modüler monolit, mikroservis değil

**Durum:** Kabul

## Bağlam

Keşif dokümanı 10+ ayrı servis öneriyordu (user, catalog, cart, order, payment,
inventory, promotion, return, notification, AI orchestrator...). MVP kısa bir takvimde
ve küçük bir takımla teslim edilecek.

## Karar

Tek deploy edilen bir NestJS uygulaması + ayrı bir kuyruk worker'ı. Modül sınırları
baştan net çizilir ve **ESLint ile zorlanır**.

## Gerekçe

Mikroservislerin bu aşamadaki maliyeti:

- Her servis için ayrı deploy, sağlık kontrolü, log toplama, izleme
- Dağıtık transaction: "sipariş oluştur + stok düş + komisyon yaz" üç servise yayılırsa
  saga gerekir
- Yerel geliştirme: 10 servisi ayağa kaldırmadan çalışamama
- Hata ayıklama: tek bir isteğin izini beş serviste sürmek

Faydası ise henüz yok: hiçbir modülün ayrı ölçeklenmesi gerekmiyor.

## Sonuçlar

**Olumlu:** Tek transaction, tek log akışı, tek deploy. Yerelde `pnpm dev` yeterli.

**Olumsuz:** Bir modülün hatası tüm süreci etkileyebilir. Bu, ağır işleri worker'a
taşıyarak ve devre kesiciyle sınırlanır.

**Sınır kuralları** (`eslint.config.mjs` + kod incelemesi):

1. Modül, başka modülün Prisma modeline doğrudan erişemez
2. Modüller arası yan etki domain event ile olur (Outbox → BullMQ)
3. Tablo öneki modül adına göre (`order_*`, `catalog_*`)
4. Yalnızca `index` / `*.service` / `*.types` dışarıdan import edilebilir

## Gözden geçirme

Bir modülün trafiği diğerlerinden bağımsız ölçeklenmeyi gerektirdiğinde. En olası ilk
aday: AI gateway ve arama.
