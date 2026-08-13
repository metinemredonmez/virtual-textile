import { Inject, Injectable } from '@nestjs/common';
import { appError } from '@vt/contracts';
import { SIZE_ENGINE } from '@vt/config';
import {
  BODY_PROFILE_PORT,
  FIT_FEEDBACK_PORT,
  TRYON_CATALOG_PORT,
  type BodyProfilePort,
  type FitFeedbackPort,
  type TryOnCatalogPort,
} from './ai.ports.js';
import {
  recommendSize,
  SIZE_DISCLAIMER,
  type BodyMeasurements,
  type BrandFit,
  type SizeChart,
  type SizeEngineResult,
  type SizeReason,
} from './size-engine.js';
import type { BrandFitSignal, UserSizeHistory } from './fit-learning.js';
import type { SizeLearningPort } from './fit-learning.gateway.js';
import type { SizeRecommendInput } from './ai.schema.js';

/**
 * BEDEN ÖNERİSİ
 *
 * Servisin işi veri toplamak ve kararı `size-engine.ts`'e devretmektir.
 * Karar mantığı burada DEĞİL, saf bir fonksiyonda yaşar — çünkü test edilmesi
 * gereken şey odur ve veritabanı olmadan test edilebilmelidir.
 *
 * ⚠️ Yanıt her zaman beden tablosunu içerir; öneri gösterilmese bile kullanıcı
 *    kendi kararını verebilsin. Güven eşiğin altındayken öneri alanı BOŞ döner,
 *    "belki L" gibi zayıf bir tahmin gönderilmez.
 */

export interface SizeRecommendationView {
  productId: string;
  /** Eşiğin altındaysa null — arayüz yalnızca tabloyu gösterir. */
  recommendedSize: string | null;
  alternativeSize: string | null;
  confidence: number;
  /** Öneri gösterilecek mi — istemci eşiği tekrar hesaplamasın. */
  showRecommendation: boolean;
  /** Öneriyi oluşturan adımlar; kullanıcıya olduğu gibi gösterilir. */
  reasons: SizeReason[];
  sizeChart: SizeChart | null;
  orderedSizes: string[];
  /** ⚠️ Metin yanıttan çıkarılamaz: çıktı bir tahmindir, ölçüm değil. */
  disclaimer: string;
}

@Injectable()
export class SizeService {
  /**
   * ⚠️ `learning` OPSİYONELDİR ve varsayılanı `null`'dır. Marka eğilimi ve
   *    kişisel geçmiş birer İYİLEŞTİRMEDİR; bağlanmamışsa (veya sorgusu
   *    düşerse) motor eskisi gibi ölçü + ürün geri bildirimiyle çalışır.
   *    Öğrenme katmanının yokluğu beden önerisini DÜŞÜRMEMELİDİR.
   */
  constructor(
    @Inject(TRYON_CATALOG_PORT) private readonly catalog: TryOnCatalogPort,
    @Inject(BODY_PROFILE_PORT) private readonly profiles: BodyProfilePort,
    @Inject(FIT_FEEDBACK_PORT) private readonly feedback: FitFeedbackPort,
    private readonly learning: SizeLearningPort | null = null,
  ) {}

