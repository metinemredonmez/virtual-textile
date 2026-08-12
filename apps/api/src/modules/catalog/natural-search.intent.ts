import { z } from 'zod';
import { NATURAL_SEARCH } from './natural-search.constants.js';
import { searchIntentSchema, type SearchIntent } from './natural-search.schema.js';
import type { CatalogVocabulary } from './natural-search.ports.js';
import type { ProductListQuery } from './catalog.schema.js';

/**
 * NİYET ÇÖZÜMLEME — SAF KATMAN
 *
 * Bu dosyada ağ, veritabanı, Redis ve NestJS YOKTUR. İçindeki her şey saf
 * fonksiyondur; doğal dilde aramanın karar veren kısmı burada yaşar ve
 * bu yüzden tamamı testle kilitlenebilir (bkz. natural-search.intent.test.ts).
 *
 * Üç soruya cevap verir:
 *   1. Bu sorgu LLM'e gitmeli mi?            → `decideInterpretation`
 *   2. Modelin çıktısı sözleşmeye uyuyor mu? → `parseIntent`
 *   3. Değerleri katalogda var mı?           → `sanitizeIntent`
 *   ve sonunda: bu niyet hangi filtreye eşit? → `intentToProductListQuery`
 */

// ── Türkçe metin normalleştirme ────────────────────────────────────────────

/**
 * Karşılaştırma için metni sadeleştirir.
 *
 * ⚠️ `toLowerCase()` DEĞİL `toLocaleLowerCase('tr-TR')`: Türkçe'de "I" harfinin
 *    küçüğü "ı"dır, "i" değil. Varsayılan yerelde "MAVİ" → "mavi̇" (ayrı
 *    birleştirici nokta ile) çıkar ve "mavi" ile EŞLEŞMEZ. Marka adı
 *    karşılaştırması sessizce çalışmaz hâle gelirdi.
 *
 * ⚠️ Aksanlar da düşürülür: kullanıcı "gomlek" yazar, katalogda "Gömlek"
 *    yazar. Türkçe'de bu istisna değil kuraldır (bkz. catalog.service.ts).
 */
export function foldTr(value: string): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/â/g, 'a')
    .replace(/î/g, 'i')
    .replace(/û/g, 'u')
    .trim();
}

/** Kelime sayımı — noktalama ayırıcıdır, kelime değildir. */
export function tokenize(query: string): string[] {
  return query.split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 0);
}

// ── 1. Sorgu LLM'e gitmeli mi? ─────────────────────────────────────────────

export type SkipReason = 'SHORT_QUERY' | 'BRAND_ONLY';

export type InterpretationDecision = { interpret: true } | { interpret: false; reason: SkipReason };

/**
 * KISA SORGU KURALI — maliyetin en büyük kaldıracı.
 *
 * Her doğal dil araması bir LLM çağrısıdır; çağrı başına para ve ~1 saniye
 * gecikme demektir. Aramaların büyük çoğunluğu ("elbise", "Mavi", "siyah
 * gömlek") zaten anahtar kelime aramasının MÜKEMMEL çözdüğü sorgulardır.
 * Bu üç kural, LLM'i yalnızca gerçekten cümle olan sorgulara ayırır:
 *
 *   a) Sorgu bir MARKA ADININ tamamıysa → LLM'e gitmez. "Mavi Jeans" için
 *      çevrilecek bir niyet yoktur; kullanıcı o markayı görmek istiyor ve
 *      `brandName` zaten searchVector'da A ağırlığındadır.
 *
 *   b) Kelime sayısı eşiğin altındaysa → LLM'e gitmez. Gerekçe ve eşiğin
 *      neden 4 olduğu: `NATURAL_SEARCH.minWordsForLlm`.
 *
 *   c) İSTİSNA: sorguda rakam varsa eşik 2'ye iner. Rakam neredeyse her zaman
 *      fiyattır ve fiyat, anahtar kelime aramasının SIFIR sonuç verdiği tek
 *      yerdir ("5000 altı elbise" → hiçbir başlıkta "5000" geçmez).
 */
