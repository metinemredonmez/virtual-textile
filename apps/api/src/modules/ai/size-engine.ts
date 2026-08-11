import { SIZE_ENGINE } from '@vt/config';

/**
 * BEDEN ÖNERİ MOTORU — MVP'DE ML YOK, ŞEFFAF KURAL MOTORU
 *
 * Neden model değil kural: beden önerisi yanlış olduğunda bedeli iade
 * kargosudur ve doğrudan satıcının cebinden çıkar. Bir modelin neden "L"
 * dediğini açıklayamayız; kuralın neden "L" dediğini satır satır gösterebiliriz.
 * Kullanıcı da satıcı da bu gerekçeyi görür, itiraz edebilir, biz de düzeltiriz.
 * Eğitim verisi (iade + fit geri bildirimi) yeterli hacme ulaşana kadar
 * açıklanabilirlik, marjinal doğruluktan daha değerlidir.
 *
 * ⚠️ ÇIKTI HER ZAMAN "TAHMİN"DİR. `SIZE_DISCLAIMER` metni yanıttan
 *    çıkarılamaz; kesinlik iddiası hem yanlış hem de ticari olarak riskli olur.
 */

/** Ürünün beden tablosu: {"M": {"chest": 98, "waist": 78, "length": 70}} */
export type SizeChart = Record<string, Record<string, number>>;

export interface BodyMeasurements {
  chestCm?: number | null;
  waistCm?: number | null;
  hipCm?: number | null;
  heightCm?: number | null;
  weightKg?: number | null;
  /** Kullanıcının "normalde giydiğim" bedeni — doğrulama sinyali. */
  usualSize?: string | null;
}

export type BrandFit = 'SLIM' | 'REGULAR' | 'OVERSIZE';

/** İade ve yorumlardan toplanan kalıp geri bildirimi. */
export interface FitFeedbackSummary {
  tooSmall: number;
  trueToSize: number;
  tooLarge: number;
}

export interface SizeEngineInput {
  sizeChart: SizeChart;
  measurements: BodyMeasurements;
  /** Markanın kalıbı — ürün AI etiketlerinden veya satıcı beyanından gelir. */
  brandFit?: BrandFit | null;
  /** Kullanıcının kalıp TERCİHİ (dar/bol sevme) — markanın kalıbından ayrıdır. */
  fitPreference?: BrandFit | null;
  feedback?: FitFeedbackSummary | null;
}

/** Şeffaflık: öneriyi oluşturan her adım kullanıcıya gösterilir. */
export interface SizeReason {
  code:
    | 'MEASUREMENT_MATCH'
    | 'NO_MEASUREMENTS'
    | 'NO_SIZE_CHART'
    | 'AMBIGUOUS'
    | 'BRAND_FIT'
    | 'FIT_PREFERENCE'
    | 'RETURN_FEEDBACK'
    | 'FEEDBACK_TOO_FEW'
    | 'USUAL_SIZE_AGREES'
    | 'USUAL_SIZE_CONFLICTS';
  message: string;
}

export type SizeEngineResult =
  | {
      kind: 'RECOMMENDATION';
      recommendedSize: string;
      /** İkinci en yakın beden — "arada kaldıysanız" kutusu için. */
      alternativeSize: string | null;
      confidence: number;
      reasons: SizeReason[];
      orderedSizes: string[];
      disclaimer: string;
    }
  | {
      /**
       * ⚠️ Güven eşiğin altında: ÖNERİ GÖSTERİLMEZ.
       * Zayıf bir öneri, hiç öneri olmamasından daha kötüdür — kullanıcı ona
       * güvenip yanlış beden alır ve iade eder.
       */
      kind: 'CHART_ONLY';
      confidence: number;
      reasons: SizeReason[];
      orderedSizes: string[];
      disclaimer: string;
    };

export const SIZE_DISCLAIMER =
  'Bu bir tahmindir. Ölçüleriniz ve ürünün beden tablosu karşılaştırılarak hesaplanır; ' +
  'markanın kalıbı ve kumaşın esnekliği sonucu değiştirebilir.';

