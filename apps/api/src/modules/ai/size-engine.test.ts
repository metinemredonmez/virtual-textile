import { describe, expect, it } from 'vitest';
import { SIZE_ENGINE } from '@vt/config';
import {
  orderSizes,
  recommendSize,
  SIZE_DISCLAIMER,
  type BrandFitSignal,
  type SizeChart,
  type SizeEngineResult,
  type UserSizeHistory,
} from './size-engine.js';
import { FIT_SIGNAL_TUNING } from './fit-learning.js';

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

// ═══════════════════════════════════════════════════════════════════════════
// GÖREV D — İADE GERİ BİLDİRİMİYLE ÖĞRENME
//
// Bu bölümün tamamı tek bir iddiayı korur: AZ VERİYLE YÜKSEK GÜVEN GÖSTERMEK
// EN ZARARLI DAVRANIŞTIR. Aşağıdaki testler kırılırsa öneri, eline geçen ilk
// üç yorumla beden kaydırmaya başlar.
// ═══════════════════════════════════════════════════════════════════════════

/** İki beden ölçüye eşit uzaklıkta: taban güven eşiğin ALTINDA kalır. */
const AMBIGUOUS_CHART: SizeChart = { S: { chest: 96 }, M: { chest: 98 } };

describe('recommendSize — güven VERİ MİKTARIYLA ölçeklenir', () => {
  it('aynı sinyal az veriyle öneriyi GİZLER, çok veriyle GÖSTERİR', () => {
    // ⚠️ Bu görevin en önemli testi. İki girdide de alıcıların TAMAMI "küçük
    //    geldi" diyor; tek fark kaç kişinin dediği. Beş kişilik veri öneriyi
    //    eşiğin üstüne çıkarmaya YETMEMELİ.
    const thin = recommendSize({
      sizeChart: AMBIGUOUS_CHART,
      measurements: { chestCm: 91 },
      feedback: { tooSmall: SIZE_ENGINE.minFeedbackCountToUse, trueToSize: 0, tooLarge: 0 },
    });
    const thick = recommendSize({
      sizeChart: AMBIGUOUS_CHART,
      measurements: { chestCm: 91 },
      feedback: { tooSmall: 50, trueToSize: 0, tooLarge: 0 },
    });

    expect(thin.kind).toBe('CHART_ONLY');
    expect(thin.confidence).toBeLessThan(SIZE_ENGINE.minConfidenceToShow);

    expect(thick.kind).toBe('RECOMMENDATION');
    expect(thick.confidence).toBeGreaterThanOrEqual(SIZE_ENGINE.minConfidenceToShow);
  });

  it('öneri gizlenirken beden tablosu ve tahmin uyarısı yine döner', () => {
    // Öneri yoksa kullanıcı kendi kararını verebilmeli.
    const thin = recommendSize({
      sizeChart: AMBIGUOUS_CHART,
      measurements: { chestCm: 91 },
      feedback: { tooSmall: SIZE_ENGINE.minFeedbackCountToUse, trueToSize: 0, tooLarge: 0 },
    });

    expect(thin.orderedSizes).toEqual(['S', 'M']);
    expect(thin.disclaimer).toBe(SIZE_DISCLAIMER);
    expect(thin).not.toHaveProperty('recommendedSize');
  });

  it('geri bildirim arttıkça güven artar — sabit ödül YOKTUR', () => {
    const at = (tooSmall: number): number =>
      recommendSize({
        sizeChart: CHART,
        measurements: { chestCm: 92 },
        feedback: { tooSmall, trueToSize: 0, tooLarge: 0 },
      }).confidence;

    const few = at(SIZE_ENGINE.minFeedbackCountToUse);
    const some = at(SIZE_ENGINE.minFeedbackCountToUse * 4);
    const many = at(SIZE_ENGINE.minFeedbackCountToUse * 20);

    expect(some).toBeGreaterThan(few);
    expect(many).toBeGreaterThan(some);
  });

  it('sonsuz veri bile güveni 100e kilitlemez', () => {
    const result = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      feedback: { tooSmall: 100_000, trueToSize: 0, tooLarge: 0 },
    });

    expect(result.confidence).toBeLessThanOrEqual(100);
  });
});

