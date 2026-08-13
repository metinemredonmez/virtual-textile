import { SIZE_ENGINE } from '@vt/config';
import type { SizeReasonCodeWire } from '@vt/contracts';
import {
  evaluateBrandFitSignal,
  evaluateFitSignal,
  feedbackTotal,
  fitShiftSteps,
  keptCount,
  personalWeight,
  resolveUserSizeEvidence,
  verdictToBrandFit,
  type BrandFit,
  type BrandFitSignal,
  type FitFeedbackSummary,
  type FitVerdict,
  type UserSizeHistory,
} from './fit-learning.js';

/**
 * BEDEN ÖNERİ MOTORU — ML YOK, ŞEFFAF KURAL + İSTATİSTİK
 *
 * Neden model değil kural: beden önerisi yanlış olduğunda bedeli iade
 * kargosudur ve doğrudan satıcının cebinden çıkar. Bir modelin neden "L"
 * dediğini açıklayamayız; kuralın neden "L" dediğini satır satır gösterebiliriz.
 * Kullanıcı da satıcı da bu gerekçeyi görür, itiraz edebilir, biz de düzeltiriz.
 *
 * Motor artık saf ölçü karşılaştırması değil: gerçek iade ve yorum verisi de
 * girdidir. Ama öğrenen bir model DEĞİL — sayım, oran ve güven aralığından
 * ibaret bir düzeltme (bkz. `fit-learning.ts`). Açıklanabilirlik korunur.
 *
 * ⚠️ ÇIKTI HER ZAMAN "TAHMİN"DİR. `SIZE_DISCLAIMER` metni yanıttan
 *    çıkarılamaz; kesinlik iddiası hem yanlış hem de ticari olarak riskli olur.
 *
 * ⚠️ TEK KAYDIRMA KURALI. Giysinin kalıbı için merdivende EN FAZLA BİR adım
 *    kaydırma yapılır. Beyan edilen kalıp, ürün geri bildirimi ve marka
 *    eğilimi çoğu zaman AYNI OLGUYU üç kez ölçer; üçünü toplasaydık öneri iki
 *    beden şaşardı. Bu yüzden aralarında yarışırlar, toplanmazlar.
 */

/** Ürünün beden tablosu: {"M": {"chest": 98, "waist": 78, "length": 70}} */
export type SizeChart = Record<string, Record<string, number>>;

export interface BodyMeasurements {
  chestCm?: number | null;
  waistCm?: number | null;
  hipCm?: number | null;
  /**
   * Omuz genişliği (cm) — omuz ucundan omuz ucuna, sırttan.
   * Seed `UST_BEDEN_TABLOSU.omuz` sütunuyla eşleşir (XS 37 … XL 46).
   * ⚠️ ÇEVRE sınıfındadır: skorlar VE eşleşme sayısına girer.
   */
  shoulderCm?: number | null;
  /**
   * İç bacak boyu (cm). Seed `ALT_BEDEN_TABLOSU.icBoy` ile eşleşir.
   * ⚠️ UZUNLUK sınıfındadır: yalnızca BERABERLİK bozar, güven üretmez.
   *    Gerekçe `CEVRE_ALANLARI` başlığında aritmetiğiyle yazılı.
   */
  inseamCm?: number | null;
  heightCm?: number | null;
  weightKg?: number | null;
  /** Kullanıcının "normalde giydiğim" bedeni — doğrulama sinyali. */
  usualSize?: string | null;
}

/**
 * Kalıp vokabülerinin sahibi `fit-learning.ts`'tir (kanıt katmanı); motor onu
 * tüketir. Buradan yeniden dışa açılıyor ki mevcut tüketiciler
 * (`ai.ports.ts`, `index.ts`) tek bir yerden okumaya devam etsin.
 */
export type { BrandFit, FitFeedbackSummary, BrandFitSignal, UserSizeHistory };

export interface SizeEngineInput {
  sizeChart: SizeChart;
  measurements: BodyMeasurements;
  /** Markanın BEYAN edilen kalıbı — ürün AI etiketlerinden veya satıcıdan. */
  brandFit?: BrandFit | null;
  /** Kullanıcının kalıp TERCİHİ (dar/bol sevme) — markanın kalıbından ayrıdır. */
  fitPreference?: BrandFit | null;
  /** Bu ÜRÜN için toplanmış iade + yorum sinyali. */
  feedback?: FitFeedbackSummary | null;
  /** Aynı MARKANIN tüm ürünlerinden toplanmış sinyal. */
  brandSignal?: BrandFitSignal | null;
  /**
   * Kullanıcının kendi satın alma geçmişi.
   * ⚠️ Yalnızca giriş yapmış kullanıcıda dolu olur; misafirde null'dır ve
   *    olmaması bir eksiklik değildir — kişisel veri toplamadan öneri veririz.
   */
  userHistory?: UserSizeHistory | null;
}

/**
 * Şeffaflık: öneriyi oluşturan her adım kullanıcıya gösterilir.
 *
 * ⚠️ `code` ARTIK ELLE YAZILMIYOR — tek kaynak `@vt/contracts` içindeki
 *    `SIZE_REASON_CODES`. Burada 15 üyelik bir kopya duruyordu ve SAPMIŞTI:
 *    motorun ürettiği `USER_KEPT_SIZE`, `USER_RETURNED_SIZE`,
 *    `USER_BRAND_HISTORY`, `USUAL_SIZE_AGREES`, `USUAL_SIZE_CONFLICTS`
 *    kodlarının BEŞİ DE telde yoktu; teldeki `USER_HISTORY` ise motorda hiç
 *    üretilmiyordu. İki liste ayrı ayrı yaşadığı sürece bu sapma sessizdi.
 *    Bağlandıktan sonra motor yeni bir kod üretip tele yazmayı UNUTAMAZ —
 *    derleme kırılır.
 */
