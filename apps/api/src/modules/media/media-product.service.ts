import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { MEDIA } from '@vt/config';
import { appError } from '@vt/contracts';
import { APP_LOGGER } from '../../infra/infra.module.js';
import type { Logger } from '../../common/logger.js';
import { detectImageFormat } from './image-format.js';
import {
  MEDIA_IMAGE_PROCESSOR,
  type ImageAnalysis,
  type ImageProcessor,
} from './image-processor.js';
import {
  MEDIA_CATALOG,
  MEDIA_STORAGE,
  mediaKeys,
  type MediaCatalogPort,
  type MediaProductImage,
  type MediaStoragePort,
} from './media.ports.js';
import {
  scoreTryOnReadiness,
  type ReadinessAngle,
  type ReadinessImageFacts,
  type TryOnReadinessResult,
  type TryOnSuggestion,
} from './tryon-readiness.js';
import type { ProductImageConfirmInput, ProductImageUploadInput } from './media.schema.js';
import type { UploadTicket } from './media.service.js';

export interface ProductImageView {
  id: string;
  productId: string;
  storageKey: string;
  /** CDN adresi — ürün görselleri public, imza gerektirmez. */
  url: string;
  angle: string;
  isPrimary: boolean;
  blurhash: string | null;
  widthPx: number;
  heightPx: number;
  /** Duyarlı gösterim için genişlik → CDN adresi. */
  variants: Array<{ width: number; url: string }>;
}

export interface ProductImageConfirmResult {
  image: ProductImageView;
  tryOnScore: number;
  tryOnIssues: string[];
  /** Skor eşiğin altındaysa dolu gelir; en çok puan kazandıran başta. */
  suggestions: TryOnSuggestion[];
}

/**
 * ═══════════════════════ ÜRÜN GÖRSELİ SERVİSİ ═══════════════════════════════
 *
 * Kullanıcı fotoğrafı akışıyla AYNI DEĞİLDİR ve karıştırılamaz:
 *
 *   • Kullanıcı fotoğrafı  → private kova, imzalı okuma, saklama süresi, rıza.
 *   • Ürün görseli         → public kova (CDN), kalıcı, satıcıya ait.
 *
 * ⚠️ Ham yükleme yine de PRIVATE kovaya iner (`staging/`). Sebep: imzalı URL
 *    ile gelen dosya EXIF'lidir ve doğrudan public kovaya yazılsaydı, biz onu
 *    işleyene kadar satıcının atölye/ev GPS konumu CDN'den indirilebilir
 *    olurdu. Public kovaya yalnızca temizlenmiş türev yazılır; staging nesnesi
 *    işlem biter bitmez silinir.
 * ═══════════════════════════════════════════════════════════════════════════
 */
