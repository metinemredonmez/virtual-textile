/**
 * SİPARİŞ DURUM ÇEKİRDEĞİ — saf, yan etkisiz, veritabanından bağımsız.
 *
 * Neden ayrı dosya ve saf fonksiyon: sipariş durumu hem müşteri iletişiminin
 * hem de paranın (hakediş, iade penceresi, payout) dayandığı tek karardır.
 * Servis içine gömülseydi yalnızca canlı veritabanıyla sınanabilirdi; burada
 * her bileşke tek tek test edilebiliyor.
 *
 * ⚠️ Order.status şemada bir kolon olarak DURUYOR ama DOĞRULUK KAYNAĞI DEĞİL:
 *    kolon yalnızca listeleme/filtreleme için tutulan bir önbellektir ve her
 *    paket değişiminden sonra bu dosyadaki türetimle yeniden yazılır
 *    (bkz. OrderService.syncOrderStatus). İki kaynak çeliştiğinde doğru olan
 *    burasıdır.
 */
import { appError } from '@vt/contracts';
import { ORDER } from '@vt/config';
import type { OrderStatus, PackageStatus } from '@vt/db';

/**
 * Ödemenin sipariş durumuna yansıyan aşaması.
 * Paketlerden TÜRETİLEMEZ — ödeme paket yaratılmadan da başarısız olabilir.
 */
export type PaymentPhase = 'PENDING' | 'FAILED' | 'EXPIRED' | 'PAID';

export interface PackageSnapshot {
  readonly status: PackageStatus;
  readonly deliveredAt?: Date | null;
}

export interface OrderDerivationContext {
  readonly paymentPhase: PaymentPhase;
  /** Order.cancelledAt dolu mu — müşteri/sistem siparişi iptal etti mi. */
  readonly cancelled?: boolean;
  /** Otomatik tamamlama eşiği için. Testte sabitlenebilsin diye parametre. */
  readonly now?: Date;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * PAKET İLERLEME SIRASI
 *
 * Bileşke hesabı "en geride kalan paket" üzerinden yürür; bu yüzden durumlar
 * karşılaştırılabilir bir sayıya indirgenir. RETURN_REQUESTED, DELIVERED ile
 * aynı seviyededir: iade talebi ancak teslim edilmiş bir paket için açılır,
 * yani teslimat gerçekleşmiştir.
 *
 * CANCELLED ayrı ele alınır (−1) — iptal edilen paket ilerlemeyi ölçmez,
 * hesabın DIŞINDA bırakılır.
 */
const FULFILMENT_RANK: Record<PackageStatus, number> = {
  CANCELLED: -1,
  AWAITING_APPROVAL: 0,
  PREPARING: 0,
  SHIPPED: 1,
  DELIVERED: 2,
  RETURN_REQUESTED: 2,
  RETURNED: 3,
};

/** Bu durumlardan çıkış yoktur — yeni geçiş kabul edilmez. */
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = [
  'EXPIRED',
  'COMPLETED',
  'CANCELLED',
  'REFUNDED',
];

export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return TERMINAL_ORDER_STATUSES.includes(status);
}

/**
 * PAKET DURUMLARI → SİPARİŞ DURUMU
 *
 * Kurallar:
 *  - Ödeme tamamlanmadıysa paketlerin durumu okunmaz; sipariş henüz yok sayılır.
 *  - İptal edilen paketler bileşkeye KATILMAZ. A satıcısı iptal edip B satıcısı
 *    kargoladıysa müşterinin siparişi "kargolandı"dır; iptal edilen paket
 *    siparişi sonsuza kadar "kısmen kargolandı"da tutamaz.
 *  - Tek bir paket bile kalmadıysa sipariş iptaldir.
 */
export function deriveOrderStatus(
  packages: readonly PackageSnapshot[],
  context: OrderDerivationContext,
): OrderStatus {
  const live = packages.filter((p) => p.status !== 'CANCELLED');

  // Paketleri olan ama hepsi iptal edilmiş sipariş: ödeme aşaması ne olursa
  // olsun iptaldir. (Parası çekildiyse iade akışı OutboxEvent ile yürür.)
  if (packages.length > 0 && live.length === 0) return 'CANCELLED';

  if (context.paymentPhase === 'PENDING') {
    return context.cancelled === true ? 'CANCELLED' : 'PENDING_PAYMENT';
  }
  if (context.paymentPhase === 'FAILED') return 'PAYMENT_FAILED';
  if (context.paymentPhase === 'EXPIRED') return 'EXPIRED';

  // Buradan sonrası ödemesi alınmış sipariş: durum TAMAMEN paketlerin bileşkesi.
  if (live.length === 0) return context.cancelled === true ? 'CANCELLED' : 'PAID';

  const ranks = live.map((p) => FULFILMENT_RANK[p.status]);
  const slowest = Math.min(...ranks);

  if (slowest >= 3) return 'REFUNDED';
  if (slowest >= 2) {
    return isAutoCompletable(live, context.now ?? new Date()) ? 'COMPLETED' : 'DELIVERED';
  }
  if (slowest >= 1) return 'SHIPPED';
  return ranks.some((rank) => rank >= 1) ? 'PARTIALLY_SHIPPED' : 'PAID';
}