export interface SizeReason {
  code: SizeReasonCodeWire;
  message: string;
}

export type SizeEngineResult =
  | {
      kind: 'RECOMMENDATION';
      recommendedSize: string;
      /** İkinci en yakın beden — "arada kaldıysanız" kutusu için. */
      alternativeSize: string | null;
      confidence: number;
      reasons: SizeReason[];
      orderedSizes: string[];
      disclaimer: string;
    }
  | {
      /**
       * ⚠️ Güven eşiğin altında: ÖNERİ GÖSTERİLMEZ.
       * Zayıf bir öneri, hiç öneri olmamasından daha kötüdür — kullanıcı ona
       * güvenip yanlış beden alır ve iade eder.
       */
      kind: 'CHART_ONLY';
      confidence: number;
      reasons: SizeReason[];
      orderedSizes: string[];
      disclaimer: string;
    };

export const SIZE_DISCLAIMER =
  'Bu bir tahmindir. Ölçüleriniz ve ürünün beden tablosu karşılaştırılarak hesaplanır; ' +
  'markanın kalıbı ve kumaşın esnekliği sonucu değiştirebilir.';

/**
 * BOLLUK PAYI (ease) — vücut ölçüsü ile giysi ölçüsü arasındaki fark.
 *
 * Beden tablosu GİYSİ ölçüsüdür, vücut ölçüsü değil. 98 cm göğüs ölçülü bir
 * tişört, 98 cm göğüslü birine dar gelir. Bu tablo olmadan motor sistematik
 * olarak bir beden küçük önerir.
 *
 * ⚠️ Değerler sektör ortalamasıdır, ölçüm değildir. İade verisi biriktikçe
 *    kategori bazında kalibre edilmelidir (bkz. docs/size-engine.md).
 */
const IDEAL_EASE_CM: Record<string, number> = {
  chest: 6,
  waist: 5,
  hip: 6,
  /**
   * ⚠️ OMUZDA BOLLUK PAYI SIFIRA YAKIN. Göğüs/bel/kalça giysinin İÇİNDE
   *    kalan çevrelerdir; omuz ise dikiş çizgisinin OTURDUĞU noktadır.
   *    6 cm bolluk verilen bir omuz, omzu düşük bir giysi demektir — regular
   *    kalıpta arıza, oversize kalıpta zaten `fitAdjustment` işini yapıyor.
   *    2 cm dikiş payıdır; varsayılan 5'i devralsaydı motor sistematik olarak
   *    bir beden büyük önerirdi.
   */
  shoulder: 2,
  omuz: 2,
};

/**
 * Beden tablosu anahtarı → vücut ölçüsü alanı.
 *
 * ⚠️ BU HARİTA ÜÇ ÖLÇÜ TANIYORDU VE İKİ SÜTUN SESSİZCE ÇÖPE GİDİYORDU.
 *    Ölçüldü: `ALT_BEDEN_TABLOSU` her bedende `icBoy` taşıyor (76/77/78/79)
 *    ve `scoreSizes` onu `if (!field) continue;` ile atlıyordu. Yani veri
 *    yazılmış, okunmuyordu — bu deponun altı kez yaşadığı sınıfın bir örneği,
 *    bu sefer bir `Record` içinde.
 *
 * ⚠️ `boy` (üst giyim boyu) BİLEREK EŞLEŞTİRİLMEDİ ve bu bir eksiklik değil,
 *    bir KARAR: karşılığı olacak vücut ölçüsü "gövde boyu"dur ve onu
 *    TOPLAMIYORUZ. Var olmayan bir alana eşlemek ya da kullanıcının boyundan
 *    türetmek (kaynaklı katsayı yok) sessizce yanlış olurdu. Sütun tabloda
 *    kalıyor — ölçü tablosu ekranında kullanıcıya GÖSTERİLİYOR, yalnızca
 *    skorlamaya girmiyor.
 */
const DIMENSION_TO_MEASUREMENT: Record<string, keyof BodyMeasurements> = {
  chest: 'chestCm',
  bust: 'chestCm',
  gogus: 'chestCm',
  waist: 'waistCm',
  bel: 'waistCm',
  hip: 'hipCm',
  kalca: 'hipCm',
  shoulder: 'shoulderCm',
  omuz: 'shoulderCm',
  inseam: 'inseamCm',
  icboy: 'inseamCm',
};

/**
 * ÇEVRE ÖLÇÜLERİ — skorlamaya TAM girerler.
 *
 * ⚠️ UZUNLUK ÖLÇÜLERİ (iç bacak boyu) BU LİSTEDE YOK ve sebebi aritmetik:
 *
 *      bel    66 → 81 cm   (15 cm aralık, dört beden)
 *      kalça  92 → 107 cm  (15 cm)
 *      icBoy  76 → 79 cm   ( 3 cm)
 *
 *    `scoreSizes` sapmaların ORTALAMASINI alıyor. `icBoy` ortalamaya girseydi
 *    her bedende neredeyse aynı küçük sapmayı üretip aradaki GERÇEK farkı
 *    (bel/kalça) seyreltirdi: 26 ile 30 arasındaki 15 cm'lik ayrım, üçüncü
 *    bir boyutla bölününce 10 cm'e iner ve iki beden birbirine yaklaşır.
 *    Yani uzunluğu skora katmak öneriyi İYİLEŞTİRMEZ, BULANIKLAŞTIRIR.
 *
 *    Uzunluğun doğru yeri BERABERLİK BOZMAK: çevre ölçüleri iki bedeni eşit
 *    yakın bulduğunda iç bacak boyu hangisinin uygun olduğunu söyleyebilir.
 *    `uzunlukFarki()` tam olarak bunu yapıyor.
 */
const CEVRE_ALANLARI = new Set<keyof BodyMeasurements>([
  'chestCm',
  'waistCm',
  'hipCm',
  'shoulderCm',
]);

