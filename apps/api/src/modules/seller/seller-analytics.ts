/**
 * SATICI ANALİTİĞİ — saf hesap.
 *
 * Ham sayımlar veritabanından gelir; oran/dönüşüm hesabı burada yapılır ki
 * test edilebilsin. Sıfıra bölme, oran yönü ve yuvarlama kararları bir kez
 * burada verilir — her SQL sorgusunda tekrar edilirse er geç biri kayar.
 */

/**
 * Huninin ham sayımları — hepsi aynı tarih aralığı ve aynı satıcı için.
 *
 * ⚠️ "Ürün görüntüleme" BİLEREK yok. Veri modelinde görüntüleme OLAYI
 *    tutulmuyor; `Product.viewCount` doğduğundan beri artan tek bir sayaç.
 *    Onu huniye koymak, tarih aralığı seçilmiş bir rapora ömür boyu birikmiş
 *    bir sayı sokmak olurdu: satıcı "son 7 gün"e bakıp %0,3 dönüşüm görür ve
 *    ürününü yanlışlıkla başarısız sanardı. Görüntüleme olayı tabloya
 *    yazıldığında huniye ilk adım olarak eklenebilir.
 */
export interface FunnelCounts {
  /** Başarılı sanal deneme sayısı. */
  readonly tryOnCount: number;
  /** Sepete ekleme sayısı. */
  readonly cartAddCount: number;
  /** Ödemesi tamamlanmış siparişlerdeki adet. */
  readonly purchasedCount: number;
}

export interface FunnelStage {
  readonly key: 'tryOn' | 'cart' | 'purchase';
  readonly label: string;
  readonly count: number;
  /** Bir önceki adımdan bu adıma geçiş oranı (%, iki ondalık). */
  readonly stepRatePct: number | null;
  /** İlk adıma (sanal deneme) göre oran (%, iki ondalık). */
  readonly overallRatePct: number | null;
}

/**
 * Oran hesabı — payda sıfırsa 0 değil `null` döner.
 *
 * Neden null: "hiç deneme yapılmadı" ile "deneme yapıldı ama hiç satış yok"
 * farklı gerçeklerdir. İkisi de %0 gösterilirse satıcı, ürününü kimsenin
 * denemediğini göremez ve yanlış yerde iyileştirme yapar.
 */
export function ratePct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

/**
 * TRY-ON → SEPET → SATIŞ HUNİSİ.
 *
 * ⚠️ Adımlar hiyerarşik DEĞİLDİR: bir kullanıcı denemeden de sepete ekleyebilir,
 *    bu yüzden `cartAddCount > tryOnCount` olabilir ve geçiş oranı %100'ü
 *    aşabilir. Sayılar yapay olarak kırpılmaz — kırpılırsa "sanal deneme
 *    olmadan da satılıyor" bilgisi kaybolur ki bu, özelliğin katkısını ölçmek
 *    için en değerli sinyaldir.
 */
export function buildFunnel(counts: FunnelCounts): FunnelStage[] {
  const { tryOnCount, cartAddCount, purchasedCount } = counts;

  return [
    {
      key: 'tryOn',
      label: 'Sanal deneme',
      count: tryOnCount,
      stepRatePct: null,
      overallRatePct: tryOnCount > 0 ? 100 : null,
    },
    {
      key: 'cart',
      label: 'Sepete ekleme',
      count: cartAddCount,
      stepRatePct: ratePct(cartAddCount, tryOnCount),
      overallRatePct: ratePct(cartAddCount, tryOnCount),
    },
    {
      key: 'purchase',
      label: 'Satış',
      count: purchasedCount,
      stepRatePct: ratePct(purchasedCount, cartAddCount),
      overallRatePct: ratePct(purchasedCount, tryOnCount),
    },
  ];
}

/** Beden bazlı iade satırı — ham sayımlar. */
export interface SizeReturnCounts {
  readonly size: string;
  readonly soldQuantity: number;
  readonly returnedQuantity: number;
  /** Bedeni "küçük geldi" diyerek iade edilen adet. */
  readonly tooSmallQuantity: number;
  /** Bedeni "büyük geldi" diyerek iade edilen adet. */
  readonly tooLargeQuantity: number;
}