/**
 * BOLLUK PAYI (ease) — vücut ölçüsü ile giysi ölçüsü arasındaki fark.
 *
 * Beden tablosu GİYSİ ölçüsüdür, vücut ölçüsü değil. 98 cm göğüs ölçülü bir
 * tişört, 98 cm göğüslü birine dar gelir. Bu tablo olmadan motor sistematik
 * olarak bir beden küçük önerir.
 *
 * ⚠️ Değerler sektör ortalamasıdır, ölçüm değildir. İade verisi biriktikçe
 *    kategori bazında kalibre edilmelidir (bkz. docs/size-engine.md).
 */
const IDEAL_EASE_CM: Record<string, number> = {
  chest: 6,
  waist: 5,
  hip: 6,
};

/** Beden tablosu anahtarı → vücut ölçüsü alanı. Diğer anahtarlar (boy, kol) yok sayılır. */
const DIMENSION_TO_MEASUREMENT: Record<string, keyof BodyMeasurements> = {
  chest: 'chestCm',
  bust: 'chestCm',
  gogus: 'chestCm',
  waist: 'waistCm',
  bel: 'waistCm',
  hip: 'hipCm',
  kalca: 'hipCm',
};

/**
 * Harf bedenlerin sırası. Sıralama olmadan "bir beden büyük" ifadesi
 * tanımsızdır — kalıp düzeltmesi ve geri bildirim kaydırması buna dayanır.
 */
const ALPHA_LADDER = ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '4XL', '5XL'];

const ALPHA_ALIASES: Record<string, string> = {
  '3XS': 'XXXS',
  '2XS': 'XXS',
  '2XL': 'XXL',
  '3XL': 'XXXL',
  XXXXL: '4XL',
  XXXXXL: '5XL',
};

function normalizeSizeLabel(label: string): string {
  const upper = label.trim().toUpperCase();
  return ALPHA_ALIASES[upper] ?? upper;
}

/**
 * Bedenleri küçükten büyüğe sıralar.
 * Harf bedenler merdivene, sayısal bedenler (34, 36, 38) değerine göre dizilir.
 * Tanınmayanlar sona alınır — sıralanamayan bir bedeni sıraya sokmaya çalışmak
 * sessizce yanlış öneri üretir.
 */
export function orderSizes(labels: readonly string[]): string[] {
  const rank = (label: string): [number, number, string] => {
    const normalized = normalizeSizeLabel(label);
    const alphaIndex = ALPHA_LADDER.indexOf(normalized);
    if (alphaIndex >= 0) return [0, alphaIndex, normalized];

    const numeric = Number.parseFloat(normalized.replace(',', '.'));
    if (Number.isFinite(numeric)) return [1, numeric, normalized];

    return [2, 0, normalized];
  };

  return [...labels].sort((a, b) => {
    const [groupA, valueA, textA] = rank(a);
    const [groupB, valueB, textB] = rank(b);
    if (groupA !== groupB) return groupA - groupB;
    if (valueA !== valueB) return valueA - valueB;
    return textA.localeCompare(textB, 'tr');
  });
}

interface Scored {
  size: string;
  /** Ortalama sapma (cm). Küçük = daha iyi eşleşme. */
  deviationCm: number;
  matchedDimensions: number;
}

function scoreSizes(chart: SizeChart, measurements: BodyMeasurements): Scored[] {
  const scored: Scored[] = [];

  for (const [size, dimensions] of Object.entries(chart)) {
    let total = 0;
    let matched = 0;

    for (const [rawDimension, garmentCm] of Object.entries(dimensions)) {
      const field = DIMENSION_TO_MEASUREMENT[rawDimension.trim().toLowerCase()];
      if (!field) continue;

      const bodyCm = measurements[field];
      if (typeof bodyCm !== 'number' || !Number.isFinite(garmentCm)) continue;

      const ease = IDEAL_EASE_CM[rawDimension.trim().toLowerCase()] ?? 5;
      total += Math.abs(garmentCm - (bodyCm + ease));
      matched += 1;
    }

    if (matched > 0) {
      scored.push({ size, deviationCm: total / matched, matchedDimensions: matched });
    }
  }

  return scored.sort((a, b) => a.deviationCm - b.deviationCm);
}

