import { SIZE_ENGINE } from '@vt/config';

/**
 * KALIP ÖĞRENMESİ — İADE VE YORUM VERİSİNDEN İSTATİSTİKSEL DÜZELTME
 *
 * Neden ayrı dosya: `size-engine.ts` bir KARAR katmanıdır (ölçü → beden).
 * Burası KANIT katmanıdır (ham sayım → bu eğilime ne kadar güvenilir).
 * İkisini ayırmamızın sebebi, kanıtın kalitesinin motorun hangi bedeni
 * seçtiğinden BAĞIMSIZ olarak test edilebilmesi gerektiğidir.
 *
 * ⚠️ BU DOSYANIN VAROLUŞ SEBEBİ TEK CÜMLE:
 *    AZ VERİYLE YÜKSEK GÜVEN GÖSTERMEK, HİÇ ÖNERİ VERMEMEKTEN DAHA ZARARLIDIR.
 *    Üç kişinin "küçük geldi" demesiyle bedeni kaydırırsak, o üç kişinin
 *    gürültüsünü binlerce kullanıcıya yanlış öneri olarak dağıtmış oluruz —
 *    ve faturayı iade kargosu olarak satıcı öder.
 *
 * Bu yüzden burada İKİ AYRI FREN var:
 *   1. SERT EŞİK — `SIZE_ENGINE.minFeedbackCountToUse` altındaki veri HİÇ
 *      kullanılmaz: ne bedeni kaydırır, ne güveni artırır. Ürün kararıdır,
 *      istatistik değil; bu yüzden @vt/config'te yaşar.
 *   2. WILSON ALT SINIRI — eşiği geçen veride bile, örneklem küçükse oranın
 *      alt güven sınırı düşük kalır ve eğilim "net" sayılmaz. 5 kişiden 3'ü
 *      "küçük geldi" dediğinde nokta tahmini %60'tır ama alt sınır %33'tür;
 *      bu bedeni kaydırmaya yetmez. 50 kişiden 30'unda aynı oranın alt sınırı
 *      %41'e çıkar ve yeter. Fark veri miktarındadır, orandaki değil.
 *
 * ML DEĞİL: burada öğrenen bir model yok. Sayım, oran ve güven aralığı var.
 * Neden L önerdiğimizi satır satır gösterebiliriz — bir modelin ara
 * katmanlarını gösteremezdik ve satıcıya "model öyle dedi" diyemeyiz.
 */

/** Markanın/ürünün kalıbı. Beden merdiveninde kaydırma yönünü belirler. */
export type BrandFit = 'SLIM' | 'REGULAR' | 'OVERSIZE';

/**
 * İade ve yorumlardan toplanan kalıp geri bildirimi.
 *
 * Kaynaklar (bkz. `fit-learning.gateway.ts`):
 *  - `Review.fitFeedback` — kullanıcı BEYANI,
 *  - `ReturnRequest.reason` SIZE_TOO_SMALL / SIZE_TOO_LARGE — kullanıcı
 *    DAVRANIŞI; beyandan güçlüdür çünkü bedeli vardır (kargo, zaman).
 */
export interface FitFeedbackSummary {
  tooSmall: number;
  trueToSize: number;
  tooLarge: number;
}

/** Aynı markanın TÜM ürünlerinden toplanmış sinyal. */
export interface BrandFitSignal {
  summary: FitFeedbackSummary;
  /**
   * Sinyalin geldiği FARKLI ürün sayısı.
   *
   * ⚠️ Bu alan olmadan "marka eğilimi" uydurmuş oluruz: tek bir kötü
   *    kalıplanmış üründen gelen 40 şikâyet, markanın 200 ürününün tamamı
   *    hakkında hiçbir şey söylemez. Eğilim ancak birden çok üründe
   *    tekrarlıyorsa markanın kalıbıdır.
   */
  distinctProducts: number;
}

/** Kullanıcının beden yüzünden iade ettiği bir alım. */
export interface UserReturnedSize {
  size: string;
  direction: 'TOO_SMALL' | 'TOO_LARGE';
}

/**
 * KULLANICININ KENDİ GEÇMİŞİ
 *
 * ⚠️ KVKK: bu veri yalnızca sahibinin kendi önerisinde kullanılır. Başka bir
 *    kullanıcıya, satıcıya veya toplu istatistiğe ASLA sızmaz; bu yüzden
 *    marka/ürün toplamlarından ayrı bir tipte taşınır.
 *
 * "Tutulan beden" = alınmış, teslim edilmiş ve iade PENCERESİ KAPANDIĞI hâlde
 * iade edilmemiş beden. Pencere kapanmadan "iade etmedi" demek anlamsızdır:
 * kullanıcı henüz karar vermemiş olabilir.
 *
 * Aynı beden birden çok kez tutulduysa listede birden çok kez bulunur —
 * tekrar, kanıtın kendisidir.
 */
