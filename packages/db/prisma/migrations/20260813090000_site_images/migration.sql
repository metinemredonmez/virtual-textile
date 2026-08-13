-- ── ADMİNDEN YÖNETİLEN SİTE GÖRSELLERİ ─────────────────────────────────────
--
-- NİÇİN: bugün vitrin afişi İLK ÜRÜNÜN fotoğrafı. Yönetici seçemiyor. Bu iki
-- tablo afişi, kategori kapağını ve koleksiyon kapağını yönetilebilir hâle
-- getirir. Ürün görseli DEĞİL — SİTE görseli.
--
-- ⚠️ ALAN ÖNEKİ `content_`. Şemadaki 60 modelin tamamı bir alan öneki taşıyor
--    (user_, catalog_, order_, cart_, ai_, finance_, infra_, search_) ve site
--    içeriği bunların HİÇBİRİ değil: kullanıcının verisi değil, katalog değil,
--    altyapı değil. Yeni bir alan açmak, var olan birine zorla sığdırmaktan
--    dürüst; `catalog_` deseydik afiş bir gün ürün gibi davranmaya başlardı.
--
-- ⚠️ GERİ ALINABİLİR. Bu migration YALNIZCA iki tablo yaratır; var olan hiçbir
--    tabloya kolon eklemez, hiçbir tipi değiştirmez, hiçbir enum'a değer
--    eklemez. Geri alma tam olarak şudur:
--
--        DROP TABLE "content_site_image_cards";
--        DROP TABLE "content_site_images";
--
--    (Sıra önemli: kart tablosu afişe FK ile bağlı.) Veri kaybı afişlerin
--    kendisiyle sınırlıdır; katalog, sipariş ve finans tarafında tek satır
--    etkilenmez. Vitrin boş duruma düşer ve BUGÜNKÜ davranışına — ilk ürünün
--    fotoğrafı — geri döner, yani sayfa geri almadan sonra da çalışır.
--
-- ⚠️ `slot` PostgreSQL enum'ı DEĞİL, TEXT. Ölçülen gerekçe:
--    `20260812150000_tryon_category_accessories/migration.sql:19-23` —
--    `ALTER TYPE ... ADD VALUE` GERİ ALINAMAZ. Dördüncü bir yüzey (ör.
--    "kampanya şeridi") eklemek ikinci bir geri alınamaz migration demek
--    olurdu. Geçerli değerler `packages/config/src/constants.ts` →
--    `SITE_IMAGE_SLOTS` içinde tek kaynakta; uç Zod enum'ı oradan türetiyor ve
--    bir test ucun kabul ettiği her değerin o listede olduğunu ölçüyor.
--    CHECK kısıtı da KONMADI: kısıtı değiştirmek yine migration gerektirir,
--    yani enum'ın maliyetini adı değişmiş hâlde geri getirirdi.
--
-- ⚠️ BU DOSYA ELLE YAZILDI, `prisma migrate diff` ÇIKTISI OLDUĞU GİBİ
--    KULLANILMADI. Ölçüldü — diff bugün şu ÜÇ YIKICI satırı da üretiyor:
--      DROP INDEX "catalog_products_embedding_idx"        (pgvector HNSW)
--      DROP INDEX "finance_commission_rules_scope_unique" (kısmi unique)
--      ALTER TABLE "catalog_products" ... "searchVector" DROP DEFAULT
--    Üçü de ham SQL migration'larıyla kurulmuş, Prisma şemasında ifade
--    EDİLEMEYEN yapılar; diff onları "şemada yok, demek ki silinmeli" sayıyor.
--    Uygulansaydı vektör araması ve komisyon kuralı tekilliği SESSİZCE
--    düşerdi. Aşağıya yalnızca site görseli satırları alındı.

