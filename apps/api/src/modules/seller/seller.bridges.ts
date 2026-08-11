/**
 * ═══════════════ GEÇİCİ KÖPRÜLER — SİLİNMEK ÜZERE YAZILDI ═══════════════════
 *
 * Kural 3 gereği satıcı modülü başka modülün Prisma modeline dokunmaz.
 * Sipariş YAZMA tarafında köprü YOK: `OrderService` yayımlanmış bir servistir
 * ve doğrudan çağrılır (bkz. seller-fulfillment.service.ts).
 *
 * Köprüsü olanlar, karşılığında henüz yayımlanmış bir servis bulunmayanlar:
 *   • Katalog YAZMA  — `CatalogService` yalnızca vitrin okuması yayımlıyor.
 *   • Sipariş OKUMA  — satıcı kırılımlı paket/iade listesi yayımlanmamış.
 *   • Analitik OKUMA — birden çok modülün tablosunu çapraz okuyor.
 *   • Kupon YAZMA    — kampanya modülü yok (sepet modülü de aynı gerekçeyle
 *                      kendi `PrismaCouponAdapter` köprüsünü tutuyor).
 *
 * ⚠️ ENTEGRASYON AJANI İÇİN: ilgili servisler yayımlandığında `index.ts`
 *    içindeki token bağlamalarını onlara çevirin ve BU DOSYAYI SİLİN.
 *    Satıcı servislerinde tek satır değişmesi gerekmez.
 */
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { appError } from '@vt/contracts';
import { Prisma, isPrismaKnownError, PRISMA_ERROR } from '@vt/db';
import type { PackageStatus, ProductStatus, ReturnStatus } from '@vt/db';
import { PrismaService } from '../../infra/prisma.service.js';
import { bulkUploadError, type BulkProductDraft, type BulkRowError } from './seller-csv.js';
import type {
  BulkUpsertResult,
  CreateProductCommand,
  DateRange,
  SellerAnalyticsReaderPort,
  SellerCatalogPort,
  SellerCouponPort,
  SellerCouponView,
  SellerFulfillmentReaderPort,
  SellerPackageDetail,
  SellerPackageSummary,
  SellerProductDetail,
  SellerProductSummary,
  SellerReturnSummary,
  SellerVariantDetail,
  UpdateProductCommand,
  VariantUpdateCommand,
} from './seller.ports.js';

// ── Ortak yardımcılar ─────────────────────────────────────────────────────

const TURKISH_MAP: Record<string, string> = {
  ç: 'c',
  Ç: 'c',
  ğ: 'g',
  Ğ: 'g',
  ı: 'i',
  İ: 'i',
  ö: 'o',
  Ö: 'o',
  ş: 's',
  Ş: 's',
  ü: 'u',
  Ü: 'u',
};

/**
 * Başlıktan URL parçası üretir.
 *
 * ⚠️ Türkçe karakterler ÖNCE eşlenir. `normalize('NFD')` ile aksan ayıklama
 *    "ı" ve "ğ" için çalışmaz (bunlar aksanlı harf değil, ayrı harflerdir);
 *    eşlemesiz bırakılırsa "Gömlek" → "gmlek" olurdu.
 */