/**
 * Harf bedenlerin sırası. Sıralama olmadan "bir beden büyük" ifadesi
 * tanımsızdır — kalıp düzeltmesi ve geri bildirim kaydırması buna dayanır.
 */
const ALPHA_LADDER = ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '4XL', '5XL'];

const ALPHA_ALIASES: Record<string, string> = {
  '3XS': 'XXXS',
  '2XS': 'XXS',
  '2XL': 'XXL',
  '3XL': 'XXXL',
  XXXXL: '4XL',
  XXXXXL: '5XL',
};

function normalizeSizeLabel(label: string): string {
  const upper = label.trim().toUpperCase();
  return ALPHA_ALIASES[upper] ?? upper;
}

/**
 * Bedenleri küçükten büyüğe sıralar.
 * Harf bedenler merdivene, sayısal bedenler (34, 36, 38) değerine göre dizilir.
 * Tanınmayanlar sona alınır — sıralanamayan bir bedeni sıraya sokmaya çalışmak
 * sessizce yanlış öneri üretir.
 */
export function orderSizes(labels: readonly string[]): string[] {
  const rank = (label: string): [number, number, string] => {
    const normalized = normalizeSizeLabel(label);
    const alphaIndex = ALPHA_LADDER.indexOf(normalized);
    if (alphaIndex >= 0) return [0, alphaIndex, normalized];

    const numeric = Number.parseFloat(normalized.replace(',', '.'));
    if (Number.isFinite(numeric)) return [1, numeric, normalized];

    return [2, 0, normalized];
  };

  return [...labels].sort((a, b) => {
    const [groupA, valueA, textA] = rank(a);
    const [groupB, valueB, textB] = rank(b);
    if (groupA !== groupB) return groupA - groupB;
    if (valueA !== valueB) return valueA - valueB;
    return textA.localeCompare(textB, 'tr');
  });
}

interface Scored {
  size: string;
  /** Ortalama sapma (cm) — YALNIZCA çevre ölçülerinden. Küçük = daha iyi. */
  deviationCm: number;
  /** ⚠️ Çevre ölçüsü sayısı. Güven bundan hesaplanıyor; uzunluk BURAYA GİRMEZ. */
  matchedDimensions: number;
  /**
   * Uzunluk ölçülerinin toplam sapması (cm). `null` = karşılaştırılamadı
   * (ürünün uzunluk sütunu yok ya da kullanıcı o ölçüyü vermedi).
   * ⚠️ Skoru DEĞİŞTİRMEZ; yalnızca beraberlikte kullanılır.
   */
  uzunlukFarkiCm: number | null;
}

function scoreSizes(chart: SizeChart, measurements: BodyMeasurements): Scored[] {
  const scored: Scored[] = [];

  for (const [size, dimensions] of Object.entries(chart)) {
    let total = 0;
    let matched = 0;
    let uzunlukToplam = 0;
    let uzunlukSayisi = 0;

    for (const [rawDimension, garmentCm] of Object.entries(dimensions)) {
      const anahtar = rawDimension.trim().toLowerCase();
      const field = DIMENSION_TO_MEASUREMENT[anahtar];
      if (!field) continue;

      const bodyCm = measurements[field];
      if (typeof bodyCm !== 'number' || !Number.isFinite(garmentCm)) continue;

      const ease = IDEAL_EASE_CM[anahtar] ?? 5;
      const sapma = Math.abs(garmentCm - (bodyCm + ease));

      /**
       * ⚠️ ÇEVRE VE UZUNLUK AYRI KOVALARA GİDER. Gerekçe `CEVRE_ALANLARI`
       *    başlığında aritmetiğiyle yazılı: uzunluğu ortalamaya katmak
       *    bedenler arası gerçek farkı seyreltiyor.
       */
      if (CEVRE_ALANLARI.has(field)) {
        total += sapma;
        matched += 1;
      } else {
        uzunlukToplam += sapma;
        uzunlukSayisi += 1;
      }
    }

    /**
     * ⚠️ YALNIZCA UZUNLUK EŞLEŞMİŞSE BEDEN LİSTEYE GİRMEZ. İç bacak boyu tek
     *    başına beden söylemez — 26 ile 32 arasındaki `icBoy` farkı 3 cm,
     *    yani gürültü. Girseydi motor "sadece boyunuzu verdiniz" durumunda
     *    dayanaksız bir beden önerirdi; oysa doğru cevap ölçü istemektir.
     */
    if (matched > 0) {
      scored.push({
        size,
        deviationCm: total / matched,
        matchedDimensions: matched,
        uzunlukFarkiCm: uzunlukSayisi > 0 ? uzunlukToplam / uzunlukSayisi : null,
      });
    }
  }

  /**
   * ⚠️ BERABERLİKTE UZUNLUK KARAR VERİR. Çevre sapmaları 0,5 cm'den yakınsa
   *    iki beden pratikte aynıdır; orada uzunluğa bakmak öneriyi keskinleştirir.
   *    Eşik 0,5: ölçüldü — seed tablolarında bedenler arası en küçük çevre
   *    adımı 4 cm (bel 66→70), yani 0,5 cm gerçek bir ayrım DEĞİL, sayısal
   *    yakınlıktır.
   */
  return scored.sort((a, b) => {
    const fark = a.deviationCm - b.deviationCm;
    if (Math.abs(fark) >= 0.5) return fark;
    if (a.uzunlukFarkiCm !== null && b.uzunlukFarkiCm !== null) {
      return a.uzunlukFarkiCm - b.uzunlukFarkiCm;
    }
    return fark;
  });
}

