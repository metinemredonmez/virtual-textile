-- Konteyner ilk kez ayağa kalktığında çalışır.
-- Prisma bu eklentileri yönetmediği için burada kuruyoruz.

CREATE EXTENSION IF NOT EXISTS "vector";      -- pgvector: görsel embedding / benzer ürün
CREATE EXTENSION IF NOT EXISTS "pg_trgm";     -- trigram: autocomplete + yazım toleransı
CREATE EXTENSION IF NOT EXISTS "unaccent";    -- aksan/Türkçe karakter normalizasyonu
CREATE EXTENSION IF NOT EXISTS "btree_gin";   -- karma faset indeksleri
CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- gen_random_uuid, digest

-- Türkçe arama yapılandırması: unaccent + turkish stemmer
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
