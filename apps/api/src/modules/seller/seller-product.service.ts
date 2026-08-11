import { Inject, Injectable } from '@nestjs/common';
import { APP_LOGGER } from '../../infra/infra.module.js';
import type { Logger } from '../../common/logger.js';
import { SellerService } from './seller.service.js';
import { parseBulkUpload } from './seller-csv.js';
import {
  SELLER_CATALOG,
  type BulkUpsertResult,
  type SellerCatalogPort,
  type SellerProductDetail,
  type SellerProductSummary,
} from './seller.ports.js';
import type {
  BulkUploadInput,
  BulkVariantUpdateInput,
  CreateProductInput,
  SellerProductListQuery,
  UpdateProductInput,
} from './seller.schema.js';

/**
 * SATICI ÜRÜN YÖNETİMİ.
 *
 * Ürün/varyant/stok tabloları KATALOG modülünündür; bu servis onlara
 * `SellerCatalogPort` üzerinden erişir (kural 3). Servis, katalog yazma
 * yüzeyine geçmeden önce iki şeyi garanti eder:
 *   1. mağaza işlem yapmaya uygun mu (onaylı, askıda değil),
 *   2. kaynak gerçekten BU mağazanın mı.
 *
 * İkincisi porta `sellerId` parametresi olarak geçirilir ve port bunu SORGU
 * KOŞULU yapar — "önce oku, sonra sahibini kontrol et" yazılsaydı bir gün o
 * kontrol düşer ve başka mağazanın ürünü güncellenirdi.
 */
@Injectable()
export class SellerProductService {
  constructor(
    private readonly sellers: SellerService,
    @Inject(SELLER_CATALOG) private readonly catalog: SellerCatalogPort,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  async list(
    sellerId: string,
    query: SellerProductListQuery,
  ): Promise<{ items: SellerProductSummary[]; nextCursor: string | null }> {
    // Okuma için `requireActive` YOK: askıya alınmış satıcı da ürünlerini
    // görebilmeli — göremezse neyi düzelteceğini bilemez.
    return this.catalog.listProducts(sellerId, {
      status: query.status,
      q: query.q,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  async get(sellerId: string, productId: string): Promise<SellerProductDetail> {
    return this.catalog.getProduct(sellerId, productId);
  }

  async create(sellerId: string, input: CreateProductInput): Promise<SellerProductDetail> {
    await this.sellers.requireActive(sellerId);

    return this.catalog.createProduct(sellerId, {
      title: input.title,
      description: input.description,
      categoryId: input.categoryId,
      brandName: input.brandName,
      gender: input.gender,
      season: input.season,
      collection: input.collection,
      sizeChart: input.sizeChart,
      variants: input.variants.map((variant) => ({
        sku: variant.sku,
        color: variant.color,
        colorHex: variant.colorHex,
        size: variant.size,
        priceMinor: variant.priceMinor,
        listPriceMinor: variant.listPriceMinor,
        barcode: variant.barcode,
        stock: variant.stock,
        sortOrder: variant.sortOrder,
      })),
    });
  }

  async update(
    sellerId: string,
    productId: string,
    input: UpdateProductInput,
    actorUserId: string,
  ): Promise<SellerProductDetail> {
    await this.sellers.requireActive(sellerId);
    return this.catalog.updateProduct(sellerId, productId, input, actorUserId);
  }

  /**
   * Ürün SİLİNMEZ, arşivlenir.
   *
   * Silinseydi o ürüne bağlı sipariş kalemleri, iadeler ve defter kayıtları
   * öksüz kalırdı. Sipariş kalemi zaten snapshot tutuyor ama ürün geçmişi ve
   * fiyat denetimi kaybolurdu.
   */
  async archive(sellerId: string, productId: string): Promise<{ archived: true }> {
    await this.sellers.requireActive(sellerId);
    await this.catalog.archiveProduct(sellerId, productId);
    return { archived: true };
  }

  /**
   * VARYANT TOPLU GÜNCELLEME — fiyat, stok, aktiflik.
   *
   * Tek transaction'da uygulanır. Kısmi başarı olsaydı satıcı 200 satırlık
   * bir fiyat güncellemesinin hangi 40'ının geçtiğini bilemez, tekrar
   * denediğinde geçenleri yeniden uygulardı.
   */
  async bulkUpdateVariants(
    sellerId: string,
    input: BulkVariantUpdateInput,
    actorUserId: string,
  ): Promise<{ updated: number }> {
    await this.sellers.requireActive(sellerId);

    const result = await this.catalog.bulkUpdateVariants(
      sellerId,
      input.updates.map((update) => ({
        variantId: update.variantId,
        priceMinor: update.priceMinor,
        listPriceMinor: update.listPriceMinor,
        stock: update.stock,
        isActive: update.isActive,
      })),
      actorUserId,
    );

    this.logger.info({ sellerId, count: result.updated }, 'Varyant toplu güncelleme');
    return result;
  }

  /**
   * CSV TOPLU YÜKLEME.
   *
   * İki aşama, ikisi de "hep ya da hiç":
   *   1. Ayrıştırma + doğrulama (saf, veritabanısız) — biçim, tip, dosya içi
   *      tekrar ve tutarlılık hataları satır numarasıyla toplanır.
   *   2. Yazma (tek transaction) — kategori bulunamadı, SKU başka mağazada
   *      kayıtlı gibi ancak veritabanı bilgisiyle görülebilen hatalar da
   *      aynı biçimde, satır numarasıyla döner.
   *
   * Doğrulama yazmadan ÖNCE ve ayrı yapılır: 500 satırlık bir dosyayı
   * transaction içinde satır satır doğrulamak, ilk hatada kilitleri boşuna
   * tutup geri almak demektir.
   */
  async bulkUpload(
    sellerId: string,
    input: BulkUploadInput,
    actorUserId: string,
  ): Promise<BulkUpsertResult & { rowCount: number; fileName: string }> {
    await this.sellers.requireActive(sellerId);

    // Hatalıysa BULK_UPLOAD_INVALID fırlatır; hiçbir satır yazılmaz.
    const parsed = parseBulkUpload(input.content);

    const result = await this.catalog.bulkUpsertProducts(sellerId, parsed.products, actorUserId);

    this.logger.info(
      { sellerId, fileName: input.fileName, rowCount: parsed.rowCount, ...result },
      'CSV toplu yükleme tamamlandı',
    );

    return { ...result, rowCount: parsed.rowCount, fileName: input.fileName };
  }
}
