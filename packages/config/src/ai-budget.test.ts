import { describe, expect, it } from 'vitest';
import { checkBudget, estimateCost, microToUsd, usdToMicro, type AiBudget } from './ai-budget.js';

const budget: AiBudget = {
  dailyPlatformUsd: 50,
  monthlyPlatformUsd: 1200,
  perUserDailyTryOn: 10,
  perGuestDailyTryOn: 2,
  perUserDailyStylistMessages: 30,
  perSellerMonthlyEnrich: 500,
  alertThresholds: [0.5, 0.8, 0.95],
  hardStopRatio: 1.0,
};

describe('mikro-dolar dönüşümü', () => {
  it('gidiş-dönüş kayıpsızdır', () => {
    expect(microToUsd(usdToMicro(0.06))).toBeCloseTo(0.06, 6);
  });
});

describe('checkBudget', () => {
  it('bütçe altındayken izin verir', () => {
    const d = checkBudget(budget, { todayMicroUsd: usdToMicro(10), thisMonthMicroUsd: usdToMicro(100) });
    expect(d.allowed).toBe(true);
    expect(d.allowed && d.warnAtRatio).toBeUndefined();
  });

  it('eşiği geçince izin verir ama uyarı döndürür', () => {
    const d = checkBudget(budget, { todayMicroUsd: usdToMicro(41), thisMonthMicroUsd: usdToMicro(100) });
    expect(d.allowed).toBe(true);
    expect(d.allowed && d.warnAtRatio).toBe(0.8);
  });

  it('en yüksek aşılan eşiği bildirir', () => {
    const d = checkBudget(budget, { todayMicroUsd: usdToMicro(48), thisMonthMicroUsd: usdToMicro(100) });
    expect(d.allowed && d.warnAtRatio).toBe(0.95);
  });

  it('günlük bütçe dolunca durdurur', () => {
    const d = checkBudget(budget, { todayMicroUsd: usdToMicro(50), thisMonthMicroUsd: usdToMicro(100) });
    expect(d).toEqual({ allowed: false, reason: 'DAILY_BUDGET' });
  });

  it('aylık bütçe dolunca durdurur', () => {
    const d = checkBudget(budget, { todayMicroUsd: usdToMicro(1), thisMonthMicroUsd: usdToMicro(1200) });
    expect(d).toEqual({ allowed: false, reason: 'MONTHLY_BUDGET' });
  });
});

describe('estimateCost', () => {
  it('adede göre ölçeklenir', () => {
    expect(estimateCost('TRYON', 10)).toBe(estimateCost('TRYON') * 10n);
  });

  it('try-on en pahalı özelliktir', () => {
    expect(estimateCost('TRYON')).toBeGreaterThan(estimateCost('STYLIST'));
    expect(estimateCost('TRYON')).toBeGreaterThan(estimateCost('EMBEDDING'));
  });
});
