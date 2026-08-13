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
 * GEREKÇE KODLARI — TEK KAYNAK. `size-engine.ts` bu union'ı import eder ve
 * kendi elle yazılmış kopyasını TAŞIMAZ; böylece motor yeni bir kod üretip
 * tele yazmayı UNUTAMAZ — derleme kırılır.
 *
 * Metin SUNUCUDAN gelir (`message`); kod yalnızca gerekirse davranış seçmek
 * içindir — istemcide metne çevrilmez.
 *
 * ⚠️ İKİ KOPYA VARKEN SAPMIŞTI. Ölçüldü:
 *      grep -on "code: '[A-Z_]*'" apps/api/src/modules/ai/size-engine.ts
 *    → motor `USER_KEPT_SIZE`, `USER_RETURNED_SIZE`, `USER_BRAND_HISTORY`,
 *      `USUAL_SIZE_AGREES`, `USUAL_SIZE_CONFLICTS` üretiyordu ve BEŞİ DE
 *      telde YOKTU.
 *
 * ⚠️ `USER_HISTORY` KALDIRILDI. Ölçüldü:
 *      grep -rn "USER_HISTORY" apps/api/src apps/web/app apps/web/src packages e2e
 *    → yalnızca `fit-learning.gateway.ts` içindeki İLGİSİZ bir sabit
 *      (`USER_HISTORY_LIMIT = 50`), bu tanımın kendisi ve derlenmiş dist
 *      çıktısı. Motorda üretilmiyor, tüketen SIFIR.
 *
 * ⚠️ Dizi `as const` durur, union ondan TÜRETİLİR. İkisi ayrı ayrı yazılırsa
 *    aynı sapma sınıfı bu dosyanın İÇİNDE geri gelir.
 */
export const SIZE_REASON_CODES = [
  'MEASUREMENT_MATCH',
  'NO_MEASUREMENTS',
  'NO_SIZE_CHART',
  'CHART_UNREADABLE',
  'AMBIGUOUS',
  'POOR_MATCH',
  'BRAND_FIT',
  'BRAND_FIT_LEARNED',
  'FIT_PREFERENCE',
  'RETURN_FEEDBACK',
  'FEEDBACK_TOO_FEW',
  'FEEDBACK_CONFLICTING',
  'USER_KEPT_SIZE',
  'USER_RETURNED_SIZE',
  'USER_BRAND_HISTORY',
  'USUAL_SIZE_AGREES',
  'USUAL_SIZE_CONFLICTS',
  'HEIGHT_WEIGHT_ONLY',
  'HEIGHT_WEIGHT_IMPLAUSIBLE',
  'MEASUREMENT_IMPLAUSIBLE',
  'LENGTH_NOTE',
] as const;

export type SizeReasonCodeWire = (typeof SIZE_REASON_CODES)[number];

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
