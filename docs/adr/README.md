# Mimari Karar Kayıtları (ADR)

Geri alınması pahalı olan kararlar burada yazılır. Amaç, altı ay sonra "bu neden böyle?"
sorusuna kod arkeolojisi yapmadan cevap verebilmek.

Biçim: bağlam → karar → sonuçlar → ne zaman gözden geçirilir.

| #                                | Karar                                 | Durum |
| -------------------------------- | ------------------------------------- | ----- |
| [001](001-moduler-monolit.md)    | Modüler monolit, mikroservis değil    | Kabul |
| [002](002-para-bigint-kurus.md)  | Para BigInt + kuruş                   | Kabul |
| [003](003-append-only-ledger.md) | Append-only ledger, bakiye kolonu yok | Kabul |
| [004](004-idempotency-retry.md)  | Idempotency anahtarı yoksa retry yok  | Kabul |
| [005](005-postgres-arama.md)     | Arama PostgreSQL'de, ayrı motor yok   | Kabul |
