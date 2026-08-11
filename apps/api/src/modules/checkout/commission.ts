import { FINANCE, ORDER } from '@vt/config';
import { AppError, Money, type BasisPoints } from '@vt/contracts';
import { ledgerBalanceMinor, type LedgerEntryDraft } from '../order/index.js';
import { SHIPPING } from './checkout.constants.js';

/**
 * KOMİSYON VE DEFTER HESABI — SAF FONKSİYONLAR
 *
 * Buradaki hiçbir fonksiyon veritabanına, saate veya isteğe dokunmaz.
 * Nedeni pratik: para hesabının doğruluğu bir entegrasyon testine değil,
 * hızlı ve eksiksiz bir birim testine bağlı olmalı. Yanlış hesaplanan bir
 * kuruş mutabakatı bozar ve haftalar sonra fark edilir.
 */

const TRY = 'TRY' as const;

export interface CommissionRuleSnapshot {
  /** ⚠️ Sipariş kalemine YAZILIR. Kural sonradan değişse bile bu sipariş bozulmaz. */
  versionId: string;
  /** 1250 = %12,50 */
  rateBps: BasisPoints;
  fixedFeeMinor: bigint;
}

export interface CommissionResult {
  commissionRuleVersionId: string;
  commissionRateBps: BasisPoints;
  commissionAmountMinor: bigint;
  /** Satıcının bu kalemden hakedişi. */
  sellerNetMinor: bigint;
}

/**
 * Kalem komisyonu.
 *
 * ⚠️ Yuvarlama `Money.applyBps` ile YARIM YUKARI yapılır; kendi başımıza
 *    `Math.round` yapmıyoruz çünkü float'a çevirmek 1 kuruşluk sapma üretir
 *    ve bu sapma her siparişte tekrarlanınca mutabakat açığı olur.
 *
 * ⚠️ Komisyon kalem tutarını AŞAMAZ. Sabit ücret küçük tutarlı bir kalemi
 *    aştığında satıcı platforma BORÇLANIRDI; bu ne sözleşmede vardır ne de
 *    defterde temsil edilebilir. Bu yüzden tavana kırpılır.
 */
export function calculateCommission(
  lineTotalMinor: bigint,
  rule: CommissionRuleSnapshot,
): CommissionResult {
  if (lineTotalMinor < 0n) {
    throw new AppError('PAYMENT_AMOUNT_MISMATCH', {
      internalMessage: `Negatif kalem tutarı: ${lineTotalMinor}`,
    });
  }

  // Admin arayüzü de kontrol eder ama savunma burada da olmalı: bozuk bir
  // kural kaydı satıcının cirosunun tamamını platforma aktarabilir.
  if (!Number.isInteger(rule.rateBps) || rule.rateBps < 0) {
    throw new AppError('COMMISSION_RULE_NOT_FOUND', {
      internalMessage: `Geçersiz komisyon oranı: ${rule.rateBps} bps (versiyon ${rule.versionId})`,
    });
  }
  if (rule.rateBps > FINANCE.maxCommissionBps) {
    throw new AppError('COMMISSION_RULE_NOT_FOUND', {
      internalMessage: `Komisyon oranı tavanı aşıyor: ${rule.rateBps} bps > ${FINANCE.maxCommissionBps} bps (versiyon ${rule.versionId})`,
    });
  }
  if (rule.fixedFeeMinor < 0n) {
    throw new AppError('COMMISSION_RULE_NOT_FOUND', {
      internalMessage: `Negatif sabit ücret: ${rule.fixedFeeMinor} (versiyon ${rule.versionId})`,
    });
  }

  const proportional = Money.applyBps({ amountMinor: lineTotalMinor, currency: TRY }, rule.rateBps);
  const raw = proportional.result.amountMinor + rule.fixedFeeMinor;
  const commissionAmountMinor = raw > lineTotalMinor ? lineTotalMinor : raw;

  return {
    commissionRuleVersionId: rule.versionId,
    commissionRateBps: rule.rateBps,
    commissionAmountMinor,
    sellerNetMinor: lineTotalMinor - commissionAmountMinor,
  };
}

// ── Defter (ledger) ───────────────────────────────────────────────────────
//
// ⚠️ Defter satırlarını checkout ÜRETMEZ. Sipariş modülü `buildSaleLedgerEntries`
// ile satış kayıtlarının tek kaynağıdır (SALE / COMMISSION / SHIPPING_SHARE) ve
// iade ters kayıtları (`computeReturnReversal`) tam olarak onun aynasıdır.
// Burada ikinci bir üretici yazılsaydı, iki taraf zamanla ayrışır ve tam iadede
// satıcı bakiyesi sıfırlanmazdı. Checkout yalnızca DENGEYİ doğrular.

/**
 * Yazmadan ÖNCE mutabakat kontrolü.
 *
 * Defter append-only'dir: yanlış yazılan satır düzeltilemez, ancak ters
 * kayıtla telafi edilir. Bu yüzden hata veritabanına ULAŞMADAN yakalanır.
 */
export function assertLedgerBalanced(
  entries: readonly LedgerEntryDraft[],
  expectedNetMinor: bigint,
): void {
  const actual = ledgerBalanceMinor(entries);
  if (actual !== expectedNetMinor) {
    throw new AppError('PAYMENT_AMOUNT_MISMATCH', {
      internalMessage: `Defter dengesiz: beklenen ${expectedNetMinor}, hesaplanan ${actual}`,
    });
  }
}

