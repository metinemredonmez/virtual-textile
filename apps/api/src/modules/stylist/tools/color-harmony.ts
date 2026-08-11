/**
 * RENK UYUMU — KURAL MOTORU
 *
 * Neden kural motoru: kombin uyumu kullanıcıya "bu ikisi olmaz" diyen bir
 * karardır. Modelin serbest metinle verdiği bu karar denetlenemez ve her
 * çağrıda değişir; kural motoru ise aynı girdiye aynı cevabı verir ve testi
 * yazılabilir. Model yalnızca sonucu aktarır, kararı vermez.
 *
 * ⚠️ Saf fonksiyon: veritabanı, ağ ve zaman bağımlılığı YOK. Testin tamamı
 *    bu dosyaya bakarak yazılabilir.
 */

/** Renkleri aileye indirger; ton farkı (açık/koyu mavi) uyum kararını değiştirmez. */
export type ColorFamily =
  | 'NEUTRAL'
  | 'RED'
  | 'ORANGE'
  | 'YELLOW'
  | 'GREEN'
  | 'BLUE'
  | 'PURPLE'
  | 'PINK'
  | 'BROWN'
  | 'DENIM'
  | 'METALLIC'
  | 'UNKNOWN';

/**
 * Türkçe renk adları → aile.
 *
 * ⚠️ Eşleştirme normalize edilmiş (küçük harf + aksan kaldırılmış) metin
 *    üzerinde ve "içerir" mantığıyla yapılır: katalogda "Açık Bej", "bej melanj"
 *    ve "BEJ" aynı şeydir. Tam eşleşme arasaydık katalogdaki her varyasyon için
 *    yeni satır gerekirdi.
 */
const FAMILY_KEYWORDS: ReadonlyArray<readonly [ColorFamily, readonly string[]]> = [
  ['NEUTRAL', ['siyah', 'beyaz', 'gri', 'antrasit', 'bej', 'krem', 'ekru', 'tas', 'vizon']],
  ['DENIM', ['denim', 'jean', 'kot', 'indigo']],
  ['METALLIC', ['gumus', 'altin', 'gold', 'silver', 'metalik', 'bakir']],
  ['RED', ['kirmizi', 'bordo', 'kiremit', 'sarap']],
  ['ORANGE', ['turuncu', 'somon', 'mercan', 'kaviar', 'tarcin']],
  ['YELLOW', ['sari', 'hardal', 'limon', 'safran']],
  ['GREEN', ['yesil', 'haki', 'zeytin', 'mint', 'cimen']],
  ['BLUE', ['mavi', 'lacivert', 'petrol', 'turkuaz', 'bebe mavi']],
  ['PURPLE', ['mor', 'lila', 'lavanta', 'eflatun', 'patlican']],
  ['PINK', ['pembe', 'fusya', 'gul kurusu', 'pudra']],
  ['BROWN', ['kahve', 'kahverengi', 'camel', 'toprak', 'karamel', 'haki kahve']],
];

/** Aksan ve büyük harf farkı renk kimliği değildir; "Gümüş" ile "gumus" aynıdır. */
export function normalizeColor(raw: string): string {
  return raw
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function colorFamily(raw: string): ColorFamily {
  const value = normalizeColor(raw);
  if (value.length === 0) return 'UNKNOWN';

  for (const [family, keywords] of FAMILY_KEYWORDS) {
    for (const keyword of keywords) {
      if (value.includes(keyword)) return family;
    }
  }
  return 'UNKNOWN';
}

/**
 * Çatışan aile çiftleri.
 *
 * Liste kasıtlı olarak KISA: moda kuralı değil, "çoğu kullanıcının rahatsız
 * olduğu" birkaç kombinasyon. Uzun bir yasak listesi, modelin geçerli
 * önerilerini de bloklar ve danışmanı işe yaramaz hâle getirir.
 */
const CLASHING_PAIRS: ReadonlyArray<readonly [ColorFamily, ColorFamily]> = [
  ['RED', 'PINK'],
  ['RED', 'ORANGE'],
  ['ORANGE', 'PURPLE'],
  ['GREEN', 'PINK'],
  ['PURPLE', 'YELLOW'],
  ['BROWN', 'PURPLE'],
];

function isClashing(a: ColorFamily, b: ColorFamily): boolean {
  return CLASHING_PAIRS.some(
    ([left, right]) => (left === a && right === b) || (left === b && right === a),
  );
}

/** Bu aileler her şeyle gider; kombin "nötr taşıyıcı" ile kurtarılabilir. */
const SAFE_FAMILIES: ReadonlySet<ColorFamily> = new Set<ColorFamily>(['NEUTRAL', 'DENIM', 'BROWN']);

export type HarmonyVerdict = 'HARMONIOUS' | 'ACCEPTABLE' | 'CLASHING' | 'UNKNOWN';

export interface HarmonyResult {
  verdict: HarmonyVerdict;
  /** 0-100. Modele değil, kullanıcıya gösterilecek metni beslemek için. */
  score: number;
  /** Türkçe, kullanıcıya doğrudan aktarılabilir gerekçeler. */
  notes: string[];
  families: ColorFamily[];
}

/**
 * Bir kombinin baskın renklerini değerlendirir.
 *
 * Her ürünün TEK baskın rengi alınır (ilk varyant rengi): bir ürünün 6 renk
 * seçeneği olması kombini 6 kat karmaşık yapmaz, kullanıcı bir tanesini giyer.
 */
export function evaluateColorHarmony(colorsPerProduct: ReadonlyArray<string>): HarmonyResult {
  const families = colorsPerProduct.map(colorFamily);
  const notes: string[] = [];

  const known = families.filter((f) => f !== 'UNKNOWN');
  if (known.length < 2) {
    return {
      verdict: 'UNKNOWN',
      score: 50,
      notes: ['Renk bilgisi kombini değerlendirmeye yetmiyor.'],
      families,
    };
  }

  const clashes: Array<[ColorFamily, ColorFamily]> = [];
  for (let i = 0; i < known.length; i += 1) {
    for (let j = i + 1; j < known.length; j += 1) {
      const a = known[i]!;
      const b = known[j]!;
      if (isClashing(a, b)) clashes.push([a, b]);
    }
  }

  const vivid = known.filter((f) => !SAFE_FAMILIES.has(f));
  const distinctVivid = new Set(vivid).size;

  if (clashes.length > 0) {
    notes.push('Bu renkler bir arada sert duruyor; birini nötr bir tonla değiştirmek gerekiyor.');
    return { verdict: 'CLASHING', score: 20, notes, families };
  }

  // Üç ve üzeri canlı renk: tek tek uyumlu olsalar bile kombin dağılıyor.
  if (distinctVivid >= 3) {
    notes.push('Üçten fazla canlı renk var; bir parçayı nötr tona çekmek dengeyi kurar.');
    return { verdict: 'ACCEPTABLE', score: 55, notes, families };
  }

  if (distinctVivid === 0) {
    notes.push('Tamamı nötr tonlarda; her ortamda güvenli bir kombin.');
    return { verdict: 'HARMONIOUS', score: 90, notes, families };
  }

  notes.push('Nötr zemin üzerinde tek bir vurgu rengi var; dengeli duruyor.');
  return { verdict: 'HARMONIOUS', score: 82, notes, families };
}