/** Bir bedeni merdivende `steps` kadar kaydırır; uçlarda kırpılır. */
function shiftSize(ordered: string[], size: string, steps: number): string {
  const index = ordered.indexOf(size);
  if (index < 0) return size;
  const next = Math.min(ordered.length - 1, Math.max(0, index + steps));
  return ordered[next] ?? size;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * ÖNERİYİ HESAPLAR.
 *
 * Zincir: ölçü eşleşmesi → marka kalıbı → kullanıcı tercihi → iade geri
 * bildirimi. Her adım hem bedeni hem güveni değiştirebilir ve kendi gerekçesini
 * `reasons` içine yazar.
 */
export function recommendSize(input: SizeEngineInput): SizeEngineResult {
  const reasons: SizeReason[] = [];
  const orderedSizes = orderSizes(Object.keys(input.sizeChart));

  if (orderedSizes.length === 0) {
    reasons.push({
      code: 'NO_SIZE_CHART',
      message: 'Bu ürün için beden tablosu bulunmuyor.',
    });
    return {
      kind: 'CHART_ONLY',
      confidence: 0,
      reasons,
      orderedSizes,
      disclaimer: SIZE_DISCLAIMER,
    };
  }

  const scored = scoreSizes(input.sizeChart, input.measurements);

  if (scored.length === 0) {
    // Ölçü yoksa tahmin de yok. Boy/kilodan beden türetmek cazip ama
    // güvenilmez: aynı boy-kiloda göğüs çevresi 15 cm değişebilir.
    reasons.push({
      code: 'NO_MEASUREMENTS',
      message: 'Beden önerisi için göğüs, bel veya kalça ölçünüzü girmeniz gerekiyor.',
    });
    return {
      kind: 'CHART_ONLY',
      confidence: 0,
      reasons,
      orderedSizes,
      disclaimer: SIZE_DISCLAIMER,
    };
  }

  const best = scored[0]!;
  const runnerUp = scored[1] ?? null;

  let size = best.size;
  // Kaç ölçü eşleşti: tek ölçüyle verilen karar üç ölçüyle verilenden zayıftır.
  let confidence = 35 + best.matchedDimensions * 15;

  reasons.push({
    code: 'MEASUREMENT_MATCH',
    message: `Ölçüleriniz ${best.size} bedeninin tablosuna ortalama ${best.deviationCm.toFixed(
      1,
    )} cm farkla en yakın.`,
  });

  // Aradaki fark küçükse iki beden de eşit derecede olası demektir; bunu
  // güvene yansıtmazsak kullanıcı yazı-tura sonucuna kesinlik atfeder.
  if (runnerUp) {
    const separation = runnerUp.deviationCm - best.deviationCm;
    if (separation >= 4) confidence += 10;
    else if (separation >= 2) confidence += 5;
    else if (separation < 1) {
      confidence -= 15;
      reasons.push({
        code: 'AMBIGUOUS',
        message: `${best.size} ve ${runnerUp.size} bedenleri ölçülerinize neredeyse aynı uzaklıkta.`,
      });
    }
  }

  // ── Marka kalıbı ────────────────────────────────────────────────────────
  // SLIM +1: dar kalıpta bir beden büyük. OVERSIZE -1: bol kalıpta bir küçük.
  if (input.brandFit && input.brandFit !== 'REGULAR') {
    const steps = SIZE_ENGINE.fitAdjustment[input.brandFit];
    const shifted = shiftSize(orderedSizes, size, steps);
    if (shifted !== size) {
      reasons.push({
        code: 'BRAND_FIT',
        message:
          input.brandFit === 'SLIM'
            ? `Ürün dar kalıplı; bir beden büyük (${shifted}) öneriliyor.`
            : `Ürün bol kalıplı; bir beden küçük (${shifted}) öneriliyor.`,
      });
      size = shifted;
    }
  }

  // ── Kullanıcının kalıp tercihi ──────────────────────────────────────────
  // ⚠️ Marka kalıbının TERSİ yönde çalışır: "dar sevmek" bir beden küçük,
  //    "bol sevmek" bir beden büyük demektir. İkisi karıştırılırsa düzeltme
  //    iki kez aynı yöne uygulanır ve öneri iki beden şaşar.
  if (input.fitPreference && input.fitPreference !== 'REGULAR') {
    const steps = input.fitPreference === 'SLIM' ? -1 : 1;
    const shifted = shiftSize(orderedSizes, size, steps);
    if (shifted !== size) {
      reasons.push({
        code: 'FIT_PREFERENCE',
        message:
          input.fitPreference === 'SLIM'
            ? `Dar kalıp tercihinize göre ${shifted} bedeni öneriliyor.`
            : `Bol kalıp tercihinize göre ${shifted} bedeni öneriliyor.`,
      });
      size = shifted;
    }
  }

  // ── İade / yorum geri bildirimi ─────────────────────────────────────────
  // Gerçek alıcı deneyimi, tablodaki rakamdan daha güçlü bir sinyaldir —
  // ama yalnızca yeterli sayıda geri bildirim varsa. Üç kişinin görüşü
  // gürültüdür ve öneriyi savurur.
  const feedback = input.feedback;
  const feedbackTotal = feedback ? feedback.tooSmall + feedback.trueToSize + feedback.tooLarge : 0;

  if (feedback && feedbackTotal >= SIZE_ENGINE.minFeedbackCountToUse) {
    const skew = (feedback.tooSmall - feedback.tooLarge) / feedbackTotal;

    if (skew >= 0.3) {
      const shifted = shiftSize(orderedSizes, size, 1);
      reasons.push({
        code: 'RETURN_FEEDBACK',
        message: `Alıcıların çoğu bu ürünün küçük geldiğini bildirdi; bir beden büyük (${shifted}) öneriliyor.`,
      });
      size = shifted;
      confidence += 8;
    } else if (skew <= -0.3) {
      const shifted = shiftSize(orderedSizes, size, -1);
      reasons.push({
        code: 'RETURN_FEEDBACK',
        message: `Alıcıların çoğu bu ürünün büyük geldiğini bildirdi; bir beden küçük (${shifted}) öneriliyor.`,
      });
      size = shifted;
      confidence += 8;
    } else {
      reasons.push({
        code: 'RETURN_FEEDBACK',
        message: 'Alıcıların çoğu bu ürünün bedeninin uygun olduğunu bildirdi.',
      });
      confidence += 5;
    }
  } else if (feedbackTotal > 0) {
    reasons.push({
      code: 'FEEDBACK_TOO_FEW',
      message: 'Bu ürün için henüz yeterli beden geri bildirimi yok.',
    });
  }

  // ── "Normalde giydiğim beden" doğrulaması ───────────────────────────────
  const usual = input.measurements.usualSize
    ? normalizeSizeLabel(input.measurements.usualSize)
    : null;

  if (usual) {
    const usualIndex = orderedSizes.findIndex((s) => normalizeSizeLabel(s) === usual);
    const resultIndex = orderedSizes.indexOf(size);

    if (usualIndex >= 0 && resultIndex >= 0) {
      const distance = Math.abs(usualIndex - resultIndex);
      if (distance === 0) {
        confidence += 8;
        reasons.push({
          code: 'USUAL_SIZE_AGREES',
          message: 'Öneri, normalde giydiğiniz bedenle aynı.',
        });
      } else if (distance > 1) {
        // İki sinyal birbirini tutmuyor. Hangisinin doğru olduğunu bilmiyoruz;
        // bunu gizlemek yerine güveni düşürüp kullanıcıya söylüyoruz.
        confidence -= 12;
        reasons.push({
          code: 'USUAL_SIZE_CONFLICTS',
          message: `Öneri (${size}), normalde giydiğiniz bedenden (${usual}) belirgin biçimde farklı.`,
        });
      }
    }
  }

  confidence = clamp(Math.round(confidence));

  if (confidence < SIZE_ENGINE.minConfidenceToShow) {
    return { kind: 'CHART_ONLY', confidence, reasons, orderedSizes, disclaimer: SIZE_DISCLAIMER };
  }

  // Alternatif: öneriye komşu ve tabloda var olan diğer aday.
  const alternative =
    runnerUp && runnerUp.size !== size
      ? runnerUp.size
      : (() => {
          const neighbour = shiftSize(orderedSizes, size, 1);
          return neighbour === size ? shiftSize(orderedSizes, size, -1) : neighbour;
        })();

  return {
    kind: 'RECOMMENDATION',
    recommendedSize: size,
    alternativeSize: alternative === size ? null : alternative,
    confidence,
    reasons,
    orderedSizes,
    disclaimer: SIZE_DISCLAIMER,
  };
}
