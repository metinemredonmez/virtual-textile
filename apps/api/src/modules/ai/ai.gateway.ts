// NEEDS-DEP: @vt/adapters
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_LOGGER } from '../../infra/infra.module.js';
import type { Logger } from '../../common/logger.js';
import type { ConsentRecordLike } from './consent.rules.js';
import type {
  BodyProfilePort,
  BodyProfileSnapshot,
  ConsentPort,
  FitFeedbackPort,
  ProductSizingSnapshot,
  TryOnCacheKeyPort,
  TryOnCatalogPort,
  TryOnStoragePort,
  TryOnVariantSnapshot,
} from './ai.ports.js';
import type { BrandFit, FitFeedbackSummary, SizeChart } from './size-engine.js';

/**
 * GEÇİCİ SALT OKUNUR ADAPTÖRLER
 *
 * Kullanıcı, katalog ve sipariş modülleri AI'ın ihtiyaç duyduğu projeksiyonları
 * henüz servis olarak yayımlamıyor. Bu dosya o boşluğu kapatır: buradaki
 * sorgular HİÇBİR ŞEY YAZMAZ, yalnızca karar için gereken alanları okur.
 *
 * İlgili modüller `getConsentRecords()`, `getVariantSnapshot()` ve
 * `getFitFeedback()` yayımladığında `index.ts` içindeki provider satırları
 * onlara çevrilir ve bu dosya silinir. Servislerin geri kalanı bunu fark etmez —
 * bağımlılık `ai.ports.ts`'e karşıdır.
 */

/** aiTags JSON'ından marka kalıbını güvenli biçimde çıkarır. */
function parseBrandFit(aiTags: unknown): BrandFit | null {
  if (typeof aiTags !== 'object' || aiTags === null) return null;
  const raw = (aiTags as Record<string, unknown>).fit;
  if (typeof raw !== 'string') return null;

  const normalized = raw.trim().toUpperCase();
  return normalized === 'SLIM' || normalized === 'REGULAR' || normalized === 'OVERSIZE'
    ? normalized
    : null;
}

/**
 * Beden tablosu satıcı tarafından girilen serbest JSON'dır; şeklini garanti
 * edemeyiz. Sayı olmayan değerler sessizce elenir — motor NaN ile hesap yaparsa
 * kullanıcıya tamamen anlamsız bir beden önerir.
 */
function parseSizeChart(value: unknown): SizeChart | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const chart: SizeChart = {};
  for (const [size, dimensions] of Object.entries(value as Record<string, unknown>)) {
    if (typeof dimensions !== 'object' || dimensions === null) continue;

    const parsed: Record<string, number> = {};
    for (const [dimension, raw] of Object.entries(dimensions as Record<string, unknown>)) {
      const numeric = typeof raw === 'number' ? raw : Number.parseFloat(String(raw));
      if (Number.isFinite(numeric)) parsed[dimension] = numeric;
    }
    if (Object.keys(parsed).length > 0) chart[size] = parsed;
  }

  return Object.keys(chart).length > 0 ? chart : null;
}

@Injectable()
export class PrismaConsentAdapter implements ConsentPort {
  constructor(private readonly prisma: PrismaService) {}

  async findRecords(
    userId: string,
    types: readonly ConsentRecordLike['type'][],
  ): Promise<ConsentRecordLike[]> {
    // ⚠️ Filtreleme veritabanında yapılır ama "en son kayıt" seçimi yapılmaz:
    // tüm kayıtlar döner ve karar `consent.rules.ts` içinde verilir. Sıralamayı
    // SQL'e gömmek, kuralı test edilemez bir yere taşırdı.
    return this.prisma.consentRecord.findMany({
      where: { userId, type: { in: [...types] } },
      select: { type: true, granted: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }
}

@Injectable()
export class PrismaTryOnCatalogAdapter implements TryOnCatalogPort {
  constructor(private readonly prisma: PrismaService) {}

  async findVariant(variantId: string): Promise<TryOnVariantSnapshot | null> {
    const variant = await this.prisma.variant.findUnique({
      where: { id: variantId },
      select: {
        id: true,
        size: true,
        color: true,
        isActive: true,
        product: {
          select: {
            id: true,
            title: true,
            status: true,
            sizeChart: true,
            aiTags: true,
            category: { select: { tryOnCategory: true } },
            images: {
              orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
              take: 1,
              select: { storageKey: true },
            },
          },
        },
      },
    });

    if (!variant) return null;

    return {
      variantId: variant.id,
      productId: variant.product.id,
      productTitle: variant.product.title,
      size: variant.size,
      color: variant.color,
      tryOnCategory: variant.product.category.tryOnCategory,
      imageKey: variant.product.images[0]?.storageKey ?? null,
      sizeChart: parseSizeChart(variant.product.sizeChart),
      brandFit: parseBrandFit(variant.product.aiTags),
      isPurchasable: variant.isActive && variant.product.status === 'PUBLISHED',
    };
  }

  async findProductForSizing(productId: string): Promise<ProductSizingSnapshot | null> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, status: 'PUBLISHED' },
      select: { id: true, sizeChart: true, aiTags: true },
    });

    if (!product) return null;

    return {
      productId: product.id,
      sizeChart: parseSizeChart(product.sizeChart),
      brandFit: parseBrandFit(product.aiTags),
    };
  }

  async findProductIdByVariant(variantId: string): Promise<string | null> {
    const variant = await this.prisma.variant.findUnique({
      where: { id: variantId },
      select: { productId: true },
    });
    return variant?.productId ?? null;
  }
}