export interface UserSizeHistory {
  /** Bu ÜRÜNden alınıp iade edilmemiş bedenler — en güçlü kişisel kanıt. */
  keptSizesForProduct: readonly string[];
  /** Aynı MARKAdan alınıp iade edilmemiş bedenler. */
  keptSizesForBrand: readonly string[];
  /** Bu üründe beden yüzünden iade edilmiş bedenler — güçlü negatif kanıt. */
  returnedSizesForProduct: readonly UserReturnedSize[];
}

/**
 * İSTATİSTİK AYARLARI
 *
 * Buradakiler motorun İÇ mekaniğidir (eğrinin şekli), ürün kararı değildir.
 * Ürün kararı olan iki eşik — "kaç geri bildirimden sonra dinleriz" ve "hangi
 * güvenin altında öneri gizlenir" — @vt/config'teki `SIZE_ENGINE`'de yaşar ve
 * buradan DEĞİŞTİRİLEMEZ.
 */
export const FIT_SIGNAL_TUNING = {
  /**
   * Wilson alt sınırı için z. 1,2816 = tek yönlü %90 güven.
   *
   * Neden %95 değil: %95 ile eşiği yeni geçmiş (5-10 geri bildirimli) hiçbir
   * ürün kaydırma üretmiyor — veriyi hiç kullanmamakla aynı kapıya çıkardı.
   * %90, "eşiği geçtiyse dinle ama küçük örneklemde temkinli ol" dengesini
   * kuruyor.
   */
  z: 1.2816,
  /**
   * Eğilimin "net" sayılması için baskın oranın ALT sınırı bunu geçmeli.
   * Nokta tahmini değil alt sınır bakılır — fark, küçük örneklemi elemektir.
   */
  minDominance: 0.35,
  /** Marka eğilimi için gereken en az FARKLI ürün sayısı. */
  minDistinctProductsForBrand: 3,
  /**
   * Marka eşiği, ürün eşiğinin bu katıdır.
   * Neden daha yüksek: marka çıkarımı çok daha geniş bir genellemedir —
   * tek üründe yanılırsak bir ürün, markada yanılırsak yüzlerce ürün bozulur.
   */
  brandThresholdMultiplier: 3,
  /**
   * Kişisel geçmişin doygunluk eşiği. 1'dir: kullanıcının kendi tuttuğu TEK
   * bir alım bile gerçek kanıttır — buradaki risk yabancıların gürültüsü
   * değil, tek gözlemin fazla ciddiye alınmasıdır. Ağırlık 1 gözlemde 0,50'de
   * kalır, tekrarlarla yükselir.
   */
  personalThreshold: 1,
} as const;

export type FitVerdictKind =
  /** ⚠️ Eşik altı — veri KULLANILMAZ. */
  | 'INSUFFICIENT'
  /** Geri bildirimler birbiriyle çelişiyor: yön çıkarılamaz. */
  | 'CONFLICTING'
  | 'TRUE_TO_SIZE'
  /** Ürün küçük geliyor → bir beden BÜYÜK önerilmeli. */
  | 'RUNS_SMALL'
  /** Ürün büyük geliyor → bir beden KÜÇÜK önerilmeli. */
  | 'RUNS_LARGE';

export interface FitVerdict {
  kind: FitVerdictKind;
  total: number;
  /** 0..1 — veri miktarının kanıt ağırlığı. INSUFFICIENT ise DAİMA 0. */
  weight: number;
  /** Baskın kovanın oranı için alt güven sınırı. Şeffaflık ve test için. */
  lowerBound: number;
}

export function feedbackTotal(summary: FitFeedbackSummary): number {
  return summary.tooSmall + summary.trueToSize + summary.tooLarge;
}

