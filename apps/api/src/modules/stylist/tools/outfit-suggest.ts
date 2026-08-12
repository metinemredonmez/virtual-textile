/**
 * GARDIROPTAN KOMBİN ÖNERİSİ — SAF ÇEKİRDEK
 *
 * ⚠️ NEDEN BU DOSYA STİL DANIŞMANI MODÜLÜNDE, GARDIROP MODÜLÜNDE DEĞİL:
 *    "bu ikisi yakışır" bir MODA KURALIDIR ve bu kod tabanında moda kuralı
 *    tek bir yerde yaşar (bkz. `color-harmony.ts`). Gardırop modülü kendi
 *    öneri mantığını yazsaydı kullanıcı sohbet ekranında başka, gardırop
 *    ekranında başka cevap alırdı — ve iki kural kümesi zamanla ayrışırdı.
 *    Gardırop modülü buraya `WardrobeStylistPort` arkasından ulaşır.
 *
 * ⚠️ NEDEN LLM YOK: öneri, kullanıcının kendi dolabındaki parçalar üzerinden
 *    kurulur. Modele göndermek, kullanıcının neye sahip olduğunu dış bir
 *    sağlayıcıya bildirmek olurdu — üstelik kota ve bütçe harcayarak, her
 *    çağrıda farklı bir cevap üreterek. Kombinasyon üretimi ve renk kararı
 *    tamamen belirlenimci; modelin ekleyeceği bir şey yok.
 *
 * Saf fonksiyon: veritabanı, ağ ve saat bağımlılığı yok.
 */

import type { TryOnCategory } from '@vt/db';
import { evaluateColorHarmony, type HarmonyVerdict } from './color-harmony.js';

/** Kombine girebilecek tek parça — gardıroptan gelen dar görünüm. */
export interface OutfitCandidatePiece {
  itemId: string;
  category: TryOnCategory;
  color: string;
  label: string | null;
}

export interface OutfitSuggestion {
  /** Bu kombine giren parçaların kimlikleri. */
  itemIds: string[];
  title: string;
  rationale: string;
  harmony: HarmonyVerdict;
}

/**
 * ⚠️ ÜST SINIR — kombinasyon sayısı parça sayısıyla ÇARPIMSAL büyür.
 *
 * Öneri üretimi üst × alt (× dış giyim) döngüsüdür. 200 parçalık bir dolapta
 * bu yüz binlerce kombinasyon demektir ve hepsi tek bir HTTP isteğinin içinde
 * hesaplanır. Sınır olmasaydı, dolabını dolduran bir kullanıcı kendi isteğiyle
 * API prosesini kilitleyebilirdi. En yeni parçalar önce gelir (çağıran
 * `createdAt` sırasıyla verir), yani kesilen kuyruk en eski parçalardır.
 */
const MAX_PIECES_PER_CATEGORY = 12;

/** Kombine en fazla bir dış giyim eklenir. */
const OUTERWEAR_LIMIT = 6;

function titleFor(pieces: readonly OutfitCandidatePiece[]): string {
  // Etiketi olan parçalar başlığı taşır; hiçbiri yoksa renk + kategori.
  const named = pieces.map((piece) => piece.label?.trim()).filter((l): l is string => !!l);
  if (named.length > 0) return named.join(' + ');
  return pieces.map((piece) => `${piece.color} ${categoryLabel(piece.category)}`).join(' + ');
}

function categoryLabel(category: TryOnCategory): string {
  switch (category) {
    case 'UPPER_BODY':
      return 'üst';
    case 'LOWER_BODY':
      return 'alt';
    case 'DRESS':
      return 'elbise';
    case 'OUTERWEAR':
      return 'dış giyim';
  }
}

/** Sıralamada kullanılan sayısal ağırlık — `evaluateColorHarmony` skoruyla aynı ölçek. */
interface ScoredSuggestion extends OutfitSuggestion {
  score: number;
}

function build(pieces: readonly OutfitCandidatePiece[]): ScoredSuggestion {
  const harmony = evaluateColorHarmony(pieces.map((piece) => piece.color));
  return {
    itemIds: pieces.map((piece) => piece.itemId),
    title: titleFor(pieces),
    rationale: harmony.notes.join(' '),
    harmony: harmony.verdict,
    score: harmony.score,
  };
}

/**
 * Gardıroptaki parçalardan kombin önerir.
 *
 * Kurulan gövdeler:
 *   üst + alt            → temel kombin
 *   elbise               → tek parça, kendi başına kombin
 *   (yukarıdakiler) + dış giyim
 *
 * ⚠️ ÇATIŞAN RENKLER ELENİR, "en iyi n tanesi" olarak gösterilmez. Kullanıcıya
 *    sırf liste dolsun diye kötü bir kombin göstermek, öneriye olan güveni
 *    tek seferde bitirir. Boş liste dürüst bir cevaptır.
 *
 * ⚠️ Aynı parça bir öneride iki kez GEÇMEZ; farklı önerilerde geçebilir —
 *    kullanıcı aynı pantolonu iki farklı üstle giyebilir.
 */
export function suggestOutfitsFromWardrobe(input: {
  items: readonly OutfitCandidatePiece[];
  limit: number;
}): OutfitSuggestion[] {
  const uppers: OutfitCandidatePiece[] = [];
  const lowers: OutfitCandidatePiece[] = [];
  const dresses: OutfitCandidatePiece[] = [];
  const outerwear: OutfitCandidatePiece[] = [];

  for (const item of input.items) {
    switch (item.category) {
      case 'UPPER_BODY':
        if (uppers.length < MAX_PIECES_PER_CATEGORY) uppers.push(item);
        break;
      case 'LOWER_BODY':
        if (lowers.length < MAX_PIECES_PER_CATEGORY) lowers.push(item);
        break;
      case 'DRESS':
        if (dresses.length < MAX_PIECES_PER_CATEGORY) dresses.push(item);
        break;
      case 'OUTERWEAR':
        if (outerwear.length < OUTERWEAR_LIMIT) outerwear.push(item);
        break;
    }
  }

  // Gövdeler: giyilebilir en küçük tam kombinler.
  const bodies: OutfitCandidatePiece[][] = [];
  for (const upper of uppers) {
    for (const lower of lowers) bodies.push([upper, lower]);
  }
  for (const dress of dresses) bodies.push([dress]);

  const scored: ScoredSuggestion[] = [];
  for (const body of bodies) {
    scored.push(build(body));
    for (const outer of outerwear) scored.push(build([...body, outer]));
  }

  return scored
    .filter((suggestion) => suggestion.harmony !== 'CLASHING')
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // ⚠️ Eşit skorda parça sayısı AZ olan önce: "tişört + pantolon" önerisi
      //    aynı skorlu "tişört + pantolon + mont"tan daha temel bir cevaptır
      //    ve listenin başında tekrar hissi yaratmaz.
      if (a.itemIds.length !== b.itemIds.length) return a.itemIds.length - b.itemIds.length;
      // Son kırıcı: deterministik sıra. Aksi hâlde aynı gardırop için iki ardışık
      // istek farklı sıralama döndürür ve arayüz sebepsiz oynar.
      return a.itemIds.join().localeCompare(b.itemIds.join());
    })
    .slice(0, input.limit)
    .map(({ score: _score, ...suggestion }) => suggestion);
}
