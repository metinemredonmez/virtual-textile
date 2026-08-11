/**
 * SATICI BAKİYESİ VE PAYOUT UYGUNLUĞU — saf çekirdek.
 *
 * Burada Prisma yok, tarih "şimdi" dışarıdan geliyor. Sebep: para kuralları
 * veritabanı olmadan test edilebilmeli; bir bakiye hatası ancak testte
 * yakalanırsa ucuzdur, üretimde yakalanırsa satıcıya yanlış ödeme demektir.
 *
 * ⚠️ Bakiye AYRI BİR KOLONDA TUTULMAZ. Her zaman LedgerEntry toplamıdır
 *    (bkz. schema.prisma → LedgerEntry). Ayrı kolon er geç defterle
 *    tutarsızlaşır ve hangisinin doğru olduğu anlaşılamaz.
 */
import { FINANCE } from '@vt/config';
import { Money, appError } from '@vt/contracts';
import type { LedgerType } from '@vt/db';

/** Bakiye hesabı için gereken asgari defter satırı. */
export interface LedgerRow {
  readonly type: LedgerType;
  /** + alacak, − borç. Kuruş. */
  readonly amountMinor: bigint;
  /** Hakedişin ödenebilir hâle geldiği an. null = beklemesi gerekmiyor. */
  readonly availableAt: Date | null;
}

export interface SellerBalance {
  /** Defterin tamamı — geleceğe tarihli hakedişler dâhil. */
  readonly totalMinor: bigint;
  /** Bugün çekilebilir tutar. Negatif olabilir (iade bekleyen hakedişi aşmışsa). */
  readonly availableMinor: bigint;
  /** Henüz olgunlaşmamış hakediş: availableAt geleceğe tarihli satırlar. */
  readonly pendingMinor: bigint;
  /** Payout talebinde kullanılabilecek tavan — negatif bakiye 0'a kırpılır. */
  readonly withdrawableMinor: bigint;
}

/**
 * ÇEKİLEBİLİR BAKİYE.
 *
 * Kural: `availableAt` GELECEĞE TARİHLİ olan satırlar çekilebilir bakiyeye
 * girmez; diğer her satır girer.
 *
 * ⚠️ Bu, "yalnızca availableAt <= now olan satırları topla" kuralından
 *    BİLEREK ayrılıyor ve ayrılmasa PARA KAYBEDİLİRDİ:
 *
 *    `availableAt` bir OLGUNLAŞMA tarihidir ve yalnızca satış hakedişine
 *    (SALE / COMMISSION / SHIPPING_SHARE) yazılır — iade penceresi kapanmadan
 *    hakediş ödenmesin diye. İade ters kayıtları (REFUND, COMMISSION_REVERSAL,
 *    SHIPPING_REVERSAL) ve PAYOUT borçları `availableAt = null` ile düşer
 *    (bkz. order/return-ledger.ts).
 *
 *    Düz "availableAt <= now" kuralı bu satırları toplamın DIŞINDA bırakırdı:
 *      • iadesi yapılmış satışın parası hâlâ çekilebilir görünürdü,
 *      • ödenmiş bir payout bakiyeden düşmez, satıcı aynı parayı ikinci kez
 *        çekebilirdi.
 *
 *    Bu yüzden null tarih "beklemesi gerekmiyor" olarak okunur. Yönü ne olursa
 *    olsun anında etki eder; bu, satıcı lehine değil PLATFORM lehine
 *    ihtiyatlıdır ve mutabakatı bozmaz.
 */
export function computeBalance(rows: readonly LedgerRow[], now: Date = new Date()): SellerBalance {
  let totalMinor = 0n;
  let pendingMinor = 0n;

  for (const row of rows) {
    totalMinor += row.amountMinor;
    if (isPending(row, now)) pendingMinor += row.amountMinor;
  }

  return balanceFromTotals(totalMinor, pendingMinor);
}

/** Bir satır henüz olgunlaşmamış mı? Kuralın TEK tanımı. */
export function isPending(row: LedgerRow, now: Date): boolean {
  return row.availableAt !== null && row.availableAt.getTime() > now.getTime();
}

/**
 * Toplamlardan bakiyeyi türetir.
 *
 * ⚠️ Ayrı bir fonksiyon çünkü üretimde satırlar BELLEĞE ALINMAZ: on binlerce
 *    defter kaydı olan bir satıcıda hepsini çekmek hem yavaş hem risklidir.
 *    Servis toplamları veritabanında (SUM + koşullu SUM) hesaplar ve buraya
 *    verir. Türetme mantığı tek yerde durduğu için SQL yolu ile test edilen
 *    `computeBalance` yolu AYRIŞAMAZ.
 */
export function balanceFromTotals(totalMinor: bigint, pendingMinor: bigint): SellerBalance {
  const availableMinor = totalMinor - pendingMinor;

  return {
    totalMinor,
    availableMinor,
    pendingMinor,
    // Negatif bakiye bir payout tavanı değildir; talep tarafında 0 gibi davranır.
    // (Borç tahsilatı admin işidir, satıcı ucunun konusu değil.)
    withdrawableMinor: availableMinor > 0n ? availableMinor : 0n,
  };
}