/**
 * KANIT AĞIRLIĞI — veri miktarını 0..1 aralığına sıkıştırır.
 *
 * Doygunluk eğrisi: w = n / (n + k). Eşiği yeni geçen veri yarım ağırlık alır,
 * veri arttıkça 1'e yaklaşır ama ASLA ULAŞMAZ:
 *   n = k    → 0,50      n = 2k  → 0,67
 *   n = 4k   → 0,80      n = 10k → 0,91
 *
 * ⚠️ 1'e ulaşmaması bilinçlidir: sonsuz veri bile "kesinlik" vermez. Beden
 *    önerisi bir tahmindir ve kanıt ağırlığı da bunu yansıtmalıdır.
 *
 * ⚠️ Eşik altında 0 döner — kısmi ağırlık DEĞİL, SIFIR. "Az veriyi az
 *    kullanalım" cazip görünür ama eşiğin anlamı budur: o veri yok sayılır.
 */
export function evidenceWeight(sampleCount: number, threshold: number): number {
  const k = threshold > 0 ? threshold : 1;
  if (!Number.isFinite(sampleCount) || sampleCount < k) return 0;
  return sampleCount / (sampleCount + k);
}

/**
 * Wilson skor aralığının ALT sınırı.
 *
 * Neden Wilson, neden düz oran değil: düz oran örneklem büyüklüğünü
 * unutturur — 3/3 de %100'dür, 300/300 de. Wilson, küçük örneklemde alt sınırı
 * aşağı çeker; böylece "az veri = zayıf sinyal" kuralı elle ayarlanan bir
 * sabite değil, matematiğin kendisine dayanır.
 *
 * Neden Wald değil: Wald aralığı p 0 veya 1'e yaklaşınca çöker (genişlik
 * sıfıra iner) — yani tam da bizim en çok yanılabileceğimiz yerde bize
 * "kesinlik" verirdi.
 */
export function wilsonLowerBound(
  successes: number,
  total: number,
  z: number = FIT_SIGNAL_TUNING.z,
): number {
  if (total <= 0) return 0;

  const p = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const centre = p + z2 / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));

  return Math.max(0, (centre - margin) / denominator);
}

const INSUFFICIENT = (total: number): FitVerdict => ({
  kind: 'INSUFFICIENT',
  total,
  weight: 0,
  lowerBound: 0,
});

/**
 * ÜRÜN BAZLI KARAR: sayımlardan yön ve ağırlık çıkarır.
 *
 * Sıra önemlidir:
 *  1. Sert eşik — altındaki veri hiç okunmaz.
 *  2. Yön karşılaştırması — "küçük geldi" sayısı "büyük geldi"den KESİN fazla
 *     olmalı. Bu olmadan 10/10 bölünmüş bir üründe hem yukarı hem aşağı
 *     kaydırma koşulu sağlanabilirdi.
 *  3. Wilson alt sınırı — yön net mi, yoksa örneklem mi konuşuyor.
 *  4. Hiçbiri tutmuyorsa CONFLICTING: veri var ama bir şey söylemiyor.
 *     Bu bilgi ATILMAZ; motorda güveni DÜŞÜRÜR, çünkü bedenleri tutarsız
 *     bir ürün gerçekten daha riskli bir alışveriştir.
 */
export function evaluateFitSignal(
  summary: FitFeedbackSummary,
  minCount: number = SIZE_ENGINE.minFeedbackCountToUse,
): FitVerdict {
  const total = feedbackTotal(summary);

  // ⚠️ SERT EŞİK. Buradan aşağısı okunmaz.
  if (total < minCount) return INSUFFICIENT(total);

  const weight = evidenceWeight(total, minCount);
  const { minDominance } = FIT_SIGNAL_TUNING;

  if (summary.tooSmall > summary.tooLarge) {
    const lowerBound = wilsonLowerBound(summary.tooSmall, total);
    if (lowerBound >= minDominance) return { kind: 'RUNS_SMALL', total, weight, lowerBound };
  } else if (summary.tooLarge > summary.tooSmall) {
    const lowerBound = wilsonLowerBound(summary.tooLarge, total);
    if (lowerBound >= minDominance) return { kind: 'RUNS_LARGE', total, weight, lowerBound };
  }

  const trueToSizeBound = wilsonLowerBound(summary.trueToSize, total);
  if (trueToSizeBound >= minDominance) {
    return { kind: 'TRUE_TO_SIZE', total, weight, lowerBound: trueToSizeBound };
  }

  return { kind: 'CONFLICTING', total, weight, lowerBound: trueToSizeBound };
}

/**
 * MARKA BAZLI KARAR.
 *
 * Ürün kararının aynısı, ama İKİ ek kapıyla:
 *  - eğilim en az `minDistinctProductsForBrand` farklı üründe görülmeli,
 *  - toplam geri bildirim, ürün eşiğinin `brandThresholdMultiplier` katı olmalı.
 *
 * ⚠️ Bu kapılar olmadan tek bir hatalı beden tablosu, markanın tüm kataloğunu
 *    bir beden kaydırırdı.
 */