function slugify(input: string): string {
  const mapped = input.replace(/[çÇğĞıİöÖşŞüÜ]/g, (char) => TURKISH_MAP[char] ?? char);
  return mapped
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

/**
 * `productRef` için kararlı sonek.
 *
 * Aynı satıcı aynı dosyayı ikinci kez yüklediğinde AYNI slug üretilmeli ki
 * ürün mükerrer oluşmasın, güncellensin. Rastgele sonek kullanılsaydı her
 * yükleme yeni ürün yaratırdı.
 */
function refSuffix(sellerId: string, productRef: string): string {
  return createHash('sha256').update(`${sellerId}:${productRef}`).digest('hex').slice(0, 8);
}

/** Ürün başlığından benzersiz slug — satıcı+ref'e göre kararlı. */
function productSlug(sellerId: string, productRef: string, title: string): string {
  const base = slugify(title) || 'urun';
  return `${base}-${refSuffix(sellerId, productRef)}`;
}

function encodeCursor(id: string): string {
  return id;
}

// ═══════════════════════════ KATALOG YAZMA ══════════════════════════════════

const PRODUCT_SUMMARY_SELECT = {
  id: true,
  slug: true,
  title: true,
  brandName: true,
  status: true,
  gender: true,
  categoryId: true,
  tryOnScore: true,
  tryOnIssues: true,
  aiTagsApproved: true,
  publishedAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class PrismaSellerCatalogBridge implements SellerCatalogPort {
  constructor(private readonly prisma: PrismaService) {}

  async listProducts(
    sellerId: string,
    query: {
      status?: ProductStatus | undefined;
      q?: string | undefined;
      cursor?: string | undefined;
      limit: number;
    },
  ): Promise<{ items: SellerProductSummary[]; nextCursor: string | null }> {
    const rows = await this.prisma.product.findMany({
      // ⚠️ `sellerId` SORGU KOŞULU. "Önce oku, sonra sahibini kontrol et"
      //    yazılsaydı bir gün o kontrol düşer ve başka mağazanın ürünü
      //    listelenirdi.
      where: {
        sellerId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        ...PRODUCT_SUMMARY_SELECT,
        images: {
          orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
          take: 1,
          select: { storageKey: true },
        },
        variants: {
          select: {
            priceMinor: true,
            isActive: true,
            inventory: { select: { onHand: true, reserved: true } },
          },
        },
      },
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    const items = page.map((product) => this.toSummary(product));

    return {
      items,
      nextCursor: hasMore ? encodeCursor(page.at(-1)?.id ?? '') : null,
    };
  }

  private toSummary(product: {
    id: string;
    slug: string;
    title: string;
    brandName: string;
    status: ProductStatus;
    gender: SellerProductSummary['gender'];
    categoryId: string;
    tryOnScore: number | null;
    tryOnIssues: unknown;
    aiTagsApproved: boolean;
    publishedAt: Date | null;
    updatedAt: Date;
    images: Array<{ storageKey: string }>;
    variants: Array<{
      priceMinor: bigint;
      isActive: boolean;
      inventory: { onHand: number; reserved: number } | null;
    }>;
  }): SellerProductSummary {
    const active = product.variants.filter((variant) => variant.isActive);
    const prices = active.map((variant) => variant.priceMinor);

    return {
      id: product.id,
      slug: product.slug,
      title: product.title,
      brandName: product.brandName,
      status: product.status,
      gender: product.gender,
      categoryId: product.categoryId,
      tryOnScore: product.tryOnScore,
      tryOnIssues: product.tryOnIssues,
      aiTagsApproved: product.aiTagsApproved,
      variantCount: product.variants.length,
      // Satılabilir = onHand − reserved. Rezerve adet başkasının sepetinde.
      availableStock: active.reduce(
        (total, variant) =>
          total +
          Math.max(0, (variant.inventory?.onHand ?? 0) - (variant.inventory?.reserved ?? 0)),
        0,
      ),
      minPriceMinor: prices.length > 0 ? prices.reduce((a, b) => (a < b ? a : b)) : null,
      imageKey: product.images[0]?.storageKey ?? null,
      publishedAt: product.publishedAt,
      updatedAt: product.updatedAt,
    };
  }

  async getProduct(sellerId: string, productId: string): Promise<SellerProductDetail> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, sellerId },
      select: {
        ...PRODUCT_SUMMARY_SELECT,
        description: true,
        season: true,
        collection: true,
        statusReason: true,
        aiTags: true,
        sizeChart: true,
        images: {
          orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
          select: { id: true, storageKey: true, angle: true, isPrimary: true },
        },
        variants: {
          orderBy: [{ color: 'asc' }, { sortOrder: 'asc' }],
          select: {
            id: true,
            sku: true,
            color: true,
            colorHex: true,
            size: true,
            priceMinor: true,
            listPriceMinor: true,
            barcode: true,
            isActive: true,
            sortOrder: true,
            inventory: { select: { onHand: true, reserved: true } },
          },
        },
      },
    });

    if (!product) throw appError('PRODUCT_NOT_FOUND');

    const variants: SellerVariantDetail[] = product.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      color: variant.color,
      colorHex: variant.colorHex,
      size: variant.size,
      priceMinor: variant.priceMinor,
      listPriceMinor: variant.listPriceMinor,
      barcode: variant.barcode,
      isActive: variant.isActive,
      sortOrder: variant.sortOrder,
      onHand: variant.inventory?.onHand ?? 0,
      // ⚠️ Satıcıya `reserved` GÖSTERİLİR: "12 stok var ama 5'i sepetlerde"
      //    bilgisi olmadan satıcı stok tükendiğini anlayamaz.
      reserved: variant.inventory?.reserved ?? 0,
    }));

    const summary = this.toSummary({
      ...product,
      images: product.images.map((image) => ({ storageKey: image.storageKey })),
      variants: product.variants.map((variant) => ({
        priceMinor: variant.priceMinor,
        isActive: variant.isActive,
        inventory: variant.inventory,
      })),
    });

    return {
      ...summary,
      description: product.description,
      season: product.season,
      collection: product.collection,
      statusReason: product.statusReason,
      aiTags: product.aiTags,
      sizeChart: product.sizeChart,
      variants,
      images: product.images,
    };
  }

  async createProduct(sellerId: string, input: CreateProductCommand): Promise<SellerProductDetail> {
    const category = await this.prisma.category.findFirst({
      where: { id: input.categoryId, isActive: true },
      select: { id: true },
    });
    if (!category) throw appError('CATEGORY_NOT_FOUND');

    const productId = await this.prisma
      .$transaction(async (tx) => {
        const product = await tx.product.create({
          data: {
            sellerId,
            categoryId: input.categoryId,
            // Slug ürün kimliğinden türetilemez (kimlik henüz yok); başlık +
            // rastgele sonek kullanılıyor. Çakışırsa P2002'ye düşer.
            slug: `${slugify(input.title) || 'urun'}-${createHash('sha256')
              .update(`${sellerId}:${input.title}:${Date.now()}`)
              .digest('hex')
              .slice(0, 8)}`,
            title: input.title,
            description: input.description,
            brandName: input.brandName,
            gender: input.gender,
            ...(input.season ? { season: input.season } : {}),
            ...(input.collection ? { collection: input.collection } : {}),
            ...(input.sizeChart ? { sizeChart: input.sizeChart as Prisma.InputJsonValue } : {}),
            // ⚠️ Yeni ürün DRAFT doğar. Doğrudan PUBLISHED yazılsaydı
            //    moderasyondan geçmemiş ürün vitrine düşerdi.
            status: 'DRAFT',
          },
          select: { id: true },
        });

        for (const [index, variant] of input.variants.entries()) {
          const created = await tx.variant.create({
            data: {
              productId: product.id,
              sku: variant.sku,
              color: variant.color,
              colorHex: variant.colorHex,
              size: variant.size,
              priceMinor: variant.priceMinor,
              ...(variant.listPriceMinor !== undefined
                ? { listPriceMinor: variant.listPriceMinor }
                : {}),
              ...(variant.barcode ? { barcode: variant.barcode } : {}),
              sortOrder: variant.sortOrder || index,
            },
            select: { id: true },
          });

          await tx.inventory.create({
            data: { variantId: created.id, onHand: variant.stock },
          });

          // Fiyat geçmişi append-only: "sahte indirim" iddiasına karşı kanıt.
          await tx.priceHistory.create({
            data: {
              variantId: created.id,
              priceMinor: variant.priceMinor,
              ...(variant.listPriceMinor !== undefined
                ? { listPriceMinor: variant.listPriceMinor }
                : {}),
              changedBy: sellerId,
            },
          });
        }

        return product.id;
      })
      .catch((error: unknown) => {
        throw translateCatalogWriteError(error);
      });

    return this.getProduct(sellerId, productId);
  }

  async updateProduct(
    sellerId: string,
    productId: string,
    patch: UpdateProductCommand,
    _actorUserId: string,
  ): Promise<SellerProductDetail> {
    const existing = await this.prisma.product.findFirst({
      where: { id: productId, sellerId },
      select: { id: true, status: true },
    });
    if (!existing) throw appError('PRODUCT_NOT_FOUND');

    if (patch.categoryId !== undefined) {
      const category = await this.prisma.category.findFirst({
        where: { id: patch.categoryId, isActive: true },
        select: { id: true },
      });
      if (!category) throw appError('CATEGORY_NOT_FOUND');
    }

    await this.prisma.product
      .update({
        where: { id: productId },
        data: {
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
          ...(patch.brandName !== undefined ? { brandName: patch.brandName } : {}),
          ...(patch.gender !== undefined ? { gender: patch.gender } : {}),
          ...(patch.season !== undefined ? { season: patch.season } : {}),
          ...(patch.collection !== undefined ? { collection: patch.collection } : {}),
          ...(patch.sizeChart !== undefined
            ? { sizeChart: (patch.sizeChart ?? Prisma.DbNull) as Prisma.InputJsonValue }
            : {}),
          ...(patch.aiTagsApproved !== undefined ? { aiTagsApproved: patch.aiTagsApproved } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
        },
      })
      .catch((error: unknown) => {
        throw translateCatalogWriteError(error);
      });

    return this.getProduct(sellerId, productId);
  }

  async archiveProduct(sellerId: string, productId: string): Promise<void> {
    // `updateMany` + sellerId koşulu: sahiplik kontrolü ile güncelleme TEK
    // sorguda, araya yarış durumu giremez.
    const result = await this.prisma.product.updateMany({
      where: { id: productId, sellerId },
      data: { status: 'ARCHIVED' },
    });

    if (result.count === 0) throw appError('PRODUCT_NOT_FOUND');
  }

  async bulkUpdateVariants(
    sellerId: string,
    updates: readonly VariantUpdateCommand[],
    _actorUserId: string,
  ): Promise<{ updated: number }> {
    const ids = updates.map((update) => update.variantId);

    // Tümü bu satıcıya mı ait? Tek sorguda doğrulanır; eksik varsa hiçbiri
    // uygulanmaz.
    const owned = await this.prisma.variant.findMany({
      where: { id: { in: ids }, product: { sellerId } },
      select: {
        id: true,
        priceMinor: true,
        listPriceMinor: true,
        inventory: { select: { reserved: true, version: true } },
      },
    });

    if (owned.length !== ids.length) {
      const found = new Set(owned.map((variant) => variant.id));
      throw appError('VARIANT_NOT_FOUND', {
        internalMessage: `Satıcıya ait olmayan veya bulunamayan varyant: ${ids
          .filter((id) => !found.has(id))
          .join(', ')}`,
      });
    }

    const byId = new Map(owned.map((variant) => [variant.id, variant]));

    await this.prisma.$transaction(async (tx) => {
      for (const update of updates) {
        const current = byId.get(update.variantId)!;

        if (
          update.priceMinor !== undefined ||
          update.listPriceMinor !== undefined ||
          update.isActive !== undefined
        ) {
          await tx.variant.update({
            where: { id: update.variantId },
            data: {
              ...(update.priceMinor !== undefined ? { priceMinor: update.priceMinor } : {}),
              ...(update.listPriceMinor !== undefined
                ? { listPriceMinor: update.listPriceMinor }
                : {}),
              ...(update.isActive !== undefined ? { isActive: update.isActive } : {}),
            },
          });
        }

        // Fiyat GERÇEKTEN değiştiyse geçmişe yaz. Her istekte yazılsaydı
        // geçmiş, hiçbir şeyi değiştirmeyen kayıtlarla dolar ve kampanya
        // denetiminde kullanılamaz hâle gelirdi.
        const priceChanged =
          update.priceMinor !== undefined && update.priceMinor !== current.priceMinor;
        const listChanged =
          update.listPriceMinor !== undefined && update.listPriceMinor !== current.listPriceMinor;

        if (priceChanged || listChanged) {
          await tx.priceHistory.create({
            data: {
              variantId: update.variantId,
              priceMinor: update.priceMinor ?? current.priceMinor,
              listPriceMinor:
                update.listPriceMinor !== undefined
                  ? update.listPriceMinor
                  : current.listPriceMinor,
              changedBy: sellerId,
            },
          });
        }

        if (update.stock !== undefined) {
          const reserved = current.inventory?.reserved ?? 0;

          // ⚠️ Fiziksel stok, REZERVE edilenin altına indirilemez. İndirilseydi
          //    satılabilir adet (onHand − reserved) negatife düşer ve ödemesi
          //    devam eden siparişler karşılıksız kalırdı.
          if (update.stock < reserved) {
            // Satıcı panelinde konuşuyoruz: burada kimse satın almıyor, stok
            // düzeltiliyor. Müşteri mesajı ("en fazla N adet alabilirsiniz")
            // bu ekranda anlamsız kalırdı.
            throw appError('STOCK_BELOW_RESERVED', {
              params: { reserved },
              internalMessage: `Varyant ${update.variantId}: stok ${update.stock} < rezerve ${reserved}`,
            });
          }

          const version = current.inventory?.version ?? 0;

          // Optimistic lock: eşzamanlı checkout rezerve arttırdıysa version
          // değişmiştir ve bu güncelleme UYGULANMAZ.
          const result = await tx.inventory.updateMany({
            where: { variantId: update.variantId, version },
            data: { onHand: update.stock, version: { increment: 1 } },
          });

          if (result.count === 0) {
            // Envanter satırı hiç yoksa oluştur; yoksa gerçek bir yarış vardır.
            if (current.inventory === null) {
              await tx.inventory.create({
                data: { variantId: update.variantId, onHand: update.stock },
              });
            } else {
              throw appError('CONCURRENCY_CONFLICT', {
                internalMessage: `Varyant ${update.variantId} envanteri başka bir işlem tarafından güncellendi`,
              });
            }
          }
        }
      }
    });

    return { updated: updates.length };
  }

  /**
   * CSV TOPLU YAZMA — hepsi ya da hiçbiri.
   *
   * Tek transaction. Yalnızca veritabanı bilgisiyle görülebilen hatalar
   * (kategori yok, SKU başka mağazada) burada toplanır ve yine SATIR
   * NUMARASIYLA BULK_UPLOAD_INVALID'e çevrilir — satıcı için biçim hatasıyla
   * arasında fark yoktur.
   */
  async bulkUpsertProducts(
    sellerId: string,
    products: readonly BulkProductDraft[],
    _actorUserId: string,
  ): Promise<BulkUpsertResult> {
    const errors: BulkRowError[] = [];

    // ── Kategoriler ──
    const categorySlugs = [...new Set(products.map((product) => product.categorySlug))];
    const categories = await this.prisma.category.findMany({
      where: { slug: { in: categorySlugs }, isActive: true },
      select: { id: true, slug: true },
    });
    const categoryBySlug = new Map(categories.map((category) => [category.slug, category.id]));

    for (const product of products) {
      if (!categoryBySlug.has(product.categorySlug)) {
        // Ürünün ilk satırına bağlanır: kategori ürün düzeyinde bir alandır.
        errors.push({
          row: product.variants[0]?.line ?? 1,
          column: 'categorySlug',
          message: `"${product.categorySlug}" diye bir kategori yok veya aktif değil.`,
        });
      }
    }

    // ── SKU çakışması ──
    const allSkus = products.flatMap((product) => product.variants.map((variant) => variant.sku));
    const existingVariants = await this.prisma.variant.findMany({
      where: { sku: { in: allSkus } },
      select: { sku: true, product: { select: { sellerId: true, slug: true } } },
    });
    const foreignSkus = new Set(
      existingVariants
        .filter((variant) => variant.product.sellerId !== sellerId)
        .map((variant) => variant.sku),
    );

    for (const product of products) {
      for (const variant of product.variants) {
        if (foreignSkus.has(variant.sku)) {
          errors.push({
            row: variant.line,
            column: 'sku',
            message: `"${variant.sku}" başka bir mağazada kayıtlı. Farklı bir SKU kullanın.`,
          });
        }
      }
    }

    if (errors.length > 0) throw bulkUploadError(errors);

    // ── Yazma ──
    const result: BulkUpsertResult = {
      createdProducts: 0,
      updatedProducts: 0,
      createdVariants: 0,
      updatedVariants: 0,
    };

    await this.prisma
      .$transaction(
        async (tx) => {
          for (const draft of products) {
            const slug = productSlug(sellerId, draft.productRef, draft.title);
            const categoryId = categoryBySlug.get(draft.categorySlug)!;

            // Kararlı slug sayesinde aynı dosyanın ikinci yüklemesi ürünü
            // GÜNCELLER, mükerrer yaratmaz.
            const existing = await tx.product.findUnique({
              where: { slug },
              select: { id: true, sellerId: true },
            });

            if (existing && existing.sellerId !== sellerId) {
              // Slug çakışması başka mağazayla: hash sellerId içerdiği için
              // pratikte imkânsız, ama sessizce üzerine yazmaktansa dur.
              throw bulkUploadError([
                {
                  row: draft.variants[0]?.line ?? 1,
                  column: 'productRef',
                  message: 'Bu ürün kodu başka bir mağazayla çakışıyor. Farklı bir kod kullanın.',
                },
              ]);
            }

            let productId: string;
            if (existing) {
              await tx.product.update({
                where: { id: existing.id },
                data: {
                  title: draft.title,
                  ...(draft.description ? { description: draft.description } : {}),
                  categoryId,
                  brandName: draft.brandName,
                  gender: draft.gender,
                },
              });
              productId = existing.id;
              result.updatedProducts += 1;
            } else {
              const created = await tx.product.create({
                data: {
                  sellerId,
                  categoryId,
                  slug,
                  title: draft.title,
                  description: draft.description || draft.title,
                  brandName: draft.brandName,
                  gender: draft.gender,
                  // Toplu yükleme de moderasyondan geçer.
                  status: 'DRAFT',
                },
                select: { id: true },
              });
              productId = created.id;
              result.createdProducts += 1;
            }

            for (const [index, variant] of draft.variants.entries()) {
              const current = await tx.variant.findUnique({
                where: { sku: variant.sku },
                select: { id: true, productId: true, priceMinor: true, listPriceMinor: true },
              });

              if (current && current.productId !== productId) {
                throw bulkUploadError([
                  {
                    row: variant.line,
                    column: 'sku',
                    message: `"${variant.sku}" bu mağazada başka bir ürüne bağlı. SKU'yu değiştirin.`,
                  },
                ]);
              }

              if (current) {
                await tx.variant.update({
                  where: { id: current.id },
                  data: {
                    color: variant.color,
                    colorHex: variant.colorHex,
                    size: variant.size,
                    priceMinor: variant.priceMinor,
                    listPriceMinor: variant.listPriceMinor,
                    barcode: variant.barcode,
                    sortOrder: index,
                  },
                });

                if (
                  current.priceMinor !== variant.priceMinor ||
                  current.listPriceMinor !== variant.listPriceMinor
                ) {
                  await tx.priceHistory.create({
                    data: {
                      variantId: current.id,
                      priceMinor: variant.priceMinor,
                      listPriceMinor: variant.listPriceMinor,
                      changedBy: sellerId,
                    },
                  });
                }

                await tx.inventory.upsert({
                  where: { variantId: current.id },
                  create: { variantId: current.id, onHand: variant.stock },
                  update: { onHand: variant.stock, version: { increment: 1 } },
                });
                result.updatedVariants += 1;
              } else {
                const created = await tx.variant.create({
                  data: {
                    productId,
                    sku: variant.sku,
                    color: variant.color,
                    colorHex: variant.colorHex,
                    size: variant.size,
                    priceMinor: variant.priceMinor,
                    listPriceMinor: variant.listPriceMinor,
                    barcode: variant.barcode,
                    sortOrder: index,
                  },
                  select: { id: true },
                });

                await tx.inventory.create({
                  data: { variantId: created.id, onHand: variant.stock },
                });
                await tx.priceHistory.create({
                  data: {
                    variantId: created.id,
                    priceMinor: variant.priceMinor,
                    listPriceMinor: variant.listPriceMinor,
                    changedBy: sellerId,
                  },
                });
                result.createdVariants += 1;
              }
            }
          }
        },
        // Büyük dosyalarda varsayılan 5 sn yetmez; yarıda kesilen transaction
        // "hepsi ya da hiçbiri" sözünü tutar ama satıcıya sebepsiz hata verir.
        { timeout: 120_000, maxWait: 10_000 },
      )
      .catch((error: unknown) => {
        throw translateCatalogWriteError(error);
      });

    return result;
  }
}

