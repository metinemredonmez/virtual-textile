import { Money, type MoneyValue } from '@vt/contracts';

/**
 * SEPET TOPLAMI — SAF FONKSİYON
 *
 * Burada veritabanı, saat, rastgelelik ve I/O YOKTUR. Nedeni: para hesabının
 * doğruluğu tek başına test edilebilmeli. Bir kuruşluk sapma mutabakatı bozar
 * ve hatayı ay sonunda muhasebe bulur; o noktada hangi siparişin bozuk olduğunu
 * geri izlemek imkânsıza yakındır.
 *
 * Fonksiyon HATA FIRLATMAZ. Kupon artık geçerli değilse (kullanıcı sepetten
 * ürün çıkardı, tutar eşiğin altına düştü) sepeti okunamaz hâle getirmek yerine
 * `couponRejection` ile bildirir — sepet görüntüleme her zaman başarılı olmalı,
 * kupon reddi bir uyarıdır, hata değil.
 */

export type DiscountKind = 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE_SHIPPING';

export interface CartLineInput {
  id: string;
  variantId: string;
  /** Satıcı bazında paketleme bunun üzerinden yapılır. */
  sellerId: string;
  quantity: number;
  /**
   * Sepete eklendiği andaki birim fiyat. BAĞLAYICI FİYAT BUDUR.
   * Katalog fiyatı sonradan artsa bile kullanıcıya gösterilen ve tahsil
   * edilmeye çalışılan tutar bu kalır; fark `priceChanged` ile işaretlenir ve
   * checkout kullanıcı onayı olmadan devam etmez.
   */
  addedPriceMinor: bigint;
  /** Katalogdaki güncel birim fiyat — yalnızca karşılaştırma için. */
  currentPriceMinor: bigint;
}

export interface CouponInput {
  id: string;
  code: string;
  /** null = platform kuponu (tüm sepet), dolu = yalnızca o mağazanın kalemleri. */
  sellerId: string | null;
  discountType: DiscountKind;
  /** PERCENTAGE için basis point (1000 = %10), FIXED_AMOUNT için kuruş. */
  discountValue: bigint;
  /** Yüzdesel indirimde tavan. null = tavansız. */
  maxDiscountMinor: bigint | null;
  minCartMinor: bigint;
}

export type CouponRejectionReason = 'NOT_APPLICABLE' | 'MIN_AMOUNT';

export interface CartLineTotals {
  id: string;
  variantId: string;
  sellerId: string;
  quantity: number;
  unitPrice: MoneyValue;
  /** unitPrice × quantity */
  lineTotal: MoneyValue;
  currentUnitPrice: MoneyValue;
  /** true ise checkout CART_PRICE_CHANGED ile reddeder. */
  priceChanged: boolean;
  /** Pozitif: katalog fiyatı arttı. Negatif: ucuzladı. */
  priceDiffMinor: bigint;
}

export interface SellerPackageTotals {
  sellerId: string;
  lines: CartLineTotals[];
  subtotal: MoneyValue;
  /** Sepet indirimlerinden bu pakete düşen pay. */
  discount: MoneyValue;
  /** subtotal − discount. Kargo bu tutara dahil değildir. */
  total: MoneyValue;
}

export interface CartTotals {
  /**
   * Her satıcı ayrı paket, ayrı kargo, ayrı hakediş.
   * Sıra: kalemlerin sepete giriş sırası — okuma her çağrıda aynı sonucu
   * vermeli, aksi hâlde arayüz kendi kendine sıralama değiştirir.
   */
  packages: SellerPackageTotals[];
  subtotal: MoneyValue;
  discount: MoneyValue;
  total: MoneyValue;
  /** Toplam adet (kalem sayısı değil). */
  itemCount: number;
  distinctItemCount: number;
  hasPriceChange: boolean;
  appliedCouponCode: string | null;
  couponRejection: CouponRejectionReason | null;
  /** FREE_SHIPPING kuponu: kargo ücreti checkout'ta sıfırlanır. */
  freeShipping: boolean;
}

const zero = (): MoneyValue => Money.money(0n);

/**
 * Sepet toplamını hesaplar.
 *
 * @param lines  sepetteki kalemler (boş olabilir)
 * @param coupon uygulanmış kupon; yoksa null
 */
