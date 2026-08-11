import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '@vt/contracts';
import { SEARCH } from '@vt/config';
import { Prisma } from '@vt/db';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import type { Logger } from '../../common/logger.js';
import type { ProductListQuery } from './catalog.schema.js';

export interface ProductListItem {
  id: string;
  slug: string;
  title: string;
  brandName: string;
  storeSlug: string;
  imageKey: string | null;
  blurhash: string | null;
  priceMinor: bigint;
  listPriceMinor: bigint | null;
  colors: string[];
  tryOnScore: number | null;
  tryOnable: boolean;
}

export interface FacetBucket {
  value: string;
  label: string;
  count: number;
}

export interface ProductListResult {
  items: ProductListItem[];
  nextCursor: string | null;
  total: number;
  facets: {
    colors: FacetBucket[];
    sizes: FacetBucket[];
    brands: FacetBucket[];
    priceRange: { minMinor: bigint; maxMinor: bigint } | null;
  };
  /** Arama sonuç vermediyse önerilen düzeltme. */
  didYouMean: string | null;
}

/**
 * Cursor: son öğenin sıralama anahtarı + kimliği.
 * Offset kullanılmaz — derin sayfalarda yavaştır ve araya yeni ürün girdiğinde
 * kullanıcı aynı ürünü iki kez görür veya bir ürünü hiç görmez.
 */
