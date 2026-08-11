-- ═══════════════════════════════════════════════════════════════════════════
--  Arama altyapısı: Türkçe tam metin araması + vektör benzerlik araması
--
--  Prisma bu nesneleri şemada ifade edemediği için elle yazılmıştır:
--   • text search configuration (turkish_unaccent)
--   • generated column (searchVector)
--   • GIN / HNSW / kısmi indeksler
--
--  ⚠️ Docker init script'i KULLANILMAZ — staging ve üretimde çalışmaz.
--     Arama altyapısının her ortamda aynı olması için buradadır.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Türkçe arama yapılandırması ────────────────────────────────────────
-- "elbisesi" → "elbise" (stemmer) ve "İSTANBUL" → "istanbul" (unaccent).
-- Türkçe'ye özgü i/İ/ı/I sorunu unaccent + turkish_stem birleşimiyle çözülür.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'turkish_unaccent') THEN
    CREATE TEXT SEARCH CONFIGURATION turkish_unaccent (COPY = turkish);
    ALTER TEXT SEARCH CONFIGURATION turkish_unaccent
      ALTER MAPPING FOR hword, hword_part, word
      WITH unaccent, turkish_stem;
  END IF;
END
$$;

-- ── 2. Ürün arama vektörü (generated column) ──────────────────────────────
-- Ağırlıklar: A = başlık/marka, B = renk/desen/kumaş etiketleri, C = açıklama.
-- Generated column kullanılıyor çünkü trigger'a göre daha ucuz ve hep tutarlı.
ALTER TABLE "catalog_products" DROP COLUMN IF EXISTS "searchVector";

ALTER TABLE "catalog_products"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('turkish_unaccent', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('turkish_unaccent', coalesce("brandName", '')), 'A') ||
    setweight(to_tsvector('turkish_unaccent', coalesce("aiTags"->>'color', '')), 'B') ||
    setweight(to_tsvector('turkish_unaccent', coalesce("aiTags"->>'pattern', '')), 'B') ||
    setweight(to_tsvector('turkish_unaccent', coalesce("aiTags"->>'fabric', '')), 'B') ||
    setweight(to_tsvector('turkish_unaccent', coalesce("collection", '')), 'B') ||
    setweight(to_tsvector('turkish_unaccent', coalesce("description", '')), 'C')
  ) STORED;

CREATE INDEX "catalog_products_search_vector_idx"
  ON "catalog_products" USING GIN ("searchVector");

-- ── 3. Autocomplete / yazım toleransı ─────────────────────────────────────
-- "gomlek" yazana "gömlek" bulunsun diye trigram benzerliği.
CREATE INDEX "catalog_products_title_trgm_idx"
  ON "catalog_products" USING GIN ("title" gin_trgm_ops);

CREATE INDEX "catalog_products_brand_trgm_idx"
  ON "catalog_products" USING GIN ("brandName" gin_trgm_ops);

-- ── 4. Görsel benzerlik (pgvector, HNSW) ──────────────────────────────────
-- "Benzerini Bul" ve stil danışmanının aday ürün seçimi bunu kullanır.
-- HNSW, IVFFlat'e göre daha yüksek recall verir ve önceden eğitim istemez.
CREATE INDEX "catalog_products_embedding_idx"
  ON "catalog_products" USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ── 5. Katalog listeleme / faset indeksleri ───────────────────────────────
-- Kısmi indeks: sorguların neredeyse tamamı yalnızca yayındaki ürünlere bakar.
CREATE INDEX "catalog_products_published_idx"
  ON "catalog_products" ("categoryId", "popularityScore" DESC, "publishedAt" DESC)
  WHERE "status" = 'PUBLISHED';

CREATE INDEX "catalog_variants_price_idx"
  ON "catalog_variants" ("priceMinor")
  WHERE "isActive" = true;

CREATE INDEX "catalog_variants_color_idx"
  ON "catalog_variants" ("color")
  WHERE "isActive" = true;

CREATE INDEX "catalog_variants_size_idx"
  ON "catalog_variants" ("size")
  WHERE "isActive" = true;

-- ── 6. Satılabilir stok ───────────────────────────────────────────────────
-- Satılabilir = onHand - reserved. Tükenmiş varyantları hızlı elemek için.
CREATE INDEX "catalog_inventory_available_idx"
  ON "catalog_inventory" (("onHand" - "reserved"))
  WHERE ("onHand" - "reserved") > 0;