  async recommend(
    input: SizeRecommendInput,
    userId: string | null,
  ): Promise<SizeRecommendationView> {
    const productId = await this.resolveProductId(input);

    const product = await this.catalog.findProductForSizing(productId);
    if (!product) throw appError('PRODUCT_NOT_FOUND');

    // Gövdedeki ölçüler kayıtlı profili EZER: kullanıcı "eşim için bakıyorum"
    // diyebilmeli. ⚠️ Bu ölçüler kaydedilmez, yalnızca bu hesapta kullanılır.
    const profile = userId ? await this.profiles.find(userId) : null;

    const measurements: BodyMeasurements = input.measurements
      ? {
          chestCm: input.measurements.chestCm ?? null,
          waistCm: input.measurements.waistCm ?? null,
          hipCm: input.measurements.hipCm ?? null,
          /**
           * ⚠️ BU İKİ SATIR EKLENMESEYDİ ALANLAR ÖLÜ KALIRDI. Şema, sözleşme
           *    ve motor hazır olsa bile gövdeden gelen omuz/iç bacak boyu
           *    BURADA düşerdi — kullanıcı ölçüyü girer, hiçbir şey değişmezdi.
           *    Deponun altı kez yaşadığı sınıfın tam olarak geçtiği yer burası.
           */
          shoulderCm: input.measurements.shoulderCm ?? null,
          inseamCm: input.measurements.inseamCm ?? null,
          heightCm: input.measurements.heightCm ?? null,
          weightKg: input.measurements.weightKg ?? null,
          usualSize: input.measurements.usualSize ?? profile?.usualSize ?? null,
        }
      : (profile ?? {});

    const fitPreference: BrandFit | null = input.measurements?.fitPref ?? profile?.fitPref ?? null;

    // Geri bildirim yalnızca beden tablosu varsa anlamlı: kaydırılacak bir
    // beden merdiveni yoksa "bir beden büyük al" söylenemez.
    const hasChart = product.sizeChart !== null;

    const [feedbackSummary, brandSignal, userHistory] = await Promise.all([
      hasChart ? this.feedback.summarize(product.productId) : null,
      hasChart ? this.loadBrandSignal(product.productId) : null,
      // ⚠️ Kişisel geçmiş yalnızca GİRİŞ YAPMIŞ kullanıcı için okunur.
      //    Misafirde sorgu bile atılmaz; kimliksiz kullanıcıyı geçmiş bir
      //    siparişe bağlamaya çalışmak KVKK açısından da yanlış olurdu.
      hasChart && userId ? this.loadUserHistory(userId, product.productId) : null,
    ]);

    const result: SizeEngineResult = recommendSize({
      sizeChart: product.sizeChart ?? {},
      measurements,
      brandFit: product.brandFit,
      fitPreference,
      feedback: feedbackSummary,
      brandSignal,
      userHistory,
    });

    return this.toView(product.productId, product.sizeChart, result);
  }

  /**
   * ⚠️ Öğrenme sorguları HATA YUTAR ve `null` döner.
   *
   * Gerekçe: bu iki sinyal öneriyi İYİLEŞTİRİR, oluşturmaz. Marka toplamı
   * çıkarılamadığı için ürün sayfasında beden kutusunun tamamen kaybolması,
   * kullanıcı açısından açık bir gerileme olurdu. Ölçü + ürün geri bildirimi
   * zaten elimizde ve tek başlarına geçerli bir öneri üretiyorlar.
   *
   * ⚠️ Bu, hatanın görünmez olduğu anlamına GELMEZ: `null` dönüşü motorda
   *    "sinyal yok" olarak ele alınır ve güveni artırmaz — yani sessizce
   *    fazla iddialı bir öneri üretemez.
   */
  private async loadBrandSignal(productId: string): Promise<BrandFitSignal | null> {
    if (!this.learning) return null;
    try {
      return await this.learning.summarizeBrandOfProduct(productId);
    } catch {
      return null;
    }
  }

  private async loadUserHistory(
    userId: string,
    productId: string,
  ): Promise<UserSizeHistory | null> {
    if (!this.learning) return null;
    try {
      return await this.learning.findUserHistory(userId, productId);
    } catch {
      return null;
    }
  }

  private async resolveProductId(input: SizeRecommendInput): Promise<string> {
    if (input.productId) return input.productId;

    const productId = input.variantId
      ? await this.catalog.findProductIdByVariant(input.variantId)
      : null;

    if (!productId) throw appError('VARIANT_NOT_FOUND');
    return productId;
  }

  private toView(
    productId: string,
    sizeChart: SizeChart | null,
    result: SizeEngineResult,
  ): SizeRecommendationView {
    const base = {
      productId,
      confidence: result.confidence,
      reasons: result.reasons,
      sizeChart,
      orderedSizes: result.orderedSizes,
      disclaimer: SIZE_DISCLAIMER,
    };

    if (result.kind === 'RECOMMENDATION') {
      return {
        ...base,
        recommendedSize: result.recommendedSize,
        alternativeSize: result.alternativeSize,
        showRecommendation: true,
      };
    }

    // ⚠️ Güven `SIZE_ENGINE.minConfidenceToShow` altında: beden alanları BOŞ.
    // Zayıf bir öneriyi "düşük güvenli" etiketiyle göstermek de yanlış olurdu —
    // kullanıcı etiketi değil bedeni okur ve yanlış ürünü alır.
    return {
      ...base,
      recommendedSize: null,
      alternativeSize: null,
      showRecommendation: false,
    };
  }
}

/** Test ve dokümantasyon için: eşik tek yerden okunur. */
export const MIN_CONFIDENCE_TO_SHOW = SIZE_ENGINE.minConfidenceToShow;
