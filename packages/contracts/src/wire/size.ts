/**
 * BEDEN ÖNERİSİ — telde görünen şekil.
 *
 * Alanlar çalışan API'ye atılmış gerçek isteklerden okundu
 * (`POST /v1/size/recommend`, ölçülü ve ölçüsüz iki gövdeyle), servisin
 * `SizeRecommendationView` arayüzünden değil.
 *
 * ⚠️ EŞİK BURADA YENİDEN HESAPLANMAZ. Sunucu `showRecommendation` gönderiyor
 *    ve karar `SIZE_ENGINE.minConfidenceToShow` ile orada veriliyor. İstemcide
 *    `confidence >= 50` yazmak eşiği İKİ yere koyardı; biri değişip diğeri
 *    unutulduğunda kullanıcı, sunucunun "gösterme" dediği zayıf bir öneriye
 *    bakarak yanlış beden alırdı.
 */

/**
 * ⚠️ `SizeReason` bir union'dır ve `apps/api` → `size-engine.ts` ile aynı
 *    kalmalıdır. Metin SUNUCUDAN gelir (`message`); kod yalnızca gerekirse
 *    davranış seçmek içindir — istemcide metne çevrilmez.
 */
export type SizeReasonCodeWire =
  | 'MEASUREMENT_MATCH'
  | 'NO_MEASUREMENTS'
  | 'NO_SIZE_CHART'
  | 'AMBIGUOUS'
  | 'BRAND_FIT'
  | 'BRAND_FIT_LEARNED'
  | 'FIT_PREFERENCE'
  | 'RETURN_FEEDBACK'
  | 'FEEDBACK_TOO_FEW'
  | 'FEEDBACK_CONFLICTING'
  | 'USER_HISTORY';

export interface SizeReasonWire {
  /** ⚠️ Sürüm sapmasında bilinmeyen kod gelebilir; `string` kabul edilir. */
  code: SizeReasonCodeWire | string;
  /** Türkçe ve kullanıcıya gösterilebilir — yeniden yazılmaz. */
  message: string;
}

/** `{"M": {"chest": 94, "waist": 76, "length": 64}}` — GİYSİ ölçüsü, vücut değil. */
export type SizeChartWire = Record<string, Record<string, number>>;

export interface SizeRecommendationWire {
  productId: string;
  /** ⚠️ `showRecommendation` false iken HER ZAMAN null — ölçüldü. */
  recommendedSize: string | null;
  alternativeSize: string | null;
  confidence: number;
  /**
   * Öneri gösterilecek mi. ⚠️ Yanıt eşiğin altında da beden TABLOSUNU taşır:
   * öneri gizlenir, kullanıcı kendi kararını verebilsin.
   */
  showRecommendation: boolean;
  reasons: SizeReasonWire[];
  sizeChart: SizeChartWire | null;
  /** Tabloyu ekranda sıralamak için — `Object.keys` sırası güvenilir değil. */
  orderedSizes: string[];
  /** ⚠️ Yanıttan ÇIKARILAMAZ: çıktı bir tahmindir, ölçüm değil. */
  disclaimer: string;
}
