import { MEDIA } from '@vt/config';

/**
 * TRY-ON UYGUNLUK SKORU (0-100)
 *
 * NEDEN VAR: sanal denemenin kalitesini belirleyen en büyük değişken bizim
 * modelimiz değil, SATICININ GÖRSELİDİR. Kalabalık arka planlı, kırpılmış,
 * düşük çözünürlüklü bir ürün fotoğrafıyla en iyi model bile kötü sonuç
 * üretir. Satıcı bunu göremezse suçu "sizin yapay zekâ bozuk" diye bize
 * keser; skoru ve SOMUT düzeltme adımlarını göstermek, kaliteyi tek tek
 * ürün sayfalarında yükseltmenin en ucuz yoludur.
 *
 * Ağırlıklar (toplam 100) ürün kararıdır:
 *   çözünürlük        25p
 *   sade arka plan    25p
 *   kırpılmamış       20p
 *   ön + arka + yan   20p
 *   model üzerinde    10p
 */

export const TRYON_READINESS_WEIGHTS = {
  resolution: 25,
  background: 25,
  uncropped: 20,
  angles: 20,
  onModel: 10,
} as const;

/**
 * Bu skorun altındaki üründe satıcıya iyileştirme önerisi gösterilir.
 *
 * ⚠️ Değer burada duruyor çünkü bu ajanın `@vt/config` yazma yetkisi yok.
 *    Kalıcı yeri `packages/config/src/constants.ts` içindeki `TRYON` bloğudur
 *    (ör. `minProductReadinessScore`); taşındığında bu sabit silinmeli.
 */
export const MIN_TRYON_READINESS_SCORE = 60;

/** `Product.tryOnIssues` içine yazılan kodlar. */
export type TryOnReadinessIssue =
  | 'no_images'
  | 'low_resolution'
  | 'busy_background'
  | 'cropped_subject'
  | 'missing_front_angle'
  | 'missing_back_angle'
  | 'missing_side_angle'
  | 'missing_model_shot';

export type ReadinessAngle = 'FRONT' | 'BACK' | 'SIDE' | 'DETAIL' | 'MODEL' | 'FLATLAY';

/** Skorun ihtiyaç duyduğu tek görsel bilgisi. */
export interface ReadinessImageFacts {
  readonly angle: ReadinessAngle;
  readonly widthPx: number;
  readonly heightPx: number;
  /** 0-100 (bkz. image-analysis.ts). Ölçülemediyse undefined. */
  readonly backgroundUniformity?: number | undefined;
  /** Ölçülemediyse undefined. */
  readonly subjectTouchesEdge?: boolean | undefined;
}

export interface TryOnSuggestion {
  readonly issue: TryOnReadinessIssue;
  /** Satıcının doğrudan uygulayabileceği eylem. */
  readonly message: string;
  /** Bu düzeltme kaç puan kazandırır — satıcı önce hangisini yapacağını bilsin. */
  readonly gain: number;
}

export interface TryOnReadinessResult {
  readonly score: number;
  readonly issues: TryOnReadinessIssue[];
  readonly breakdown: {
    readonly resolution: number;
    readonly background: number;
    readonly uncropped: number;
    readonly angles: number;
    readonly onModel: number;
  };
  /** Puanı en çok artıracak düzeltme başta olacak şekilde sıralı. */
  readonly suggestions: TryOnSuggestion[];
  readonly needsImprovement: boolean;
}

/** Arka plan bu değerin altındaysa "kalabalık" sayılır. */
const BACKGROUND_WARN = 60;

/**
 * Bu sadelikten sonrası tam puan.
 *
 * ⚠️ Tam puan için 100 istenseydi hiçbir gerçek fotoğraf tam puan alamazdı:
 *    stüdyo fonunda bile gölge ve sensör gürültüsü birkaç puanlık sapma
 *    üretir. Ulaşılamayan bir hedef, satıcının skoru ciddiye almasını
 *    engeller.
 */
const BACKGROUND_FULL_CREDIT = 85;

/**
 * Ölçüm yapılamamış görseller için varsayılan.
 *
 * ⚠️ Ölçülemeyen görsel CEZALANDIRILMAZ (nötr kabul edilir). Aksi hâlde
 *    işleyici geçici olarak çalışmadığında ürünlerin skoru düşer ve satıcı,
 *    aslında iyi olan görsellerini değiştirmeye çalışır.
 */