/**
 * Teslimden ORDER.autoCompleteAfterDays gün sonra sipariş kapanır.
 *
 * ⚠️ Açık iade talebi varken KAPANMAZ: sipariş COMPLETED olduğunda satıcı
 * hakedişi ödenebilir hâle gelir; açık iade varken bu para ödenirse iade
 * onaylandığında satıcıdan geri tahsilat gerekir.
 */
function isAutoCompletable(live: readonly PackageSnapshot[], now: Date): boolean {
  if (live.some((p) => p.status === 'RETURN_REQUESTED')) return false;
  const threshold = now.getTime() - ORDER.autoCompleteAfterDays * MS_PER_DAY;
  return live.every((p) => p.deliveredAt != null && p.deliveredAt.getTime() <= threshold);
}

/**
 * Ödeme aşamasını Order'ın KENDİ kolonlarından türetir.
 *
 * PaymentIntent'e bakılmaz: o kayıt ödeme modülünün sahibidir ve sipariş
 * modülü başka modülün tablosunu okumaz. Ödeme modülü sonucu Order.paidAt /
 * Order.status üzerinden bildirir.
 */
export function derivePaymentPhase(order: {
  readonly paidAt: Date | null;
  readonly reservationExpiresAt: Date | null;
  readonly status: OrderStatus;
  readonly now?: Date;
}): PaymentPhase {
  if (order.paidAt !== null) return 'PAID';
  // PAYMENT_FAILED yapışkandır: yeniden deneme hakkı bitmiş olabilir, bu bilgi
  // yalnızca ödeme modülünde vardır; sipariş modülü onu silmez.
  if (order.status === 'PAYMENT_FAILED') return 'FAILED';
  const now = order.now ?? new Date();
  if (
    order.reservationExpiresAt !== null &&
    order.reservationExpiresAt.getTime() <= now.getTime()
  ) {
    return 'EXPIRED';
  }
  return 'PENDING';
}

// ── Paket durum geçiş makinesi ────────────────────────────────────────────

/**
 * İZİN VERİLEN GEÇİŞLER — beyaz liste.
 *
 * Kara liste kullanılmaz: yeni bir durum eklendiğinde kara liste sessizce
 * "her şeye izin var" hâline gelir, beyaz liste ise derleme hatası verir.
 *
 * RETURN_REQUESTED → DELIVERED geçişi iade REDDİ içindir; paket zaten
 * müşteridedir, teslim edilmiş hâline geri döner.
 */
const PACKAGE_TRANSITIONS: Record<PackageStatus, readonly PackageStatus[]> = {
  AWAITING_APPROVAL: ['PREPARING', 'CANCELLED'],
  PREPARING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: ['RETURN_REQUESTED'],
  RETURN_REQUESTED: ['RETURNED', 'DELIVERED'],
  RETURNED: [],
  CANCELLED: [],
};

export function canTransitionPackage(from: PackageStatus, to: PackageStatus): boolean {
  return PACKAGE_TRANSITIONS[from].includes(to);
}

export function assertPackageTransition(from: PackageStatus, to: PackageStatus): void {
  if (canTransitionPackage(from, to)) return;
  throw appError('ORDER_INVALID_TRANSITION', {
    internalMessage: `Geçersiz paket geçişi: ${from} → ${to}`,
    details: { from, to },
  });
}

/** Kargoya verilmemiş paket iptal edilebilir; sonrası iade konusudur. */
export function isPackageCancellable(status: PackageStatus): boolean {
  return canTransitionPackage(status, 'CANCELLED');
}

export function assertPackageCancellable(status: PackageStatus): void {
  if (isPackageCancellable(status)) return;
  if (status === 'CANCELLED') {
    throw appError('ORDER_INVALID_TRANSITION', {
      internalMessage: 'Paket zaten iptal edilmiş',
    });
  }
  throw appError('ORDER_NOT_CANCELLABLE', {
    internalMessage: `Paket ${status} durumunda, iptal edilemez`,
  });
}

/**
 * SİPARİŞİN TAMAMINI İPTAL EDİLEBİLİR Mİ?
 *
 * Müşteri iptali "hepsi ya da hiçbiri"dir: bir paket kargoya verilmişse
 * sipariş iptal edilmez, iade talebi açılır. Kısmi iptal satıcının kendi
 * akışıdır (stok yok, hatalı ürün) ve ayrı yetkiyle yapılır — burada
 * müşterinin yarım iptalle kafası karışmasın diye kapalıdır.
 */
export function assertOrderCancellable(packages: readonly PackageSnapshot[]): void {
  const live = packages.filter((p) => p.status !== 'CANCELLED');
  if (packages.length > 0 && live.length === 0) {
    throw appError('ORDER_INVALID_TRANSITION', { internalMessage: 'Sipariş zaten iptal edilmiş' });
  }
  for (const pkg of live) assertPackageCancellable(pkg.status);
}
