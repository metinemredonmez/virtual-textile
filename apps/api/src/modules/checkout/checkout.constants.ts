/**
 * CHECKOUT SABİTLERİ
 *
 * ⚠️ TODO(config-gerekli): Bunlar ürün kararıdır, teknik detay değil ve
 * `@vt/config/constants.ts` içindeki `SHIPPING` bloğuna taşınmalıdır. Şu an
 * burada duruyorlar çünkü `packages/config` başka bir ajanın çalışma alanında;
 * aynı dosyaya iki taraftan yazmak çakışma üretir. Taşındığında bu dosya
 * silinir ve import tek satırda değişir.
 */
export const SHIPPING = {
  /** Satıcı BAŞINA sabit kargo ücreti (kuruş) — 49,90 ₺ */
  flatFeePerSellerMinor: 4_990n,
  /**
   * Paket tutarı bunu aşarsa kargo bedava (kuruş) — 500,00 ₺
   * Eşik SİPARİŞ değil PAKET bazındadır: kargoyu her satıcı ayrı gönderir,
   * maliyet de ayrı doğar.
   */
  freeShippingThresholdMinor: 50_000n,
  /** Kargoda geçen tahmini süre — hakedişin ne zaman ödenebilir olacağını kestirmek için. */
  estimatedTransitDays: 3,
} as const;

/** Sipariş numarası biçimi: VT-260811-4K7Q */
export const ORDER_NUMBER_PREFIX = 'VT';

/**
 * Sipariş numarası çakışırsa kaç kez yeniden denenir.
 * Rastgele son ek 36^4 ≈ 1,7 milyon olasılık; günlük hacimde çakışma
 * pratikte imkânsız, yine de sessizce 500 dönmemek için tekrar denenir.
 */
export const ORDER_NUMBER_MAX_ATTEMPTS = 5;
