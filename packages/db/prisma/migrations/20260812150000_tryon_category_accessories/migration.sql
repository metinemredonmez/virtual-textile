-- ═══════════════════════════════════════════════════════════════════════════
--  TryOnCategory: ayakkabı, takı, çanta, aksesuar
-- ═══════════════════════════════════════════════════════════════════════════
--
-- NİÇİN ŞİMDİ: bu değerler KATALOG kategorisidir, try-on yeteneği DEĞİL.
-- Mağazada ayakkabı ve çanta bugün satılıyor; `Category.tryOnCategory` alanı
-- bu ürünler için `null` kalmak zorundaydı ve o `null`, iki ayrı gerçeği
-- birbirine karıştırıyordu: "bu kategori giyilebilir bir şey değil" ile
-- "giyilebilir ama sağlayıcı henüz yapamıyor".
--
-- ⚠️ SANAL DENEME BU MIGRATION'LA AÇILMAZ. Açık olup olmadığına
--    @vt/config → TRYON_PROVIDER_CAPABILITIES karar verir ve bugün dört
--    değerin dördü de hiçbir sağlayıcıda YOK. `TRYONABLE_CATEGORIES` o
--    matristen türetildiği için "Üzerimde Dene" düğmesi çıkmaz ve tek kuruş
--    harcanmaz. Sağlayıcı desteklediği gün TEK SATIR config değişir —
--    yeni migration gerekmez. Bu, migration'ın asıl kazancıdır.
--
-- ⚠️ GERİ ALINAMAZ. PostgreSQL'de enum değeri kaldırılamaz (tipin yeniden
--    yaratılması, bütün bağımlı kolonların yeniden yazılması gerekir).
--    Video try-on'un `VIDEO_TRYON` değeri hâlâ migrations-pending/ altında
--    BEKLETİLİYOR çünkü orada harcanacak para ölçülmedi; burada ise değer
--    ÜRÜN KATEGORİSİ olarak bugün kullanılıyor — bekletmenin bir getirisi yok.
--
-- PostgreSQL 12+ `ALTER TYPE ... ADD VALUE` ifadesini transaction içinde
-- kabul eder; yeni değer AYNI transaction'da KULLANILAMAZ, bu migration da
-- kullanmıyor.

ALTER TYPE "TryOnCategory" ADD VALUE IF NOT EXISTS 'SHOES';
ALTER TYPE "TryOnCategory" ADD VALUE IF NOT EXISTS 'JEWELRY';
ALTER TYPE "TryOnCategory" ADD VALUE IF NOT EXISTS 'BAG';
ALTER TYPE "TryOnCategory" ADD VALUE IF NOT EXISTS 'ACCESSORY';