/**
 * GİRDİ MANTIK DENETİMİ — boy ve kilonun TEK MEŞRU KULLANIMI.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⚠️ BOY VE KİLO SKORLAMAYA GİRMEZ VE BU BİLİNÇLİ BİR REDDİR.
 *
 *  Beden tablosunda "boy: 172" diye bir satır yok; yani mesafe hesabına
 *  DOĞRUDAN giremezler. Girebilmelerinin tek yolu boy+kilodan göğüs/bel/kalça
 *  KESTİRMEK olurdu ve bu bir ANTROPOMETRİK MODEL iddiasıdır: elimizde
 *  kaynaklı bir katsayı seti YOK. Uydurulmuş bir katsayı, kullanıcıya
 *  bilimsel GÖRÜNEN bir tahmin sunmak demektir — yanlış beden alır, iadeyi
 *  satıcı öder ve biz "motor öyle dedi" deriz. Bunu yapmıyoruz.
 *
 *  Aşağıdakiler MODEL DEĞİL, VERİ GİRİŞİ DENETİMİdir. Hiçbiri "şu boyda şu
 *  beden olur" demiyor; yalnızca "bu değerler birlikte İMKÂNSIZ" diyor.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * ⚠️ GEOMETRİK SAÇMALIK — istatistik değil. Bir insanın göğüs/bel/kalça
 *    ÇEVRESİ, toplam BOYUNDAN büyük olamaz. Bu bir dağılım iddiası değil;
 *    böyle bir girdi neredeyse kesinlikle yazım hatası ya da birim karışması
 *    (inç ↔ cm) demektir. Öneriyi DEĞİŞTİRMEZ, güveni düşürür ve söyler.
 */
function olculerImkansizMi(m: BodyMeasurements): boolean {
  if (typeof m.heightCm !== 'number') return false;
  const cevreler = [m.chestCm, m.waistCm, m.hipCm].filter(
    (v): v is number => typeof v === 'number',
  );
  return cevreler.some((cevre) => cevre > m.heightCm!);
}

/**
 * ⚠️ BMI BURADA BİR SAĞLIK ÖLÇÜSÜ DEĞİL, BİRİM DENETİMİ. Sınırlar 10 ve 80;
 *    ikisi de yaşayan bir insan aralığının çok dışında. Tipik yakaladığı hata:
 *    kilonun libre (lb) olarak girilmesi — 70 kg yerine 154 yazılınca BMI
 *    ikiye katlanır. "Zayıf/kilolu" gibi bir yargı ÜRETMEZ ve öneriyi
 *    değiştirmez; yalnızca girdinin okunamadığını söyler.
 *
 * ⚠️ Sınırlar GENİŞ TUTULDU. Dar bir aralık (ör. 15-40) gerçek kullanıcıları
 *    "hatalı" diye işaretlerdi; bu denetimin işi tipo yakalamak, insan elemek
 *    değil.
 */
function boyKiloImkansizMi(m: BodyMeasurements): boolean {
  if (typeof m.heightCm !== 'number' || typeof m.weightKg !== 'number') return false;
  const metre = m.heightCm / 100;
  const bmi = m.weightKg / (metre * metre);
  return bmi < 10 || bmi > 80;
}

/** Kullanıcı yalnız boy/kilo verdiyse — çevre ölçüsü yoksa öneri kurulamaz. */
function yalnizBoyKilo(m: BodyMeasurements): boolean {
  const cevreVar =
    typeof m.chestCm === 'number' ||
    typeof m.waistCm === 'number' ||
    typeof m.hipCm === 'number' ||
    typeof m.shoulderCm === 'number';
  const boyKiloVar = typeof m.heightCm === 'number' || typeof m.weightKg === 'number';
  return !cevreVar && boyKiloVar;
}

/** Beden tablosunda uzunluk sütunu var mı (icBoy/inseam)? */
function tabloUzunlukTasiyorMu(chart: SizeChart): boolean {
  return Object.values(chart).some((boyutlar) =>
    Object.keys(boyutlar).some((ad) => {
      const alan = DIMENSION_TO_MEASUREMENT[ad.trim().toLowerCase()];
      return alan !== undefined && !CEVRE_ALANLARI.has(alan);
    }),
  );
}