@Injectable()
export class MediaProductService {
  constructor(
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStoragePort,
    @Inject(MEDIA_IMAGE_PROCESSOR) private readonly processor: ImageProcessor,
    @Inject(MEDIA_CATALOG) private readonly catalog: MediaCatalogPort,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  /** POST /seller/products/:id/images */
  async requestUpload(
    sellerId: string,
    productId: string,
    input: ProductImageUploadInput,
  ): Promise<UploadTicket> {
    await this.requireOwnedProduct(sellerId, productId);

    const imageId = randomUUID();
    const stagingKey = mediaKeys.productImageStaging(productId, imageId);

    const uploadUrl = await this.storage.signedUrl({
      key: stagingKey,
      visibility: 'private', // ⚠️ Ham dosya asla public kovaya inmez.
      operation: 'put',
      expiresInSeconds: MEDIA.uploadUrlTtlSeconds,
      contentType: input.contentType,
      maxSizeBytes: input.sizeBytes,
    });

    return {
      uploadId: imageId,
      uploadUrl,
      requiredContentType: input.contentType,
      maxSizeBytes: input.sizeBytes,
      expiresInSeconds: MEDIA.uploadUrlTtlSeconds,
    };
  }

  /**
   * POST /seller/products/:id/images/:imageId/confirm
   *
   * Ham dosyayı işler, public türevleri yazar, satırı oluşturur ve ürünün
   * Try-On Uygunluk Skorunu yeniden hesaplar.
   */
  async confirmUpload(
    sellerId: string,
    productId: string,
    imageId: string,
    input: ProductImageConfirmInput,
  ): Promise<ProductImageConfirmResult> {
    await this.requireOwnedProduct(sellerId, productId);

    const stagingKey = mediaKeys.productImageStaging(productId, imageId);

    if (!(await this.storage.exists(stagingKey, 'private'))) {
      throw appError('PHOTO_NOT_FOUND', {
        internalMessage: `Onaylanmak istenen yükleme depoda yok: ${stagingKey}`,
      });
    }

    const raw = await this.storage.get(stagingKey, 'private');

    if (raw.byteLength > MEDIA.maxUploadBytes) {
      await this.discard(stagingKey, 'boyut tavanı aşıldı');
      throw appError('PHOTO_TOO_LARGE', {
        params: { maxMb: Math.floor(MEDIA.maxUploadBytes / (1024 * 1024)) },
      });
    }

    // Biçim istemci beyanından değil, içerikten okunur (bkz. image-format.ts).
    if (detectImageFormat(raw) === null) {
      await this.discard(stagingKey, 'desteklenmeyen içerik');
      throw appError('PHOTO_INVALID_FORMAT', {
        internalMessage: `Tanınmayan görsel içeriği: ${stagingKey}`,
      });
    }

    // ⚠️ EXIF/GPS temizliği. Bundan sonrası public kovaya gidiyor; ham dosya
    //    bu noktadan sonra hiçbir yere kopyalanmaz.
    const sanitized = await this.processor.sanitize(raw, { format: 'webp' });
    const analysis = await this.processor.analyze(sanitized.buffer);

    // ⚠️ Düşük çözünürlük burada REDDEDİLMEZ, skora yansır. Reddetseydik
    //    "çözünürlük 25 puan" bileşeni her üründe tam dolar ve satıcıya
    //    iyileştirilecek bir şey kalmazdı; asıl amaç kaliteyi göstererek
    //    yükseltmek, satıcıyı ürün yükleyemez hâle getirmek değil.
    const derived = await this.processor.derive(sanitized.buffer, MEDIA.productImageWidths);
    const blurhash = await this.processor.blurhash(sanitized.buffer);

    const originalKey = mediaKeys.productImageOriginal(productId, imageId);

    await this.storage.put({
      key: originalKey,
      visibility: 'public',
      body: sanitized.buffer,
      contentType: sanitized.contentType,
    });

    for (const variant of derived) {
      await this.storage.put({
        key: mediaKeys.productImage(productId, imageId, variant.width),
        visibility: 'public',
        body: variant.buffer,
        contentType: variant.contentType,
      });
    }

    const { image, images } = await this.catalog.addImage(sellerId, productId, {
      imageId,
      storageKey: originalKey,
      angle: input.angle,
      isPrimary: input.isPrimary,
      blurhash,
      widthPx: sanitized.widthPx,
      heightPx: sanitized.heightPx,
    });

    // ⚠️ Ham (EXIF'li) dosya işi bitince silinir. Başarısız olursa istek
    //    düşmez: dosya private kovada ve erişilemez durumda kalır, ama
    //    satıcının yüklemesi geçerlidir. Görünür kalsın diye WARN loglanır.
    await this.discard(stagingKey, 'işlendi');

    const readiness = await this.recomputeReadiness(sellerId, productId, images, {
      storageKey: originalKey,
      analysis,
    });

    this.logger.info(
      { productId, imageId, tryOnScore: readiness.score },
      'Ürün görseli eklendi ve try-on skoru güncellendi',
    );

    return {
      image: this.toView(
        image,
        derived.map((variant) => variant.width),
      ),
      tryOnScore: readiness.score,
      tryOnIssues: readiness.issues,
      // Skor eşiğin üstündeyse satıcıyı gereksiz uyarıyla meşgul etme.
      suggestions: readiness.needsImprovement ? readiness.suggestions : [],
    };
  }

  // ── Yardımcılar ─────────────────────────────────────────────────────────

  private async requireOwnedProduct(sellerId: string, productId: string): Promise<void> {
    const product = await this.catalog.findProduct(sellerId, productId);
    if (!product) {
      // ⚠️ "Bu ürün başkasının" DEMİYORUZ. Var olan bir ürünün başka mağazaya
      //    ait olduğunu doğrulamak, kimlik numarası tarayarak rakip katalog
      //    büyüklüğü çıkarmaya yarar. Yanıt her iki durumda da aynı.
      throw appError('PRODUCT_NOT_FOUND');
    }
  }

  /**
   * ÜRÜNÜN TRY-ON UYGUNLUK SKORUNU YENİDEN HESAPLAR.
   *
   * Skor ürünün TÜM görselleri üzerinden hesaplanır. Arka plan sadeliği ve
   * kırpılma bilgisi veritabanında saklanmıyor (şemada karşılığı yok), bu
   * yüzden mevcut görseller için ölçüm KÜÇÜK TÜREVDEN yapılır: 320 piksellik
   * WebP birkaç KB'dır ve arka plan/kırpma ölçümü için fazlasıyla yeterli.
   * Asıl görselleri indirmek, satıcı her fotoğraf eklediğinde onlarca MB
   * trafik demek olurdu.
   *
   * Yeni eklenen görselin ölçümü elimizde; tekrar indirilmez.
   */
  private async recomputeReadiness(
    sellerId: string,
    productId: string,
    images: readonly MediaProductImage[],
    fresh: { storageKey: string; analysis: ImageAnalysis },
  ): Promise<TryOnReadinessResult> {
    const facts: ReadinessImageFacts[] = [];

    for (const image of images) {
      const analysis =
        image.storageKey === fresh.storageKey
          ? fresh.analysis
          : await this.analyzeExisting(image.productId, image.id);

      facts.push({
        angle: image.angle as ReadinessAngle,
        widthPx: image.widthPx,
        heightPx: image.heightPx,
        backgroundUniformity: analysis?.backgroundUniformity,
        subjectTouchesEdge: analysis?.subjectTouchesEdge,
      });
    }

    const readiness = scoreTryOnReadiness(facts);
    await this.catalog.saveReadiness(sellerId, productId, readiness.score, readiness.issues);
    return readiness;
  }

  /**
   * Var olan bir görselin ölçümü. Başarısız olursa `undefined` döner ve skor
   * motoru o görseli NÖTR kabul eder — ölçüm yapılamadı diye satıcının skoru
   * düşmemeli (bkz. tryon-readiness.ts / NEUTRAL_BACKGROUND).
   */
  private async analyzeExisting(
    productId: string,
    imageId: string,
  ): Promise<ImageAnalysis | undefined> {
    const smallestWidth = Math.min(...MEDIA.productImageWidths);
    const key = mediaKeys.productImage(productId, imageId, smallestWidth);

    try {
      const bytes = await this.storage.get(key, 'public');
      return await this.processor.analyze(bytes);
    } catch (error) {
      this.logger.warn({ key, err: error }, 'Mevcut görsel ölçülemedi, nötr kabul edildi');
      return undefined;
    }
  }

  private async discard(key: string, reason: string): Promise<void> {
    try {
      await this.storage.delete(key, 'private');
    } catch (error) {
      this.logger.warn({ key, reason, err: error }, 'Geçici yükleme silinemedi');
    }
  }

  private toView(image: MediaProductImage, widths: readonly number[]): ProductImageView {
    return {
      id: image.id,
      productId: image.productId,
      storageKey: image.storageKey,
      url: this.storage.publicUrl(image.storageKey),
      angle: image.angle,
      isPrimary: image.isPrimary,
      blurhash: image.blurhash,
      widthPx: image.widthPx,
      heightPx: image.heightPx,
      variants: widths.map((width) => ({
        width,
        url: this.storage.publicUrl(mediaKeys.productImage(image.productId, image.id, width)),
      })),
    };
  }
}