/** Bir sonraki hakedişin olgunlaşacağı an — arayüzde "x tarihinde çekilebilir". */
export function nextAvailableAt(rows: readonly LedgerRow[], now: Date = new Date()): Date | null {
  let earliest: Date | null = null;
  for (const row of rows) {
    if (row.availableAt === null) continue;
    if (row.availableAt.getTime() <= now.getTime()) continue;
    // Yalnızca ALACAK satırları beklenmeye değer; bekleyen bir borcun
    // tarihini "paran şu gün gelecek" diye göstermek yanlış olurdu.
    if (row.amountMinor <= 0n) continue;
    if (earliest === null || row.availableAt.getTime() < earliest.getTime()) {
      earliest = row.availableAt;
    }
  }
  return earliest;
}

/** Defterin tür bazında dökümü — satıcı finans ekranının özet kartları. */
export function summarizeByType(rows: readonly LedgerRow[]): Record<string, bigint> {
  const totals: Record<string, bigint> = {};
  for (const row of rows) {
    totals[row.type] = (totals[row.type] ?? 0n) + row.amountMinor;
  }
  return totals;
}

export interface PayoutEligibilityInput {
  readonly requestedMinor: bigint;
  readonly withdrawableMinor: bigint;
  /** REQUESTED veya APPROVED durumda bekleyen bir talep var mı? */
  readonly hasPendingRequest: boolean;
}

/**
 * PAYOUT UYGUNLUĞU — talep yazılmadan ÖNCE çalışır.
 *
 * Sıralama önemlidir ve bilinçlidir:
 *   1. Tutar asgarinin altında mı        → isteğin KENDİSİ geçersiz
 *   2. Bekleyen talep var mı             → sistemin DURUMU uygun değil
 *   3. Bakiye yetiyor mu                 → en pahalı kontrol, en sonda
 *
 * Önce isteğin kendi geçerliliğine bakılır: satıcıya "bekleyen talebin var"
 * denip talebi sonuçlandıktan sonra "zaten asgari tutarın altındaydın"
 * denmesi kötü bir deneyimdir.
 *
 * ⚠️ Bekleyen talep kontrolü aynı zamanda bir PARA KİLİDİDİR. Talep
 *    oluştuğunda deftere PAYOUT kaydı DÜŞMEZ (ödeme admin onayıyla yapılır),
 *    dolayısıyla bekleyen tutar çekilebilir bakiyeden düşmez. Bu kontrol
 *    olmasaydı satıcı aynı bakiye için arka arkaya iki talep açıp aynı parayı
 *    iki kez tahsil edebilirdi.
 */
export function assertPayoutEligible(input: PayoutEligibilityInput): void {
  if (input.requestedMinor < FINANCE.minPayoutMinor) {
    throw appError('PAYOUT_BELOW_MINIMUM', {
      params: { minAmount: Money.formatMoney(Money.money(FINANCE.minPayoutMinor)) },
      internalMessage: `İstenen ${input.requestedMinor}, asgari ${FINANCE.minPayoutMinor}`,
    });
  }

  if (input.hasPendingRequest) {
    throw appError('PAYOUT_PENDING_EXISTS');
  }

  if (input.requestedMinor > input.withdrawableMinor) {
    throw appError('PAYOUT_INSUFFICIENT_BALANCE', {
      internalMessage: `İstenen ${input.requestedMinor}, çekilebilir ${input.withdrawableMinor}`,
      details: { withdrawableMinor: input.withdrawableMinor.toString() },
    });
  }
}

/** Uygunluğu hata fırlatmadan sorar — arayüzde "Talep Et" düğmesini kapatmak için. */
export function isPayoutEligible(input: PayoutEligibilityInput): boolean {
  try {
    assertPayoutEligible(input);
    return true;
  } catch {
    return false;
  }
}

/**
 * PAYOUT DEFTER KAYDI — talep ödendiğinde (admin akışı) yazılacak satır.
 *
 * Burada duruyor çünkü bakiye hesabının aynasıdır: payout borcunun işareti
 * veya `availableAt` değeri değişirse bakiye sessizce kayar. İkisi aynı
 * dosyada olursa biri değişip diğeri unutulamaz.
 */
export function buildPayoutLedgerRow(input: {
  readonly sellerId: string;
  readonly payoutId: string;
  readonly amountMinor: bigint;
}): {
  sellerId: string;
  payoutId: string;
  type: LedgerType;
  amountMinor: bigint;
  description: string;
  availableAt: null;
} {
  if (input.amountMinor <= 0n) {
    throw appError('PAYOUT_INSUFFICIENT_BALANCE', {
      internalMessage: `Payout tutarı pozitif olmalı, ${input.amountMinor} verildi`,
    });
  }
  return {
    sellerId: input.sellerId,
    payoutId: input.payoutId,
    type: 'PAYOUT',
    // Borç: bakiyeyi DÜŞÜRÜR. İşaret ters yazılırsa ödeme yapıldıkça bakiye
    // artar ve satıcı sınırsız çekim yapar.
    amountMinor: -input.amountMinor,
    description: `Ödeme talebi ${input.payoutId}`,
    // Ödeme borcu beklemez; anında bakiyeden düşer (bkz. computeBalance).
    availableAt: null,
  };
}
