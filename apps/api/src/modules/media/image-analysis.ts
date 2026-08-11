import type { ImageAnalysis } from './image-processor.js';

/**
 * SAF GÖRSEL ÖLÇÜMÜ
 *
 * Girdi: küçültülmüş GRİ TONLAMALI piksel dizisi. Çıktı: skor motorlarının
 * beslendiği ham ölçümler. Burada karar yok, eşik yok — yalnızca sayı.
 *
 * Neden ayrı dosya: `sharp` yalnızca "görüntüyü 64×64 griye indir" işini yapar;
 * ölçümün kendisi saf TypeScript'tir. Böylece kalite kararlarını native bir
 * bağımlılık olmadan test edebiliyoruz ve sharp sürümü değişince ölçümler
 * sessizce kaymıyor.
 *
 * ⚠️ Bunlar MVP sezgisel yöntemleridir; kişi/segmentasyon modeli değildir.
 *    Amaç "kesin doğru" değil, "kullanıcıyı boş yere AI maliyetine sokmadan
 *    bariz kötü fotoğrafı elemek".
 */

export interface GrayscaleImage {
  /** Uzunluk = width × height, her bayt 0-255 luma. */
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/** Ölçüm için kullanılan küçültülmüş kare boyutu. */
export const ANALYSIS_SIZE = 64;

/** Laplace standart sapması bu değere ulaşınca "tam net" sayılır. */
const SHARPNESS_REFERENCE_STD = 35;

/** Kenar bandı kalınlığı — görüntünün dış %12,5'i arka plan kabul edilir. */
const BORDER_RATIO = 0.125;

/** Bir kenarın standart sapması bunu aşarsa konu o kenara taşıyor demektir. */
const EDGE_SUBJECT_STD = 20;

/** Arka plan sapmasının 0 puana düştüğü nokta. */
const BACKGROUND_STD_AT_ZERO = 40;

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

function stdDev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  let sum = 0;
  for (const value of values) sum += (value - average) ** 2;
  return Math.sqrt(sum / values.length);
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const at = (image: GrayscaleImage, x: number, y: number): number =>
  image.data[y * image.width + x] ?? 0;

/** Ortalama parlaklık (0-255). */
export function meanLuminance(image: GrayscaleImage): number {
  let total = 0;
  for (const value of image.data) total += value;
  return image.data.length === 0 ? 0 : total / image.data.length;
}

/**
 * NETLİK (0-100)
 *
 * Laplace operatörünün varyansı: bulanık görüntüde komşu pikseller birbirine
 * yakındır, ikinci türev sıfıra iner. Odak kaçmış veya el titremiş bir
 * fotoğrafta bu değer çöker.
 */
export function sharpness(image: GrayscaleImage): number {
  if (image.width < 3 || image.height < 3) return 0;

  const laplacian: number[] = [];
  for (let y = 1; y < image.height - 1; y += 1) {
    for (let x = 1; x < image.width - 1; x += 1) {
      const value =
        4 * at(image, x, y) -
        at(image, x - 1, y) -
        at(image, x + 1, y) -
        at(image, x, y - 1) -
        at(image, x, y + 1);
      laplacian.push(value);
    }
  }

  const normalized = (stdDev(laplacian) / SHARPNESS_REFERENCE_STD) * 100;
  return Math.round(clamp(normalized, 0, 100));
}

/** Kenar bandındaki piksellerin toplandığı yardımcı. */
function borderPixels(image: GrayscaleImage): {
  all: number[];
  top: number[];
  bottom: number[];
  left: number[];
  right: number[];
} {
  const bandX = Math.max(1, Math.round(image.width * BORDER_RATIO));
  const bandY = Math.max(1, Math.round(image.height * BORDER_RATIO));

  const top: number[] = [];
  const bottom: number[] = [];
  const left: number[] = [];
  const right: number[] = [];

  for (let y = 0; y < bandY; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      top.push(at(image, x, y));
      bottom.push(at(image, x, image.height - 1 - y));
    }
  }
  for (let x = 0; x < bandX; x += 1) {
    for (let y = 0; y < image.height; y += 1) {
      left.push(at(image, x, y));
      right.push(at(image, image.width - 1 - x, y));
    }
  }

  return { all: [...top, ...bottom, ...left, ...right], top, bottom, left, right };
}

/**
 * ARKA PLAN SADELİĞİ (0-100)
 *
 * Try-On modelleri kıyafeti arka plandan ayırmak zorunda; desenli/kalabalık
 * arka plan segmentasyonu bozar ve sonuç görselde kıyafetin kenarları erir.
 * Kenar bandındaki piksellerin dağılımı ne kadar darsa arka plan o kadar sade.
 */
export function backgroundUniformity(image: GrayscaleImage): number {
  const deviation = stdDev(borderPixels(image).all);
  const score = 100 - (deviation / BACKGROUND_STD_AT_ZERO) * 100;
  return Math.round(clamp(score, 0, 100));
}

/**
 * KONU KENARA DEĞİYOR MU?
 *
 * Sade bir arka plan kenarı düz olur. Bir kenarda ani ton değişimi varsa konu
 * o kenardan taşıyor, yani görsel kırpılmış demektir. Kırpılmış üründe
 * sanal deneme kıyafetin devamını uydurur ve müşteri gerçekte olmayan bir
 * kesim görür — iadenin en pahalı sebeplerinden biri.
 */
export function subjectTouchesEdge(image: GrayscaleImage): boolean {
  const { top, bottom, left, right } = borderPixels(image);
  return [top, bottom, left, right].some((side) => stdDev(side) > EDGE_SUBJECT_STD);
}

/**
 * Tüm ölçümler tek geçişte.
 *
 * `originalWidth/Height` küçültme ÖNCESİ gerçek boyutlardır — çözünürlük
 * puanı buradan hesaplanır, ölçüm görüntüsünden değil.
 */
export function analyzeGrayscale(
  image: GrayscaleImage,
  originalWidthPx: number,
  originalHeightPx: number,
): ImageAnalysis {
  return {
    widthPx: originalWidthPx,
    heightPx: originalHeightPx,
    meanLuminance: Math.round(meanLuminance(image) * 100) / 100,
    sharpness: sharpness(image),
    backgroundUniformity: backgroundUniformity(image),
    subjectTouchesEdge: subjectTouchesEdge(image),
  };
}