export function evaluateBrandFitSignal(signal: BrandFitSignal): FitVerdict {
  const total = feedbackTotal(signal.summary);
  const { minDistinctProductsForBrand, brandThresholdMultiplier } = FIT_SIGNAL_TUNING;

  if (signal.distinctProducts < minDistinctProductsForBrand) return INSUFFICIENT(total);

  return evaluateFitSignal(
    signal.summary,
    SIZE_ENGINE.minFeedbackCountToUse * brandThresholdMultiplier,
  );
}

/**
 * Kararı kalıba çevirir.
 *
 * "Küçük geliyor" ile "dar kalıplı" aynı düzeltmedir: bir beden büyük öner.
 * Bu eşleme sayesinde öğrenilen sinyal, satıcının beyan ettiği kalıpla AYNI
 * mekanizmayı kullanır — iki ayrı kaydırma yolu olmaz.
 *
 * `null` dönmesi "bu karardan kalıp çıkarılamaz" demektir (eşik altı veya
 * çelişkili) — REGULAR ile karıştırılmamalı: REGULAR bir BİLGİDİR
 * ("bedenler doğru"), null bilgisizliktir.
 */
export function verdictToBrandFit(kind: FitVerdictKind): BrandFit | null {
  switch (kind) {
    case 'RUNS_SMALL':
      return 'SLIM';
    case 'RUNS_LARGE':
      return 'OVERSIZE';
    case 'TRUE_TO_SIZE':
      return 'REGULAR';
    case 'INSUFFICIENT':
    case 'CONFLICTING':
      return null;
  }
}

/** Kalıbın merdivende kaç adım kaydırdığı. Tek kaynak: @vt/config. */
export function fitShiftSteps(fit: BrandFit): number {
  return SIZE_ENGINE.fitAdjustment[fit];
}

/** Bir bedenin listede kaç kez geçtiği — tekrar, kanıtın ağırlığıdır. */
function countOf(sizes: readonly string[], size: string): number {
  return sizes.reduce((n, current) => (current === size ? n + 1 : n), 0);
}

/**
 * KİŞİSEL KANIT — çelişkiler ayıklanmış hâli.
 *
 * Aynı beden hem tutulmuş hem beden yüzünden iade edilmişse (kullanıcı iki kez
 * almış, iki farklı sonuç) o beden hakkında bir şey BİLMİYORUZ demektir.
 * Böyle bir bedeni "tutuldu" sayarsak, kullanıcıya daha önce iade ettiği
 * bedeni önerme riskimiz olur — güvenilirliği en hızlı yıkan hata budur.
 */
export interface UserSizeEvidence {
  keptForProduct: readonly string[];
  keptForBrand: readonly string[];
  returnedForProduct: readonly UserReturnedSize[];
  /** Aynı bedenin hem tutulup hem iade edildiği, yok sayılan durumlar. */
  hasContradiction: boolean;
}

export function resolveUserSizeEvidence(history: UserSizeHistory): UserSizeEvidence {
  const returnedSizes = new Set(history.returnedSizesForProduct.map((r) => r.size));

  const keptForProduct = history.keptSizesForProduct.filter((size) => !returnedSizes.has(size));
  const hasContradiction = keptForProduct.length !== history.keptSizesForProduct.length;

  return {
    keptForProduct,
    keptForBrand: history.keptSizesForBrand,
    returnedForProduct: history.returnedSizesForProduct,
    hasContradiction,
  };
}

/**
 * Kişisel gözlemin kanıt ağırlığı (0..1).
 *
 * ⚠️ Buraya `minFeedbackCountToUse` UYGULANMAZ ve bu bilinçlidir: o eşik
 *    YABANCILARIN görüşündeki gürültüye karşıdır. Kullanıcının kendi tuttuğu
 *    giysi gürültü değil, doğrudan ölçümdür. Yine de tek gözlem yarım
 *    ağırlıkta kalır — bir kez tutmak "bu beden bana olur"un kanıtıdır,
 *    "başka beden olmaz"ın değil.
 */
export function personalWeight(observationCount: number): number {
  return evidenceWeight(observationCount, FIT_SIGNAL_TUNING.personalThreshold);
}

export function keptCount(sizes: readonly string[], size: string): number {
  return countOf(sizes, size);
}