/** Bir bedeni merdivende `steps` kadar kaydırır; uçlarda kırpılır. */
function shiftSize(ordered: string[], size: string, steps: number): string {
  const index = ordered.indexOf(size);
  if (index < 0) return size;
  const next = Math.min(ordered.length - 1, Math.max(0, index + steps));
  return ordered[next] ?? size;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * GÜVENİN KANIT KAYNAKLARINA GÖRE TAVANLARI.
 *
 * ⚠️ Bunlar TAVANDIR, sabit ekleme değil. Her biri kanıt ağırlığıyla
 *    (`evidenceWeight`, 0..1) ÇARPILIR. Bu çarpım bu görevin çekirdeğidir:
 *    eşiği yeni geçen 5 geri bildirim tavanın yarısını, 50 geri bildirim
 *    %90'ını verir. Sabit bir ekleme yapsaydık 5 kişiyle 500 kişi aynı güveni
 *    üretirdi — kullanıcı da aradaki farkı göremezdi.
 *
 * Sıralamanın gerekçesi: kullanıcının KENDİ tuttuğu giysi > bu ürünün alıcı
 * verisi > markanın geneli. Kanıt özelleştikçe değeri artar.
 */
const CONFIDENCE_CAP = {
  /** Bu ürünün alıcı verisi. */
  productFeedback: 20,
  /** Marka geneli — daha geniş genelleme, daha az güven. */
  brandFeedback: 10,
  /**
   * ⚠️ NEGATİF. Bedenleri tutarsız bir ürün gerçekten daha riskli bir
   *    alışveriştir; bunu gizlemek yerine güveni düşürüp söylüyoruz.
   */
  conflictingFeedback: -10,
  /** Kullanıcının bu üründen tuttuğu beden — elimizdeki en güçlü kanıt. */
  userKeptForProduct: 25,
  /** Beden yüzünden iade — güçlü negatif kanıt, ama yönü kesin. */
  userReturnedForProduct: 18,
  /** Aynı markadan tutulan beden; kategori değişince kalıp da değişir. */
  userKeptForBrand: 6,
  /** Markadaki geçmişiyle belirgin çelişki. */
  userBrandConflict: -8,
} as const;

/** Giysinin kalıbına dair nihai karar ve nereden geldiği. */
interface GarmentFitDecision {
  fit: BrandFit;
  source: 'DECLARED' | 'PRODUCT_FEEDBACK' | 'BRAND_FEEDBACK' | 'NONE';
  verdict: FitVerdict | null;
}

/**
 * KALIP KARARI — ÖLÇÜLEN DAVRANIŞ, BEYANI EZER.
 *
 * Öncelik: ürün geri bildirimi → marka eğilimi → satıcı beyanı.
 *
 * Neden veri beyanı eziyor: satıcının "regular kalıp" demesi bir iddiadır;
 * 200 alıcının bir beden büyük alıp tutması ölçümdür. Beyanı ölçümün ÜSTÜNE
 * eklemek ise aynı olguyu iki kez sayıp öneriyi iki beden şaşırtırdı.
 *
 * ⚠️ TRUE_TO_SIZE de bir KARARDIR, bilgisizlik değil: alıcılar "bedenler
 *    doğru" diyorsa, beyan edilen SLIM kalıp uygulanMAZ. Kalıbın dar olması
 *    bedenin küçük olduğu anlamına gelmez; alıcı verisi tam da bu ayrımı bilir.
 */
function resolveGarmentFit(
  declared: BrandFit | null,
  productVerdict: FitVerdict | null,
  brandVerdict: FitVerdict | null,
): GarmentFitDecision {
  const fromProduct = productVerdict ? verdictToBrandFit(productVerdict.kind) : null;
  if (fromProduct) return { fit: fromProduct, source: 'PRODUCT_FEEDBACK', verdict: productVerdict };

  const fromBrand = brandVerdict ? verdictToBrandFit(brandVerdict.kind) : null;
  if (fromBrand) return { fit: fromBrand, source: 'BRAND_FEEDBACK', verdict: brandVerdict };

  if (declared) return { fit: declared, source: 'DECLARED', verdict: null };

  return { fit: 'REGULAR', source: 'NONE', verdict: null };
}

/** Kaydırmanın gerekçesi — hangi KANITTAN geldiği kullanıcıya da görünür. */
function garmentFitReason(
  source: GarmentFitDecision['source'],
  runsSmall: boolean,
  shifted: string,
): SizeReason {
  if (source === 'PRODUCT_FEEDBACK') {
    return {
      code: 'RETURN_FEEDBACK',
      message: runsSmall
        ? `Alıcıların çoğu bu ürünün küçük geldiğini bildirdi; bir beden büyük (${shifted}) öneriliyor.`
        : `Alıcıların çoğu bu ürünün büyük geldiğini bildirdi; bir beden küçük (${shifted}) öneriliyor.`,
    };
  }

  if (source === 'BRAND_FEEDBACK') {
    return {
      code: 'BRAND_FIT_LEARNED',
      message: runsSmall
        ? `Bu markanın ürünleri genelde küçük geliyor; bir beden büyük (${shifted}) öneriliyor.`
        : `Bu markanın ürünleri genelde büyük geliyor; bir beden küçük (${shifted}) öneriliyor.`,
    };
  }

  return {
    code: 'BRAND_FIT',
    message: runsSmall
      ? `Ürün dar kalıplı; bir beden büyük (${shifted}) öneriliyor.`
      : `Ürün bol kalıplı; bir beden küçük (${shifted}) öneriliyor.`,
  };
}

/** Etiket eşanlamlılarını (2XL/XXL) hesaba katan merdiven araması. */
function indexOfSize(ordered: readonly string[], label: string): number {
  const target = normalizeSizeLabel(label);
  return ordered.findIndex((s) => normalizeSizeLabel(s) === target);
}

/**
 * KULLANICININ KENDİ GEÇMİŞİ.
 *
 * İki kanıt türü ve aralarındaki ASİMETRİ:
 *  - TUTULAN beden pozitif ama yumuşak kanıttır: insanlar biraz bol/dar bir
 *    şeyi de tutar (iade etmek zahmetlidir).
 *  - BEDEN YÜZÜNDEN İADE edilen beden sert kanıttır: kimse üstüne olan bir
 *    şeyi kargoyla geri göndermez. Bu yüzden iade, tutulan bedenin ÜSTÜNE
 *    uygulanır ve son sözü söyler.
 *
 * ⚠️ Bu yüzden bir bedeni "kullanıcı bunu iade etmişti" diye dışarıda
 *    bırakmak, "kullanıcı bunu tutmuştu" diye önermekten daha önceliklidir.
 */
function applyUserHistory(
  history: UserSizeHistory,
  orderedSizes: readonly string[],
  current: string,
  reasons: SizeReason[],
): { size: string; confidenceDelta: number } {
  const evidence = resolveUserSizeEvidence(history);
  let size = current;
  let confidenceDelta = 0;
  let usedProductEvidence = false;

  // ── 1. Bu üründen tutulan beden ─────────────────────────────────────────
  const keptCandidates = evidence.keptForProduct
    .map((label) => ({ label, index: indexOfSize(orderedSizes, label) }))
    .filter((c) => c.index >= 0);

  if (keptCandidates.length > 0) {
    const currentIndex = indexOfSize(orderedSizes, size);
    // Birden çok beden tutulmuşsa (ör. iki renk, iki beden) mevcut öneriye en
    // yakın olanı seçilir: hangisinin "doğru" olduğunu bilmiyoruz, en az
    // sürprizli olanı tercih ederiz.
    const chosen = keptCandidates.reduce((best, candidate) =>
      Math.abs(candidate.index - currentIndex) < Math.abs(best.index - currentIndex)
        ? candidate
        : best,
    );
    const label = orderedSizes[chosen.index] ?? chosen.label;
    const weight = personalWeight(keptCount(evidence.keptForProduct, chosen.label));

    confidenceDelta += CONFIDENCE_CAP.userKeptForProduct * weight;
    usedProductEvidence = true;

    reasons.push({
      code: 'USER_KEPT_SIZE',
      message:
        label === size
          ? `Bu üründen daha önce ${label} beden almıştınız ve iade etmemiştiniz.`
          : `Bu üründen daha önce ${label} beden almıştınız ve iade etmemiştiniz; öneri buna göre ${label}.`,
    });
    size = label;
  }

  // ── 2. Beden yüzünden iade edilen bedenler ──────────────────────────────
  const returns = evidence.returnedForProduct
    .map((r) => ({ ...r, index: indexOfSize(orderedSizes, r.size) }))
    .filter((r) => r.index >= 0);

  if (returns.length > 0) {
    let minAllowed = 0;
    let maxAllowed = orderedSizes.length - 1;

    for (const item of returns) {
      if (item.direction === 'TOO_SMALL') minAllowed = Math.max(minAllowed, item.index + 1);
      else maxAllowed = Math.min(maxAllowed, item.index - 1);
    }

    const currentIndex = indexOfSize(orderedSizes, size);

    // ⚠️ minAllowed > maxAllowed: kullanıcı aynı üründen hem "küçük geldi" hem
    //    "büyük geldi" diye iade etmiş ve aralarında geçerli beden kalmamış.
    //    Böyle bir geçmişten beden çıkarılamaz — kanıt SESSİZCE UYGULANMAZ,
    //    zorlama bir beden üretmek yerine ölçü kararında kalınır.
    if (minAllowed <= maxAllowed && currentIndex >= 0) {
      const bounded = Math.min(maxAllowed, Math.max(minAllowed, currentIndex));
      const weight = personalWeight(returns.length);
      const blocking = returns.find((r) =>
        r.direction === 'TOO_SMALL' ? r.index >= currentIndex : r.index <= currentIndex,
      );

      confidenceDelta += CONFIDENCE_CAP.userReturnedForProduct * weight;
      usedProductEvidence = true;

      if (bounded !== currentIndex) {
        const shifted = orderedSizes[bounded];
        if (shifted) {
          reasons.push({
            code: 'USER_RETURNED_SIZE',
            message:
              blocking?.direction === 'TOO_LARGE'
                ? `Bu üründen aldığınız ${blocking.size} beden size büyük gelmişti; öneri ${shifted} bedene çekildi.`
                : `Bu üründen aldığınız ${blocking?.size ?? size} beden size küçük gelmişti; öneri ${shifted} bedene çekildi.`,
          });
          size = shifted;
        }
      } else {
        const returned = returns[0]!;
        reasons.push({
          code: 'USER_RETURNED_SIZE',
          message:
            returned.direction === 'TOO_SMALL'
              ? `Bu üründen aldığınız ${returned.size} beden size küçük gelmişti; öneri onun üzerinde.`
              : `Bu üründen aldığınız ${returned.size} beden size büyük gelmişti; öneri onun altında.`,
        });
      }
    }
  }

  // ── 3. Aynı markadaki geçmiş ────────────────────────────────────────────
  // ⚠️ Yalnızca ÜRÜN düzeyinde kanıt YOKSA bakılır. Aynı markanın montu ile
  //    tişörtü aynı beden merdivenini paylaşmaz; bu sinyal bedeni KAYDIRMAZ,
  //    sadece güveni oynatır.
  if (!usedProductEvidence && evidence.keptForBrand.length > 0) {
    const currentIndex = indexOfSize(orderedSizes, size);
    const distances = evidence.keptForBrand
      .map((label) => indexOfSize(orderedSizes, label))
      .filter((index) => index >= 0)
      .map((index) => Math.abs(index - currentIndex));

    if (currentIndex >= 0 && distances.length > 0) {
      const nearest = Math.min(...distances);
      const weight = personalWeight(evidence.keptForBrand.length);

      if (nearest === 0) {
        confidenceDelta += CONFIDENCE_CAP.userKeptForBrand * weight;
        reasons.push({
          code: 'USER_BRAND_HISTORY',
          message: `Bu markadan daha önce aldığınız ${size} bedeni iade etmemiştiniz.`,
        });
      } else if (nearest >= 2) {
        // İki sinyal birbirini tutmuyor; hangisinin doğru olduğunu bilmiyoruz.
        // Gizlemek yerine güveni düşürüp kullanıcıya söylüyoruz.
        confidenceDelta += CONFIDENCE_CAP.userBrandConflict * weight;
        reasons.push({
          code: 'USER_BRAND_HISTORY',
          message: `Bu markadan daha önce farklı bir beden almıştınız; öneri (${size}) ondan belirgin biçimde uzak.`,
        });
      }
    }
  }

  return { size, confidenceDelta };
}

/**
 * ÖNERİYİ HESAPLAR.
 *
 * Zincir: ölçü eşleşmesi → giysinin kalıbı (ürün verisi > marka verisi >
 * satıcı beyanı, TEK kaydırma) → kullanıcı tercihi → kullanıcının kendi
 * geçmişi → "normalde giydiğim beden" doğrulaması.
 *
 * Her adım hem bedeni hem güveni değiştirebilir ve kendi gerekçesini `reasons`
 * içine yazar. Güven katkıları SABİT DEĞİL, kanıt ağırlığıyla çarpılır.
 */
export function recommendSize(input: SizeEngineInput): SizeEngineResult {
  const reasons: SizeReason[] = [];
  const orderedSizes = orderSizes(Object.keys(input.sizeChart));

  if (orderedSizes.length === 0) {
    reasons.push({
      code: 'NO_SIZE_CHART',
      message: 'Bu ürün için beden tablosu bulunmuyor.',
    });
    return {
      kind: 'CHART_ONLY',
      confidence: 0,
      reasons,
      orderedSizes,
      disclaimer: SIZE_DISCLAIMER,
    };
  }

  const scored = scoreSizes(input.sizeChart, input.measurements);

  if (scored.length === 0) {
    /**
     * ⚠️ İKİ AYRI DURUM, İKİ AYRI MESAJ. Eskiden ikisi de "ölçünüzü girin"
     *    diyordu; oysa boy/kilosunu GİRMİŞ bir kullanıcıya "ölçü girin"
     *    demek, girdiği şeyi görmezden gelmektir — kullanıcı formu doldurmuş
     *    olduğunu bildiği için bunu bir arıza sanır.
     */
    if (yalnizBoyKilo(input.measurements)) {
      reasons.push({
        code: 'HEIGHT_WEIGHT_ONLY',
        message:
          'Boy ve kilo tek başına beden söylemez: aynı boy-kiloda göğüs çevresi ' +
          '15 cm kadar değişebiliyor. Göğüs, bel ya da kalça ölçünüzü ekleyin.',
      });
    } else {
      reasons.push({
        code: 'NO_MEASUREMENTS',
        message: 'Beden önerisi için göğüs, bel veya kalça ölçünüzü girmeniz gerekiyor.',
      });
    }
    return {
      kind: 'CHART_ONLY',
      confidence: 0,
      reasons,
      orderedSizes,
      disclaimer: SIZE_DISCLAIMER,
    };
  }

  const best = scored[0]!;
  const runnerUp = scored[1] ?? null;

  let size = best.size;
  // Kaç ölçü eşleşti: tek ölçüyle verilen karar üç ölçüyle verilenden zayıftır.
  let confidence = 35 + best.matchedDimensions * 15;

  reasons.push({
    code: 'MEASUREMENT_MATCH',
    message: `Ölçüleriniz ${best.size} bedeninin tablosuna ortalama ${best.deviationCm.toFixed(
      1,
    )} cm farkla en yakın.`,
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════
   *  BOY VE KİLONUN İŞE KARIŞTIĞI YER — VE SADECE BURASI.
   *
   *  ⚠️ Hiçbiri ÖNERİYİ DEĞİŞTİRMİYOR, yalnızca GÜVENİ düşürüyor ve sebebini
   *     söylüyor. Ayrım önemli: öneriyi değiştirmek bir model iddiasıdır
   *     (boy şu ise beden şu olur), güveni düşürmek ise bir bilgi eksikliği
   *     ya da veri hatası bildirimidir. İkincisini kaynaksız yapabiliriz,
   *     birincisini yapamayız.
   * ═══════════════════════════════════════════════════════════════════════
   */
  if (olculerImkansizMi(input.measurements)) {
    // Çevre > boy. Neredeyse kesinlikle birim karışması ya da yazım hatası.
    confidence -= 25;
    reasons.push({
      code: 'MEASUREMENT_IMPLAUSIBLE',
      message:
        'Girdiğiniz çevre ölçülerinden en az biri boyunuzdan büyük. ' +
        'Ölçüler santim olmalı — inç girdiyseniz 2,54 ile çarpın.',
    });
  }

  if (boyKiloImkansizMi(input.measurements)) {
    confidence -= 15;
    reasons.push({
      code: 'HEIGHT_WEIGHT_IMPLAUSIBLE',
      message: 'Boy ve kilonuz birlikte okunamadı; kilonun kilogram olduğundan emin olun.',
    });
  }

  /**
   * ⚠️ UZUNLUK NOTU: ürünün tablosunda iç bacak boyu VAR ama kullanıcı o ölçüyü
   *    VERMEMİŞ. Burada tahmin YAPILMAZ — boydan iç bacak boyu türetmek yine
   *    kaynaksız bir katsayı isterdi. Yapılan tek şey söylemek: paça boyu bu
   *    öneriye girmedi. Güven 5 düşüyor çünkü karar gerçekten eksik veriyle
   *    verildi ve kullanıcı bunu bilmeli.
   */
  if (best.uzunlukFarkiCm === null && tabloUzunlukTasiyorMu(input.sizeChart)) {
    confidence -= 5;
    reasons.push({
      code: 'LENGTH_NOTE',
      message:
        'Bu üründe paça boyu da tabloda var ama iç bacak boyunuz kayıtlı değil; ' +
        'öneri yalnızca çevre ölçülerinize dayanıyor.',
    });
  }

  // Aradaki fark küçükse iki beden de eşit derecede olası demektir; bunu
  // güvene yansıtmazsak kullanıcı yazı-tura sonucuna kesinlik atfeder.
  if (runnerUp) {
    const separation = runnerUp.deviationCm - best.deviationCm;
    if (separation >= 4) confidence += 10;
    else if (separation >= 2) confidence += 5;
    else if (separation < 1) {
      confidence -= 15;
      reasons.push({
        code: 'AMBIGUOUS',
        message: `${best.size} ve ${runnerUp.size} bedenleri ölçülerinize neredeyse aynı uzaklıkta.`,
      });
    }
  }

  // ── Kalıp düzeltmesi: TEK kaydırma ──────────────────────────────────────
  // Kaynak yarışması `resolveGarmentFit`te yapılır; buraya kazanan gelir.
  // SLIM +1: küçük gelen/dar kalıpta bir beden büyük. OVERSIZE -1: tersi.
  const productVerdict = input.feedback ? evaluateFitSignal(input.feedback) : null;
  const brandVerdict = input.brandSignal ? evaluateBrandFitSignal(input.brandSignal) : null;
  const garment = resolveGarmentFit(input.brandFit ?? null, productVerdict, brandVerdict);

  if (garment.fit !== 'REGULAR') {
    const shifted = shiftSize(orderedSizes, size, fitShiftSteps(garment.fit));
    if (shifted !== size) {
      const runsSmall = garment.fit === 'SLIM';
      reasons.push(garmentFitReason(garment.source, runsSmall, shifted));
      size = shifted;
    }
  } else if (garment.source === 'PRODUCT_FEEDBACK') {
    reasons.push({
      code: 'RETURN_FEEDBACK',
      message: 'Alıcıların çoğu bu ürünün bedeninin uygun olduğunu bildirdi.',
    });
  } else if (garment.source === 'BRAND_FEEDBACK') {
    reasons.push({
      code: 'BRAND_FIT_LEARNED',
      message: 'Bu markanın ürünlerinde alıcılar bedenlerin uygun olduğunu bildiriyor.',
    });
  }

  // Kanıt ağırlığıyla ölçeklenen güven. ⚠️ Sabit ekleme YOK: 5 geri bildirim
  // ile 500 geri bildirim aynı güveni üretemez.
  if (garment.verdict) {
    const cap =
      garment.source === 'PRODUCT_FEEDBACK'
        ? CONFIDENCE_CAP.productFeedback
        : CONFIDENCE_CAP.brandFeedback;
    confidence += cap * garment.verdict.weight;
  }

  // ── Kullanılamayan / çelişen geri bildirim ──────────────────────────────
  const productTotal = input.feedback ? feedbackTotal(input.feedback) : 0;

  if (productVerdict?.kind === 'INSUFFICIENT' && productTotal > 0) {
    // ⚠️ Eşik altı veri güveni ne artırır ne azaltır — YOK SAYILIR. Ama
    //    kullanıcıya varlığı söylenir; sessizce yutmak şeffaflığı bozar.
    reasons.push({
      code: 'FEEDBACK_TOO_FEW',
      message: 'Bu ürün için henüz yeterli beden geri bildirimi yok.',
    });
  } else if (productVerdict?.kind === 'CONFLICTING') {
    confidence += CONFIDENCE_CAP.conflictingFeedback * productVerdict.weight;
    reasons.push({
      code: 'FEEDBACK_CONFLICTING',
      message:
        'Bu ürünün bedeni hakkında alıcı geri bildirimleri birbiriyle çelişiyor; ' +
        'beden tablosunu incelemenizi öneririz.',
    });
  }

  // ── Kullanıcının kalıp tercihi ──────────────────────────────────────────
  // ⚠️ Marka kalıbının TERSİ yönde çalışır: "dar sevmek" bir beden küçük,
  //    "bol sevmek" bir beden büyük demektir. İkisi karıştırılırsa düzeltme
  //    iki kez aynı yöne uygulanır ve öneri iki beden şaşar.
  if (input.fitPreference && input.fitPreference !== 'REGULAR') {
    const steps = input.fitPreference === 'SLIM' ? -1 : 1;
    const shifted = shiftSize(orderedSizes, size, steps);
    if (shifted !== size) {
      reasons.push({
        code: 'FIT_PREFERENCE',
        message:
          input.fitPreference === 'SLIM'
            ? `Dar kalıp tercihinize göre ${shifted} bedeni öneriliyor.`
            : `Bol kalıp tercihinize göre ${shifted} bedeni öneriliyor.`,
      });
      size = shifted;
    }
  }

  // ── Kullanıcının kendi geçmişi ──────────────────────────────────────────
  // ⚠️ Yabancıların ortalamasından SONRA gelir ve onu ezebilir: bu kişinin
  //    kendi vücudunda o giysinin nasıl durduğu, yüzlerce yabancının
  //    ortalamasından daha bilgilendiricidir.
  if (input.userHistory) {
    const applied = applyUserHistory(input.userHistory, orderedSizes, size, reasons);
    size = applied.size;
    confidence += applied.confidenceDelta;
  }

  // ── "Normalde giydiğim beden" doğrulaması ───────────────────────────────
  const usual = input.measurements.usualSize
    ? normalizeSizeLabel(input.measurements.usualSize)
    : null;

  if (usual) {
    const usualIndex = orderedSizes.findIndex((s) => normalizeSizeLabel(s) === usual);
    const resultIndex = orderedSizes.indexOf(size);

    if (usualIndex >= 0 && resultIndex >= 0) {
      const distance = Math.abs(usualIndex - resultIndex);
      if (distance === 0) {
        confidence += 8;
        reasons.push({
          code: 'USUAL_SIZE_AGREES',
          message: 'Öneri, normalde giydiğiniz bedenle aynı.',
        });
      } else if (distance > 1) {
        // İki sinyal birbirini tutmuyor. Hangisinin doğru olduğunu bilmiyoruz;
        // bunu gizlemek yerine güveni düşürüp kullanıcıya söylüyoruz.
        confidence -= 12;
        reasons.push({
          code: 'USUAL_SIZE_CONFLICTS',
          message: `Öneri (${size}), normalde giydiğiniz bedenden (${usual}) belirgin biçimde farklı.`,
        });
      }
    }
  }

  confidence = clamp(Math.round(confidence));

  if (confidence < SIZE_ENGINE.minConfidenceToShow) {
    return { kind: 'CHART_ONLY', confidence, reasons, orderedSizes, disclaimer: SIZE_DISCLAIMER };
  }

  // Alternatif: öneriye komşu ve tabloda var olan diğer aday.
  const alternative =
    runnerUp && runnerUp.size !== size
      ? runnerUp.size
      : (() => {
          const neighbour = shiftSize(orderedSizes, size, 1);
          return neighbour === size ? shiftSize(orderedSizes, size, -1) : neighbour;
        })();

  return {
    kind: 'RECOMMENDATION',
    recommendedSize: size,
    alternativeSize: alternative === size ? null : alternative,
    confidence,
    reasons,
    orderedSizes,
    disclaimer: SIZE_DISCLAIMER,
  };
}
