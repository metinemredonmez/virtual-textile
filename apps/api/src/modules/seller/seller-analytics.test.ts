import { describe, expect, it } from 'vitest';
import {
  analyzeProductFunnels,
  analyzeSizeReturns,
  buildFunnel,
  DIRECTION_DOMINANCE_PCT,
  LOW_CONVERSION_PCT,
  MIN_RETURNS_FOR_SUGGESTION,
  MIN_TRYONS_FOR_INSIGHT,
  ratePct,
} from './seller-analytics.js';

describe('ratePct', () => {
  it('yüzdeyi iki ondalığa yuvarlar', () => {
    expect(ratePct(1, 3)).toBe(33.33);
    expect(ratePct(2, 3)).toBe(66.67);
  });

  /**
   * "Hiç deneme yapılmadı" ile "deneme yapıldı, satış yok" farklı gerçekler.
   * İkisi de %0 gösterilseydi satıcı yanlış yerde iyileştirme yapardı.
   */
  it('payda sıfırsa null döner, sıfır değil', () => {
    expect(ratePct(0, 0)).toBeNull();
    expect(ratePct(5, 0)).toBeNull();
    expect(ratePct(0, 10)).toBe(0);
  });
});

describe('buildFunnel', () => {
  it('try-on → sepet → satış adımlarını üretir', () => {
    const stages = buildFunnel({ tryOnCount: 200, cartAddCount: 50, purchasedCount: 10 });

    expect(stages.map((s) => s.key)).toEqual(['tryOn', 'cart', 'purchase']);
    expect(stages[1]?.stepRatePct).toBe(25);
    expect(stages[2]?.stepRatePct).toBe(20);
    expect(stages[2]?.overallRatePct).toBe(5);
  });

  /**
   * Adımlar hiyerarşik değil: denemeden de sepete eklenebilir. Sayı
   * kırpılsaydı "sanal deneme olmadan da satılıyor" sinyali kaybolurdu.
   */
  it('sepet sayısı denemeyi aşarsa oran %100 üstü kalır, kırpılmaz', () => {
    const stages = buildFunnel({ tryOnCount: 10, cartAddCount: 25, purchasedCount: 5 });

    expect(stages[1]?.count).toBe(25);
    expect(stages[1]?.stepRatePct).toBe(250);
  });

  it('hiç deneme yoksa oranlar null olur', () => {
    const stages = buildFunnel({ tryOnCount: 0, cartAddCount: 0, purchasedCount: 0 });

    expect(stages[0]?.overallRatePct).toBeNull();
    expect(stages[1]?.stepRatePct).toBeNull();
  });
});

describe('analyzeSizeReturns', () => {
  const row = (over: Partial<Parameters<typeof analyzeSizeReturns>[0][number]> = {}) => ({
    size: 'M',
    soldQuantity: 100,
    returnedQuantity: 20,
    tooSmallQuantity: 0,
    tooLargeQuantity: 0,
    ...over,
  });

  it('iade oranını hesaplar', () => {
    const [result] = analyzeSizeReturns([row()]);
    expect(result?.returnRatePct).toBe(20);
  });

  it('"küçük geldi" baskınsa dar kalıp önerir', () => {
    const [result] = analyzeSizeReturns([
      row({ returnedQuantity: 10, tooSmallQuantity: 8, tooLargeQuantity: 2 }),
    ]);

    expect(result?.suggestion).toBe('RUNS_SMALL');
    expect(result?.sizeRelatedRatePct).toBe(100);
  });

  it('"büyük geldi" baskınsa bol kalıp önerir', () => {
    const [result] = analyzeSizeReturns([
      row({ returnedQuantity: 10, tooSmallQuantity: 1, tooLargeQuantity: 9 }),
    ]);

    expect(result?.suggestion).toBe('RUNS_LARGE');
  });

  /** Az veriden kalıp çıkarımı satıcıyı yanlış yönlendirir. */
  it('eşik altındaki iade sayısında öneri üretilmez', () => {
    const [result] = analyzeSizeReturns([
      row({
        returnedQuantity: MIN_RETURNS_FOR_SUGGESTION - 1,
        tooSmallQuantity: MIN_RETURNS_FOR_SUGGESTION - 1,
      }),
    ]);

    expect(result?.suggestion).toBeNull();
  });

  it('yön baskın değilse öneri üretilmez', () => {
    const [result] = analyzeSizeReturns([
      row({ returnedQuantity: 10, tooSmallQuantity: 5, tooLargeQuantity: 5 }),
    ]);

    expect(result?.suggestion).toBeNull();
  });

  it('baskınlık eşiği tam karşılanırsa öneri üretilir', () => {
    // 6/10 = %60 = DIRECTION_DOMINANCE_PCT
    const [result] = analyzeSizeReturns([
      row({ returnedQuantity: 10, tooSmallQuantity: 6, tooLargeQuantity: 4 }),
    ]);

    expect(DIRECTION_DOMINANCE_PCT).toBe(60);
    expect(result?.suggestion).toBe('RUNS_SMALL');
  });

  it('hiç satış yoksa iade oranı null olur', () => {
    const [result] = analyzeSizeReturns([row({ soldQuantity: 0, returnedQuantity: 0 })]);
    expect(result?.returnRatePct).toBeNull();
  });
});

describe('analyzeProductFunnels', () => {
  const product = (over: Partial<Parameters<typeof analyzeProductFunnels>[0][number]> = {}) => ({
    productId: 'p-1',
    title: 'Oversize Gömlek',
    tryOnScore: 72,
    tryOnCount: 100,
    cartAddCount: 30,
    purchasedCount: 9,
    ...over,
  });

  it('ürün bazlı oranları hesaplar', () => {
    const [result] = analyzeProductFunnels([product()]);

    expect(result?.tryOnToCartPct).toBe(30);
    expect(result?.cartToPurchasePct).toBe(30);
    expect(result?.tryOnToPurchasePct).toBe(9);
  });

  it('çok denenip az sepete eklenen ürünü işaretler', () => {
    const [result] = analyzeProductFunnels([product({ tryOnCount: 500, cartAddCount: 20 })]);

    expect(result?.tryOnToCartPct).toBe(4);
    expect(result?.highInterestLowConversion).toBe(true);
  });

  it('deneme sayısı anlamsızsa işaretlemez', () => {
    const [result] = analyzeProductFunnels([
      product({ tryOnCount: MIN_TRYONS_FOR_INSIGHT - 1, cartAddCount: 0 }),
    ]);

    expect(result?.highInterestLowConversion).toBe(false);
  });

  it('dönüşüm eşiğin üstündeyse işaretlemez', () => {
    const [result] = analyzeProductFunnels([
      product({ tryOnCount: 100, cartAddCount: LOW_CONVERSION_PCT + 1 }),
    ]);

    expect(result?.highInterestLowConversion).toBe(false);
  });
});
