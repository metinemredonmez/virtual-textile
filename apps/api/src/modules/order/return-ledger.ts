/**
 * İADE TERS KAYITLARI — saf para hesabı.
 *
 * Satış anında satıcı defterine üç kayıt düşer:
 *   SALE            (+) satış tutarı
 *   COMMISSION      (−) platform komisyonu
 *   SHIPPING_SHARE  (−) satıcıya düşen kargo payı
 * Toplamı = OrderItem.sellerNetMinor.
 *
 * İade onaylandığında bunların AYNADAKİ karşılıkları yazılır:
 *   REFUND              (−)
 *   COMMISSION_REVERSAL (+)
 *   SHIPPING_REVERSAL   (+)
 *
 * ⚠️ Satıcı bakiyesi ayrı kolonda tutulmaz, SUM(amountMinor) ile hesaplanır
 *    (bkz. packages/db/src/index.ts → getSellerBalanceMinor). Bu yüzden tam
 *    iadede ters kayıtların toplamı satış kayıtlarını KURUŞU KURUŞUNA
 *    sıfırlamak zorundadır; 1 kuruşluk sapma mutabakatı bozar ve payout'ta
 *    satıcıya eksik/fazla ödeme yapılır.
 */
import { Money, appError } from '@vt/contracts';
import type { LedgerType } from '@vt/db';

export interface LedgerEntryDraft {
  readonly sellerId: string;
  readonly orderItemId: string;
  readonly type: LedgerType;
  /** + alacak, − borç. Kuruş. */
  readonly amountMinor: bigint;
  readonly description: string;
  /** Hakedişin ödenebilir hâle geldiği tarih. Ters kayıtlarda anlamsızdır. */
  readonly availableAt?: Date | null;
}

/** Satış anındaki kalem — hem satış hem iade hesabının girdisi. */
export interface OrderItemMoneySnapshot {
  readonly orderItemId: string;
  readonly sellerId: string;
  /** Sipariş edilen toplam adet. */
  readonly quantity: number;
  readonly lineTotalMinor: bigint;
  readonly commissionAmountMinor: bigint;
  /** lineTotal − komisyon − kargo payı. */
  readonly sellerNetMinor: bigint;
  /** İnsan tarafından okunacak açıklama için. */
  readonly label?: string;
}

export interface ReturnLine extends OrderItemMoneySnapshot {
  /** Bu iadeden ÖNCE kapanmış iadelerde geri alınan adet. */
  readonly alreadyReturnedQuantity: number;
  /** Bu iadede geri alınan adet. */
  readonly returnQuantity: number;
  /**
   * Kalemin sepet/kupon indiriminden aldığı pay (pozitif, kuruş).
   * Müşteriye geri ödenecek tutar bu kadar AZALIR — müşteri o parayı hiç
   * ödemedi. Satıcı defterine etkisi yoktur: satış kaydı brüt tutarla
   * düşmüştür, ters kaydı da brüt tutarla düşmelidir.
   */
  readonly discountShareMinor?: bigint;
}

export interface ReturnLineResult {
  readonly orderItemId: string;
  /** ReturnItem.refundMinor — müşteriye ödenecek net tutar. */
  readonly customerRefundMinor: bigint;
  /** Satıcı defterine net etki (negatif) — tam iadede −sellerNet. */
  readonly sellerNetImpactMinor: bigint;
}

export interface ReturnReversalDraft {
  readonly entries: readonly LedgerEntryDraft[];
  readonly perItem: readonly ReturnLineResult[];
  /** ReturnRequest.refundAmountMinor — müşteriye ödenecek toplam. */
  readonly customerRefundMinor: bigint;
  /** Satıcı bakiyesine toplam etki. */
  readonly sellerNetImpactMinor: bigint;
}