export interface SizeReturnInsight extends SizeReturnCounts {
  readonly returnRatePct: number | null;
  /** Beden kaynaklı iadelerin tüm iadeler içindeki payı. */
  readonly sizeRelatedRatePct: number | null;
  /**
   * Kalıp önerisi. Beden kaynaklı iadeler tek yöne ağır basıyorsa üretilir.
   * `null` = anlamlı bir sinyal yok.
   */
  readonly suggestion: 'RUNS_SMALL' | 'RUNS_LARGE' | null;
}

/**
 * Bir bedende kalıp sorunu olduğunu söyleyebilmek için gereken asgari iade.
 * Altında kalan sayılar gürültüdür; 1 iadeye bakıp "kalıbınız dar" demek
 * satıcıyı yanlış yönlendirir.
 */
export const MIN_RETURNS_FOR_SUGGESTION = 5;
/** Tek yönün baskın sayılması için gereken pay. */
export const DIRECTION_DOMINANCE_PCT = 60;

export function analyzeSizeReturns(rows: readonly SizeReturnCounts[]): SizeReturnInsight[] {
  return rows.map((row) => {
    const sizeRelated = row.tooSmallQuantity + row.tooLargeQuantity;

    let suggestion: SizeReturnInsight['suggestion'] = null;
    if (sizeRelated >= MIN_RETURNS_FOR_SUGGESTION) {
      const smallPct = ratePct(row.tooSmallQuantity, sizeRelated) ?? 0;
      const largePct = ratePct(row.tooLargeQuantity, sizeRelated) ?? 0;
      // "Küçük geldi" baskınsa ürün DAR kalıplıdır: müşteri bir beden büyük almalı.
      if (smallPct >= DIRECTION_DOMINANCE_PCT) suggestion = 'RUNS_SMALL';
      else if (largePct >= DIRECTION_DOMINANCE_PCT) suggestion = 'RUNS_LARGE';
    }

    return {
      ...row,
      returnRatePct: ratePct(row.returnedQuantity, row.soldQuantity),
      sizeRelatedRatePct: ratePct(sizeRelated, row.returnedQuantity),
      suggestion,
    };
  });
}

/** Ürün bazlı huni satırı — "hangi ürün deneniyor ama satılmıyor". */
export interface ProductFunnelCounts {
  readonly productId: string;
  readonly title: string;
  /** Try-On Uygunluk Skoru — düşük dönüşümün sebebi görsel kalitesi olabilir. */
  readonly tryOnScore: number | null;
  readonly tryOnCount: number;
  readonly cartAddCount: number;
  readonly purchasedCount: number;
}

export interface ProductFunnelInsight extends ProductFunnelCounts {
  readonly tryOnToCartPct: number | null;
  readonly cartToPurchasePct: number | null;
  readonly tryOnToPurchasePct: number | null;
  /**
   * Çok denenip az satılan ürün — vitrini iyi, ürünü veya fiyatı sorunlu.
   * Satıcı panelinde ilk gösterilecek satır budur.
   */
  readonly highInterestLowConversion: boolean;
}

/** Bu eşiğin altındaki deneme sayısı istatistiksel olarak anlamsızdır. */
export const MIN_TRYONS_FOR_INSIGHT = 20;
/** Deneme → sepet oranı bunun altındaysa "ilgi var, dönüşüm yok". */
export const LOW_CONVERSION_PCT = 10;

export function analyzeProductFunnels(
  rows: readonly ProductFunnelCounts[],
): ProductFunnelInsight[] {
  return rows.map((row) => {
    const tryOnToCartPct = ratePct(row.cartAddCount, row.tryOnCount);

    return {
      ...row,
      tryOnToCartPct,
      cartToPurchasePct: ratePct(row.purchasedCount, row.cartAddCount),
      tryOnToPurchasePct: ratePct(row.purchasedCount, row.tryOnCount),
      highInterestLowConversion:
        row.tryOnCount >= MIN_TRYONS_FOR_INSIGHT &&
        tryOnToCartPct !== null &&
        tryOnToCartPct < LOW_CONVERSION_PCT,
    };
  });
}
