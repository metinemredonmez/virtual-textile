-- ⚠️ BU MİGRATION UYGULANMADI VE `migrations/` KLASÖRÜNDE DEĞİL.
--
-- Prisma yalnızca `prisma/migrations/` altını okur; buradaki dosya hiçbir
-- komutla kendiliğinden çalışmaz. Uygulamak için klasör `migrations/` altına
-- taşınmalı VE `schema.prisma` aynı değişikliklerle güncellenmelidir (aksi
-- hâlde `prisma migrate dev` drift bildirir).
--
-- ── NEDEN GEREKLİ ──────────────────────────────────────────────────────────
--
-- Markalar arası çoklu ürün denemesi, kombindeki HER KATMANI ayrı bir
-- `ai_tryon_jobs` satırı olarak tutar (satırın `cacheKey`i o katmanın ÖNEK
-- anahtarıdır). Bu tercih bilinçlidir: kota sayımı, `cacheKey` tekilliği ve
-- kota iadesi hiç değiştirilmeden çalışmaya devam eder.
--
-- Uçlar bu migration OLMADAN da çalışır — istemci adım kimliklerini yanıtta
-- alır. Eksik kalan tek şey GRUPLAMADIR:
--
--   1. `GET /tryon/history` üç parçalı bir kombini ÜÇ AYRI kayıt olarak
--      listeler. Kullanıcı tek bir deneme yaptığını bilir; geçmişinde birbirine
--      benzeyen üç satır görmek, hangisinin "gerçek" sonuç olduğunu
--      anlaşılmaz kılar.
--   2. `cart_outfits.tryOnJobId` yalnızca SON katmana işaret edebilir; o
--      kaydın hangi parçalardan oluştuğu veritabanından okunamaz, ancak
--      önbellek anahtarı yeniden hesaplanarak tahmin edilebilir.
--
-- ── DEĞİŞİKLİKLER ──────────────────────────────────────────────────────────

-- Aynı kombin denemesinin katmanlarını birbirine bağlar. NULL = tek ürün
-- denemesi (bugünkü tüm kayıtlar). Geriye dönük veri taşıma GEREKMEZ.
ALTER TABLE "ai_tryon_jobs" ADD COLUMN "outfitGroupId" TEXT;

-- Katmanın kombindeki sırası: 0 en alttaki parça. Sıra `cacheKey` içinde
-- zaten kodlu ama oradan OKUNAMAZ (özet geri çevrilemez); listeleme ve hata
-- ayıklama için ayrıca tutulur.
ALTER TABLE "ai_tryon_jobs" ADD COLUMN "layerIndex" INTEGER;

-- Geçmiş ekranı "her grubun en üst katmanı" sorgusunu bu indeksle çalıştırır.
CREATE INDEX "ai_tryon_jobs_outfitGroupId_layerIndex_idx"
  ON "ai_tryon_jobs"("outfitGroupId", "layerIndex");

-- ── AKSESUAR KATMANI (ayrı karar) ──────────────────────────────────────────
--
-- Katman sırası tablosu (bkz. @vt/adapters → OUTFIT_LAYER_ORDER) aksesuarı en
-- üst katman olarak zaten tanımlıyor, ama katalog enum'unda karşılığı yok ve
-- HİÇBİR SAĞLAYICI aksesuar giydiremiyor. Enum'a değer eklemek geri alınamaz
-- (PostgreSQL'de enum değeri silinemez); bu yüzden sağlayıcı desteği
-- doğrulanmadan uygulanmamalıdır.
--
-- ⚠️ `ALTER TYPE ... ADD VALUE` PostgreSQL 12+ ile transaction içinde
--    çalışabilir ama aynı transaction'da KULLANILAMAZ; Prisma bu ifadeyi ayrı
--    bir migration'a koymayı bekler.
--
-- ALTER TYPE "TryOnCategory" ADD VALUE 'ACCESSORY';
