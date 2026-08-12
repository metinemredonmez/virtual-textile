-- ⚠️ BU MİGRATION UYGULANMADI VE `migrations/` KLASÖRÜNDE DEĞİL.
--
-- Prisma yalnızca `prisma/migrations/` altını okur; buradaki dosya hiçbir
-- komutla kendiliğinden çalışmaz. Uygulamak için klasör `migrations/` altına
-- taşınmalı VE `schema.prisma` aynı değişikliklerle güncellenmelidir (aksi
-- hâlde `prisma migrate dev` drift bildirir).
--
-- ── KARAR (2026-08-12): ŞİMDİ UYGULANMADI — YAZAN KOD İLE BİRLİKTE GELMELİ.
--
-- Fayda gerçek ve aşağıda doğru anlatılmış (geçmiş ekranı üç satır yerine tek
-- kombin göstermeli). Ama BUGÜN taşınırsa ortaya ÖLÜ ŞEMA çıkar:
--   • `outfitGroupId` ve `layerIndex` alanlarını YAZAN hiçbir kod yok —
--     `MultiTryOnService.enqueue` satırları bu alanlar olmadan oluşturuyor.
--     Kolonlar kalıcı olarak NULL kalır.
--   • Yeni indeks, hiçbir sorgunun okumadığı NULL bir kolon üzerinde her
--     `ai_tryon_jobs` INSERT'ine bakım maliyeti bindirir. Bugün yalnızca
--     gideri var, getirisi yok.
--   • Bu arada şema "grup var" der, veri "yok" der; sonraki okuyucu için
--     yanıltıcıdır — geriye dönük veri taşıma gerekmediği hâlde eski
--     satırların neden boş olduğu tartışılır.
--
-- ⚠️ ENUM'DAN FARKI, ERTELEMEYİ BEDAVA KILAN ŞEY: bunlar KOLON; gerekirse
--    `DROP COLUMN` ile geri alınır. Geri alınamaz olan enum değerinde
--    "önden ekleyelim" riskliydi, burada beklemenin maliyeti sıfır.
--
-- UYGULAMA KOŞULU (üçü AYNI değişiklik setinde):
--   1. yazma yolu  — `MultiTryOnService.enqueue` her adıma grup kimliği +
--                    katman sırası yazsın,
--   2. okuma yolu  — `GET /tryon/history` grup başına tek kayıt döndürsün,
--   3. bu migration + `schema.prisma` alanları.
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
