import { describe, expect, it } from 'vitest';
import { SIZE_ENGINE } from '@vt/config';
import {
  evaluateBrandFitSignal,
  evaluateFitSignal,
  evidenceWeight,
  FIT_SIGNAL_TUNING,
  personalWeight,
  resolveUserSizeEvidence,
  verdictToBrandFit,
  wilsonLowerBound,
  type BrandFitSignal,
  type FitFeedbackSummary,
} from './fit-learning.js';

const MIN = SIZE_ENGINE.minFeedbackCountToUse;
const BRAND_MIN = MIN * FIT_SIGNAL_TUNING.brandThresholdMultiplier;

function summary(tooSmall: number, trueToSize: number, tooLarge: number): FitFeedbackSummary {
  return { tooSmall, trueToSize, tooLarge };
}

describe('evidenceWeight — kanıt veri miktarıyla ölçeklenir', () => {
  it('eşik altında SIFIR döner, kısmi ağırlık değil', () => {
    // ⚠️ Eşiğin anlamı budur: o veri yok sayılır. "Az veriyi az kullanalım"
    // demek, üç kişinin gürültüsünü öneriye sızdırmaktır.
    expect(evidenceWeight(0, MIN)).toBe(0);
    expect(evidenceWeight(MIN - 1, MIN)).toBe(0);
  });

  it('eşiği yeni geçen veri yarım ağırlık alır', () => {
    expect(evidenceWeight(MIN, MIN)).toBeCloseTo(0.5, 6);
  });

  it('veri arttıkça ağırlık artar', () => {
    const few = evidenceWeight(MIN, MIN);
    const some = evidenceWeight(MIN * 4, MIN);
    const many = evidenceWeight(MIN * 20, MIN);

    expect(some).toBeGreaterThan(few);
    expect(many).toBeGreaterThan(some);
  });

  it('ne kadar veri olursa olsun 1e ULAŞMAZ — kesinlik iddia edilemez', () => {
    expect(evidenceWeight(1_000_000, MIN)).toBeLessThan(1);
  });
});

describe('wilsonLowerBound — küçük örneklem cezalandırılır', () => {
  it('aynı oranda daha az veri daha düşük alt sınır verir', () => {
    // Her ikisi de %100 "küçük geldi" diyor; fark yalnızca kaç kişinin dediği.
    expect(wilsonLowerBound(5, 5)).toBeLessThan(wilsonLowerBound(50, 50));
  });

  it('veri yoksa 0 döner', () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
  });

  it('nokta tahminin ALTINDA kalır', () => {
    expect(wilsonLowerBound(30, 50)).toBeLessThan(30 / 50);
  });
});

describe('evaluateFitSignal — eşik altı veri KULLANILMAZ', () => {
  it('eşiğin altındaki veri ne yön ne ağırlık üretir', () => {
    const verdict = evaluateFitSignal(summary(MIN - 1, 0, 0));

    expect(verdict.kind).toBe('INSUFFICIENT');
    expect(verdict.weight).toBe(0);
  });

  it('geri bildirim hiç yoksa da eşik altıdır', () => {
    expect(evaluateFitSignal(summary(0, 0, 0)).kind).toBe('INSUFFICIENT');
  });

  it('eşiğin tam üstündeki oybirliği kullanılır', () => {
    const verdict = evaluateFitSignal(summary(MIN, 0, 0));

    expect(verdict.kind).toBe('RUNS_SMALL');
    expect(verdict.weight).toBeGreaterThan(0);
  });
});

describe('evaluateFitSignal — aynı ORAN, farklı VERİ MİKTARI', () => {
  it('zayıf çoğunluk az veriyle yön üretmez, çok veriyle üretir', () => {
    // ⚠️ Bu testin tamamı bu görevin özüdür: iki girdide de alıcıların %60'ı
    //    "küçük geldi" diyor. Beşinin görüşü örneklem gürültüsünden
    //    ayrılamaz; ellinin görüşü ayrılır.
    const thin = evaluateFitSignal(summary(3, 2, 0));
    const thick = evaluateFitSignal(summary(30, 20, 0));

    expect(thin.kind).not.toBe('RUNS_SMALL');
    expect(thick.kind).toBe('RUNS_SMALL');
  });

  it('aynı oranda daha çok veri daha yüksek ağırlık verir', () => {
    const few = evaluateFitSignal(summary(MIN, 0, 0));
    const many = evaluateFitSignal(summary(MIN * 10, 0, 0));

    expect(many.weight).toBeGreaterThan(few.weight);
    expect(many.kind).toBe(few.kind);
  });
});

