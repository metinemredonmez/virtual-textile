import { Injectable } from '@nestjs/common';
import { ORDER } from '@vt/config';
import { Prisma } from '@vt/db';
import { PrismaService } from '../../infra/prisma.service.js';
import type { BrandFitSignal, UserReturnedSize, UserSizeHistory } from './fit-learning.js';

/**
 * ÖĞRENME KATMANININ VERİ KAYNAĞI
 *
 * Neden `ai.gateway.ts`'te değil: oradaki `PrismaFitFeedbackAdapter` TEK ürünün
 * özetini çıkarır ve beden motorunun bugünkü sözleşmesidir. Buradaki iki sorgu
 * ise MARKA ve KULLANICI düzeyinde çalışır, farklı tablolara dokunur ve farklı
 * gizlilik kuralına tabidir. Aynı dosyada büyümeleri, kullanıcı verisine dokunan
 * kodu ürün istatistiğiyle aynı gözden geçirme yüzeyine sokardı.
 *
 * ⚠️ Ham SQL kullanılıyor çünkü Prisma `groupBy` ilişkili tablo alanına
 *    (Product.brandName) göre gruplayamıyor. Tüm parametreler `Prisma.sql`
 *    şablonuyla bağlanır — string birleştirme YOK.
 */

export const SIZE_LEARNING_PORT = 'AI_SIZE_LEARNING_PORT';

/**
 * Beden motorunun ürün özetinin ÖTESİNDE ihtiyaç duyduğu iki sinyal.
 *
 * Her iki metot da `null` dönebilir ve bu bir hata DEĞİLDİR: sinyal yoksa motor
 * eskisi gibi yalnızca ölçü + ürün geri bildirimiyle çalışır. Öğrenme katmanı
 * bir İYİLEŞTİRMEDİR, bir bağımlılık değil — veri kaynağı düşerse beden önerisi
 * çalışmaya devam etmelidir.
 */
export interface SizeLearningPort {
  /** Ürünün markasındaki DİĞER ürünlerin toplu kalıp sinyali. */
  summarizeBrandOfProduct(productId: string): Promise<BrandFitSignal | null>;
  /**
   * Kullanıcının bu ürün ve markadaki satın alma geçmişi.
   * ⚠️ KVKK: yalnızca `userId` sahibinin kendi önerisinde kullanılır.
   */
  findUserHistory(userId: string, productId: string): Promise<UserSizeHistory | null>;
}

interface BrandAggregateRow {
  tooSmall: number;
  trueToSize: number;
  tooLarge: number;
  distinctProducts: number;
}

interface PurchaseRow {
  size: string;
  sameProduct: boolean;
  returnReason: string | null;
}

/**
 * Kullanıcı geçmişinde bakılacak en fazla alım sayısı.
 *
 * Neden sınır var: hem sorgu maliyeti hem de VÜCUT DEĞİŞİR. Beş yıl önce
 * tutulan bir beden bugünün kanıtı değildir; en yeni alımlar daha bilgilendirici.
 */
const USER_HISTORY_LIMIT = 50;

@Injectable()
export class PrismaSizeLearningAdapter implements SizeLearningPort {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * MARKA SİNYALİ — yorumlar + beden kaynaklı iadeler, ürün bazında gruplanıp
   * toplanır.
   *
   * ⚠️ ÜRÜNÜN KENDİSİ TOPLAMIN DIŞINDA BIRAKILIR. Aksi hâlde ürünün kendi
   *    (eşiği geçmeyen) verisi "marka eğilimi" kılığında geri girer ve
   *    `minFeedbackCountToUse` eşiğini dolanırdı. Marka sinyali, tanım gereği,
   *    bu ürün hakkında bilmediklerimizi DİĞER ürünlerden tahmin etmektir.
   *
   * ⚠️ BİLİNEN SINIR: tek bir aykırı ürün, küçük bir markanın toplamına
   *    hâkim olabilir; `distinctProducts` eşiği bunu azaltır ama yok etmez.
   *    Doğru çözüm ürün başına TEK OY (her ürün kendi yönünü belirler, oylar
   *    sayılır) — veri hacmi arttığında buraya taşınmalı.
   */
  async summarizeBrandOfProduct(productId: string): Promise<BrandFitSignal | null> {
    const rows = await this.prisma.$queryRaw<BrandAggregateRow[]>(Prisma.sql`
      WITH target AS (
        SELECT "brandName" FROM catalog_products WHERE id = ${productId}
      ),
      review_signal AS (
        SELECT
          r."productId" AS product_id,
          COUNT(*) FILTER (WHERE r."fitFeedback" = 'TOO_SMALL')    AS too_small,
          COUNT(*) FILTER (WHERE r."fitFeedback" = 'TRUE_TO_SIZE') AS true_to_size,
          COUNT(*) FILTER (WHERE r."fitFeedback" = 'TOO_LARGE')    AS too_large
        FROM catalog_reviews r
        JOIN catalog_products p ON p.id = r."productId"
        WHERE p."brandName" = (SELECT "brandName" FROM target)
          AND p.id <> ${productId}
          AND r."isApproved"
          AND r."fitFeedback" IS NOT NULL
        GROUP BY r."productId"
      ),
      return_signal AS (
        SELECT
          v."productId" AS product_id,
          COUNT(*) FILTER (WHERE rr.reason = 'SIZE_TOO_SMALL') AS too_small,
          0::bigint                                            AS true_to_size,
          COUNT(*) FILTER (WHERE rr.reason = 'SIZE_TOO_LARGE') AS too_large
        FROM return_items ri
        JOIN return_requests rr ON rr.id = ri."returnId"
        JOIN order_items oi     ON oi.id = ri."orderItemId"
        JOIN catalog_variants v ON v.id = oi."variantId"
        JOIN catalog_products p ON p.id = v."productId"
        WHERE p."brandName" = (SELECT "brandName" FROM target)
          AND p.id <> ${productId}
          AND rr.reason IN ('SIZE_TOO_SMALL', 'SIZE_TOO_LARGE')
        GROUP BY v."productId"
      ),
      merged AS (
        SELECT * FROM review_signal
        UNION ALL
        SELECT * FROM return_signal
      )
      SELECT
        COALESCE(SUM(too_small), 0)::int    AS "tooSmall",
        COALESCE(SUM(true_to_size), 0)::int AS "trueToSize",
        COALESCE(SUM(too_large), 0)::int    AS "tooLarge",
        COUNT(DISTINCT product_id)::int     AS "distinctProducts"
      FROM merged
    `);

    const row = rows[0];
    if (!row || row.distinctProducts === 0) return null;

    return {
      summary: {
        tooSmall: row.tooSmall,
        trueToSize: row.trueToSize,
        tooLarge: row.tooLarge,
      },
      distinctProducts: row.distinctProducts,
    };
  }

