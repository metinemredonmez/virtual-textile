-- ═══════════════════════════════════════════════════════════════════════════
--  Komisyon kuralı benzersizliği — NULL güvenli
--
--  SORUN
--  Prisma'nın ürettiği @@unique([categoryId, sellerId]) kısıtı burada işe
--  YARAMAZ. PostgreSQL'de standart UNIQUE kısıtta NULL'lar birbirinden farklı
--  sayılır, dolayısıyla şu iki satır aynı anda var olabilirdi:
--
--      (categoryId = 'ust-giyim', sellerId = NULL)   -- platform kuralı
--      (categoryId = 'ust-giyim', sellerId = NULL)   -- ikinci platform kuralı!
--
--  Sonuç: komisyon araması hangi kuralı bulacağını bilemez. Sipariş kalemi
--  yanlış oranı snapshot alır ve satıcı hakedişi hatalı hesaplanır.
--
--  ÇÖZÜM
--  PostgreSQL 15+ `NULLS NOT DISTINCT`: NULL'lar eşit kabul edilir, böylece
--  kategori başına en fazla bir platform kuralı, satıcı başına en fazla bir
--  override, ve tüm sistemde en fazla bir global varsayılan olabilir.
--
--  Prisma bu söz dizimini üretemediği için kısıt elle tanımlanmıştır.
-- ═══════════════════════════════════════════════════════════════════════════

-- Prisma'nın ürettiği NULL-güvensiz kısıtı kaldır
DROP INDEX IF EXISTS "finance_commission_rules_categoryId_sellerId_key";

-- Arama indeksi (Prisma şemasındaki @@index karşılığı)
CREATE INDEX "finance_commission_rules_categoryId_sellerId_idx"
  ON "finance_commission_rules" ("categoryId", "sellerId");

-- Gerçek kısıt
CREATE UNIQUE INDEX "finance_commission_rules_scope_unique"
  ON "finance_commission_rules" ("categoryId", "sellerId")
  NULLS NOT DISTINCT;

-- ── Aynı anda birden fazla geçerli versiyon olamaz ────────────────────────
-- validTo IS NULL = "hâlâ geçerli". Kural başına yalnızca bir tane olmalı;
-- aksi hâlde komisyon araması yine belirsizleşir.
CREATE UNIQUE INDEX "finance_commission_rule_versions_one_active"
  ON "finance_commission_rule_versions" ("ruleId")
  WHERE "validTo" IS NULL;