const NEUTRAL_BACKGROUND = 75;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Try-on kalitesini belirleyen görseller. Detay çekimleri kıyafeti temsil etmez. */
const isTryOnRelevant = (image: ReadinessImageFacts): boolean => image.angle !== 'DETAIL';

/**
 * ÜRÜNÜN TRY-ON UYGUNLUK SKORU.
 *
 * Skor, ürünün TÜM görselleri üzerinden hesaplanır — tek bir iyi fotoğraf
 * yetmez, çünkü sanal deneme kıyafeti farklı açılardan anlamak zorundadır.
 */
export function scoreTryOnReadiness(images: readonly ReadinessImageFacts[]): TryOnReadinessResult {
  if (images.length === 0) {
    return {
      score: 0,
      issues: ['no_images'],
      breakdown: { resolution: 0, background: 0, uncropped: 0, angles: 0, onModel: 0 },
      suggestions: [
        {
          issue: 'no_images',
          message:
            'Ürüne henüz görsel eklenmemiş. En az bir ön, bir arka ve bir yan görsel yükleyin.',
          gain: 100,
        },
      ],
      needsImprovement: true,
    };
  }

  const relevant = images.filter(isTryOnRelevant);
  // Ürünün yalnızca detay çekimi varsa hesap yapacak veri yok; hepsini kullan.
  const pool = relevant.length > 0 ? relevant : images;

  const issues: TryOnReadinessIssue[] = [];

  // ── Çözünürlük (25p) ────────────────────────────────────────────────────
  // Ölçüt: her görselin `MEDIA.minProductImageWidth` genişliğine oranı.
  // Ortalama alınıyor ki tek bir küçük görsel tüm puanı silmesin ama
  // görmezden de gelinmesin.
  const resolutionRatio =
    pool.reduce((total, image) => total + clamp01(image.widthPx / MEDIA.minProductImageWidth), 0) /
    pool.length;
  const resolutionScore = TRYON_READINESS_WEIGHTS.resolution * resolutionRatio;
  const smallImages = pool.filter((image) => image.widthPx < MEDIA.minProductImageWidth).length;
  if (smallImages > 0) issues.push('low_resolution');

  // ── Sade arka plan (25p) ────────────────────────────────────────────────
  const backgroundAverage =
    pool.reduce((total, image) => total + (image.backgroundUniformity ?? NEUTRAL_BACKGROUND), 0) /
    pool.length;
  const backgroundScore =
    TRYON_READINESS_WEIGHTS.background * clamp01(backgroundAverage / BACKGROUND_FULL_CREDIT);
  const busyImages = pool.filter(
    (image) => (image.backgroundUniformity ?? NEUTRAL_BACKGROUND) < BACKGROUND_WARN,
  ).length;
  if (busyImages > 0) issues.push('busy_background');

  // ── Kırpılmamış (20p) ───────────────────────────────────────────────────
  const croppedImages = pool.filter((image) => image.subjectTouchesEdge === true).length;
  const uncroppedScore =
    TRYON_READINESS_WEIGHTS.uncropped * clamp01((pool.length - croppedImages) / pool.length);
  if (croppedImages > 0) issues.push('cropped_subject');

  // ── Açılar (20p) ────────────────────────────────────────────────────────
  // Üç temel açı eşit ağırlıklı: model, kıyafetin arkasını ve yan hattını
  // görmeden dönen bir sonuç üretemez; eksik açıyı "uydurur".
  const angles = new Set(images.map((image) => image.angle));
  const requiredAngles: Array<{ angle: ReadinessAngle; issue: TryOnReadinessIssue }> = [
    { angle: 'FRONT', issue: 'missing_front_angle' },
    { angle: 'BACK', issue: 'missing_back_angle' },
    { angle: 'SIDE', issue: 'missing_side_angle' },
  ];
  const presentAngles = requiredAngles.filter((entry) => angles.has(entry.angle));
  const anglesScore =
    (TRYON_READINESS_WEIGHTS.angles * presentAngles.length) / requiredAngles.length;
  for (const entry of requiredAngles) {
    if (!angles.has(entry.angle)) issues.push(entry.issue);
  }

  // ── Model üzerinde (10p) ────────────────────────────────────────────────
  // Manken/model üzerindeki çekim, kıyafetin düşme biçimini gösterir; düz
  // serilmiş (flatlay) görselden çıkarılamayan tek bilgi budur.
  const hasModelShot = angles.has('MODEL');
  const onModelScore = hasModelShot ? TRYON_READINESS_WEIGHTS.onModel : 0;
  if (!hasModelShot) issues.push('missing_model_shot');

  const breakdown = {
    resolution: round2(resolutionScore),
    background: round2(backgroundScore),
    uncropped: round2(uncroppedScore),
    angles: round2(anglesScore),
    onModel: round2(onModelScore),
  };

  const score = Math.round(
    resolutionScore + backgroundScore + uncroppedScore + anglesScore + onModelScore,
  );

  return {
    score,
    issues,
    breakdown,
    suggestions: buildSuggestions({
      issues,
      smallImages,
      busyImages,
      croppedImages,
      missingAngles: requiredAngles.filter((entry) => !angles.has(entry.angle)).length,
      resolutionScore,
      backgroundScore,
      uncroppedScore,
      anglesScore,
    }),
    needsImprovement: score < MIN_TRYON_READINESS_SCORE,
  };
}