/** Prisma yazma hatalarını uygulama hatalarına çevirir. */
function translateCatalogWriteError(error: unknown): unknown {
  if (!isPrismaKnownError(error)) return error;

  if (error.code === PRISMA_ERROR.UNIQUE_VIOLATION) {
    return appError('DUPLICATE_RESOURCE', {
      cause: error,
      internalMessage: `Benzersizlik ihlali: ${JSON.stringify(error.meta?.['target'])}`,
    });
  }
  if (error.code === PRISMA_ERROR.FOREIGN_KEY_VIOLATION) {
    return appError('INVALID_REFERENCE', { cause: error });
  }
  return error;
}

// ═══════════════════════ SİPARİŞ / İADE OKUMA ═══════════════════════════════

@Injectable()
export class PrismaSellerFulfillmentReaderBridge implements SellerFulfillmentReaderPort {
  constructor(private readonly prisma: PrismaService) {}

  async listPackages(
    sellerId: string,
    query: {
      status?: PackageStatus | undefined;
      slaBreached?: boolean | undefined;
      orderNumber?: string | undefined;
      cursor?: string | undefined;
      limit: number;
    },
  ): Promise<{ items: SellerPackageSummary[]; nextCursor: string | null }> {
    const now = new Date();

    const rows = await this.prisma.orderPackage.findMany({
      where: {
        sellerId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.orderNumber ? { order: { orderNumber: query.orderNumber } } : {}),
        // SLA ihlali: son tarih geçmiş ve paket hâlâ kargolanmamış.
        ...(query.slaBreached
          ? {
              slaDeadline: { lt: now },
              status: { in: ['AWAITING_APPROVAL', 'PREPARING'] as PackageStatus[] },
            }
          : {}),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        orderId: true,
        status: true,
        itemsTotalMinor: true,
        shippingMinor: true,
        discountShareMinor: true,
        carrier: true,
        trackingNo: true,
        slaDeadline: true,
        shippedAt: true,
        deliveredAt: true,
        createdAt: true,
        order: { select: { orderNumber: true } },
        _count: { select: { items: true } },
      },
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    const items: SellerPackageSummary[] = page.map((pkg) => ({
      id: pkg.id,
      orderId: pkg.orderId,
      orderNumber: pkg.order.orderNumber,
      status: pkg.status,
      itemsTotalMinor: pkg.itemsTotalMinor,
      shippingMinor: pkg.shippingMinor,
      discountShareMinor: pkg.discountShareMinor,
      carrier: pkg.carrier,
      trackingNo: pkg.trackingNo,
      slaDeadline: pkg.slaDeadline,
      shippedAt: pkg.shippedAt,
      deliveredAt: pkg.deliveredAt,
      createdAt: pkg.createdAt,
      itemCount: pkg._count.items,
      slaBreached:
        pkg.shippedAt === null &&
        pkg.slaDeadline.getTime() < now.getTime() &&
        (pkg.status === 'AWAITING_APPROVAL' || pkg.status === 'PREPARING'),
    }));

    return { items, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null };
  }

  async getPackage(sellerId: string, packageId: string): Promise<SellerPackageDetail> {
    const now = new Date();

    const pkg = await this.prisma.orderPackage.findFirst({
      where: { id: packageId, sellerId },
      select: {
        id: true,
        orderId: true,
        status: true,
        itemsTotalMinor: true,
        shippingMinor: true,
        discountShareMinor: true,
        carrier: true,
        trackingNo: true,
        slaDeadline: true,
        shippedAt: true,
        deliveredAt: true,
        createdAt: true,
        order: { select: { orderNumber: true, shippingAddress: true } },
        items: {
          select: {
            id: true,
            productTitle: true,
            variantLabel: true,
            sku: true,
            imageKey: true,
            quantity: true,
            unitPriceMinor: true,
            lineTotalMinor: true,
            sellerNetMinor: true,
            commissionAmountMinor: true,
            commissionRateBps: true,
          },
        },
      },
    });

    if (!pkg) throw appError('PACKAGE_NOT_FOUND');

    return {
      id: pkg.id,
      orderId: pkg.orderId,
      orderNumber: pkg.order.orderNumber,
      status: pkg.status,
      itemsTotalMinor: pkg.itemsTotalMinor,
      shippingMinor: pkg.shippingMinor,
      discountShareMinor: pkg.discountShareMinor,
      carrier: pkg.carrier,
      trackingNo: pkg.trackingNo,
      slaDeadline: pkg.slaDeadline,
      shippedAt: pkg.shippedAt,
      deliveredAt: pkg.deliveredAt,
      createdAt: pkg.createdAt,
      itemCount: pkg.items.length,
      slaBreached:
        pkg.shippedAt === null &&
        pkg.slaDeadline.getTime() < now.getTime() &&
        (pkg.status === 'AWAITING_APPROVAL' || pkg.status === 'PREPARING'),
      shipping: pickShippingFields(pkg.order.shippingAddress),
      items: pkg.items,
    };
  }

  async listReturns(
    sellerId: string,
    query: { status?: ReturnStatus | undefined; cursor?: string | undefined; limit: number },
  ): Promise<{ items: SellerReturnSummary[]; nextCursor: string | null }> {
    const rows = await this.prisma.returnRequest.findMany({
      // ⚠️ Kapsam kalem üzerinden kuruluyor: iade TALEBİ siparişe aittir,
      //    sipariş çok satıcılı olabilir. Satıcı yalnızca KENDİ kalemlerini
      //    içeren iadeleri görür.
      where: {
        ...(query.status ? { status: query.status } : {}),
        items: { some: { orderItem: { package: { sellerId } } } },
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: returnSelect(sellerId),
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      items: page.map(toReturnSummary),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async getReturn(sellerId: string, returnId: string): Promise<SellerReturnSummary> {
    const row = await this.prisma.returnRequest.findFirst({
      where: { id: returnId, items: { some: { orderItem: { package: { sellerId } } } } },
      select: returnSelect(sellerId),
    });

    if (!row) throw appError('NOT_FOUND', { internalMessage: `İade ${returnId} bulunamadı` });
    return toReturnSummary(row);
  }
}

/**
 * ⚠️ Kalemler satıcıya göre FİLTRELENİR. Filtrelenmezse çok satıcılı bir
 *    siparişin iadesinde satıcı, diğer satıcının ürünlerini ve tutarlarını
 *    görürdü.
 */
function returnSelect(sellerId: string) {
  return {
    id: true,
    returnNumber: true,
    orderId: true,
    status: true,
    reason: true,
    note: true,
    photoKeys: true,
    refundAmountMinor: true,
    decidedAt: true,
    createdAt: true,
    order: { select: { orderNumber: true } },
    items: {
      where: { orderItem: { package: { sellerId } } },
      select: {
        orderItemId: true,
        quantity: true,
        refundMinor: true,
        orderItem: { select: { productTitle: true, variantLabel: true } },
      },
    },
  } as const;
}

function toReturnSummary(row: {
  id: string;
  returnNumber: string;
  orderId: string;
  status: ReturnStatus;
  reason: string;
  note: string | null;
  photoKeys: string[];
  refundAmountMinor: bigint;
  decidedAt: Date | null;
  createdAt: Date;
  order: { orderNumber: string };
  items: Array<{
    orderItemId: string;
    quantity: number;
    refundMinor: bigint;
    orderItem: { productTitle: string; variantLabel: string };
  }>;
}): SellerReturnSummary {
  return {
    id: row.id,
    returnNumber: row.returnNumber,
    orderId: row.orderId,
    orderNumber: row.order.orderNumber,
    status: row.status,
    reason: row.reason,
    note: row.note,
    refundAmountMinor: row.refundAmountMinor,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
    photoKeys: row.photoKeys,
    items: row.items.map((item) => ({
      orderItemId: item.orderItemId,
      productTitle: item.orderItem.productTitle,
      variantLabel: item.orderItem.variantLabel,
      quantity: item.quantity,
      refundMinor: item.refundMinor,
    })),
  };
}

/**
 * Sipariş adresi JSON snapshot'ından YALNIZCA kargo alanlarını alır.
 *
 * ⚠️ Nesnenin tamamı verilmez: fatura bilgisi, vergi numarası ve e-posta
 *    satıcının kargo göndermek için ihtiyaç duymadığı kişisel veridir
 *    (veri minimizasyonu). Alan alan seçmek, snapshot'a ileride yeni bir alan
 *    eklendiğinde onun otomatik olarak satıcıya sızmasını da engeller.
 */
function pickShippingFields(address: unknown): SellerPackageDetail['shipping'] {
  const source = (address ?? {}) as Record<string, unknown>;
  const text = (key: string): string =>
    typeof source[key] === 'string' ? (source[key] as string) : '';
  const optional = (key: string): string | null =>
    typeof source[key] === 'string' && source[key] !== '' ? (source[key] as string) : null;

  return {
    contactName: text('contactName'),
    phone: text('phone'),
    city: text('city'),
    district: text('district'),
    neighbourhood: optional('neighbourhood'),
    line1: text('line1'),
    postalCode: optional('postalCode'),
  };
}

// ═══════════════════════════ ANALİTİK OKUMA ═════════════════════════════════

@Injectable()
export class PrismaSellerAnalyticsReaderBridge implements SellerAnalyticsReaderPort {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ⚠️ Ham SQL kullanılıyor çünkü sayımlar dört ayrı modülün tablosunu
   *    (AI deneme, sepet, sipariş, katalog) çapraz kesiyor ve Prisma Client
   *    bunu tek turda ifade edemiyor. Tüm parametreler `Prisma.sql` ile
   *    BAĞLANIYOR — string birleştirme yok, enjeksiyon mümkün değil.
   */
  async funnelTotals(
    sellerId: string,
    range: DateRange,
  ): Promise<{
    tryOnCount: number;
    cartAddCount: number;
    purchasedCount: number;
    revenueMinor: bigint;
    orderCount: number;
  }> {
    const [tryOn, cart, sales] = await Promise.all([
      this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*) AS count
        FROM ai_tryon_jobs j
        JOIN catalog_variants v ON v.id = j."variantId"
        JOIN catalog_products p ON p.id = v."productId"
        WHERE p."sellerId" = ${sellerId}::uuid
          AND j."status" = 'SUCCEEDED'
          AND j."queuedAt" >= ${range.from} AND j."queuedAt" < ${range.to}`),

      this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*) AS count
        FROM cart_items ci
        JOIN catalog_variants v ON v.id = ci."variantId"
        JOIN catalog_products p ON p.id = v."productId"
        WHERE p."sellerId" = ${sellerId}::uuid
          AND ci."createdAt" >= ${range.from} AND ci."createdAt" < ${range.to}`),

      this.prisma.$queryRaw<
        Array<{ quantity: bigint | null; revenue: bigint | null; orders: bigint }>
      >(Prisma.sql`
        SELECT
          SUM(oi."quantity")        AS quantity,
          SUM(oi."lineTotalMinor")  AS revenue,
          COUNT(DISTINCT oi."orderId") AS orders
        FROM order_items oi
        JOIN order_packages pk ON pk.id = oi."packageId"
        JOIN order_orders o    ON o.id = oi."orderId"
        WHERE pk."sellerId" = ${sellerId}::uuid
          -- İptal edilen paket satış değildir.
          AND pk."status" <> 'CANCELLED'
          -- Ödeme tamamlanmamış sipariş de satış değildir.
          AND o."paidAt" IS NOT NULL
          AND o."paidAt" >= ${range.from} AND o."paidAt" < ${range.to}`),
    ]);

    return {
      tryOnCount: Number(tryOn[0]?.count ?? 0n),
      cartAddCount: Number(cart[0]?.count ?? 0n),
      purchasedCount: Number(sales[0]?.quantity ?? 0n),
      // ⚠️ Ciro bigint kalır. Number'a çevrilseydi 2^53 kuruşun üstünde
      //    sessizce bozulurdu.
      revenueMinor: sales[0]?.revenue ?? 0n,
      orderCount: Number(sales[0]?.orders ?? 0n),
    };
  }

  async funnelByProduct(
    sellerId: string,
    range: DateRange,
    limit: number,
  ): Promise<
    Array<{
      productId: string;
      title: string;
      tryOnScore: number | null;
      tryOnCount: number;
      cartAddCount: number;
      purchasedCount: number;
    }>
  > {
    const rows = await this.prisma.$queryRaw<
      Array<{
        productId: string;
        title: string;
        tryOnScore: number | null;
        tryons: bigint;
        carts: bigint;
        purchased: bigint;
      }>
    >(Prisma.sql`
      WITH tryons AS (
        SELECT p.id AS product_id, COUNT(*) AS n
        FROM ai_tryon_jobs j
        JOIN catalog_variants v ON v.id = j."variantId"
        JOIN catalog_products p ON p.id = v."productId"
        WHERE p."sellerId" = ${sellerId}::uuid
          AND j."status" = 'SUCCEEDED'
          AND j."queuedAt" >= ${range.from} AND j."queuedAt" < ${range.to}
        GROUP BY p.id
      ),
      carts AS (
        SELECT p.id AS product_id, COUNT(*) AS n
        FROM cart_items ci
        JOIN catalog_variants v ON v.id = ci."variantId"
        JOIN catalog_products p ON p.id = v."productId"
        WHERE p."sellerId" = ${sellerId}::uuid
          AND ci."createdAt" >= ${range.from} AND ci."createdAt" < ${range.to}
        GROUP BY p.id
      ),
      sales AS (
        SELECT oi."productId" AS product_id, SUM(oi."quantity") AS n
        FROM order_items oi
        JOIN order_packages pk ON pk.id = oi."packageId"
        JOIN order_orders o    ON o.id = oi."orderId"
        WHERE pk."sellerId" = ${sellerId}::uuid
          AND pk."status" <> 'CANCELLED'
          AND o."paidAt" IS NOT NULL
          AND o."paidAt" >= ${range.from} AND o."paidAt" < ${range.to}
        GROUP BY oi."productId"
      )
      SELECT p.id AS "productId", p.title, p."tryOnScore",
             COALESCE(t.n, 0) AS tryons,
             COALESCE(c.n, 0) AS carts,
             COALESCE(s.n, 0) AS purchased
      FROM catalog_products p
      LEFT JOIN tryons t ON t.product_id = p.id
      LEFT JOIN carts  c ON c.product_id = p.id
      LEFT JOIN sales  s ON s.product_id = p.id
      WHERE p."sellerId" = ${sellerId}::uuid
        -- Aralıkta hiç hareketi olmayan ürünler raporu şişirir.
        AND (t.n IS NOT NULL OR c.n IS NOT NULL OR s.n IS NOT NULL)
      ORDER BY COALESCE(t.n, 0) DESC, COALESCE(s.n, 0) DESC
      LIMIT ${limit}`);

    return rows.map((row) => ({
      productId: row.productId,
      title: row.title,
      tryOnScore: row.tryOnScore,
      tryOnCount: Number(row.tryons),
      cartAddCount: Number(row.carts),
      purchasedCount: Number(row.purchased),
    }));
  }

  /**
   * BEDEN BAZLI SATIŞ VE İADE.
   *
   * Beden, sipariş kalemindeki `variantLabel` metninden AYRIŞTIRILMAZ
   * ("Siyah / M" biçimi değişirse rapor sessizce bozulurdu); varyant
   * tablosundaki `size` alanından okunur.
   *
   * İade sebebi kalem düzeyinde değil TALEP düzeyinde tutulduğu için
   * (`ReturnRequest.reason`), "küçük geldi / büyük geldi" sayımı talebin
   * sebebinden gelir.
   */
  async returnsBySize(
    sellerId: string,
    range: DateRange,
  ): Promise<
    Array<{
      size: string;
      soldQuantity: number;
      returnedQuantity: number;
      tooSmallQuantity: number;
      tooLargeQuantity: number;
    }>
  > {
    const rows = await this.prisma.$queryRaw<
      Array<{
        size: string;
        sold: bigint;
        returned: bigint;
        too_small: bigint;
        too_large: bigint;
      }>
    >(Prisma.sql`
      WITH sold AS (
        SELECT v."size" AS size, SUM(oi."quantity") AS n
        FROM order_items oi
        JOIN order_packages pk   ON pk.id = oi."packageId"
        JOIN order_orders o      ON o.id = oi."orderId"
        JOIN catalog_variants v  ON v.id = oi."variantId"
        WHERE pk."sellerId" = ${sellerId}::uuid
          AND pk."status" <> 'CANCELLED'
          AND o."paidAt" IS NOT NULL
          AND o."paidAt" >= ${range.from} AND o."paidAt" < ${range.to}
        GROUP BY v."size"
      ),
      returned AS (
        SELECT
          v."size" AS size,
          SUM(ri."quantity") AS n,
          SUM(ri."quantity") FILTER (WHERE r."reason" = 'SIZE_TOO_SMALL') AS too_small,
          SUM(ri."quantity") FILTER (WHERE r."reason" = 'SIZE_TOO_LARGE') AS too_large
        FROM return_items ri
        JOIN return_requests r  ON r.id = ri."returnId"
        JOIN order_items oi     ON oi.id = ri."orderItemId"
        JOIN order_packages pk  ON pk.id = oi."packageId"
        JOIN catalog_variants v ON v.id = oi."variantId"
        WHERE pk."sellerId" = ${sellerId}::uuid
          -- Reddedilen/iptal edilen iade gerçekleşmemiştir; orana katılmaz.
          AND r."status" IN ('APPROVED', 'IN_TRANSIT', 'RECEIVED', 'REFUNDED')
          AND r."createdAt" >= ${range.from} AND r."createdAt" < ${range.to}
        GROUP BY v."size"
      )
      SELECT
        COALESCE(sold.size, returned.size) AS size,
        COALESCE(sold.n, 0)                AS sold,
        COALESCE(returned.n, 0)            AS returned,
        COALESCE(returned.too_small, 0)    AS too_small,
        COALESCE(returned.too_large, 0)    AS too_large
      FROM sold
      -- FULL JOIN: aralıkta satılmamış ama iade edilmiş beden de görünmeli
      -- (önceki dönemde satılıp bu dönemde iade edilen ürünler).
      FULL OUTER JOIN returned ON returned.size = sold.size
      ORDER BY 2 DESC`);

    return rows.map((row) => ({
      size: row.size,
      soldQuantity: Number(row.sold),
      returnedQuantity: Number(row.returned),
      tooSmallQuantity: Number(row.too_small),
      tooLargeQuantity: Number(row.too_large),
    }));
  }
}

// ═══════════════════════════ KUPON YAZMA ════════════════════════════════════

const COUPON_SELECT = {
  id: true,
  code: true,
  discountType: true,
  discountValue: true,
  maxDiscountMinor: true,
  minCartMinor: true,
  usageLimit: true,
  usageLimitPerUser: true,
  usedCount: true,
  validFrom: true,
  validTo: true,
  isActive: true,
  createdAt: true,
} as const;

@Injectable()
export class PrismaSellerCouponBridge implements SellerCouponPort {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    sellerId: string,
    query: { isActive?: boolean | undefined; cursor?: string | undefined; limit: number },
  ): Promise<{ items: SellerCouponView[]; nextCursor: string | null }> {
    const rows = await this.prisma.coupon.findMany({
      // ⚠️ `sellerId` koşulu ZORUNLU. Düşerse platform kuponları
      //    (sellerId = null) da listeye girer.
      where: { sellerId, ...(query.isActive !== undefined ? { isActive: query.isActive } : {}) },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: COUPON_SELECT,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    return { items: page, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null };
  }

  async create(
    sellerId: string,
    input: {
      code: string;
      discountType: 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE_SHIPPING';
      discountValue: bigint;
      maxDiscountMinor?: bigint | undefined;
      minCartMinor: bigint;
      usageLimit?: number | undefined;
      usageLimitPerUser: number;
      validFrom: Date;
      validTo: Date;
    },
  ): Promise<SellerCouponView> {
    try {
      return await this.prisma.coupon.create({
        data: {
          sellerId,
          code: input.code,
          discountType: input.discountType,
          discountValue: input.discountValue,
          ...(input.maxDiscountMinor !== undefined
            ? { maxDiscountMinor: input.maxDiscountMinor }
            : {}),
          minCartMinor: input.minCartMinor,
          ...(input.usageLimit !== undefined ? { usageLimit: input.usageLimit } : {}),
          usageLimitPerUser: input.usageLimitPerUser,
          validFrom: input.validFrom,
          validTo: input.validTo,
        },
        select: COUPON_SELECT,
      });
    } catch (error) {
      if (isPrismaKnownError(error) && error.code === PRISMA_ERROR.UNIQUE_VIOLATION) {
        // Kupon kodu GLOBAL benzersiz: başka bir mağazanın veya platformun
        // kodu olabilir. Hangi mağazaya ait olduğu SÖYLENMEZ — rakip mağaza
        // kampanya kodlarını deneme yanılmayla keşfetmesin.
        throw appError('COUPON_CODE_TAKEN', {
          cause: error,
          internalMessage: `Kupon kodu çakıştı: ${input.code}`,
          details: {
            fields: [
              { path: 'code', message: 'Bu kupon kodu kullanılıyor, başka bir kod deneyin.' },
            ],
          },
        });
      }
      throw error;
    }
  }

  async update(
    sellerId: string,
    couponId: string,
    patch: {
      isActive?: boolean | undefined;
      validTo?: Date | undefined;
      usageLimit?: number | null | undefined;
    },
  ): Promise<SellerCouponView> {
    // Sahiplik kontrolü ile güncelleme TEK sorguda: `sellerId` koşulu
    // düşerse satıcı platform kuponunu kapatabilirdi.
    const result = await this.prisma.coupon.updateMany({
      where: { id: couponId, sellerId },
      data: {
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
        ...(patch.validTo !== undefined ? { validTo: patch.validTo } : {}),
        ...(patch.usageLimit !== undefined ? { usageLimit: patch.usageLimit } : {}),
      },
    });

    if (result.count === 0) {
      throw appError('NOT_FOUND', {
        internalMessage: `Kupon ${couponId} bu mağazaya ait değil veya yok`,
      });
    }

    const coupon = await this.prisma.coupon.findUniqueOrThrow({
      where: { id: couponId },
      select: COUPON_SELECT,
    });
    return coupon;
  }
}
