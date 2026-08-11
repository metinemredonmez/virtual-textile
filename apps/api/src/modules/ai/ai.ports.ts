import type { ConsentRecordLike } from './consent.rules.js';
import type { BodyMeasurements, BrandFit, FitFeedbackSummary, SizeChart } from './size-engine.js';

/**
 * AI MODÜLÜNÜN DIŞARIYA BAĞIMLILIKLARI
 *
 * AI modülü yalnızca kendi tablolarına sahiptir: UserPhoto (`ai_user_photos`),
 * TryOnJob (`ai_tryon_jobs`), AiUsageLog (`ai_usage_logs`).
 *
 * Rıza kaydı kullanıcı modülünün, varyant/ürün/beden tablosu katalog modülünün,
 * iade geri bildirimi ise sipariş ve katalog modüllerinin verisidir. AI modülü
 * bu tabloları BİLMEZ; buradaki dar sözleşmelerden okur.
 *
 * ⚠️ Özellikle rıza için bu sınır önemlidir: rıza mantığı tek bir yerde
 *    (kullanıcı modülü) yaşamalı, her tüketici kendi yorumunu üretmemelidir.
 */

export const CONSENT_PORT = 'AI_CONSENT_PORT';
export const TRYON_CATALOG_PORT = 'AI_TRYON_CATALOG_PORT';
export const BODY_PROFILE_PORT = 'AI_BODY_PROFILE_PORT';
export const FIT_FEEDBACK_PORT = 'AI_FIT_FEEDBACK_PORT';
export const TRYON_STORAGE_PORT = 'AI_TRYON_STORAGE_PORT';

/**
 * Sonuç görselinin adresini üretir.
 *
 * ⚠️ Try-on sonuçları private kovadadır ve kullanıcının vücut görüntüsünü
 *    taşır. Kalıcı bağlantı ASLA verilmez; adres kısa ömürlü ve imzalıdır.
 *    `null` dönmesi "görsel yok" demektir — hata değil, arayüz bunu bekler.
 */
export interface TryOnStoragePort {
  signedResultUrl(resultKey: string, expiresInSeconds: number): Promise<string | null>;
}

export const TRYON_CACHE_KEY_PORT = 'AI_TRYON_CACHE_KEY_PORT';

/**
 * ÖNBELLEK ANAHTARI ÜRETİCİSİ
 *
 * ⚠️ Anahtar API ve worker tarafında AYNI değeri üretmek ZORUNDADIR; ayrışırsa
 *    önbellek sessizce ıskalar ve her istek yeniden para harcar. Sözleşme
 *    `packages/adapters/src/ai/cache-key.ts`'dir.
 *
 * ⚠️ Anahtar İSTEMCİDEN ALINMAZ. Uydurulmuş bir anahtarla başka bir üretimin
 *    sonucu çekilebilirdi; bu yüzden yalnızca sunucuda, kaydedilmiş fotoğrafın
 *    kendi içerik özetinden üretilir.
 */
export interface TryOnCacheKeyPort {
  build(input: { photoContentHash: string; variantId: string; mode: 'FAST' | 'QUALITY' }): string;
}

export interface ConsentPort {
  /**
   * Kullanıcının ilgili rıza türlerindeki TÜM kayıtları (append-only).
   * Karar `consent.rules.ts` içinde verilir — port yorum yapmaz, veri getirir.
   */
  findRecords(
    userId: string,
    types: readonly ConsentRecordLike['type'][],
  ): Promise<ConsentRecordLike[]>;
}

/** Sanal denemenin bir varyant hakkında bilmesi gereken her şey. */
export interface TryOnVariantSnapshot {
  variantId: string;
  productId: string;
  productTitle: string;
  size: string;
  color: string;
  /** null ise kategori try-on'a uygun DEĞİL. */
  tryOnCategory: 'UPPER_BODY' | 'LOWER_BODY' | 'DRESS' | 'OUTERWEAR' | null;
  /** Sağlayıcıya gönderilecek ürün görselinin depo anahtarı. */
  imageKey: string | null;
  sizeChart: SizeChart | null;
  /** Ürün AI etiketlerinden çıkarılan marka kalıbı. */
  brandFit: BrandFit | null;
  /** Yayında ve satılabilir mi — kaldırılmış ürün için üretim yapılmaz. */
  isPurchasable: boolean;
}

/** Beden önerisi VARYANT değil ÜRÜN düzeyinde çalışır: bedenler karşılaştırılır. */
export interface ProductSizingSnapshot {
  productId: string;
  sizeChart: SizeChart | null;
  brandFit: BrandFit | null;
}

export interface TryOnCatalogPort {
  findVariant(variantId: string): Promise<TryOnVariantSnapshot | null>;
  findProductForSizing(productId: string): Promise<ProductSizingSnapshot | null>;
  /** Varyanttan ürüne geçiş — istemci elindeki varyantla öneri isteyebilir. */
  findProductIdByVariant(variantId: string): Promise<string | null>;
}

/** Ölçüler + kalıp TERCİHİ. Tercih bir ölçü değildir, ayrı taşınır. */
export type BodyProfileSnapshot = BodyMeasurements & { fitPref: BrandFit | null };

export interface BodyProfilePort {
  find(userId: string): Promise<BodyProfileSnapshot | null>;
}

export interface FitFeedbackPort {
  /** Ürün bazında toplanmış "küçük geldi / tam / büyük geldi" sayıları. */
  summarize(productId: string): Promise<FitFeedbackSummary>;
}