describe('recommendSize — eşik altı veri HİÇ kullanılmaz', () => {
  const baseline = recommendSize({ sizeChart: CHART, measurements: { chestCm: 92 } });

  it('eşik altı veri güveni ne artırır ne azaltır', () => {
    // ⚠️ "Az veriyi az kullanalım" demek, üç kişinin gürültüsünü öneriye
    //    sızdırmaktır. Eşiğin anlamı: o veri YOK sayılır.
    const belowThreshold = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      feedback: {
        tooSmall: SIZE_ENGINE.minFeedbackCountToUse - 1,
        trueToSize: 0,
        tooLarge: 0,
      },
    });

    expect(belowThreshold.confidence).toBe(baseline.confidence);
  });

  it('eşik altı veri oybirliğinde bile bedeni kaydırmaz', () => {
    const belowThreshold = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      feedback: {
        tooSmall: SIZE_ENGINE.minFeedbackCountToUse - 1,
        trueToSize: 0,
        tooLarge: 0,
      },
    });

    expect(recommended(belowThreshold)).toBe('M');
    expect(belowThreshold.reasons.map((r) => r.code)).toContain('FEEDBACK_TOO_FEW');
  });

  it('eşiği geçen aynı oran hem kaydırır hem güveni yükseltir', () => {
    const atThreshold = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      feedback: { tooSmall: SIZE_ENGINE.minFeedbackCountToUse, trueToSize: 0, tooLarge: 0 },
    });

    expect(recommended(atThreshold)).toBe('L');
    expect(atThreshold.confidence).toBeGreaterThan(baseline.confidence);
  });

  it('çelişkili geri bildirim güveni DÜŞÜRÜR ve söylenir', () => {
    // Bedeni tutarsız bir ürün gerçekten daha riskli bir alışveriştir.
    const conflicting = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      feedback: { tooSmall: 10, trueToSize: 0, tooLarge: 10 },
    });

    expect(recommended(conflicting)).toBe('M');
    expect(conflicting.confidence).toBeLessThan(baseline.confidence);
    expect(conflicting.reasons.map((r) => r.code)).toContain('FEEDBACK_CONFLICTING');
  });
});

describe('recommendSize — marka bazlı öğrenme', () => {
  const BRAND_MIN = SIZE_ENGINE.minFeedbackCountToUse * FIT_SIGNAL_TUNING.brandThresholdMultiplier;

  const brandRunsSmall = (count: number, distinctProducts: number): BrandFitSignal => ({
    summary: { tooSmall: count, trueToSize: 0, tooLarge: 0 },
    distinctProducts,
  });

  it('markanın geneline yayılmış eğilim bir beden kaydırır', () => {
    const result = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      brandSignal: brandRunsSmall(BRAND_MIN * 2, 6),
    });

    expect(recommended(result)).toBe('L');
    expect(result.reasons.map((r) => r.code)).toContain('BRAND_FIT_LEARNED');
  });

  it('tek üründen gelen yığın veri marka kalıbı SAYILMAZ', () => {
    // ⚠️ Tek bir hatalı beden tablosu, markanın tüm kataloğunu kaydıramaz.
    const result = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      brandSignal: brandRunsSmall(200, 1),
    });

    expect(recommended(result)).toBe('M');
    expect(result.reasons.map((r) => r.code)).not.toContain('BRAND_FIT_LEARNED');
  });

  it('marka eşiği ürün eşiğinden yüksektir', () => {
    const result = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      brandSignal: brandRunsSmall(
        SIZE_ENGINE.minFeedbackCountToUse,
        FIT_SIGNAL_TUNING.minDistinctProductsForBrand,
      ),
    });

    expect(recommended(result)).toBe('M');
  });

  it('ürünün KENDİ verisi marka eğilimini EZER', () => {
    // Özel kanıt, genel kanıttan üstündür: bu ürün büyük geliyorsa markanın
    // geneli ne derse desin bir beden küçük önerilir.
    const result = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      feedback: { tooSmall: 0, trueToSize: 0, tooLarge: 20 },
      brandSignal: brandRunsSmall(BRAND_MIN * 2, 6),
    });

    expect(recommended(result)).toBe('S');
    expect(result.reasons.map((r) => r.code)).toContain('RETURN_FEEDBACK');
    expect(result.reasons.map((r) => r.code)).not.toContain('BRAND_FIT_LEARNED');
  });

  it('marka güveni ürün güveninden daha az yükseltir', () => {
    const viaProduct = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      feedback: { tooSmall: 100, trueToSize: 0, tooLarge: 0 },
    });
    const viaBrand = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      brandSignal: brandRunsSmall(100, 6),
    });

    expect(viaBrand.confidence).toBeLessThan(viaProduct.confidence);
  });
});

