import type { Env } from './env.js';

/**
 * AI MALİYET GUARDRAIL'LERİ
 *
 * Sanal deneme, klasik e-ticaretten farklı olarak **işlem başına değişken maliyet**
 * taşır. Tek seferlik geliştirme bedeli değil, süregelen bir işletme gideridir.
 *
 * Buradaki tavan aşıldığında AI özellikleri kapanır — ama ticaret akışı
 * ETKİLENMEZ. Kullanıcı yine gezinir, sepete atar, satın alır.
 */

export type AiFeature =
  'TRYON' | 'STYLIST' | 'TAGGING' | 'DESCRIPTION' | 'EMBEDDING' | 'MODERATION';

export interface AiBudget {
  dailyPlatformUsd: number;
  monthlyPlatformUsd: number;
  perUserDailyTryOn: number;
  perGuestDailyTryOn: number;
  perUserDailyStylistMessages: number;
  perSellerMonthlyEnrich: number;
  /** Bu oranlara ulaşınca e-posta + Slack uyarısı gider. */
  alertThresholds: readonly number[];
  /** 1.0 = bütçe dolduğunda AI özellikleri tamamen kapanır. */
  hardStopRatio: number;
}

export function aiBudgetFromEnv(env: Env): AiBudget {
  return {
    dailyPlatformUsd: env.AI_DAILY_BUDGET_USD,
    monthlyPlatformUsd: env.AI_MONTHLY_BUDGET_USD,
    perUserDailyTryOn: env.AI_TRYON_DAILY_PER_USER,
    perGuestDailyTryOn: env.AI_TRYON_DAILY_PER_GUEST,
    perUserDailyStylistMessages: env.AI_STYLIST_DAILY_PER_USER,
    perSellerMonthlyEnrich: 500,
    alertThresholds: [0.5, 0.8, 0.95],
    hardStopRatio: 1.0,
  };
}

/**
 * Maliyetler mikro-dolar (1e-6 USD) cinsinden bigint olarak tutulur.
 * Kuruş mantığının aynısı: kayan noktalı sayı kullanılmaz.
 */
export const MICRO_USD = 1_000_000n;

export function usdToMicro(usd: number): bigint {
  return BigInt(Math.round(usd * 1_000_000));
}

export function microToUsd(micro: bigint): number {
  return Number(micro) / 1_000_000;
}

export type BudgetDecision =
  | { allowed: true; warnAtRatio?: number }
  | { allowed: false; reason: 'DAILY_BUDGET' | 'MONTHLY_BUDGET' };

/**
 * Bir AI çağrısına izin verilip verilmeyeceğine karar verir.
 * Çağrı YAPILMADAN ÖNCE sorulur — sonrasında sorulursa para zaten harcanmıştır.
 */
export function checkBudget(
  budget: AiBudget,
  spent: { todayMicroUsd: bigint; thisMonthMicroUsd: bigint },
): BudgetDecision {
  const dailyLimit = usdToMicro(budget.dailyPlatformUsd * budget.hardStopRatio);
  const monthlyLimit = usdToMicro(budget.monthlyPlatformUsd * budget.hardStopRatio);

  if (spent.todayMicroUsd >= dailyLimit) return { allowed: false, reason: 'DAILY_BUDGET' };
  if (spent.thisMonthMicroUsd >= monthlyLimit) return { allowed: false, reason: 'MONTHLY_BUDGET' };

  const dailyRatio = Number(spent.todayMicroUsd) / Number(usdToMicro(budget.dailyPlatformUsd));
  const crossed = [...budget.alertThresholds].reverse().find((t) => dailyRatio >= t);

  return crossed === undefined ? { allowed: true } : { allowed: true, warnAtRatio: crossed };
}

/**
 * Sağlayıcı fiyat tablosu — maliyet TAHMİNİ için.
 *
 * ⚠️ Gerçek maliyet her zaman sağlayıcının döndürdüğü değerden yazılır;
 * bu tablo yalnızca ön kontrol ve bütçe projeksiyonu içindir.
 * Fiyatlar değişir — `docs/ai-costs.md` ile birlikte güncel tutulmalıdır.
 */
export const ESTIMATED_UNIT_COST_MICRO_USD: Record<AiFeature, bigint> = {
  TRYON: 60_000n, // ~$0,06 / üretim
  STYLIST: 8_000n, // ~$0,008 / mesaj turu
  TAGGING: 1_500n, // ~$0,0015 / ürün
  DESCRIPTION: 2_000n,
  EMBEDDING: 200n,
  MODERATION: 500n,
};

export function estimateCost(feature: AiFeature, units = 1): bigint {
  return ESTIMATED_UNIT_COST_MICRO_USD[feature] * BigInt(units);
}