interface SuggestionContext {
  issues: readonly TryOnReadinessIssue[];
  smallImages: number;
  busyImages: number;
  croppedImages: number;
  missingAngles: number;
  resolutionScore: number;
  backgroundScore: number;
  uncroppedScore: number;
  anglesScore: number;
}

/**
 * SOMUT ÖNERİLER
 *
 * ⚠️ Her öneri (a) ne yapılacağını, (b) kaç puan kazandıracağını söyler.
 *    "Görsel kalitesini artırın" tarzı bir metin satıcıya hiçbir şey
 *    yaptırmaz; "arka planı düz beyaza alın, +12 puan" yaptırır.
 *
 * Sıralama kazanca göre: satıcının ilk yapacağı iş en çok getiren iş olsun.
 */
function buildSuggestions(context: SuggestionContext): TryOnSuggestion[] {
  const suggestions: TryOnSuggestion[] = [];

  if (context.issues.includes('low_resolution')) {
    suggestions.push({
      issue: 'low_resolution',
      message: `${context.smallImages} görselin genişliği ${MEDIA.minProductImageWidth} pikselin altında. Aynı çekimleri en az ${MEDIA.minProductImageWidth} piksel genişliğinde yeniden yükleyin.`,
      gain: Math.round(TRYON_READINESS_WEIGHTS.resolution - context.resolutionScore),
    });
  }

  if (context.issues.includes('busy_background')) {
    suggestions.push({
      issue: 'busy_background',
      message: `${context.busyImages} görselde arka plan kalabalık. Ürünü düz beyaz veya açık gri bir fon önünde, gölgesiz çekin.`,
      gain: Math.round(TRYON_READINESS_WEIGHTS.background - context.backgroundScore),
    });
  }

  if (context.issues.includes('cropped_subject')) {
    suggestions.push({
      issue: 'cropped_subject',
      message: `${context.croppedImages} görselde ürün kadraja sığmamış. Ürünün tamamı çerçevenin içinde kalacak ve kenarlarda boşluk bırakacak şekilde çekin.`,
      gain: Math.round(TRYON_READINESS_WEIGHTS.uncropped - context.uncroppedScore),
    });
  }

  const missingAngleLabels: Array<[TryOnReadinessIssue, string]> = [
    ['missing_front_angle', 'ön'],
    ['missing_back_angle', 'arka'],
    ['missing_side_angle', 'yan'],
  ];
  const missing = missingAngleLabels.filter(([issue]) => context.issues.includes(issue));
  if (missing.length > 0) {
    const gainPerAngle = TRYON_READINESS_WEIGHTS.angles / 3;
    suggestions.push({
      issue: missing[0]?.[0] ?? 'missing_front_angle',
      message: `Eksik açı: ${missing.map(([, label]) => label).join(', ')}. Sanal deneme kıyafetin görmediği tarafını tahmin etmek zorunda kalır; eksik açıları ekleyin.`,
      gain: Math.round(gainPerAngle * missing.length),
    });
  }

  if (context.issues.includes('missing_model_shot')) {
    suggestions.push({
      issue: 'missing_model_shot',
      message:
        'Ürünün model veya manken üzerindeki bir görselini ekleyin (açı: MODEL). Kıyafetin vücutta nasıl durduğu yalnızca bu çekimden anlaşılır.',
      gain: TRYON_READINESS_WEIGHTS.onModel,
    });
  }

  return suggestions.sort((a, b) => b.gain - a.gain);
}
