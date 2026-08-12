-- ── DİJİTAL GARDIROP ───────────────────────────────────────────────────────
--
-- NİÇİN ŞİMDİ: `apps/api/src/modules/wardrobe/` yazıldı ve testleri geçiyor,
-- ama modül `app.module.ts`e KAYDEDİLEMİYORDU çünkü dayandığı tablo yoktu.
-- Kayıtsız modül = ölü kod: iş kuralları var, hiçbir kullanıcı isteği onlara
-- ulaşmıyor. Bu migration o kilidi açar; aynı sette modül de kaydediliyor.
--
-- ⚠️ TABLO ADI `user_wardrobe_items`. Modül içindeki `proposed-migration.sql`
--    öneksiz `wardrobe_items` diyordu ve kararı şema sahibine bırakmıştı.
--    Önek eklendi: şemadaki 60 modelin tamamı alan öneki taşıyor
--    (user_, catalog_, order_, cart_, ai_, finance_, infra_, search_) ve
--    gardırop kullanıcının verisidir — hesap silindiğinde onunla gider.
--    Kod tarafı etkilenmez: erişim Prisma model adı (`DigitalWardrobeItem`)
--    üzerindendir, tablo adı hiçbir TS dosyasında geçmez.
--
-- ⚠️ BU DOSYA ELLE YAZILDI, `migrate diff` ÇIKTISI OLDUĞU GİBİ KULLANILMADI.
--    Sebep: diff üç tane YIKICI satır da üretiyor —
--      DROP INDEX "catalog_products_embedding_idx"        (pgvector HNSW)
--      DROP INDEX "finance_commission_rules_scope_unique" (kısmi unique)
--      ALTER TABLE "catalog_products" ... "searchVector" DROP DEFAULT
--    Üçü de ham SQL migration'larıyla kurulmuş, Prisma şemasında ifade
--    EDİLEMEYEN yapılar. Diff onları "şemada yok, demek ki silinmeli" sayıyor.
--    Uygulansaydı vektör araması ve komisyon kuralı tekilliği sessizce
--    düşerdi. Buraya yalnızca gardırop satırları alındı.

-- CreateEnum
CREATE TYPE "WardrobeSource" AS ENUM ('PURCHASE', 'MANUAL');

-- CreateTable
CREATE TABLE "user_wardrobe_items" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "WardrobeSource" NOT NULL,

    -- ⚠️ NULL OLABİLİR ve bu bir gereksinimdir: kullanıcı platformda
    --    satılmayan kendi parçasını da ekleyebilmeli. NOT NULL olsaydı
    --    gardırop, kullanıcının dolabını değil yalnızca bizden aldıklarını
    --    gösterirdi ve kombin önerisi eksik bir dolaba bakardı.
    "variantId" TEXT,

    "category" "TryOnCategory" NOT NULL,
    "color" TEXT NOT NULL,
    "label" TEXT,

    -- ⚠️ ÖZEL NİTELİKLİ VERİ — private kovadaki anahtar. MANUAL kayıtlarda
    --    dolu. Ürün görselinden (public kova) AYRI kolonda tutulur ki bir
    --    sorgu yanlışlıkla ikisini aynı yoldan servis edemesin.
    "photoKey" TEXT,

    -- PURCHASE kayıtlarında ürünün public görsel anahtarı (snapshot).
    "productImageKey" TEXT,

    -- ⚠️ İDEMPOTENTLİĞİN DAYANAĞI. Bkz. aşağıdaki UNIQUE indeks.
    "sourceOrderItemId" TEXT,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_wardrobe_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_wardrobe_items_userId_createdAt_idx" ON "user_wardrobe_items"("userId", "createdAt");

-- Kombin önerisi kategoriye göre filtreler.
-- CreateIndex
CREATE INDEX "user_wardrobe_items_userId_category_idx" ON "user_wardrobe_items"("userId", "category");

-- ═══════════════════════════════════════════════════════════════════════════
--  ⚠️⚠️ MÜKERRER KAYIT SAVUNMASI — BU İNDEKS OLMADAN İDEMPOTENTLİK YOKTUR
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Outbox EN AZ BİR KEZ teslim eder (bkz. outbox.dispatcher.ts) ve BullMQ işi
--  3 kez dener. Ayrıca iade reddi paketi RETURN_REQUESTED → DELIVERED geri
--  döndürdüğünde `package.delivered` İKİNCİ KEZ gerçekten üretilir.
--
--  Uygulama katmanında "önce var mı diye bak, yoksa yaz" YETMEZ: iki
--  eşzamanlı tüketici de "yok" cevabı alır ve iki satır yazar. Tekilliği
--  yarış koşullarına dayanıklı biçimde yalnızca veritabanı kurabilir.
--
--  PostgreSQL'de NULL'lar birbirinden FARKLI sayılır; bu yüzden MANUAL
--  kayıtlar (sourceOrderItemId IS NULL) bu indeksten etkilenmez ve kullanıcı
--  istediği kadar el ile parça ekleyebilir.
-- CreateIndex
CREATE UNIQUE INDEX "user_wardrobe_items_userId_sourceOrderItemId_key" ON "user_wardrobe_items"("userId", "sourceOrderItemId");

-- ⚠️ ON DELETE CASCADE: hesap silindiğinde gardırop SATIRLARI da gider.
--    NOT: satırın gitmesi FOTOĞRAFIN gitmesi DEĞİLDİR — depodaki nesneyi
--    `AccountDeletionJob` ayrıca siler (wardrobe/<userId>/ öneki).
-- AddForeignKey
ALTER TABLE "user_wardrobe_items" ADD CONSTRAINT "user_wardrobe_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ⚠️ Varyant SİLİNİRSE gardırop parçası SİLİNMEZ, bağlantısı kopar:
--    kullanıcının dolabındaki ceket, biz ürünü katalogdan kaldırdık diye yok
--    olmaz. ON DELETE SET NULL tam olarak bunu yapar — parça MANUAL'e benzer
--    bir hâle düşer, kombinlerde kalmaya devam eder, denenemez olur.
-- AddForeignKey
ALTER TABLE "user_wardrobe_items" ADD CONSTRAINT "user_wardrobe_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "catalog_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