/**
 * Bir tutarı adet başına, KURUŞ KAYBI OLMADAN böler.
 *
 * Neden orantı çarpımı değil de birim birim dağıtım: 3 adetlik 1000 kuruşluk
 * bir kalemden 1 adet iade edilirse orantı 333,33 kuruş verir. İki ayrı kısmi
 * iadede 333 + 333 = 666 geri döner, kalan 1 adet iade edildiğinde de 333;
 * toplam 999 ≠ 1000. Birim dizisi üretip DİLİM almak bu kaybı imkânsız kılar:
 * dizinin tamamının toplamı her zaman tam tutardır.
 *
 * Money.allocate kalan kuruşları ilk birimlerden başlayarak dağıtır; iade
 * dilimi de her zaman baştan sayıldığı için dağıtım tekrarlanabilirdir.
 */
function splitPerUnit(totalMinor: bigint, quantity: number): bigint[] {
  if (quantity <= 0) return [];
  const weights = new Array<number>(quantity).fill(1);
  return Money.allocate(Money.money(totalMinor), weights).map((part) => part.amountMinor);
}

function sumSlice(units: readonly bigint[], from: number, count: number): bigint {
  return units.slice(from, from + count).reduce((acc, value) => acc + value, 0n);
}

/**
 * Kargo payı OrderItem'da ayrı kolon olarak tutulmuyor; sellerNet
 * tanımından geri çıkarılıyor. Böylece ters kayıt, defterde gerçekten ne
 * yazdıysa onunla birebir örtüşür — ayrı bir hesaptan gelen "yaklaşık" değer
 * kullanılsa tam iadede bakiye sıfırlanmazdı.
 */
function shippingShareOf(item: OrderItemMoneySnapshot): bigint {
  const share = item.lineTotalMinor - item.commissionAmountMinor - item.sellerNetMinor;
  if (share < 0n) {
    // Satıcıya lineTotal − komisyon'dan FAZLA hakediş yazılmış: satış anındaki
    // kayıt tutarsız. Sessizce devam edilirse iade satıcı bakiyesini eksiye
    // düşürür; işlem burada durur.
    throw appError('PAYMENT_AMOUNT_MISMATCH', {
      internalMessage:
        `Kalem ${item.orderItemId} tutarsız: lineTotal=${item.lineTotalMinor} ` +
        `komisyon=${item.commissionAmountMinor} sellerNet=${item.sellerNetMinor}`,
    });
  }
  return share;
}

/**
 * SATIŞ KAYITLARI — sipariş ödendiğinde yazılır.
 *
 * Burada duruyor çünkü iade ters kaydının aynası bu; ikisi ayrı dosyalarda
 * olsaydı biri değişip diğeri unutulduğunda bakiye sessizce kayardı.
 */
export function buildSaleLedgerEntries(
  item: OrderItemMoneySnapshot,
  options: { readonly availableAt?: Date | null } = {},
): LedgerEntryDraft[] {
  const shipping = shippingShareOf(item);
  const label = item.label ?? item.orderItemId;
  const availableAt = options.availableAt ?? null;

  const entries: LedgerEntryDraft[] = [
    {
      sellerId: item.sellerId,
      orderItemId: item.orderItemId,
      type: 'SALE',
      amountMinor: item.lineTotalMinor,
      description: `Satış: ${label}`,
      availableAt,
    },
  ];

  // Sıfır tutarlı kayıt defterde gürültüdür; mutabakatta okunurluğu düşürür.
  if (item.commissionAmountMinor !== 0n) {
    entries.push({
      sellerId: item.sellerId,
      orderItemId: item.orderItemId,
      type: 'COMMISSION',
      amountMinor: -item.commissionAmountMinor,
      description: `Komisyon: ${label}`,
      availableAt,
    });
  }
  if (shipping !== 0n) {
    entries.push({
      sellerId: item.sellerId,
      orderItemId: item.orderItemId,
      type: 'SHIPPING_SHARE',
      amountMinor: -shipping,
      description: `Kargo payı: ${label}`,
      availableAt,
    });
  }

  return entries;
}