describe('recommendSize — kalıp kaynakları TOPLANMAZ, yarışır', () => {
  it('beyan edilen dar kalıp + "küçük geliyor" verisi iki beden kaydırmaz', () => {
    // ⚠️ İkisi çoğu zaman AYNI olguyu ölçer. Toplasaydık öneri iki beden
    //    şaşardı ve bunu kimse fark etmezdi.
    const result = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      brandFit: 'SLIM',
      feedback: { tooSmall: 20, trueToSize: 0, tooLarge: 0 },
    });

    expect(recommended(result)).toBe('L');
  });

  it('alıcı verisi "bedenler doğru" diyorsa beyan edilen kalıp UYGULANMAZ', () => {
    // Kalıbın dar olması bedenin küçük olduğu anlamına gelmez; alıcı verisi
    // tam da bu ayrımı bilir ve satıcının beyanını ezer.
    const result = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      brandFit: 'SLIM',
      feedback: { tooSmall: 1, trueToSize: 20, tooLarge: 1 },
    });

    expect(recommended(result)).toBe('M');
    expect(result.reasons.map((r) => r.code)).not.toContain('BRAND_FIT');
  });

  it('veri eşik altındaysa beyan edilen kalıp yürürlükte kalır', () => {
    const result = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      brandFit: 'SLIM',
      feedback: { tooSmall: 0, trueToSize: SIZE_ENGINE.minFeedbackCountToUse - 1, tooLarge: 0 },
    });

    expect(recommended(result)).toBe('L');
    expect(result.reasons.map((r) => r.code)).toContain('BRAND_FIT');
  });
});