describe('evaluateFitSignal — yön ve çelişki', () => {
  it('"büyük geliyor" baskınsa aşağı yön verir', () => {
    expect(evaluateFitSignal(summary(0, 0, MIN)).kind).toBe('RUNS_LARGE');
  });

  it('bedeni doğru bulanlar baskınsa TRUE_TO_SIZE der', () => {
    expect(evaluateFitSignal(summary(1, 8, 1)).kind).toBe('TRUE_TO_SIZE');
  });

  it('eşit bölünmüş geri bildirim İKİ yöne birden kaymaz', () => {
    // Eşit sayıda "küçük" ve "büyük": yön yok. Yön karşılaştırması olmasaydı
    // her iki kaydırma koşulu da sağlanabilirdi.
    const verdict = evaluateFitSignal(summary(10, 0, 10));

    expect(verdict.kind).toBe('CONFLICTING');
  });

  it('çelişkili veri de ağırlık taşır — bilgi ATILMAZ', () => {
    // Tutarsız beden gerçekten daha riskli bir alışveriştir; motor bunu
    // güveni düşürerek kullanır.
    expect(evaluateFitSignal(summary(10, 0, 10)).weight).toBeGreaterThan(0);
  });
});

describe('evaluateBrandFitSignal — marka için kapı daha dar', () => {
  const runsSmall = (count: number, distinctProducts: number): BrandFitSignal => ({
    summary: summary(count, 0, 0),
    distinctProducts,
  });

  it('tek üründen gelen yığın veri marka eğilimi SAYILMAZ', () => {
    // ⚠️ Kötü kalıplanmış tek bir ürünün 100 şikâyeti, markanın diğer 200
    //    ürünü hakkında hiçbir şey söylemez.
    const verdict = evaluateBrandFitSignal(runsSmall(100, 1));

    expect(verdict.kind).toBe('INSUFFICIENT');
    expect(verdict.weight).toBe(0);
  });

  it('ürün eşiğini geçen veri marka eşiğini geçmeye yetmez', () => {
    const productLevel = evaluateFitSignal(summary(MIN, 0, 0));
    const brandLevel = evaluateBrandFitSignal(
      runsSmall(MIN, FIT_SIGNAL_TUNING.minDistinctProductsForBrand),
    );

    expect(productLevel.kind).toBe('RUNS_SMALL');
    expect(brandLevel.kind).toBe('INSUFFICIENT');
  });

  it('yeterli ürüne yayılmış yeterli veri marka eğilimi üretir', () => {
    const verdict = evaluateBrandFitSignal(
      runsSmall(BRAND_MIN, FIT_SIGNAL_TUNING.minDistinctProductsForBrand),
    );

    expect(verdict.kind).toBe('RUNS_SMALL');
    expect(verdict.weight).toBeGreaterThan(0);
  });

  it('marka ağırlığı da veri miktarıyla ölçeklenir', () => {
    const few = evaluateBrandFitSignal(runsSmall(BRAND_MIN, 3));
    const many = evaluateBrandFitSignal(runsSmall(BRAND_MIN * 10, 12));

    expect(many.weight).toBeGreaterThan(few.weight);
  });
});

describe('verdictToBrandFit', () => {
  it('yönü kalıba çevirir — öğrenilen sinyal beyanla aynı mekanizmayı kullanır', () => {
    expect(verdictToBrandFit('RUNS_SMALL')).toBe('SLIM');
    expect(verdictToBrandFit('RUNS_LARGE')).toBe('OVERSIZE');
    expect(verdictToBrandFit('TRUE_TO_SIZE')).toBe('REGULAR');
  });

  it('bilgisizlik REGULAR değil null ile ifade edilir', () => {
    // REGULAR bir BİLGİDİR ("bedenler doğru"); null bilgisizliktir.
    expect(verdictToBrandFit('INSUFFICIENT')).toBeNull();
    expect(verdictToBrandFit('CONFLICTING')).toBeNull();
  });
});

describe('resolveUserSizeEvidence — kişisel çelişkiler ayıklanır', () => {
  it('hem tutulmuş hem beden yüzünden iade edilmiş beden "tutuldu" sayılmaz', () => {
    const evidence = resolveUserSizeEvidence({
      keptSizesForProduct: ['M', 'L'],
      keptSizesForBrand: [],
      returnedSizesForProduct: [{ size: 'M', direction: 'TOO_SMALL' }],
    });

    expect(evidence.keptForProduct).toEqual(['L']);
    expect(evidence.hasContradiction).toBe(true);
  });

  it('çelişki yoksa liste olduğu gibi kalır', () => {
    const evidence = resolveUserSizeEvidence({
      keptSizesForProduct: ['L'],
      keptSizesForBrand: ['M'],
      returnedSizesForProduct: [],
    });

    expect(evidence.keptForProduct).toEqual(['L']);
    expect(evidence.hasContradiction).toBe(false);
  });
});

describe('personalWeight — kendi geçmişine ürün eşiği uygulanmaz', () => {
  it('tek gözlem kanıt sayılır ama yarım ağırlıkta kalır', () => {
    // ⚠️ `minFeedbackCountToUse` YABANCILARIN gürültüsüne karşıdır.
    //    Kullanıcının kendi tuttuğu giysi gürültü değil, ölçümdür.
    expect(personalWeight(1)).toBeCloseTo(0.5, 6);
  });

  it('tekrar eden gözlem ağırlığı artırır', () => {
    expect(personalWeight(3)).toBeGreaterThan(personalWeight(1));
  });

  it('gözlem yoksa sıfırdır', () => {
    expect(personalWeight(0)).toBe(0);
  });
});