export function decideInterpretation(
  query: string,
  vocabulary: CatalogVocabulary,
): InterpretationDecision {
  const folded = foldTr(query);

  if (vocabulary.brands.some((brand) => foldTr(brand) === folded)) {
    return { interpret: false, reason: 'BRAND_ONLY' };
  }

  const words = tokenize(query);
  const hasNumericHint = words.some((word) => /\d/.test(word));
  const threshold = hasNumericHint
    ? NATURAL_SEARCH.minWordsWithNumericHint
    : NATURAL_SEARCH.minWordsForLlm;

  if (words.length < threshold) return { interpret: false, reason: 'SHORT_QUERY' };

  return { interpret: true };
}

// ── 2. Model çıktısı sözleşmeye uyuyor mu? ─────────────────────────────────

export type IntentParseResult =
  | { ok: true; draft: z.infer<typeof searchIntentSchema> }
  /** `issues` log içindir: modelin sözleşmeden nerede saptığı görünsün. */
  | { ok: false; issues: string[] };

/**
 * Ham model çıktısını şemaya karşı doğrular.
 *
 * ⚠️ Hata FIRLATMAZ. Sözleşme ihlali kullanıcının sorununu çözmemek için
 *    sebep değildir; çağıran anahtar kelime aramasına düşer ve kullanıcı yine
 *    sonuç alır. Fırlatsaydı, sağlayıcının bir gün fazladan alan eklemesi
 *    aramayı topyekûn 500'e düşürürdü.
 */
export function parseIntent(raw: unknown): IntentParseResult {
  const parsed = searchIntentSchema.safeParse(raw);
  if (parsed.success) return { ok: true, draft: parsed.data };

  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(kök)'}: ${issue.code}`),
  };
}

// ── 3. Değerler katalogda gerçekten var mı? ────────────────────────────────

/**
 * Modelin ürettiği DEĞERLERİ katalog söz varlığına karşı doğrular.
 *
 * ⚠️ ŞEMA DOĞRULAMASI TEK BAŞINA YETMEZ. Zod "bu bir string mi" sorusunu
 *    cevaplar; "bu kategori var mı" sorusunu cevaplamaz. Var olmayan bir
 *    kategori adresi `listProducts` içindeki özyinelemeli CTE'yi boş küme
 *    yapar ve sorgu HATASIZ biçimde sıfır satır döner. Aynısı renk için de
 *    geçerli: `v."color" = ANY(...)` eşleşmezse EXISTS false olur.
 *    Yani uydurma bir değer, "ürün bulunamadı" olarak görünür — kullanıcı
 *    katalogun boş olduğunu sanır. Bu yüzden tanınmayan değer ELENİR:
 *    daha geniş ama DOĞRU bir sonuç, dar ve yanlış bir hiçlikten iyidir.
 */
export function sanitizeIntent(
  draft: z.infer<typeof searchIntentSchema>,
  vocabulary: CatalogVocabulary,
): SearchIntent {
  // Katalogdaki YAZIMA geri dönebilmek için katlanmış hâlden asıl değere harita.
  // Gerekçe: SQL karşılaştırması birebirdir — model "siyah" der, sütunda
  // "Siyah" yazar; katlanmış hâli filtreye koyarsak hiçbir varyant eşleşmez.
  const colorByFolded = new Map(vocabulary.colors.map((color) => [foldTr(color), color]));
  const knownSlugs = new Set(vocabulary.categorySlugs);

  const category =
    draft.category !== undefined && knownSlugs.has(draft.category.toLowerCase())
      ? draft.category.toLowerCase()
      : undefined;

  const colors = draft.colors
    ?.map((color) => colorByFolded.get(foldTr(color)))
    .filter((color): color is string => color !== undefined);

  const chosenColors = colors !== undefined && colors.length > 0 ? [...new Set(colors)] : undefined;
  const chosenColorTokens = new Set((chosenColors ?? []).map(foldTr));

  const keywords: string[] = [];
  const seen = new Set<string>();
  for (const keyword of draft.keywords) {
    const folded = foldTr(keyword);
    if (folded === '' || seen.has(folded)) continue;

    // ⚠️ Salt rakam olan terim atılır. Model bütçeyi hem `maxPriceMinor`e hem
    //    de anahtar kelimeye yazdığında ("5000"), tsquery o terimi de VE'ler
    //    ve hiçbir ürün başlığında geçmediği için sonuç SIFIRA düşer.
    if (/^\d+$/.test(folded)) continue;

    // ⚠️ Renk zaten yapılandırılmış filtreye girdiyse anahtar kelimeden atılır:
    //    aynı kısıt iki kez, biri kesin (varyant rengi) diğeri bulanık (metin)
    //    uygulanınca yalnızca sonuç kümesi daralır, isabet artmaz.
    if (chosenColorTokens.has(folded)) continue;

    seen.add(folded);
    keywords.push(keyword);
    if (keywords.length >= NATURAL_SEARCH.maxKeywords) break;
  }

  return {
    keywords,
    ...(category === undefined ? {} : { category }),
    ...(chosenColors === undefined ? {} : { colors: chosenColors }),
    // ⚠️ PARA: sınırda tam sayı kuruş → bigint. Number aritmetiği YOK.
    ...(draft.maxPriceMinor === undefined ? {} : { maxPriceMinor: BigInt(draft.maxPriceMinor) }),
    ...(draft.gender === undefined ? {} : { gender: draft.gender }),
    ...(draft.occasion === undefined ? {} : { occasion: draft.occasion }),
    ...(draft.season === undefined ? {} : { season: draft.season }),
  };
}

