import { MEDIA, TRYON } from '@vt/config';

/**
 * KULLANICI FOTOĞRAFI KALİTE SKORU (0-100)
 *
 * NEDEN VAR: sanal deneme her çağrıda para harcar ve kullanıcının günlük
 * kotasından düşer. Kötü bir fotoğrafla üretilen sonuç da kötü olur; kullanıcı
 * hem kotasını hem güvenini kaybeder, biz de GPU parasını. Bu yüzden eleme
 * ÇAĞRIDAN ÖNCE, bizim tarafımızda yapılır.
 *
 * Skor üç bileşenden oluşur ve ağırlıklar ürün kararıdır:
 *   çözünürlük 40p — düşük çözünürlükte model yüz/vücut hattını çıkaramaz
 *   parlaklık   30p — karanlık fotoğrafta kıyafet rengi yanlış eşleşir
 *   netlik      30p — bulanık girdi bulanık çıktı üretir
 *
 * TRYON.minPhotoQualityScore altındaki fotoğraf PHOTO_QUALITY_LOW ile
 * reddedilir. Eşik sabittedir; burada yeniden tanımlanmaz.
 */

export const PHOTO_QUALITY_WEIGHTS = {
  resolution: 40,
  brightness: 30,
  sharpness: 30,
} as const;

/** Kullanıcıya gösterilen sorun kodları. */
export type PhotoQualityIssue = 'low_resolution' | 'too_dark' | 'too_bright' | 'blurry';

export interface PhotoQualityInput {
  readonly widthPx: number;
  readonly heightPx: number;
  /** 0-255 ortalama luma. */
  readonly meanLuminance: number;
  /** 0-100 netlik. */
  readonly sharpness: number;
}

export interface PhotoQualityResult {
  readonly score: number;
  readonly issues: PhotoQualityIssue[];
  /** PHOTO_QUALITY_LOW mesajındaki `{reason}` — kullanıcıya gösterilir. */
  readonly reason: string;
  readonly breakdown: {
    readonly resolution: number;
    readonly brightness: number;
    readonly sharpness: number;
  };
}

// ── Eşikler ────────────────────────────────────────────────────────────────

/** Bu aralıkta parlaklık tam puan alır. */
const IDEAL_LUMINANCE = { min: 90, max: 175 } as const;
/** Bu aralığın dışında parlaklık puanı sıfırdır. */
const USABLE_LUMINANCE = { min: 35, max: 225 } as const;
/** Kullanıcıya "karanlık/parlak" uyarısı verilen noktalar. */
const WARN_LUMINANCE = { dark: 70, bright: 195 } as const;

/** Bu netliğin üstü tam puan. */
const SHARPNESS_FULL_CREDIT = 60;
/** Bunun altı "bulanık" uyarısı alır. */
const SHARPNESS_WARN = 40;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * ÇÖZÜNÜRLÜK (40p)
 *
 * Ölçüt `MEDIA.minUserPhotoWidth/Height`. Puan, iki eksenin ZAYIF olanına
 * göre verilir: 2000×400 bir fotoğraf "yeterince büyük" değildir, sadece
 * geniştir. Tavanı aşan çözünürlük ekstra puan getirmez — 4K fotoğraf,
 * modelin sonucunu 1K'dan daha iyi yapmaz, yalnızca yükleme süresini uzatır.
 */
function scoreResolution(input: PhotoQualityInput): number {
  if (input.widthPx <= 0 || input.heightPx <= 0) return 0;
  const ratio = Math.min(
    input.widthPx / MEDIA.minUserPhotoWidth,
    input.heightPx / MEDIA.minUserPhotoHeight,
  );
  return PHOTO_QUALITY_WEIGHTS.resolution * clamp01(ratio);
}

/**
 * PARLAKLIK (30p)
 *
 * İdeal banttan uzaklaştıkça doğrusal düşer. Tek yönlü bir "ne kadar aydınlık
 * o kadar iyi" ölçüsü YANLIŞ olurdu: aşırı pozlanmış fotoğrafta kıyafetin
 * dokusu tamamen kaybolur ve model düz bir yüzey görür.
 */