export function calculateCartTotals(
  lines: readonly CartLineInput[],
  coupon: CouponInput | null = null,
): CartTotals {
  // ── 1) Kalem toplamları ve satıcı bazında gruplama ───────────────────────
  const packageIndex = new Map<string, number>();
  const packages: Array<{ sellerId: string; lines: CartLineTotals[]; subtotalMinor: bigint }> = [];

  let itemCount = 0;
  let hasPriceChange = false;

  for (const line of lines) {
    const unit = Money.money(line.addedPriceMinor);
    const lineTotal = Money.multiply(unit, line.quantity);
    const priceDiffMinor = line.currentPriceMinor - line.addedPriceMinor;

    if (priceDiffMinor !== 0n) hasPriceChange = true;
    itemCount += line.quantity;

    const computed: CartLineTotals = {
      id: line.id,
      variantId: line.variantId,
      sellerId: line.sellerId,
      quantity: line.quantity,
      unitPrice: unit,
      lineTotal,
      currentUnitPrice: Money.money(line.currentPriceMinor),
      priceChanged: priceDiffMinor !== 0n,
      priceDiffMinor,
    };

    let index = packageIndex.get(line.sellerId);
    if (index === undefined) {
      index = packages.length;
      packageIndex.set(line.sellerId, index);
      packages.push({ sellerId: line.sellerId, lines: [], subtotalMinor: 0n });
    }
    const pkg = packages[index]!;
    pkg.lines.push(computed);
    pkg.subtotalMinor += lineTotal.amountMinor;
  }

  const subtotalMinor = packages.reduce((acc, p) => acc + p.subtotalMinor, 0n);
  const subtotal = Money.money(subtotalMinor);

  // ── 2) Kupon ─────────────────────────────────────────────────────────────
  const evaluated = evaluateCoupon(packages, subtotalMinor, coupon);

  // ── 3) İndirimi satıcı paketlerine dağıt ─────────────────────────────────
  //
  // ⚠️ Bölme YAPILMAZ; Money.allocate() kullanılır. Her paketin payını ayrı ayrı
  // yuvarlamak toplamda kuruş kaybı/fazlası üretir: 100 kuruşluk indirim üç eşit
  // pakete 33+33+33 = 99 olarak dağılır ve 1 kuruş buharlaşır. allocate() kalan
  // kuruşları en büyük paya dağıtır; paketlerin toplamı DAİMA indirime eşittir.
  const shares = Money.allocate(
    evaluated.discount,
    packages.map((p) =>
      evaluated.eligibleSellerIds.has(p.sellerId) ? Number(p.subtotalMinor) : 0,
    ),
  );

  const withTotals: SellerPackageTotals[] = packages.map((p, i) => {
    const packageSubtotal = Money.money(p.subtotalMinor);
    const packageDiscount = shares[i] ?? zero();
    return {
      sellerId: p.sellerId,
      lines: p.lines,
      subtotal: packageSubtotal,
      discount: packageDiscount,
      total: Money.subtract(packageSubtotal, packageDiscount),
    };
  });

  return {
    packages: withTotals,
    subtotal,
    discount: evaluated.discount,
    total: Money.subtract(subtotal, evaluated.discount),
    itemCount,
    distinctItemCount: lines.length,
    hasPriceChange,
    appliedCouponCode: coupon && evaluated.rejection === null ? coupon.code : null,
    couponRejection: evaluated.rejection,
    freeShipping: evaluated.freeShipping,
  };
}

interface CouponEvaluation {
  discount: MoneyValue;
  /** İndirimin dağıtılacağı satıcılar. Platform kuponunda hepsi. */
  eligibleSellerIds: Set<string>;
  rejection: CouponRejectionReason | null;
  freeShipping: boolean;
}

function evaluateCoupon(
  packages: ReadonlyArray<{ sellerId: string; subtotalMinor: bigint }>,
  subtotalMinor: bigint,
  coupon: CouponInput | null,
): CouponEvaluation {
  const none: CouponEvaluation = {
    discount: zero(),
    eligibleSellerIds: new Set<string>(),
    rejection: null,
    freeShipping: false,
  };

  if (!coupon) return none;
  if (packages.length === 0) {
    // Boş sepette kupon ne uygulanır ne de hata üretir; kullanıcı ürün
    // ekleyince kendiliğinden devreye girsin.
    return { ...none, rejection: 'NOT_APPLICABLE' };
  }

  const eligible = packages.filter(
    (p) => coupon.sellerId === null || p.sellerId === coupon.sellerId,
  );
  if (eligible.length === 0) {
    return { ...none, rejection: 'NOT_APPLICABLE' };
  }

  const eligibleSellerIds = new Set(eligible.map((p) => p.sellerId));
  const eligibleBaseMinor = eligible.reduce((acc, p) => acc + p.subtotalMinor, 0n);

  // ⚠️ Asgari sepet tutarı, kuponun KAPSADIĞI tutara bakılarak değerlendirilir.
  // Mağaza kuponunda tüm sepete bakılsaydı, kullanıcı başka bir mağazadan ürün
  // ekleyerek eşiği aşar ve mağazanın hiç kabul etmediği bir indirimi alırdı.
  const baseForMinimum = coupon.sellerId === null ? subtotalMinor : eligibleBaseMinor;
  if (baseForMinimum < coupon.minCartMinor) {
    return { ...none, rejection: 'MIN_AMOUNT' };
  }

  if (coupon.discountType === 'FREE_SHIPPING') {
    // Kargo ücreti sepette değil checkout'ta hesaplanır; burada yalnızca bayrak.
    return { discount: zero(), eligibleSellerIds, rejection: null, freeShipping: true };
  }

  let discountMinor: bigint;
  if (coupon.discountType === 'PERCENTAGE') {
    // discountValue basis point'tir: 1000 = %10. Float yüzde taşınmaz.
    const { result } = Money.applyBps(Money.money(eligibleBaseMinor), Number(coupon.discountValue));
    discountMinor = result.amountMinor;
    if (coupon.maxDiscountMinor !== null && discountMinor > coupon.maxDiscountMinor) {
      discountMinor = coupon.maxDiscountMinor;
    }
  } else {
    discountMinor = coupon.discountValue;
  }

  // İndirim kapsanan tutarı ASLA aşamaz — negatif ödenecek tutar,
  // yani platformun müşteriye para vermesi anlamına gelir.
  if (discountMinor > eligibleBaseMinor) discountMinor = eligibleBaseMinor;
  if (discountMinor < 0n) discountMinor = 0n;

  return {
    discount: Money.money(discountMinor),
    eligibleSellerIds,
    rejection: null,
    freeShipping: false,
  };
}