interface Cursor {
  sort: string;
  id: string;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(raw: string): Cursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as Cursor).id !== 'string'
    ) {
      throw new Error('biçim');
    }
    return parsed as Cursor;
  } catch {
    throw new AppError('VALIDATION_FAILED', {
      internalMessage: 'Geçersiz sayfalama imleci',
      details: { fields: [{ path: 'cursor', message: 'Geçersiz sayfa bilgisi.' }] },
    });
  }
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  // ── Kategoriler ──────────────────────────────────────────────────────────

  async categoryTree(): Promise<
    Array<{
      id: string;
      slug: string;
      name: string;
      tryOnCategory: string | null;
      children: unknown[];
    }>
  > {
    const all = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, slug: true, name: true, parentId: true, tryOnCategory: true },
    });

    type Node = (typeof all)[number] & { children: Node[] };
    const byId = new Map<string, Node>(all.map((c) => [c.id, { ...c, children: [] }]));
    const roots: Node[] = [];

    for (const node of byId.values()) {
      if (node.parentId) byId.get(node.parentId)?.children.push(node);
      else roots.push(node);
    }

    return roots;
  }

  // ── Ürün listeleme + faset ───────────────────────────────────────────────

  /**
   * ARAMA VE FİLTRELEME
   *
   * Ham SQL kullanılıyor çünkü Prisma `tsvector` sorgusunu, ağırlıklı sıralamayı
   * ve faset sayımlarını ifade edemiyor. Tüm parametreler `Prisma.sql` ile
   * bağlanıyor — string birleştirme YOK, SQL enjeksiyonu mümkün değil.
   */
  async listProducts(query: ProductListQuery): Promise<ProductListResult> {
    const limit = Math.min(query.limit ?? SEARCH.defaultPageSize, SEARCH.maxPageSize);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const conditions: Prisma.Sql[] = [Prisma.sql`p."status" = 'PUBLISHED'`];

    if (query.category) {
      // Alt kategorileri de kapsar: "kadın" araması "kadın > üst giyim"i getirir.
      conditions.push(Prisma.sql`
        p."categoryId" IN (
          WITH RECURSIVE tree AS (
            SELECT id FROM catalog_categories WHERE slug = ${query.category}
            UNION ALL
            SELECT c.id FROM catalog_categories c JOIN tree t ON c."parentId" = t.id
          ) SELECT id FROM tree
        )`);
    }

    if (query.gender) conditions.push(Prisma.sql`p."gender" = ${query.gender}::"Gender"`);
    if (query.brand?.length) conditions.push(Prisma.sql`p."brandName" = ANY(${query.brand})`);

    if (query.color?.length) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM catalog_variants v
        WHERE v."productId" = p.id AND v."isActive" AND v."color" = ANY(${query.color}))`);
    }

    if (query.size?.length) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM catalog_variants v
        WHERE v."productId" = p.id AND v."isActive" AND v."size" = ANY(${query.size}))`);
    }

    if (query.minPriceMinor !== undefined) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM catalog_variants v
        WHERE v."productId" = p.id AND v."isActive" AND v."priceMinor" >= ${query.minPriceMinor})`);
    }
    if (query.maxPriceMinor !== undefined) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM catalog_variants v
        WHERE v."productId" = p.id AND v."isActive" AND v."priceMinor" <= ${query.maxPriceMinor})`);
    }

    // Varsayılan olarak tükenmiş ürünler gizlenir. Ayrı bir arama motorunda
    // bu filtre mümkün olmazdı; tek veritabanının somut faydası.
    if (query.inStockOnly !== false) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM catalog_variants v
        JOIN catalog_inventory i ON i."variantId" = v.id
        WHERE v."productId" = p.id AND v."isActive" AND (i."onHand" - i."reserved") > 0)`);
    }

    // Yalnızca siparişe açık mağazalar
    conditions.push(Prisma.sql`s."status" = 'APPROVED' AND s."vacationMode" = false`);

    const hasSearch = Boolean(query.q?.trim());
    if (hasSearch) {
      conditions.push(
        Prisma.sql`p."searchVector" @@ websearch_to_tsquery('turkish_unaccent', ${query.q})`,
      );
    }

    const where = Prisma.join(conditions, ' AND ');

    // Sıralama anahtarı — cursor bunun üzerinden yürür.
    const rankExpr = hasSearch
      ? Prisma.sql`(
          ts_rank(p."searchVector", websearch_to_tsquery('turkish_unaccent', ${query.q}))
            * ${SEARCH.rankingWeights.textRelevance}
          + (p."popularityScore"::float / 100) * ${SEARCH.rankingWeights.popularity}
          + (s."qualityScore"::float / 100) * ${SEARCH.rankingWeights.sellerQuality}
        )`
      : Prisma.sql`(p."popularityScore"::float / 100)`;

    const orderBy =
      query.sort === 'price_asc'
        ? Prisma.sql`min_price ASC, p.id ASC`
        : query.sort === 'price_desc'
          ? Prisma.sql`min_price DESC, p.id ASC`
          : query.sort === 'newest'
            ? Prisma.sql`p."publishedAt" DESC NULLS LAST, p.id ASC`
            : Prisma.sql`sort_key DESC, p.id ASC`;

    const cursorFilter = cursor
      ? query.sort === 'price_asc'
        ? Prisma.sql`AND (min_price, p.id) > (${BigInt(cursor.sort)}, ${cursor.id})`
        : query.sort === 'price_desc'
          ? Prisma.sql`AND (min_price, p.id) < (${BigInt(cursor.sort)}, ${cursor.id})`
          : Prisma.sql`AND (sort_key, p.id) < (${Number(cursor.sort)}, ${cursor.id})`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        slug: string;
        title: string;
        brandName: string;
        storeSlug: string;
        imageKey: string | null;
        blurhash: string | null;
        min_price: bigint;
        list_price: bigint | null;
        colors: string[];
        tryOnScore: number | null;
        tryonable: boolean;
        sort_key: number;
        total: bigint;
      }>
    >(Prisma.sql`
      WITH base AS (
        SELECT
          p.id, p.slug, p.title, p."brandName", p."tryOnScore",
          st.slug AS "storeSlug",
          c."tryOnCategory" IS NOT NULL AS tryonable,
          ${rankExpr} AS sort_key,
          (SELECT MIN(v."priceMinor") FROM catalog_variants v
             WHERE v."productId" = p.id AND v."isActive") AS min_price,
          (SELECT MAX(v."listPriceMinor") FROM catalog_variants v
             WHERE v."productId" = p.id AND v."isActive") AS list_price,
          (SELECT img."storageKey" FROM catalog_product_images img
             WHERE img."productId" = p.id ORDER BY img."isPrimary" DESC, img."sortOrder" ASC
             LIMIT 1) AS "imageKey",
          (SELECT img."blurhash" FROM catalog_product_images img
             WHERE img."productId" = p.id ORDER BY img."isPrimary" DESC, img."sortOrder" ASC
             LIMIT 1) AS blurhash,
          (SELECT ARRAY_AGG(DISTINCT v."color") FROM catalog_variants v
             WHERE v."productId" = p.id AND v."isActive") AS colors,
          COUNT(*) OVER () AS total
        FROM catalog_products p
        JOIN seller_sellers s ON s.id = p."sellerId"
        JOIN seller_stores st ON st."sellerId" = s.id
        JOIN catalog_categories c ON c.id = p."categoryId"
        WHERE ${where}
      )
      SELECT * FROM base p
      WHERE true ${cursorFilter}
      ORDER BY ${orderBy}
      LIMIT ${limit + 1}
    `);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);

    const items: ProductListItem[] = page.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      brandName: r.brandName,
      storeSlug: r.storeSlug,
      imageKey: r.imageKey,
      blurhash: r.blurhash,
      priceMinor: r.min_price,
      listPriceMinor: r.list_price,
      colors: r.colors ?? [],
      tryOnScore: r.tryOnScore,
      tryOnable: r.tryonable,
    }));

    const facets = await this.facets(where);

    // Arama sonuç vermediyse yazım düzeltmesi öner (trigram).
    let didYouMean: string | null = null;
    if (hasSearch && items.length === 0) {
      didYouMean = await this.suggestCorrection(query.q!);
    }

    return {
      items,
      total: Number(page[0]?.total ?? 0),
      nextCursor:
        hasMore && last
          ? encodeCursor({
              id: last.id,
              sort:
                query.sort === 'price_asc' || query.sort === 'price_desc'
                  ? String(last.min_price)
                  : String(last.sort_key),
            })
          : null,
      facets,
      didYouMean,
    };
  }

  /**
   * Faset sayımları — kullanıcının seçtiği filtrelerle TUTARLI olmalı.
   * "Siyah" seçiliyken renk fasetleri yalnızca siyah ürünlerin bedenlerini
   * saymalı, aksi hâlde kullanıcı sonuç vermeyen bir filtreye tıklar.
   */
  private async facets(where: Prisma.Sql): Promise<ProductListResult['facets']> {
    const [colors, sizes, brands, price] = await Promise.all([
      this.prisma.$queryRaw<Array<{ value: string; count: bigint }>>(Prisma.sql`
        SELECT v."color" AS value, COUNT(DISTINCT p.id) AS count
        FROM catalog_products p
        JOIN seller_sellers s ON s.id = p."sellerId"
        JOIN seller_stores st ON st."sellerId" = s.id
        JOIN catalog_categories c ON c.id = p."categoryId"
        JOIN catalog_variants v ON v."productId" = p.id AND v."isActive"
        WHERE ${where} GROUP BY v."color" ORDER BY count DESC LIMIT 30`),
      this.prisma.$queryRaw<Array<{ value: string; count: bigint }>>(Prisma.sql`
        SELECT v."size" AS value, COUNT(DISTINCT p.id) AS count
        FROM catalog_products p
        JOIN seller_sellers s ON s.id = p."sellerId"
        JOIN seller_stores st ON st."sellerId" = s.id
        JOIN catalog_categories c ON c.id = p."categoryId"
        JOIN catalog_variants v ON v."productId" = p.id AND v."isActive"
        WHERE ${where} GROUP BY v."size" ORDER BY count DESC LIMIT 30`),
      this.prisma.$queryRaw<Array<{ value: string; count: bigint }>>(Prisma.sql`
        SELECT p."brandName" AS value, COUNT(*) AS count
        FROM catalog_products p
        JOIN seller_sellers s ON s.id = p."sellerId"
        JOIN seller_stores st ON st."sellerId" = s.id
        JOIN catalog_categories c ON c.id = p."categoryId"
        WHERE ${where} GROUP BY p."brandName" ORDER BY count DESC LIMIT 30`),
      this.prisma.$queryRaw<Array<{ min: bigint | null; max: bigint | null }>>(Prisma.sql`
        SELECT MIN(v."priceMinor") AS min, MAX(v."priceMinor") AS max
        FROM catalog_products p
        JOIN seller_sellers s ON s.id = p."sellerId"
        JOIN seller_stores st ON st."sellerId" = s.id
        JOIN catalog_categories c ON c.id = p."categoryId"
        JOIN catalog_variants v ON v."productId" = p.id AND v."isActive"
        WHERE ${where}`),
    ]);

    const toBuckets = (rows: Array<{ value: string; count: bigint }>): FacetBucket[] =>
      rows.map((r) => ({ value: r.value, label: r.value, count: Number(r.count) }));

    const range = price[0];
    return {
      colors: toBuckets(colors),
      sizes: toBuckets(sizes),
      brands: toBuckets(brands),
      priceRange:
        range?.min != null && range.max != null
          ? { minMinor: range.min, maxMinor: range.max }
          : null,
    };
  }

  /**
   * "palazo pantolon" → "Yüksek Bel Palazzo Pantolon"
   *
   * ⚠️ `similarity()` DEĞİL `word_similarity()` kullanılıyor.
   * similarity() terimi başlığın TAMAMIYLA karşılaştırır; uzun başlıklarda
   * kısa bir arama terimi seyrelir ve eşleşme kaçar. Ölçüldü:
   *   similarity('palaz', 'Yüksek Bel Palazzo Pantolon')      = 0.185  ✗
   *   word_similarity('palaz', 'Yüksek Bel Palazzo Pantolon') = 0.833  ✓
   * word_similarity terimi başlığın EN İYİ EŞLEŞEN parçasıyla karşılaştırır —
   * arama ve otomatik tamamlama için doğru olan budur.
   */
  private async suggestCorrection(term: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<Array<{ title: string; sim: number }>>(Prisma.sql`
      SELECT title, word_similarity(unaccent(${term}), unaccent(title)) AS sim
      FROM catalog_products
      WHERE status = 'PUBLISHED'
        AND word_similarity(unaccent(${term}), unaccent(title)) > 0.4
      ORDER BY sim DESC LIMIT 1`);
    return rows[0]?.title ?? null;
  }

  // ── Ürün detayı ──────────────────────────────────────────────────────────

  async productBySlug(slug: string): Promise<unknown> {
    const product = await this.prisma.product.findFirst({
      where: { slug, status: 'PUBLISHED' },
      include: {
        images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
        category: { select: { slug: true, name: true, tryOnCategory: true } },
        seller: {
          select: {
            id: true,
            displayName: true,
            qualityScore: true,
            vacationMode: true,
            store: { select: { slug: true } },
          },
        },
        variants: {
          where: { isActive: true },
          orderBy: [{ color: 'asc' }, { sortOrder: 'asc' }],
          include: { inventory: { select: { onHand: true, reserved: true } } },
        },
      },
    });

    if (!product) throw new AppError('PRODUCT_NOT_FOUND');

    return {
      ...product,
      variants: product.variants.map((v) => {
        const available = (v.inventory?.onHand ?? 0) - (v.inventory?.reserved ?? 0);
        return {
          id: v.id,
          sku: v.sku,
          color: v.color,
          colorHex: v.colorHex,
          size: v.size,
          priceMinor: v.priceMinor,
          listPriceMinor: v.listPriceMinor,
          // ⚠️ Ham stok adedi DIŞARI VERİLMEZ — rakip envanter takibi yapabilir.
          // Yalnızca satılabilirlik ve "son N adet" sinyali gösterilir.
          available: available > 0,
          lowStock: available > 0 && available <= 3,
        };
      }),
      tryOnable: product.category.tryOnCategory !== null,
    };
  }

  /** Görsel embedding ile benzer ürünler (pgvector, kosinüs mesafesi). */
  async similarProducts(productId: string, limit = 12): Promise<ProductListItem[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        slug: string;
        title: string;
        brandName: string;
        storeSlug: string;
        imageKey: string | null;
        blurhash: string | null;
        min_price: bigint;
        list_price: bigint | null;
        colors: string[];
        tryOnScore: number | null;
        tryonable: boolean;
      }>
    >(Prisma.sql`
      WITH src AS (SELECT embedding, "categoryId" FROM catalog_products WHERE id = ${productId})
      SELECT p.id, p.slug, p.title, p."brandName", p."tryOnScore",
             st.slug AS "storeSlug",
             c."tryOnCategory" IS NOT NULL AS tryonable,
             (SELECT MIN(v."priceMinor") FROM catalog_variants v WHERE v."productId" = p.id AND v."isActive") AS min_price,
             (SELECT MAX(v."listPriceMinor") FROM catalog_variants v WHERE v."productId" = p.id AND v."isActive") AS list_price,
             (SELECT img."storageKey" FROM catalog_product_images img WHERE img."productId" = p.id ORDER BY img."isPrimary" DESC LIMIT 1) AS "imageKey",
             (SELECT img."blurhash" FROM catalog_product_images img WHERE img."productId" = p.id ORDER BY img."isPrimary" DESC LIMIT 1) AS blurhash,
             (SELECT ARRAY_AGG(DISTINCT v."color") FROM catalog_variants v WHERE v."productId" = p.id AND v."isActive") AS colors
      FROM catalog_products p, src
      JOIN seller_sellers s ON s.id = p."sellerId"
      JOIN seller_stores st ON st."sellerId" = s.id
      JOIN catalog_categories c ON c.id = p."categoryId"
      WHERE p.id <> ${productId}
        AND p.status = 'PUBLISHED'
        AND s."status" = 'APPROVED'
        AND src.embedding IS NOT NULL
        AND p.embedding IS NOT NULL
        AND (p.embedding <=> src.embedding) < ${SEARCH.maxVectorDistance}
      ORDER BY p.embedding <=> src.embedding
      LIMIT ${limit}`);

    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      brandName: r.brandName,
      storeSlug: r.storeSlug,
      imageKey: r.imageKey,
      blurhash: r.blurhash,
      priceMinor: r.min_price,
      listPriceMinor: r.list_price,
      colors: r.colors ?? [],
      tryOnScore: r.tryOnScore,
      tryOnable: r.tryonable,
    }));
  }

  /**
   * Autocomplete — hedef 50 ms altı.
   *
   * ⚠️ İki taraf da `unaccent`'ten geçiriliyor: trigram aksan bilmez,
   * "gomlek" ile "Gömlek" eşleşmez. Türkçe'de bu istisna değil kuraldır.
   *
   * ⚠️ ÖLÇEK NOTU: unaccent() STABLE'dır, IMMUTABLE değil — bu hâliyle
   * mevcut trigram indeksleri KULLANILAMAZ, tam tarama yapılır. Bu katalog
   * boyutunda sorun değil; ürün sayısı büyüdüğünde immutable sarmalayıcı bir
   * fonksiyon + ifade indeksi (`GIN (immutable_unaccent(title) gin_trgm_ops)`)
   * eklenmelidir.
   */
  async suggest(term: string): Promise<Array<{ text: string; type: 'product' | 'brand' }>> {
    if (term.trim().length < 2) return [];

    const rows = await this.prisma.$queryRaw<Array<{ text: string; type: string; sim: number }>>(
      Prisma.sql`
      (SELECT DISTINCT title AS text, 'product' AS type,
              word_similarity(unaccent(${term}), unaccent(title)) AS sim
         FROM catalog_products
        WHERE status = 'PUBLISHED' AND unaccent(${term}) <% unaccent(title)
        ORDER BY sim DESC LIMIT ${SEARCH.suggestLimit})
      UNION ALL
      (SELECT DISTINCT "brandName" AS text, 'brand' AS type,
              word_similarity(unaccent(${term}), unaccent("brandName")) AS sim
         FROM catalog_products
        WHERE status = 'PUBLISHED' AND unaccent(${term}) <% unaccent("brandName")
        ORDER BY sim DESC LIMIT 4)
      ORDER BY sim DESC`,
    );

    return rows.map((r) => ({ text: r.text, type: r.type as 'product' | 'brand' }));
  }
}
