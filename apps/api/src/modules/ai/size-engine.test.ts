import { describe, expect, it } from 'vitest';
import { SIZE_ENGINE } from '@vt/config';
import {
  orderSizes,
  recommendSize,
  SIZE_DISCLAIMER,
  type SizeChart,
  type SizeEngineResult,
} from './size-engine.js';

/**
 * Beden tablosu GİYSİ ölçüsüdür. Motor bolluk payını (ease) ekleyerek
 * karşılaştırır: göğüs için +6 cm. Bu tabloda 92 cm göğüslü bir kullanıcının
 * hedefi 98 cm, yani M bedendir.
 */
const CHART: SizeChart = {
  S: { chest: 92 },
  M: { chest: 98 },
  L: { chest: 104 },
  XL: { chest: 110 },
};

const FULL_CHART: SizeChart = {
  S: { chest: 92, waist: 73, hip: 96 },
  M: { chest: 98, waist: 79, hip: 102 },
  L: { chest: 104, waist: 85, hip: 108 },
};

function recommended(result: SizeEngineResult): string | null {
  return result.kind === 'RECOMMENDATION' ? result.recommendedSize : null;
}

describe('orderSizes', () => {
  it('harf bedenleri küçükten büyüğe dizer', () => {
    expect(orderSizes(['L', 'XS', 'M', 'XL', 'S'])).toEqual(['XS', 'S', 'M', 'L', 'XL']);
  });

  it('sayısal bedenleri değerine göre dizer (alfabetik değil)', () => {
    expect(orderSizes(['40', '36', '38', '100'])).toEqual(['36', '38', '40', '100']);
  });

  it('2XL gibi eşanlamlıları merdivendeki yerine yerleştirir ama etiketi korur', () => {
    expect(orderSizes(['2XL', 'M', 'XL'])).toEqual(['M', 'XL', '2XL']);
  });

  it('tanınmayan bedenleri sona alır', () => {
    expect(orderSizes(['TEK EBAT', 'M', 'S'])).toEqual(['S', 'M', 'TEK EBAT']);
  });
});

describe('recommendSize — temel davranış', () => {
  it('ölçü yoksa öneri vermez, yalnızca tabloyu döndürür', () => {
    // ⚠️ Boy/kilodan beden türetmek cazip ama güvenilmez: aynı boy-kiloda
    // göğüs çevresi 15 cm oynayabilir.
    const result = recommendSize({
      sizeChart: CHART,
      measurements: { heightCm: 175, weightKg: 70 },
    });

    expect(result.kind).toBe('CHART_ONLY');
    expect(result.confidence).toBe(0);
    expect(result.reasons.map((r) => r.code)).toContain('NO_MEASUREMENTS');
    expect(result.orderedSizes).toEqual(['S', 'M', 'L', 'XL']);
  });

  it('beden tablosu yoksa öneri vermez', () => {
    const result = recommendSize({ sizeChart: {}, measurements: { chestCm: 92 } });

    expect(result.kind).toBe('CHART_ONLY');
    expect(result.reasons.map((r) => r.code)).toContain('NO_SIZE_CHART');
  });

  it('çıktı her zaman "tahmin" olarak sunulur', () => {
    const withMeasure = recommendSize({ sizeChart: CHART, measurements: { chestCm: 92 } });
    const without = recommendSize({ sizeChart: CHART, measurements: {} });

    expect(withMeasure.disclaimer).toBe(SIZE_DISCLAIMER);
    expect(without.disclaimer).toBe(SIZE_DISCLAIMER);
  });

  it('ölçüye en yakın bedeni önerir ve gerekçesini yazar', () => {
    const result = recommendSize({ sizeChart: CHART, measurements: { chestCm: 92 } });

    expect(recommended(result)).toBe('M');
    expect(result.reasons.map((r) => r.code)).toContain('MEASUREMENT_MATCH');
  });

  it('daha çok ölçü eşleşince güven artar', () => {
    const oneDimension = recommendSize({ sizeChart: CHART, measurements: { chestCm: 92 } });
    const threeDimensions = recommendSize({
      sizeChart: FULL_CHART,
      measurements: { chestCm: 92, waistCm: 74, hipCm: 96 },
    });

    expect(threeDimensions.confidence).toBeGreaterThan(oneDimension.confidence);
  });
});