-- CreateTable
CREATE TABLE "content_site_images" (
    "id" TEXT NOT NULL,

    -- 'HERO' | 'CATEGORY_COVER' | 'COLLECTION_COVER' — bkz. SITE_IMAGE_SLOTS.
    "slot" TEXT NOT NULL,

    -- ⚠️ NULL OLABİLİR ve bu bir gereksinimdir: HERO'nun hedefi yoktur, site
    --    tektir. Kapaklarda dolu — CATEGORY_COVER'da `catalog_categories.id`
    --    (slug DEĞİL: slug @unique ama değişmez değil), COLLECTION_COVER'da
    --    koleksiyon slug'ı (koleksiyonun DB karşılığı yok, iniş sayfaları
    --    statik). İki farklı uzayı işaret ettiği için FK KONULAMAZ; doğrulama
    --    YAZMA anında uçta yapılır, OKUMA hoşgörülüdür.
    "targetKey" TEXT,

    -- Public kovadaki nesne anahtarı: `site/banner/<id>/original`.
    "storageKey" TEXT NOT NULL,

    "widthPx" INTEGER NOT NULL,
    "heightPx" INTEGER NOT NULL,
    "blurhash" TEXT,

    -- ⚠️ TEK DİL (TR), bilinçli. `aktifLocale()` sabit `VARSAYILAN_LOCALE`
    --    döndürüyor ve `[locale]` rotası yok; ikinci bir kolon YAZILIR AMA
    --    HİÇBİR YERDEN OKUNMAZDI. İleri şekil: content_site_image_translations.
    "title" TEXT,
    "subtitle" TEXT,
    "linkHref" TEXT,

    -- ⚠️ Varsayılan FALSE. Yükleme biter bitmez canlıya çıkmaz; yönetici
    --    görseli görüp açar. TRUE olsaydı yarım kalan bir deneme vitrine düşerdi.
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    -- Yükleyen yönetici (`user_users.id`). ⚠️ FK YOK: yönetici hesabı KVKK
    -- silme akışıyla kaldırılsa bile afiş sitede durmalıdır. Kapak kişisel
    -- veri değildir; FK olsaydı hesap silme, canlı vitrini düşürürdü.
    "createdBy" TEXT NOT NULL,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_site_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
--
-- ⚠️ `productIds TEXT[]` DEĞİL, JOIN TABLOSU. Dizide silinmiş bir ürün kimliği
--    kalır ve hero KIRIK bir kart çizer; FK + cascade ile kart kendiliğinden
--    düşer. FK yayın durumunu bilmez, o yüzden okuma sorgusu AYRICA
--    `status = 'PUBLISHED'` filtreler.
CREATE TABLE "content_site_image_cards" (
    "id" TEXT NOT NULL,
    "siteImageId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "content_site_image_cards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
--
-- ⚠️ Onay ucu ağ zaman aşımında tekrarlanabilir; aynı nesne için ikinci bir
--    satır açılmamalı. Tekilliğin dayanağı budur.
CREATE UNIQUE INDEX "content_site_images_storageKey_key" ON "content_site_images"("storageKey");

-- CreateIndex — vitrin okuması (slot + aktiflik + sıra).
CREATE INDEX "content_site_images_slot_isActive_sortOrder_idx" ON "content_site_images"("slot", "isActive", "sortOrder");

-- CreateIndex — kategori/koleksiyon kapağı okuması.
CREATE INDEX "content_site_images_slot_targetKey_sortOrder_idx" ON "content_site_images"("slot", "targetKey", "sortOrder");

-- ⚠️ `("slot","targetKey","sortOrder")` ÜZERİNDE UNIQUE KONMADI ve bu bilinçli
--    bir sapmadır. İki ölçülen sebep:
--
--    (1) HERO'da `targetKey` NULL ve PostgreSQL'de NULL <> NULL — kısıt
--        afişlerde HİÇ uygulanmaz, kapaklarda uygulanırdı. Yarısı çalışan bir
--        kısıt, olmayan bir kısıttan kötüdür: yazarı "korunuyorum" sanır.
--    (2) Yöneticiyi çıkmaza sokardı: B'yi A'nın üstüne almak için önce A'yı
--        boş bir sıraya taşımak gerekirdi, yoksa P2002. Aynı gerekçeyle "aynı
--        anda tek aktif hero" da DB kısıtıyla zorlanmıyor.
--
--    Sıra belirsizliği okuma tarafında çözülür: `ORDER BY sortOrder ASC,
--    createdAt DESC` — eşitlikte en yeni kazanır, sonuç DETERMİNİSTİK.

-- CreateIndex
CREATE INDEX "content_site_image_cards_siteImageId_sortOrder_idx" ON "content_site_image_cards"("siteImageId", "sortOrder");

-- CreateIndex — aynı ürün aynı afişe iki kez bağlanmaz.
CREATE UNIQUE INDEX "content_site_image_cards_siteImageId_productId_key" ON "content_site_image_cards"("siteImageId", "productId");

-- AddForeignKey
ALTER TABLE "content_site_image_cards" ADD CONSTRAINT "content_site_image_cards_siteImageId_fkey" FOREIGN KEY ("siteImageId") REFERENCES "content_site_images"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_site_image_cards" ADD CONSTRAINT "content_site_image_cards_productId_fkey" FOREIGN KEY ("productId") REFERENCES "catalog_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