-- ── 7. Operasyonel kısmi indeksler ────────────────────────────────────────
-- Outbox dispatcher yalnızca yayınlanmamış kayıtları tarar — tablo büyüse de
-- indeks küçük kalır.
CREATE INDEX "infra_outbox_unpublished_idx"
  ON "infra_outbox_events" ("createdAt")
  WHERE "publishedAt" IS NULL;

CREATE INDEX "infra_webhook_unprocessed_idx"
  ON "infra_webhook_events" ("createdAt")
  WHERE "processedAt" IS NULL;

-- KVKK silme cron'u: süresi dolmuş ve henüz silinmemiş fotoğraflar.
CREATE INDEX "ai_user_photos_pending_deletion_idx"
  ON "ai_user_photos" ("expiresAt")
  WHERE "deletedAt" IS NULL;

-- Ödenmemiş siparişlerin stok rezervasyonunu serbest bırakan cron.
CREATE INDEX "order_orders_reservation_expiry_idx"
  ON "order_orders" ("reservationExpiresAt")
  WHERE "status" = 'PENDING_PAYMENT';

-- Satıcı SLA takibi: kargolanmayı bekleyen paketler.
CREATE INDEX "order_packages_sla_idx"
  ON "order_packages" ("slaDeadline")
  WHERE "status" IN ('AWAITING_APPROVAL', 'PREPARING');

-- Ödenebilir hakediş sorgusu.
CREATE INDEX "finance_ledger_available_idx"
  ON "finance_ledger_entries" ("sellerId", "availableAt")
  WHERE "availableAt" IS NOT NULL;

-- ── 8. Bütünlük kısıtları ─────────────────────────────────────────────────
-- Veritabanı seviyesinde savunma: uygulama kodunda bir hata olsa bile
-- veri tutarsız hâle gelemesin.

ALTER TABLE "catalog_inventory"
  ADD CONSTRAINT "inventory_non_negative"
  CHECK ("onHand" >= 0 AND "reserved" >= 0);

-- Rezerve edilen adet fiziksel stoğu aşamaz — fazla satışın son savunma hattı.
ALTER TABLE "catalog_inventory"
  ADD CONSTRAINT "inventory_reserved_within_on_hand"
  CHECK ("reserved" <= "onHand");

ALTER TABLE "catalog_variants"
  ADD CONSTRAINT "variant_price_non_negative"
  CHECK ("priceMinor" >= 0);

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_item_amounts_non_negative"
  CHECK ("unitPriceMinor" >= 0 AND "lineTotalMinor" >= 0 AND "commissionAmountMinor" >= 0);

-- Komisyon, kalemin kendisinden büyük olamaz.
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_item_commission_within_line"
  CHECK ("commissionAmountMinor" <= "lineTotalMinor");

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_item_quantity_positive"
  CHECK ("quantity" > 0);

ALTER TABLE "order_orders"
  ADD CONSTRAINT "order_totals_non_negative"
  CHECK ("itemsTotalMinor" >= 0 AND "grandTotalMinor" >= 0 AND "discountMinor" >= 0);

-- Komisyon oranı 0-%100 aralığında olmalı (basis point).
ALTER TABLE "finance_commission_rule_versions"
  ADD CONSTRAINT "commission_rate_within_range"
  CHECK ("rateBps" >= 0 AND "rateBps" <= 10000);

-- Payout tutarı pozitif olmalı.
ALTER TABLE "finance_payout_requests"
  ADD CONSTRAINT "payout_amount_positive"
  CHECK ("amountMinor" > 0);

-- Try-on güven skoru 0-100 aralığında.
ALTER TABLE "ai_tryon_jobs"
  ADD CONSTRAINT "tryon_confidence_range"
  CHECK ("visualConfidence" IS NULL OR ("visualConfidence" >= 0 AND "visualConfidence" <= 100));

-- Ürün kalite skorları 0-100 aralığında.
ALTER TABLE "catalog_products"
  ADD CONSTRAINT "product_tryon_score_range"
  CHECK ("tryOnScore" IS NULL OR ("tryOnScore" >= 0 AND "tryOnScore" <= 100));

ALTER TABLE "ai_user_photos"
  ADD CONSTRAINT "photo_quality_score_range"
  CHECK ("qualityScore" IS NULL OR ("qualityScore" >= 0 AND "qualityScore" <= 100));

-- Yorum puanı 1-5.
ALTER TABLE "catalog_reviews"
  ADD CONSTRAINT "review_rating_range"
  CHECK ("rating" >= 1 AND "rating" <= 5);
