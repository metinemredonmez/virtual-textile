import type { CircuitBreaker } from '../../resilience/circuit-breaker.js';

/**
 * iyzico ADAPTER YAPILANDIRMASI
 *
 * ⚠️ SDK (`iyzipay` paketi) BİLEREK KULLANILMIYOR. Gerekçe:
 *  - SDK callback tabanlıdır; `resilient()` sarmalayıcımızın zaman aşımı ve
 *    devre kesicisiyle uyumlu değildir.
 *  - Webhook doğrulaması için HAM gövdeye ihtiyacımız var; SDK gövdeyi
 *    kendisi parse eder ve imzayı doğrulanamaz hâle getirir.
 *  - Tek bir bağımlılık daha, tedarik zinciri riskinin karşılığını vermiyor.
 * Bunun yerine düz `fetch` + `node:crypto` kullanılıyor.
 */
export interface IyzicoConfig {
  /** https://sandbox-api.iyzipay.com veya https://api.iyzipay.com */
  baseUrl: string;
  apiKey: string;
  secretKey: string;
  /** Webhook HMAC anahtarı — API secret'tan AYRIDIR. */
  webhookSecret: string;

  /** Test ve ölçüm için enjekte edilebilir. */
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  /** Sağlayıcı başına tek devre — çağıran taraf `circuitFor('iyzico')` verir. */
  circuitBreaker?: CircuitBreaker;
}

/**
 * iyzico uç noktaları.
 *
 * Sabit olarak tutulmalarının nedeni: yol (path) imzanın İÇİNE giriyor
 * (bkz. iyzico.signature.ts). Yolu çağrı yerinde string olarak yazmak,
 * imzayı sessizce bozan bir yazım hatasına davetiyedir.
 */
export const IYZICO_PATH = {
  threeDsInitialize: '/payment/3dsecure/initialize',
  threeDsAuth: '/payment/3dsecure/auth',
  paymentDetail: '/payment/detail',
  refund: '/payment/refund',
  submerchant: '/onboarding/submerchant',
  /**
   * Pazaryeri hakedişi normalde iyzico tarafında OTOMATİK ödenir; bu uç,
   * bekletilen (`APPROVAL_PENDING`) kalemleri onaylayarak ödemeyi tetikler.
   */
  settlementApprove: '/payment/iyzipos/settlement/approve',
} as const;

/** iyzico her yanıtta bu zarfı döner. */
export interface IyzicoEnvelope {
  status?: 'success' | 'failure';
  errorCode?: string;
  errorMessage?: string;
  errorGroup?: string;
  locale?: string;
  systemTime?: number;
  conversationId?: string;
  [key: string]: unknown;
}

export const IYZICO_LOCALE = 'tr';
