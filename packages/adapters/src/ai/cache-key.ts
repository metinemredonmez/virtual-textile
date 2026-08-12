import { createHash } from 'node:crypto';

/**
 * SANAL DENEME ÖNBELLEK ANAHTARI
 *
 * ⚠️ EN BÜYÜK MALİYET KALDIRACI. Aynı fotoğraf + aynı ürün ikinci kez
 * ÜRETİLMEZ; önbellekten döner. Maliyet 0, gecikme ~80 ms.
 *
 * Anahtar bileşenleri ve neden:
 *  - photoContentHash : dosya adı/kimliği değil İÇERİK özeti. Kullanıcı aynı
 *                       fotoğrafı tekrar yüklerse önbellek yine isabet eder.
 *  - variantId        : renk ve beden farklı ürün demektir.
 *  - mode             : FAST ve QUALITY farklı çıktı üretir.
 *  - promptVersion    : prompt/pipeline değişince eski sonuçlar geçersizleşir.
 *                       ⚠️ Pipeline'ı değiştirdiğinde BU DEĞERİ ARTIR, yoksa
 *                       kullanıcılar eski kalitedeki görselleri görmeye devam eder.
 */
export const TRYON_PROMPT_VERSION = 1;

export interface TryOnCacheKeyInput {
  photoContentHash: string;
  variantId: string;
  mode: 'FAST' | 'QUALITY';
  promptVersion?: number;
}

export function tryOnCacheKey(input: TryOnCacheKeyInput): string {
  const version = input.promptVersion ?? TRYON_PROMPT_VERSION;
  return createHash('sha256')
    .update([input.photoContentHash, input.variantId, input.mode, `v${version}`].join('|'))
    .digest('hex');
}

/** Yüklenen fotoğrafın içerik özeti — önbellek anahtarının temeli. */
export function photoContentHash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * ÇOKLU ÜRÜN (KOMBİN) ÖNBELLEK ANAHTARI
 *
 * ⚠️ Yukarıdaki tek ürün anahtarı DEĞİŞTİRİLMEDİ. Var olan milyonlarca
 *    isabetin geçersizleşmesi, tek bir alan eklemenin bedeli olamaz.
 *
 * Kombin anahtarı ÖNEK (prefix) anahtarıdır: n parçalı bir kombinde her
 * katmanın kendi anahtarı, o katmana kadarki parçaların anahtarıdır. Bu
 * sayede kullanıcı son parçayı değiştirdiğinde ilk n-1 katmanın anahtarı
 * AYNI kalır ve o katmanlar yeniden üretilmez (bkz. multi-tryon.ts →
 * planOutfitComposition). Maliyetin kalbi budur.
 *
 * Bileşenler ve neden:
 *  - 'multi' öneki      : tek parçalı bir kombin ile tek ürün denemesi AYNI
 *                         girdilere sahip olsa bile aynı görsel DEĞİLDİR
 *                         (besteleme prompt'u farklıdır). Önek olmasaydı iki
 *                         boru hattının sonuçları birbirinin yerine geçerdi.
 *  - uzunluk önekleri   : ayırıcı karakterin kimlik içinde geçmeyeceğine
 *                         GÜVENMİYORUZ. Her kimlik kendi uzunluğuyla birlikte
 *                         yazılır, çünkü yalnızca ayırıcıyla birleştirmek
 *                         ["a","b|c"] ile ["a|b","c"] listelerini AYNI
 *                         anahtara düşürür — iki farklı kombin, tek görsel.
 *                         (Parça sayısını yazmak bunu çözmez: iki listenin de
 *                         uzunluğu ikidir.)
 *  - SIRALI kimlikler   : ⚠️ sıra anahtarı ETKİLER ve kimlikler burada
 *                         SIRALANMAZ. Ceket-gömlek sırası ile gömlek-ceket
 *                         sırası farklı görsellerdir; aynı anahtara düşerlerse
 *                         kullanıcıya yanlış katman sırasına sahip bir görsel
 *                         gösterilir. Kanonik sırayı çağıran taraf üretir
 *                         (bkz. orderOutfitPieces) — burada korunur.
 *  - mode / promptVersion : tek üründeki gerekçenin aynısı.
 *  - composeVersion     : besteleme mantığı (katman sırası, ara görsel akışı)
 *                         değişince eski kombinler geçersizdir; taban boru
 *                         hattı değişmemiş olsa bile.
 */
export const OUTFIT_COMPOSE_VERSION = 1;

export interface MultiTryOnCacheKeyInput {
  photoContentHash: string;
  /** ⚠️ KATMAN SIRASINA GÖRE sıralanmış kimlikler. Burada yeniden sıralanmaz. */
  orderedVariantIds: readonly string[];
  mode: 'FAST' | 'QUALITY';
  promptVersion?: number;
  composeVersion?: number;
}

export function multiTryOnCacheKey(input: MultiTryOnCacheKeyInput): string {
  const promptVersion = input.promptVersion ?? TRYON_PROMPT_VERSION;
  const composeVersion = input.composeVersion ?? OUTFIT_COMPOSE_VERSION;

  return createHash('sha256')
    .update(
      [
        'multi',
        input.photoContentHash,
        `n${input.orderedVariantIds.length}`,
        ...input.orderedVariantIds.map((id) => `${id.length}:${id}`),
        input.mode,
        `v${promptVersion}`,
        `c${composeVersion}`,
      ].join('|'),
    )
    .digest('hex');
}