@Injectable()
export class PrismaBodyProfileAdapter implements BodyProfilePort {
  constructor(private readonly prisma: PrismaService) {}

  async find(userId: string): Promise<BodyProfileSnapshot | null> {
    const profile = await this.prisma.bodyProfile.findUnique({
      where: { userId },
      select: {
        chestCm: true,
        waistCm: true,
        hipCm: true,
        heightCm: true,
        weightKg: true,
        usualSize: true,
        fitPref: true,
      },
    });
    return profile;
  }
}

/**
 * ⚠️ GEÇİCİ KOPYA — `@vt/adapters` henüz `apps/api` bağımlılığı değil.
 *
 * Bu sınıf `packages/adapters/src/ai/cache-key.ts` içindeki `tryOnCacheKey`'in
 * BİREBİR aynısını üretmek zorundadır: worker o dosyayı kullanıyor ve iki taraf
 * ayrışırsa önbellek her seferinde ıskalar — sessizce, hata vermeden, her
 * istekte yeniden para harcayarak.
 *
 * Bu yüzden `cache-key.test.ts` üretilen özeti sabit vektörlere karşı
 * kilitler; buradaki veya oradaki bir değişiklik testi kırar.
 *
 * @vt/adapters bağımlılığı eklendiğinde: bu sınıf silinir, `index.ts` içindeki
 * provider doğrudan `tryOnCacheKey`'e bağlanır.
 */
@Injectable()
export class LocalTryOnCacheKeyAdapter implements TryOnCacheKeyPort {
  /**
   * ⚠️ Pipeline değişince `packages/adapters` içindeki TRYON_PROMPT_VERSION ile
   *    BİRLİKTE artırılmalı, yoksa kullanıcılar eski kalitedeki görselleri
   *    görmeye devam eder.
   */
  private static readonly PROMPT_VERSION = 1;

  build(input: { photoContentHash: string; variantId: string; mode: 'FAST' | 'QUALITY' }): string {
    return createHash('sha256')
      .update(
        [
          input.photoContentHash,
          input.variantId,
          input.mode,
          `v${LocalTryOnCacheKeyAdapter.PROMPT_VERSION}`,
        ].join('|'),
      )
      .digest('hex');
  }
}

/**
 * ⚠️ GEÇİCİ: API prosesine henüz bir `StorageProvider` bağlanmadı
 *    (R2/S3 adapter'ı yazılacak; worker tarafında da aynı boşluk var).
 *
 * Bu uygulama imzalı URL ÜRETEMEZ ve `null` döner — yani sanal deneme sonucu
 * kullanıcıya GÖSTERİLEMEZ. Sessizce geçilmesin diye her çağrıda uyarı loglanır.
 * Canlıya çıkmadan önce `index.ts` içindeki bu provider gerçek adapter'a
 * çevrilmelidir.
 *
 * Neden kalıcı public URL değil: sonuç görseli kullanıcının vücut görüntüsüdür.
 * Tahmin edilebilir veya süresiz bir adres, bağlantıyı ele geçiren herkese
 * erişim verir.
 */
@Injectable()
export class PlaceholderTryOnStorageAdapter implements TryOnStoragePort {
  constructor(@Inject(APP_LOGGER) private readonly logger: Logger) {}

  signedResultUrl(resultKey: string, _expiresInSeconds: number): Promise<string | null> {
    this.logger.warn(
      { resultKey },
      '⚠️ Depo adapter’ı yok — sanal deneme sonucu için imzalı URL üretilemedi',
    );
    return Promise.resolve(null);
  }
}

@Injectable()
export class PrismaFitFeedbackAdapter implements FitFeedbackPort {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * İki kaynak birleştirilir:
   *  - Onaylanmış yorumlardaki `fitFeedback` alanı (kullanıcı beyanı),
   *  - Beden nedeniyle açılmış iade talepleri (DAVRANIŞ — beyandan güçlü sinyal).
   *
   * İade sayılmazsa motor, "beğenmedim" deyip iade edenleri hiç görmez;
   * oysa beden hatası iadenin en büyük kalemidir.
   */
  async summarize(productId: string): Promise<FitFeedbackSummary> {
    const [reviews, returnedTooSmall, returnedTooLarge] = await Promise.all([
      this.prisma.review.groupBy({
        by: ['fitFeedback'],
        where: { productId, isApproved: true, fitFeedback: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.returnItem.count({
        where: {
          orderItem: { variant: { productId } },
          returnRequest: { reason: 'SIZE_TOO_SMALL' },
        },
      }),
      this.prisma.returnItem.count({
        where: {
          orderItem: { variant: { productId } },
          returnRequest: { reason: 'SIZE_TOO_LARGE' },
        },
      }),
    ]);

    const summary: FitFeedbackSummary = {
      tooSmall: returnedTooSmall,
      trueToSize: 0,
      tooLarge: returnedTooLarge,
    };

    for (const row of reviews) {
      const count = row._count._all;
      if (row.fitFeedback === 'TOO_SMALL') summary.tooSmall += count;
      else if (row.fitFeedback === 'TOO_LARGE') summary.tooLarge += count;
      else if (row.fitFeedback === 'TRUE_TO_SIZE') summary.trueToSize += count;
    }

    return summary;
  }
}
