import type { CostMetering } from './ai-cost.js';
import type { TryOnFailure, TryOnSuccess } from './tryon.provider.js';

/**
 * `TryOnResult`in ölçüm bilgisiyle genişletilmiş hâli.
 *
 * Arayüzdeki `costMicroUsd` tek bir sayıdır ve "gerçek maliyet" olarak
 * belgelenmiştir. Sağlayıcılar bunu her zaman bildirmediği için oraya bazen
 * tahmin yazmak zorundayız; hangisinin yazıldığını bu genişletme taşır.
 * Uygulama katmanı `TryOnResult` ile çalışmaya devam edebilir — ölçüm alanları
 * yalnızca finans/mutabakat tarafının ilgilendiği ek bilgidir.
 */
export type MeteredTryOnSuccess = TryOnSuccess & CostMetering;
export type MeteredTryOnFailure = TryOnFailure & CostMetering;
export type MeteredTryOnResult = MeteredTryOnSuccess | MeteredTryOnFailure;