describe('recommendSize — kullanıcının kendi geçmişi', () => {
  const history = (partial: Partial<UserSizeHistory>): UserSizeHistory => ({
    keptSizesForProduct: [],
    keptSizesForBrand: [],
    returnedSizesForProduct: [],
    ...partial,
  });

  const baseline = recommendSize({ sizeChart: CHART, measurements: { chestCm: 92 } });

  it('bu üründen tutulan beden öneriyi kendine çeker', () => {
    const result = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      userHistory: history({ keptSizesForProduct: ['L'] }),
    });

    expect(recommended(result)).toBe('L');
    expect(result.confidence).toBeGreaterThan(baseline.confidence);
    expect(result.reasons.map((r) => r.code)).toContain('USER_KEPT_SIZE');
  });

  it('beden yüzünden iade edilen beden bir daha ÖNERİLMEZ', () => {
    const result = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      userHistory: history({ returnedSizesForProduct: [{ size: 'M', direction: 'TOO_SMALL' }] }),
    });

    expect(recommended(result)).toBe('L');
    expect(result.reasons.map((r) => r.code)).toContain('USER_RETURNED_SIZE');
  });

  it('iade kanıtı, tutulmuş sayılan bedeni EZER', () => {
    // Kimse üstüne olan bir şeyi kargoyla geri göndermez: iade, tutmaktan
    // daha güçlü bir sinyaldir.
    const result = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      userHistory: history({
        keptSizesForProduct: ['M'],
        returnedSizesForProduct: [{ size: 'M', direction: 'TOO_SMALL' }],
      }),
    });

    expect(recommended(result)).toBe('L');
    expect(result.reasons.map((r) => r.code)).not.toContain('USER_KEPT_SIZE');
  });

  it('kendi içinde çelişen iade geçmişi UYGULANMAZ', () => {
    // "L küçük geldi" + "M büyük geldi": arada geçerli beden yok. Zorlama bir
    // beden üretmek yerine ölçü kararında kalınır.
    const result = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      userHistory: history({
        returnedSizesForProduct: [
          { size: 'L', direction: 'TOO_SMALL' },
          { size: 'M', direction: 'TOO_LARGE' },
        ],
      }),
    });

    expect(recommended(result)).toBe('M');
    expect(result.confidence).toBe(baseline.confidence);
    expect(result.reasons.map((r) => r.code)).not.toContain('USER_RETURNED_SIZE');
  });

  it('marka geçmişi bedeni KAYDIRMAZ, yalnızca güveni oynatır', () => {
    // ⚠️ Aynı markanın montu ile tişörtü aynı beden merdivenini paylaşmaz.
    const agrees = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      userHistory: history({ keptSizesForBrand: ['M'] }),
    });
    const conflicts = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      userHistory: history({ keptSizesForBrand: ['XL'] }),
    });

    expect(recommended(agrees)).toBe('M');
    expect(recommended(conflicts)).toBe('M');
    expect(agrees.confidence).toBeGreaterThan(baseline.confidence);
    expect(conflicts.confidence).toBeLessThan(baseline.confidence);
    expect(conflicts.reasons.map((r) => r.code)).toContain('USER_BRAND_HISTORY');
  });

  it('ürün düzeyinde kanıt varken marka geçmişine bakılmaz', () => {
    const result = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      userHistory: history({ keptSizesForProduct: ['L'], keptSizesForBrand: ['S'] }),
    });

    expect(recommended(result)).toBe('L');
    expect(result.reasons.map((r) => r.code)).not.toContain('USER_BRAND_HISTORY');
  });

  it('geçmişi olmayan (misafir) kullanıcıda davranış değişmez', () => {
    const guest = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      userHistory: null,
    });

    expect(recommended(guest)).toBe(recommended(baseline));
    expect(guest.confidence).toBe(baseline.confidence);
  });

  it('kişisel kanıt da tekrarla güçlenir', () => {
    const once = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      userHistory: history({ keptSizesForProduct: ['L'] }),
    });
    const thrice = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      userHistory: history({ keptSizesForProduct: ['L', 'L', 'L'] }),
    });

    expect(thrice.confidence).toBeGreaterThan(once.confidence);
  });
});

describe('recommendSize — öğrenilen sinyal de "tahmin" olarak sunulur', () => {
  it('kaynak ne olursa olsun kesinlik iddia edilmez', () => {
    // ⚠️ Gerçek iade verisiyle desteklenen bir öneri bile bir tahmindir;
    //    "veriye dayanıyor" ifadesi kesinlik yerine geçemez.
    const result = recommendSize({
      sizeChart: CHART,
      measurements: { chestCm: 92 },
      feedback: { tooSmall: 500, trueToSize: 0, tooLarge: 0 },
      brandSignal: { summary: { tooSmall: 500, trueToSize: 0, tooLarge: 0 }, distinctProducts: 20 },
      userHistory: {
        keptSizesForProduct: ['L', 'L'],
        keptSizesForBrand: [],
        returnedSizesForProduct: [],
      },
    });

    expect(result.disclaimer).toBe(SIZE_DISCLAIMER);
    expect(result.confidence).toBeLessThanOrEqual(100);
  });
});