function scoreBrightness(input: PhotoQualityInput): number {
  const luminance = input.meanLuminance;
  const weight = PHOTO_QUALITY_WEIGHTS.brightness;

  if (luminance >= IDEAL_LUMINANCE.min && luminance <= IDEAL_LUMINANCE.max) return weight;

  if (luminance < IDEAL_LUMINANCE.min) {
    const span = IDEAL_LUMINANCE.min - USABLE_LUMINANCE.min;
    return weight * clamp01((luminance - USABLE_LUMINANCE.min) / span);
  }

  const span = USABLE_LUMINANCE.max - IDEAL_LUMINANCE.max;
  return weight * clamp01((USABLE_LUMINANCE.max - luminance) / span);
}

/** NETLİK (30p) — referans netliğe kadar doğrusal. */
function scoreSharpness(input: PhotoQualityInput): number {
  return PHOTO_QUALITY_WEIGHTS.sharpness * clamp01(input.sharpness / SHARPNESS_FULL_CREDIT);
}

/** Sorun kodunun kullanıcıya gösterilecek Türkçe karşılığı. */
const ISSUE_TEXT: Record<PhotoQualityIssue, string> = {
  low_resolution: `fotoğraf çok küçük (en az ${MEDIA.minUserPhotoWidth}×${MEDIA.minUserPhotoHeight} piksel olmalı)`,
  too_dark: 'ortam çok karanlık, aydınlık bir yerde tekrar çekin',
  too_bright: 'fotoğraf aşırı parlak, doğrudan ışık kaynağından uzaklaşın',
  blurry: 'fotoğraf bulanık, telefonu sabit tutup tekrar çekin',
};

/**
 * Fotoğrafın kalite skoru ve reddedilme gerekçesi.
 *
 * `reason` doğrudan PHOTO_QUALITY_LOW mesajına gider; bu yüzden teknik terim
 * değil, kullanıcının YAPABİLECEĞİ bir eylem içerir. "Kalite yetersiz" demek
 * kullanıcıyı aynı fotoğrafı tekrar yüklemeye iter.
 */
export function scorePhotoQuality(input: PhotoQualityInput): PhotoQualityResult {
  const breakdown = {
    resolution: scoreResolution(input),
    brightness: scoreBrightness(input),
    sharpness: scoreSharpness(input),
  };

  const score = Math.round(breakdown.resolution + breakdown.brightness + breakdown.sharpness);

  const issues: PhotoQualityIssue[] = [];
  if (
    input.widthPx < MEDIA.minUserPhotoWidth ||
    input.heightPx < MEDIA.minUserPhotoHeight ||
    input.widthPx <= 0 ||
    input.heightPx <= 0
  ) {
    issues.push('low_resolution');
  }
  if (input.meanLuminance < WARN_LUMINANCE.dark) issues.push('too_dark');
  if (input.meanLuminance > WARN_LUMINANCE.bright) issues.push('too_bright');
  if (input.sharpness < SHARPNESS_WARN) issues.push('blurry');

  return {
    score,
    issues,
    reason: buildReason(issues),
    breakdown: {
      resolution: Math.round(breakdown.resolution * 100) / 100,
      brightness: Math.round(breakdown.brightness * 100) / 100,
      sharpness: Math.round(breakdown.sharpness * 100) / 100,
    },
  };
}

function buildReason(issues: readonly PhotoQualityIssue[]): string {
  if (issues.length === 0) {
    // Eşiğin altında ama tek bir bariz sorun yok: bileşenlerin hepsi
    // sınırda demektir. Kullanıcıya en genel ama yine de eyleme dönük öneri.
    return 'net, iyi aydınlatılmış ve tam boy bir fotoğraf deneyin';
  }
  return issues.map((issue) => ISSUE_TEXT[issue]).join('; ');
}

/** Eşik kararı TEK yerde — çağıranlar sabiti tekrar okumasın. */
export function isPhotoQualityAcceptable(result: PhotoQualityResult): boolean {
  return result.score >= TRYON.minPhotoQualityScore;
}
