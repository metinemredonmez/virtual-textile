import { TRYON } from '@vt/config';

/**
 * GÖRSEL GÜVEN SKORU (0-100)
 *
 * `TryOnSuccess.visualConfidence` arayüzü "sağlayıcı skoru + kendi kalite
 * kontrolümüzün bileşimi" diyor. Gerçek şu: kullandığımız sağlayıcıların
 * HİÇBİRİ kalite skoru döndürmüyor. O yüzden skoru kendimiz üretiyoruz ve
 * bunun bir SEZGİSEL olduğunu gizlemiyoruz.
 *
 * ⚠️ Neden önemli: skor `TRYON.lowConfidenceThreshold` (60) altındaysa sonuç
 * kullanıcıya UYARIYLA gösterilir. Skoru olduğundan yüksek üretmek, kötü bir
 * görseli "bu sana böyle olur" diye güvenle sunmaktır — beden/kalıp beklentisi
 * yanlış kurulur ve iade oranı artar. Bu yüzden sezgisel TEMKİNLİ tarafa
 * ayarlıdır: emin olmadığımızda skor düşer, yükselmez.
 */

export interface VisualConfidenceInput {
  mode: 'FAST' | 'QUALITY';
  /** Üretilen görselin bayt uzunluğu. */
  byteLength: number;
  /** Sağlayıcı bir skor döndürdüyse (0-1 veya 0-100). Çoğu sağlayıcı döndürmez. */
  providerScore?: number;
  /** Sağlayıcı "sınırda içerik" işaretlediyse — engellemedi ama şüphelendi. */
  flaggedBorderline?: boolean;
}

/**
 * Boyut eşiği: try-on çıktısı normalde 200 KB+ olur. Çok küçük dosya genelde
 * düz/bozuk bir görsel demektir (model çöktü, siyah kare üretti). Bu, elimizdeki
 * tek ucuz kalite sinyali — piksel analizi kuyruk işçisinde ayrıca yapılır.
 */
const SUSPICIOUSLY_SMALL_BYTES = 20 * 1024;
const SMALL_BYTES = 60 * 1024;

/** Modun taban güveni: QUALITY daha çok adım/çözünürlük kullanır. */
const BASE_BY_MODE: Readonly<Record<'FAST' | 'QUALITY', number>> = {
  FAST: 72,
  QUALITY: 82,
};

function normalizeProviderScore(score: number | undefined): number | undefined {
  if (score === undefined || !Number.isFinite(score) || score < 0) return undefined;
  // Sağlayıcılar 0-1 ya da 0-100 kullanır; hangisi olduğunu değere bakarak
  // anlarız. 1 değeri iki ölçekte de "mükemmel" demek olduğu için ayrım güvenli.
  return score <= 1 ? score * 100 : Math.min(score, 100);
}

export function visualConfidenceFrom(input: VisualConfidenceInput): number {
  const base = BASE_BY_MODE[input.mode];
  const provider = normalizeProviderScore(input.providerScore);

  // Sağlayıcı skoru varsa ağırlığın çoğunu o alır; yoksa taban skor kalır.
  let score = provider === undefined ? base : provider * 0.6 + base * 0.4;

  if (input.byteLength < SUSPICIOUSLY_SMALL_BYTES) {
    // Neredeyse kesin bozuk çıktı — eşiğin altına indir ki kullanıcı uyarı görsün.
    score -= 35;
  } else if (input.byteLength < SMALL_BYTES) {
    score -= 12;
  }

  if (input.flaggedBorderline) {
    // Engellenmedi ama sağlayıcı şüphelendi: görseli gösteririz, güvenle değil.
    score -= 15;
  }

  return clampScore(score);
}

export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Sonuç kullanıcıya uyarı ile mi gösterilmeli? */
export function isLowConfidence(score: number): boolean {
  return score < TRYON.lowConfidenceThreshold;
}