  /**
   * KULLANICININ KENDİ GEÇMİŞİ.
   *
   * "Tutulan beden" tanımı burada belirlenir ve iki koşulu vardır:
   *  1. paket TESLİM EDİLMİŞ olacak — yolda olan bir şey hakkında görüş yok,
   *  2. İADE PENCERESİ KAPANMIŞ olacak (`ORDER.returnWindowDays`).
   *
   * ⚠️ İkincisi olmadan "iade etmedi" cümlesi anlamsızdır: kullanıcı daha
   *    kararını vermemiş olabilir. Dün teslim alınan bir ürünü "oldu, tuttu"
   *    saymak, kanıtı olmayan bir kanıt uydurmaktır.
   *
   * ⚠️ Bedenden BAŞKA sebeple iade edilenler (hasarlı, beğenmedi) ne "tutuldu"
   *    ne de "beden yanlıştı" sayılır — kalıp hakkında bilgi taşımazlar ve
   *    ikisine de yazılmaları veriyi bozardı.
   *
   * Beden `catalog_variants.size`'dan okunur, `order_items.variantLabel`
   * ("Siyah / M") ayrıştırılmaz: ayırıcıya bağlı ayrıştırma sessizce yanlış
   * beden üretir.
   */
  async findUserHistory(userId: string, productId: string): Promise<UserSizeHistory | null> {
    const rows = await this.prisma.$queryRaw<PurchaseRow[]>(Prisma.sql`
      WITH target AS (
        SELECT id, "brandName" FROM catalog_products WHERE id = ${productId}
      )
      SELECT
        v."size"                                        AS "size",
        (oi."productId" = (SELECT id FROM target))      AS "sameProduct",
        (
          SELECT rr.reason::text
          FROM return_items ri
          JOIN return_requests rr ON rr.id = ri."returnId"
          WHERE ri."orderItemId" = oi.id
          ORDER BY rr."createdAt" DESC
          LIMIT 1
        )                                               AS "returnReason"
      FROM order_items oi
      JOIN order_orders o     ON o.id  = oi."orderId"
      JOIN order_packages pkg ON pkg.id = oi."packageId"
      JOIN catalog_variants v ON v.id  = oi."variantId"
      WHERE o."userId" = ${userId}
        AND pkg."deliveredAt" IS NOT NULL
        -- ⚠️ make_interval(days => $1) DEĞİL: Prisma parametreyi float8 olarak
        --    gönderdiğinde o imza bulunamaz ve sorgu üretimde patlar. Çarpım
        --    biçimi hem int hem float8 parametreyle çalışır.
        AND pkg."deliveredAt" < now() - (${ORDER.returnWindowDays} * INTERVAL '1 day')
        AND (
          oi."productId" = (SELECT id FROM target)
          OR oi."brandName" = (SELECT "brandName" FROM target)
        )
      ORDER BY pkg."deliveredAt" DESC
      LIMIT ${USER_HISTORY_LIMIT}
    `);

    if (rows.length === 0) return null;

    const keptSizesForProduct: string[] = [];
    const keptSizesForBrand: string[] = [];
    const returnedSizesForProduct: UserReturnedSize[] = [];

    for (const row of rows) {
      if (row.returnReason === 'SIZE_TOO_SMALL' || row.returnReason === 'SIZE_TOO_LARGE') {
        if (row.sameProduct) {
          returnedSizesForProduct.push({
            size: row.size,
            direction: row.returnReason === 'SIZE_TOO_SMALL' ? 'TOO_SMALL' : 'TOO_LARGE',
          });
        }
        continue;
      }

      // Beden dışı bir sebeple iade edilmişse kalıp hakkında bilgi taşımaz.
      if (row.returnReason !== null) continue;

      if (row.sameProduct) keptSizesForProduct.push(row.size);
      else keptSizesForBrand.push(row.size);
    }

    return { keptSizesForProduct, keptSizesForBrand, returnedSizesForProduct };
  }
}
