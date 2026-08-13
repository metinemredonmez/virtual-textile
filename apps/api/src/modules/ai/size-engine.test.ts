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
    /**
     * ⚠️ BEKLENTİ DEĞİŞTİ: `NO_MEASUREMENTS` → `HEIGHT_WEIGHT_ONLY`.
     *
     *    Test SUSTURULMADI, davranış BİLEREK iyileşti. Eskiden boy/kilosunu
     *    GİRMİŞ bir kullanıcıya "ölçünüzü girin" deniyordu; kullanıcı formu
     *    doldurduğunu bildiği için bunu bir arıza sanıyordu. Artık ne
     *    girdiğini kabul eden, neyin eksik olduğunu söyleyen ayrı bir kod var.
     *
     *    Kararın kendisi DEĞİŞMEDİ ve değişmemeli: boy/kilodan beden
     *    türetmek kaynaklı bir antropometrik model ister, elimizde yok.
     *    Aynı boy-kiloda göğüs çevresi 15 cm oynayabilir.
     */
    const result = recommendSize({
      sizeChart: CHART,
      measurements: { heightCm: 175, weightKg: 70 },
    });

    expect(result.kind).toBe('CHART_ONLY');
    expect(result.confidence).toBe(0);
    expect(result.reasons.map((r) => r.code)).toContain('HEIGHT_WEIGHT_ONLY');
    expect(result.orderedSizes).toEqual(['S', 'M', 'L', 'XL']);
  });

  it('hiçbir ölçü yoksa NO_MEASUREMENTS döner (boy/kilo da yoksa)', () => {
    // ⚠️ Eski kod yolu SİLİNMEDİ, yalnız daraldı. İki durum artık ayrı ayrı
    //    ölçülüyor; biri diğerinin kapsamına kayarsa test söyler.
    const result = recommendSize({ sizeChart: CHART, measurements: {} });
    expect(result.reasons.map((r) => r.code)).toContain('NO_MEASUREMENTS');
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

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  OMUZ · İÇ BACAK BOYU · BOY/KİLO — bu turda bağlanan yollar.
 *
 *  ⚠️ HER TEST BİR MUTASYONLA ÖLÇÜLDÜ. Yazıldıktan sonra ilgili satır kasten
 *     bozuldu, testin KIRILDIĞI görüldü, sonra geri alındı. Bu depoda bir kez
 *     tam tersi oldu: bir sapma kontrolü `.test.ts` içindeydi ve
 *     `apps/api/tsconfig.json` test dosyalarını dışladığı için HİÇ DERLENMEDİ;
 *     yeşil görünen bir ölü koruma aylarca durdu.
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe('yeni ölçüler', () => {
  /** Seed `UST_BEDEN_TABLOSU` ile birebir aynı (omuz bu turda eklendi). */
  const UST = {
    XS: { gogus: 84, bel: 66, boy: 60, omuz: 37 },
    S: { gogus: 88, bel: 70, boy: 62, omuz: 39 },
    M: { gogus: 94, bel: 76, boy: 64, omuz: 41 },
    L: { gogus: 100, bel: 82, boy: 66, omuz: 43 },
    XL: { gogus: 108, bel: 90, boy: 68, omuz: 46 },
  };

  /** Seed `ALT_BEDEN_TABLOSU` — `icBoy` bugüne kadar hiç okunmuyordu. */
  const ALT = {
    '26': { bel: 66, kalca: 92, icBoy: 76 },
    '28': { bel: 71, kalca: 97, icBoy: 77 },
    '30': { bel: 76, kalca: 102, icBoy: 78 },
    '32': { bel: 81, kalca: 107, icBoy: 79 },
  };

  it('omuz ölçüsü eşleşen boyut sayısına GİRER ve güveni artırır', () => {
    const omuzsuz = recommendSize({
      sizeChart: UST,
      measurements: { chestCm: 88, waistCm: 70 },
    });
    const omuzlu = recommendSize({
      sizeChart: UST,
      measurements: { chestCm: 88, waistCm: 70, shoulderCm: 37 },
    });

    // ⚠️ Mutasyon: `DIMENSION_TO_MEASUREMENT`ten `omuz` satırı silinince bu
    //    beklenti düşüyor (güvenler eşitleniyor) — ölçüldü.
    expect(omuzsuz.kind).toBe('RECOMMENDATION');
    expect(omuzlu.kind).toBe('RECOMMENDATION');
    if (omuzsuz.kind !== 'RECOMMENDATION' || omuzlu.kind !== 'RECOMMENDATION') return;
    expect(omuzlu.confidence).toBeGreaterThan(omuzsuz.confidence);
  });

  it('iç bacak boyu ORTALAMAYA girmez — yalnız beraberlik bozar', () => {
    /**
     * ⚠️ Bu testin çekirdeği: `icBoy` skora girseydi sapma ortalaması
     *    değişirdi ve iki çağrı FARKLI güven üretirdi. Aynı çıkması,
     *    uzunluğun kovaya girmediğinin kanıtı.
     */
    const icBoysuz = recommendSize({
      sizeChart: ALT,
      measurements: { waistCm: 66, hipCm: 92 },
    });
    const icBoylu = recommendSize({
      sizeChart: ALT,
      measurements: { waistCm: 66, hipCm: 92, inseamCm: 76 },
    });

    expect(icBoysuz.kind).toBe('RECOMMENDATION');
    expect(icBoylu.kind).toBe('RECOMMENDATION');
    if (icBoysuz.kind !== 'RECOMMENDATION' || icBoylu.kind !== 'RECOMMENDATION') return;

    // Uzunluk skora girmediği için ÖNERİ aynı kalmalı.
    expect(icBoylu.recommendedSize).toBe(icBoysuz.recommendedSize);

    /**
     * ⚠️ İLK YAZIMDA `toBe(icBoysuz.confidence)` YAZMIŞTIM VE TEST KIRILDI —
     *    70 beklenirken 75 geldi. Test haklıydı, ben yanlıştım: aradaki 5
     *    puan `LENGTH_NOTE` cezasıdır (iç bacak boyu verilmediğinde güven
     *    düşüyor), skora karışan bir uzunluk değil.
     *
     *    Beklenti bu yüzden "eşit" değil "TAM 5 fark" — böylece uzunluk bir
     *    gün yanlışlıkla ortalamaya karışırsa fark 5 olmaktan çıkar ve test
     *    yakalar. "Eşit" yazsaydım cezayı da silmem gerekirdi ve gerçek
     *    korumayı kaybederdim.
     */
    expect(icBoylu.confidence - icBoysuz.confidence).toBe(5);
    expect(icBoysuz.reasons.map((r) => r.code)).toContain('LENGTH_NOTE');
    expect(icBoylu.reasons.map((r) => r.code)).not.toContain('LENGTH_NOTE');
  });

  it('yalnız iç bacak boyu verilirse ÖNERİ ÜRETİLMEZ', () => {
    // ⚠️ 3 cm'lik bir aralıktan beden çıkarmak gürültüden karar üretmektir.
    const sonuc = recommendSize({
      sizeChart: ALT,
      measurements: { inseamCm: 78 },
    });
    expect(sonuc.kind).toBe('CHART_ONLY');
  });

  it('yalnız boy/kilo verilirse HEIGHT_WEIGHT_ONLY döner, öneri dönmez', () => {
    const sonuc = recommendSize({
      sizeChart: UST,
      measurements: { heightCm: 172, weightKg: 68 },
    });
    expect(sonuc.kind).toBe('CHART_ONLY');
    expect(sonuc.reasons.map((r) => r.code)).toContain('HEIGHT_WEIGHT_ONLY');
  });

  it('çevre ölçüsü boydan büyükse güven düşer ve sebebi söylenir', () => {
    const normal = recommendSize({
      sizeChart: UST,
      measurements: { chestCm: 94, waistCm: 76, heightCm: 170 },
    });
    // 94 cm göğüs, 90 cm boy — geometrik olarak imkânsız (inç ↔ cm karışması).
    const imkansiz = recommendSize({
      sizeChart: UST,
      measurements: { chestCm: 94, waistCm: 76, heightCm: 90 },
    });

    expect(normal.kind).toBe('RECOMMENDATION');
    if (normal.kind !== 'RECOMMENDATION') return;
    expect(imkansiz.reasons.map((r) => r.code)).toContain('MEASUREMENT_IMPLAUSIBLE');
    if (imkansiz.kind === 'RECOMMENDATION') {
      // ⚠️ ÖNERİ DEĞİŞMEZ, yalnız güven düşer — model iddiası yok, veri uyarısı var.
      expect(imkansiz.recommendedSize).toBe(normal.recommendedSize);
      expect(imkansiz.confidence).toBeLessThan(normal.confidence);
    }
  });

  it('boy/kilo birlikte okunamıyorsa (BMI dışı) uyarır, öneriyi değiştirmez', () => {
    const normal = recommendSize({
      sizeChart: UST,
      measurements: { chestCm: 94, waistCm: 76, heightCm: 172, weightKg: 68 },
    });
    // 172 cm / 150 kg gerçek; 172 cm / 350 kg libre karışması (BMI ~118).
    const bozuk = recommendSize({
      sizeChart: UST,
      measurements: { chestCm: 94, waistCm: 76, heightCm: 172, weightKg: 350 },
    });

    if (normal.kind !== 'RECOMMENDATION' || bozuk.kind !== 'RECOMMENDATION') {
      throw new Error('iki çağrı da öneri döndürmeliydi');
    }
    expect(bozuk.reasons.map((r) => r.code)).toContain('HEIGHT_WEIGHT_IMPLAUSIBLE');
    expect(bozuk.recommendedSize).toBe(normal.recommendedSize);
    expect(bozuk.confidence).toBeLessThan(normal.confidence);
  });

  it('ürün uzunluk taşıyıp kullanıcı iç bacak boyu vermediyse LENGTH_NOTE düşer', () => {
    const sonuc = recommendSize({
      sizeChart: ALT,
      measurements: { waistCm: 76, hipCm: 102 },
    });
    expect(sonuc.reasons.map((r) => r.code)).toContain('LENGTH_NOTE');
  });

  it('üst giyimde LENGTH_NOTE DÜŞMEZ — o tabloda iç bacak boyu yok', () => {
    // ⚠️ `boy` sütunu var ama eşlenmemiş; uzunluk uyarısı yalnız EŞLENEN bir
    //    uzunluk boyutu varken anlamlı, yoksa her üst giyimde gürültü olurdu.
    const sonuc = recommendSize({
      sizeChart: UST,
      measurements: { chestCm: 94, waistCm: 76 },
    });
    expect(sonuc.reasons.map((r) => r.code)).not.toContain('LENGTH_NOTE');
  });
});