// ── 4. Niyet → mevcut katalog sorgusu ──────────────────────────────────────

/**
 * ⚠️ ÇEVİRİNİN TAMAMI BU FONKSİYONDUR. Arama yapan kod `CatalogService`tir;
 *    burada üretilen nesne onun BUGÜNKÜ, DEĞİŞTİRİLMEMİŞ girdisidir.
 *    Doğal dil katmanının kataloga tek dokunuşu budur.
 *
 * ⚠️ `occasion` ve `season` BİLİNÇLİ OLARAK BURAYA GİRMEZ. İkisi de
 *    `websearch_to_tsquery`ye eklenseydi terimler VE'lenirdi: "iş" VE
 *    "görüşme" VE "ceket" → hiçbir üründe hepsi geçmez, sonuç sıfırlanır.
 *    `Product.season` kolonu vardır ama `listProducts` onu filtrelemez ve bu
 *    görev katalog servisini değiştirmez. Alanlar taşınır, gösterilir,
 *    filtrelenmez — karşılığı geldiğinde eklenecek yer burasıdır.
 */
export function intentToProductListQuery(intent: SearchIntent, limit: number): ProductListQuery {
  const q = intent.keywords.join(' ').trim();

  return {
    q: q === '' ? undefined : q,
    category: intent.category,
    gender: intent.gender,
    brand: undefined,
    color: intent.colors,
    size: undefined,
    minPriceMinor: undefined,
    maxPriceMinor: intent.maxPriceMinor,
    // Öneri havuzuna tükenmiş ürün girmemeli — kullanıcı cümle kurarak
    // aradığı şeyi satın almak istiyor, katalog arşivini gezmek değil.
    inStockOnly: true,
    sort: 'relevance',
    cursor: undefined,
    limit,
  };
}

/**
 * LLM devrede değilken kullanılan sorgu: kullanıcının cümlesi, olduğu gibi.
 *
 * ⚠️ Uzun bir cümle burada büyük olasılıkla SIFIR sonuç verir; terimler
 *    VE'lenir. Bu, düşüş yolunun bilinen ve kabul edilen sınırıdır: bu yolun
 *    işi "LLM olmadan da doğru davran"tır, "LLM'i taklit et" değil. Katalog
 *    servisi bu durumda `didYouMean` üretir ve arayüz onu gösterir.
 */
export function fallbackProductListQuery(query: string, limit: number): ProductListQuery {
  return {
    // 100 karakter sınırı `productListQuerySchema.q` ile aynıdır: bu uç
    // şemayı atlayarak servisi doğrudan çağırdığı için sınırı elle korur.
    q: query.trim().slice(0, 100),
    category: undefined,
    gender: undefined,
    brand: undefined,
    color: undefined,
    size: undefined,
    minPriceMinor: undefined,
    maxPriceMinor: undefined,
    inStockOnly: true,
    sort: 'relevance',
    cursor: undefined,
    limit,
  };
}