describe('recommendSize — kalıp düzeltmeleri', () => {
  it('dar kalıpta bir beden büyük önerir (SLIM +1)', () => {
    const result = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      brandFit: 'SLIM',
    });

    expect(recommended(result)).toBe('L');
    expect(result.reasons.map((r) => r.code)).toContain('BRAND_FIT');
  });

  it('bol kalıpta bir beden küçük önerir (OVERSIZE -1)', () => {
    const result = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      brandFit: 'OVERSIZE',
    });

    expect(recommended(result)).toBe('S');
  });

  it('REGULAR kalıp öneriyi değiştirmez', () => {
    const result = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      brandFit: 'REGULAR',
    });

    expect(recommended(result)).toBe('M');
    expect(result.reasons.map((r) => r.code)).not.toContain('BRAND_FIT');
  });

  it('kullanıcının kalıp tercihi marka kalıbının TERSİ yönde çalışır', () => {
    // "Dar sevmek" bir beden küçük demektir; "dar kalıplı ürün" bir beden
    // büyük. İkisi karıştırılırsa öneri iki beden şaşar.
    const prefersSlim = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      fitPreference: 'SLIM',
    });
    const prefersOversize = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      fitPreference: 'OVERSIZE',
    });

    expect(recommended(prefersSlim)).toBe('S');
    expect(recommended(prefersOversize)).toBe('L');
  });

  it('dar kalıplı üründe dar tercih birbirini götürür', () => {
    const result = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      brandFit: 'SLIM',
      fitPreference: 'SLIM',
    });

    expect(recommended(result)).toBe('M');
  });

  it('merdivenin ucunda kaydırma taşmaz', () => {
    const result = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 104 },
      brandFit: 'SLIM',
    });

    // XL zaten en büyük beden; "bir beden büyük" XL'de kalır.
    expect(recommended(result)).toBe('XL');
  });
});

describe('recommendSize — iade geri bildirimi', () => {
  const belowThreshold = SIZE_ENGINE.minFeedbackCountToUse - 1;

  it('yeterli geri bildirim yoksa öneriyi kaydırmaz', () => {
    const result = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      feedback: { tooSmall: belowThreshold, trueToSize: 0, tooLarge: 0 },
    });

    expect(recommended(result)).toBe('M');
    expect(result.reasons.map((r) => r.code)).toContain('FEEDBACK_TOO_FEW');
  });

  it('"küçük geliyor" sinyali eşiği aşınca bir beden büyük önerir', () => {
    const result = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      feedback: { tooSmall: SIZE_ENGINE.minFeedbackCountToUse, trueToSize: 0, tooLarge: 0 },
    });

    expect(recommended(result)).toBe('L');
    expect(result.reasons.map((r) => r.code)).toContain('RETURN_FEEDBACK');
  });

  it('"büyük geliyor" sinyali bir beden küçük önerir', () => {
    const result = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      feedback: { tooSmall: 0, trueToSize: 0, tooLarge: SIZE_ENGINE.minFeedbackCountToUse },
    });

    expect(recommended(result)).toBe('S');
  });

  it('dengeli geri bildirim öneriyi kaydırmaz ama güveni artırır', () => {
    const withoutFeedback = recommendSize({ sizeChart: CHART, measurements: { chestCm: 92 } });
    const withFeedback = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      feedback: { tooSmall: 1, trueToSize: 8, tooLarge: 1 },
    });

    expect(recommended(withFeedback)).toBe('M');
    expect(withFeedback.confidence).toBeGreaterThan(withoutFeedback.confidence);
  });
});

describe('recommendSize — güven eşiği', () => {
  it('iki beden eşit uzaklıktaysa güven düşer ve öneri GİZLENİR', () => {
    // ⚠️ Zayıf bir öneri, hiç öneri olmamasından kötüdür: kullanıcı ona
    // güvenip yanlış bedeni alır ve iade eder.
    const result = recommendSize({
      sizeChart: { S: { chest: 96 }, M: { chest: 98 } },
      measurements: { chestCm: 91 },
    });

    expect(result.kind).toBe('CHART_ONLY');
    expect(result.confidence).toBeLessThan(SIZE_ENGINE.minConfidenceToShow);
    expect(result.reasons.map((r) => r.code)).toContain('AMBIGUOUS');
    // Öneri gizlense bile tablo her zaman döner.
    expect(result.orderedSizes).toEqual(['S', 'M']);
  });

  it('eşiğin altındaki sonuçta beden alanı hiç bulunmaz', () => {
    const result = recommendSize({ sizeChart: CHART, measurements: {} });

    expect(result).not.toHaveProperty('recommendedSize');
  });

  it('normalde giyilen bedenle uyuşma güveni artırır', () => {
    const neutral = recommendSize({ sizeChart: CHART, measurements: { chestCm: 92 } });
    const agreeing = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92, usualSize: 'M' },
    });

    expect(agreeing.confidence).toBeGreaterThan(neutral.confidence);
    expect(agreeing.reasons.map((r) => r.code)).toContain('USUAL_SIZE_AGREES');
  });

  it('normalde giyilen bedenle belirgin çelişki güveni düşürür ve söylenir', () => {
    const result = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92, usualSize: 'XL' },
    });

    expect(result.reasons.map((r) => r.code)).toContain('USUAL_SIZE_CONFLICTS');
  });

  it('güven her zaman 0-100 aralığında kalır', () => {
    const result = recommendSize({
      sizeChart: FULL_CHART,
      measurements: { chestCm: 92, waistCm: 73, hipCm: 96, usualSize: 'M' },
      feedback: { tooSmall: 20, trueToSize: 0, tooLarge: 0 },
    });

    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(100);
  });
});