// ── Hakedişin ödenebilir olma tarihi ──────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Teslim + iade penceresi.
 *
 * ⚠️ Hakediş teslimden HEMEN sonra ödenirse ve müşteri iade ederse parayı
 *    satıcıdan geri tahsil etmemiz gerekir; pratikte bu çoğu zaman mümkün
 *    olmaz. Bu yüzden iade penceresi kapanmadan hiçbir kuruş ödenebilir
 *    sayılmaz.
 */
export function payoutAvailableAt(deliveredAt: Date): Date {
  return new Date(deliveredAt.getTime() + FINANCE.payoutEligibleAfterDays * DAY_MS);
}

/**
 * Ödeme anında teslim tarihi HENÜZ BİLİNMİYOR; tahmin edilir.
 *
 * ⚠️ Bu bir TAHMİNDİR ve gerçek teslimat gerçekleştiğinde
 *    `LedgerEntry.availableAt` yeniden hesaplanmalıdır (sipariş modülünün
 *    `package.delivered` işleyicisi). Tahmin gerçekten kısa tutulursa
 *    hakediş erken ödenir; bu yüzden hazırlık SLA'sı + kargo süresi de
 *    hesaba katılır.
 */
export function estimatedDeliveryAt(paidAt: Date): Date {
  return new Date(
    paidAt.getTime() +
      ORDER.sellerPreparationSlaHours * HOUR_MS +
      SHIPPING.estimatedTransitDays * DAY_MS,
  );
}

export function estimatedPayoutAvailableAt(paidAt: Date): Date {
  return payoutAvailableAt(estimatedDeliveryAt(paidAt));
}

/** Satıcının kargoya verme son tarihi. */
export function preparationDeadline(from: Date): Date {
  return new Date(from.getTime() + ORDER.sellerPreparationSlaHours * HOUR_MS);
}

// ── Kargo ─────────────────────────────────────────────────────────────────

/**
 * Paket (satıcı) başına kargo ücreti.
 *
 * Eşik SİPARİŞ değil PAKET bazındadır: üç satıcıdan alışveriş üç ayrı kargo
 * demektir ve maliyet üç kez doğar. Sipariş toplamına bakıp tek kargo bedava
 * saymak, çok satıcılı sepette platformun zararına çalışır.
 */
export function packageShippingMinor(packageItemsTotalMinor: bigint): bigint {
  return packageItemsTotalMinor >= SHIPPING.freeShippingThresholdMinor
    ? 0n
    : SHIPPING.flatFeePerSellerMinor;
}

export interface PackageTotals {
  itemsTotalMinor: bigint;
  shippingMinor: bigint;
  discountShareMinor: bigint;
}

export interface OrderTotals {
  itemsTotalMinor: bigint;
  shippingTotalMinor: bigint;
  discountMinor: bigint;
  grandTotalMinor: bigint;
}

/** Sipariş toplamı = paketlerin toplamı. Tek yerde hesaplanır ki iki yer ayrışmasın. */
export function summarizeOrder(packages: readonly PackageTotals[]): OrderTotals {
  const itemsTotalMinor = packages.reduce((sum, p) => sum + p.itemsTotalMinor, 0n);
  const shippingTotalMinor = packages.reduce((sum, p) => sum + p.shippingMinor, 0n);
  const discountMinor = packages.reduce((sum, p) => sum + p.discountShareMinor, 0n);

  const grandTotalMinor = itemsTotalMinor + shippingTotalMinor - discountMinor;
  if (grandTotalMinor < 0n) {
    throw new AppError('PAYMENT_AMOUNT_MISMATCH', {
      internalMessage: `İndirim sipariş tutarını aşıyor: ${discountMinor} > ${itemsTotalMinor + shippingTotalMinor}`,
    });
  }

  return { itemsTotalMinor, shippingTotalMinor, discountMinor, grandTotalMinor };
}

/**
 * Kargo bedelinin ödeme sağlayıcısına nasıl bildirileceği.
 *
 * Sağlayıcı sepet kalemlerinin toplamının ödenen tutara EŞİT olmasını ister;
 * kargo ayrı bir kalem değildir. Bu yüzden kargo, paketin ilk kalemine
 * eklenir ve AYNI tutar o kalemin komisyonuna da eklenir — böylece satıcıya
 * giden `subMerchantPrice` değişmez, kargo bedeli platformda kalır.
 *
 * ⚠️ Bu düzeltme yapılmazsa kargo bedeli satıcıya ödenir ve platform her
 *    siparişte kargo tutarı kadar zarar eder.
 */
export function foldShippingIntoFirstItem<
  T extends { amountMinor: bigint; commissionMinor: bigint },
>(items: readonly T[], shippingMinor: bigint): T[] {
  if (items.length === 0 || shippingMinor === 0n) return [...items];
  const [first, ...rest] = items as readonly [T, ...T[]];
  return [
    {
      ...first,
      amountMinor: first.amountMinor + shippingMinor,
      commissionMinor: first.commissionMinor + shippingMinor,
    },
    ...rest,
  ];
}