/**
 * İADE TERS KAYITLARI.
 *
 * Kısmi iade desteklenir: iade edilen adet, satış anındaki birim dağılımının
 * bir DİLİMİDİR. Aynı kalemden art arda yapılan iadelerin toplamı, kalemin
 * tamamı iade edildiğinde satış kayıtlarını tam olarak sıfırlar.
 */
export function computeReturnReversal(lines: readonly ReturnLine[]): ReturnReversalDraft {
  const entries: LedgerEntryDraft[] = [];
  const perItem: ReturnLineResult[] = [];
  let customerRefundMinor = 0n;
  let sellerNetImpactMinor = 0n;

  for (const line of lines) {
    if (line.returnQuantity <= 0) {
      throw appError('RETURN_NOT_ALLOWED', {
        internalMessage: `Kalem ${line.orderItemId} için iade adedi pozitif olmalı`,
      });
    }
    if (line.alreadyReturnedQuantity + line.returnQuantity > line.quantity) {
      throw appError('RETURN_NOT_ALLOWED', {
        internalMessage:
          `Kalem ${line.orderItemId}: ${line.returnQuantity} adet istendi, ` +
          `iade edilebilir ${line.quantity - line.alreadyReturnedQuantity} adet`,
      });
    }

    const shipping = shippingShareOf(line);
    const label = line.label ?? line.orderItemId;
    const from = line.alreadyReturnedQuantity;
    const count = line.returnQuantity;

    const refundedGross = sumSlice(splitPerUnit(line.lineTotalMinor, line.quantity), from, count);
    const refundedCommission = sumSlice(
      splitPerUnit(line.commissionAmountMinor, line.quantity),
      from,
      count,
    );
    const refundedShipping = sumSlice(splitPerUnit(shipping, line.quantity), from, count);
    const refundedDiscount = sumSlice(
      splitPerUnit(line.discountShareMinor ?? 0n, line.quantity),
      from,
      count,
    );

    entries.push({
      sellerId: line.sellerId,
      orderItemId: line.orderItemId,
      type: 'REFUND',
      amountMinor: -refundedGross,
      description: `İade: ${label} (${count} adet)`,
    });

    if (refundedCommission !== 0n) {
      entries.push({
        sellerId: line.sellerId,
        orderItemId: line.orderItemId,
        type: 'COMMISSION_REVERSAL',
        amountMinor: refundedCommission,
        description: `Komisyon iadesi: ${label}`,
      });
    }
    if (refundedShipping !== 0n) {
      entries.push({
        sellerId: line.sellerId,
        orderItemId: line.orderItemId,
        type: 'SHIPPING_REVERSAL',
        amountMinor: refundedShipping,
        description: `Kargo payı iadesi: ${label}`,
      });
    }

    // Müşteri indirimli tutarı ödedi; indirim payı kadar eksik geri alır.
    const customerRefund = refundedGross - refundedDiscount;
    const netImpact = -refundedGross + refundedCommission + refundedShipping;

    perItem.push({
      orderItemId: line.orderItemId,
      customerRefundMinor: customerRefund,
      sellerNetImpactMinor: netImpact,
    });
    customerRefundMinor += customerRefund;
    sellerNetImpactMinor += netImpact;
  }

  return { entries, perItem, customerRefundMinor, sellerNetImpactMinor };
}

/** Defter kayıtlarının toplamı — bakiye kontrolü ve test için. */
export function ledgerBalanceMinor(entries: readonly LedgerEntryDraft[]): bigint {
  return entries.reduce((acc, entry) => acc + entry.amountMinor, 0n);
}

// TODO(kod-gerekli): LEDGER_INCONSISTENT — satış kaydı kendi içinde tutarsız
// olduğunda (sellerNet > lineTotal − komisyon) PAYMENT_AMOUNT_MISMATCH
// kullanılıyor. Aile ve HTTP kodu doğru (system/409) ama kullanıcı mesajı
// ödeme diyor; defter tutarsızlığı için ayrı bir kod daha isabetli olur.
