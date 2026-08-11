# ADR-005 — Arama PostgreSQL'de, ayrı motor yok

**Durum:** Kabul

## Bağlam

Katalog araması Türkçe çalışmalı, yazım hatasına toleranslı olmalı, faset filtre
desteklemeli ve görsel benzerlikle "benzerini bul" sunmalı.

Keşif dokümanı OpenSearch öneriyordu.

## Karar

MVP'de her şey PostgreSQL 17'de:

- **Türkçe FTS**: `turkish_unaccent` yapılandırması (`unaccent` + `turkish_stem`)
  üzerinde generated `tsvector` column, GIN indeksli
- **Yazım toleransı / autocomplete**: `pg_trgm`
- **Görsel benzerlik**: `pgvector`, HNSW indeksi, kosinüs mesafesi

## Gerekçe

Bu katalog boyutunda ayrı bir arama kümesi:

- Bir servis daha (deploy, izleme, yedekleme)
- Senkronizasyon sorunu (ürün güncellendi, indeks bayat)
- Aylık ek maliyet

Buna karşılık PostgreSQL yeterli sonucu veriyor. Doğrulandı:

| Sorgu                            | Sonuç                                             |
| -------------------------------- | ------------------------------------------------- |
| `gomlek` (aksansız)              | "Keten Oversize **Gömlek**" bulunur               |
| `palazo pantolon` (yanlış yazım) | "Yüksek Bel **Palazzo Pantolon**", 0.48 benzerlik |

Ayrıca tek veritabanı = arama sonuçlarını stok ve fiyatla **aynı transaction'da**
filtreleyebilmek demektir. Ayrı motorda "stokta yok" ürünler arama sonucunda görünür.

## Sonuçlar

**Olumlu:** Bir servis eksik, senkronizasyon sorunu yok, ilişkisel filtreler ücretsiz.

**Olumsuz:** Çok dilli arama, gelişmiş sıralama modelleri ve çok yüksek eşzamanlılık
PostgreSQL'i zorlar.

**Geçiş yolu:** Arama bir arayüz (`SearchProvider`) arkasında. Geçiş bir haftalık iştir.

## Gözden geçirme

- Ürün sayısı 200.000'i aştığında
- Arama p95 gecikmesi 300 ms'yi geçtiğinde
- Kişiselleştirilmiş sıralama modeli gerektiğinde
