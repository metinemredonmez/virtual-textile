import { appError } from '@vt/contracts';
import { multiTryOnCacheKey } from './cache-key.js';
import {
  generateWithFallback,
  isPermanentFailure,
  type TryOnFailureReason,
  type TryOnGarmentCategory,
  type TryOnProvider,
} from './tryon.provider.js';

/**
 * MARKALAR ARASI ÇOKLU ÜRÜN DENEME (KOMBİN BESTESİ)
 *
 * İddia şu: bir mağazanın ceketi + ikincinin pantolonu + üçüncünün gömleği,
 * AYNI kişi görselinde, tek sepette. Tek ürün denemesi artık ayrıştırıcı
 * değil (bkz. docs/ozellik-yol-haritasi.md → Faz 2).
 *
 * Bu dosya çerçeveden ve veritabanından bağımsızdır: saf sıralama, planlama ve
 * besteleme mantığı. Rıza, kota ve kuyruk kararları uygulama katmanındadır —
 * ⚠️ bu modül RIZA KONTROLÜ YAPMAZ, yalnızca kendisine verilen adımları üretir.
 *
 * Üç ayrı sorumluluk, üç ayrı fonksiyon:
 *   1. orderOutfitPieces()      → katman sırası (sabit tablo, çağıranın sırası DEĞİL)
 *   2. planOutfitComposition()  → hangi katmanlar yeniden üretilecek (maliyetin kalbi)
 *   3. composeOutfit()          → sağlayıcı çağrılarını zincirler
 */

// ── 1. KATMAN SIRASI ────────────────────────────────────────────────────────

/**
 * ⚠️ ACCESSORY katalogda HENÜZ YOK (`TryOnCategory` enum'u dört değer taşır:
 *    UPPER_BODY, LOWER_BODY, DRESS, OUTERWEAR) ve hiçbir sağlayıcı onu
 *    desteklemiyor. Sıra tablosunda yine de yer alıyor çünkü tablo BİR SIRA
 *    SÖZLEŞMESİDİR: aksesuar eklendiğinde sıranın neresine gireceği bugünden
 *    bellidir ve tabloyu o gün yeniden yorumlamak gerekmez.
 *
 *    Bugün üretilemez; `isProducibleCategory()` onu eler ve uygulama katmanı
 *    PRODUCT_NOT_TRYONABLE döndürür. Enum ve sağlayıcı desteği geldiğinde
 *    burada değişecek TEK ŞEY yoktur.
 */
export type OutfitLayerCategory = TryOnGarmentCategory | 'ACCESSORY';

/**
 * SABİT KATMAN SIRASI — çağıranın gönderdiği sıra DEĞİL.
 *
 * ⚠️ Sıra yanlışsa ceket gömleğin ALTINDA kalır: sağlayıcı her adımda bir
 *    önceki görselin ÜSTÜNE giydirir, yani en son giydirilen parça en üstte
 *    görünür. Bu yüzden sıra istemciye bırakılamaz — istemcinin gönderdiği
 *    sıra kullanıcının karuselde parçalara dokunma sırasıdır ve giyim
 *    fiziğiyle hiçbir ilgisi yoktur.
 *
 * Aradaki boşluklar (10'ar) bilinçli: araya yeni bir katman (ör. çorap,
 * atkı) girdiğinde tüm tablonun yeniden numaralanması gerekmesin.
 */
export const OUTFIT_LAYER_ORDER: Readonly<Record<OutfitLayerCategory, number>> = {
  /** Alt giyim — en alttaki katman. */
  LOWER_BODY: 10,
  /** Elbise tek parçadır: hem üst hem alt bölgeyi kaplar (bkz. EXCLUSIVE_SLOTS). */
  DRESS: 20,
  /** Üst giyim. */
  UPPER_BODY: 30,
  /** Dış giyim — üst giyimin ÜSTÜNE giydirilir. */
  OUTERWEAR: 40,
  /** Aksesuar — her şeyin üstünde. */
  ACCESSORY: 50,
};

/**
 * Vücut bölgeleri. Bir bölgeyi iki parça birden kaplayamaz: ikincisi
 * birincisini örter ve BİRİNCİ ÜRETİM ÇÖPE GİDER — parası ödenmiş olarak.
 * Bu yüzden çakışma sessizce tolere edilmez, istek reddedilir.
 */
type BodySlot = 'UPPER' | 'LOWER' | 'OUTER';

const EXCLUSIVE_SLOTS: Readonly<Record<OutfitLayerCategory, readonly BodySlot[]>> = {
  LOWER_BODY: ['LOWER'],
  UPPER_BODY: ['UPPER'],
  /** ⚠️ Elbise İKİ bölgeyi birden tutar: elbise + pantolon ya da elbise + gömlek çakışır. */
  DRESS: ['UPPER', 'LOWER'],
  OUTERWEAR: ['OUTER'],
  /**
   * Aksesuar bölge tutmaz: şapka ile çanta aynı anda takılabilir, birbirini
   * örtmezler. Katman sırasında yine de en üsttedir.
   */
  ACCESSORY: [],
};

/**
 * Parça sayısı sınırları.
 *
 * Alt sınır 2: tek parça zaten tek ürün denemesidir, o boru hattı daha ucuz.
 * Üst sınır 5: her parça AYRI bir sağlayıcı çağrısıdır. 5 parça FAST modda
 * ~60 saniye ve ~$0,30 demektir; üstü hem kullanıcıyı bekletir hem de tek bir
 * istekle günlük bütçeyi ısırır.
 */
export const MIN_OUTFIT_PIECES = 2;
export const MAX_OUTFIT_PIECES = 5;

export interface OutfitPieceLike {
  variantId: string;
  category: OutfitLayerCategory;
}

export type OrderedOutfitPiece<T extends OutfitPieceLike> = T & {
  /** 0'dan başlayan besteleme sırası — en alttaki katman 0. */
  layerIndex: number;
};

export type OutfitOrderFailureReason =
  'TOO_FEW_PIECES' | 'TOO_MANY_PIECES' | 'DUPLICATE_VARIANT' | 'LAYER_CONFLICT';

export type OutfitOrderResult<T extends OutfitPieceLike> =
  | { ok: true; pieces: readonly OrderedOutfitPiece<T>[] }
  | {
      ok: false;
      reason: OutfitOrderFailureReason;
      /** Loglanır; kullanıcı mesajı katalogdan gelir. */
      detail: string;
      variantIds: readonly string[];
    };

/**
 * Parçaları SABİT tabloya göre sıralar ve çakışmaları eler.
 *
 * ⚠️ Çağıranın gönderdiği sıra KULLANILMAZ. Girdi sırası yalnızca eşit
 *    katmandaki parçalarda bile devreye girmez (aşağıya bakınız).
 *
 * Jenerik: uygulama katmanı katalog anlık görüntülerini, worker ise görsel
 * URL'lerini taşıyan parçaları sıralar. Sıralama kuralı tek yerde kalsın diye
 * parçanın şekli değil yalnızca `variantId` + `category` şart koşulur.
 */
export function orderOutfitPieces<T extends OutfitPieceLike>(
  pieces: readonly T[],
): OutfitOrderResult<T> {
  const variantIds = pieces.map((piece) => piece.variantId);

  if (pieces.length < MIN_OUTFIT_PIECES) {
    return {
      ok: false,
      reason: 'TOO_FEW_PIECES',
      detail: `Kombin en az ${MIN_OUTFIT_PIECES} parça içermeli (gelen: ${pieces.length}).`,
      variantIds,
    };
  }

  if (pieces.length > MAX_OUTFIT_PIECES) {
    return {
      ok: false,
      reason: 'TOO_MANY_PIECES',
      detail: `Kombin en fazla ${MAX_OUTFIT_PIECES} parça içerebilir (gelen: ${pieces.length}).`,
      variantIds,
    };
  }

  const seen = new Set<string>();
  for (const piece of pieces) {
    if (seen.has(piece.variantId)) {
      // Aynı varyantı iki kez giydirmek ikinci bir üretim maliyetidir ve
      // görselde hiçbir şey değiştirmez.
      return {
        ok: false,
        reason: 'DUPLICATE_VARIANT',
        detail: `Aynı varyant birden fazla kez gönderildi: ${piece.variantId}`,
        variantIds,
      };
    }
    seen.add(piece.variantId);
  }

  const claimed = new Map<BodySlot, string>();
  for (const piece of pieces) {
    for (const slot of EXCLUSIVE_SLOTS[piece.category]) {
      const owner = claimed.get(slot);
      if (owner !== undefined) {
        return {
          ok: false,
          reason: 'LAYER_CONFLICT',
          detail: `Aynı bölge (${slot}) iki parça tarafından kaplanıyor: ${owner} ve ${piece.variantId}`,
          variantIds,
        };
      }
      claimed.set(slot, piece.variantId);
    }
  }

  const sorted = [...pieces].sort((a, b) => {
    const byLayer = OUTFIT_LAYER_ORDER[a.category] - OUTFIT_LAYER_ORDER[b.category];
    if (byLayer !== 0) return byLayer;

    /**
     * Aynı katmanda birden fazla parça yalnızca aksesuarda mümkündür ve
     * aralarındaki sıra görseli etkilemez. Yine de SABİT bir sıra gerekir:
     * sıra anahtarı etkiliyor (bkz. multiTryOnCacheKey), dolayısıyla aynı
     * kombin farklı istemci sırasıyla gelirse farklı anahtar üretir ve
     * önbellek sessizce ıskalar.
     *
     * ⚠️ localeCompare KULLANILMAZ: sonucu çalışma zamanının yerel ayarına
     *    bağlıdır. Sunucu ile worker farklı locale ile açılırsa aynı kombin
     *    iki farklı anahtara düşer — hata vermeden, sadece fatura artarak.
     */
    if (a.variantId < b.variantId) return -1;
    if (a.variantId > b.variantId) return 1;
    return 0;
  });

  return {
    ok: true,
    pieces: sorted.map((piece, index) => ({ ...piece, layerIndex: index })),
  };
}

/** Bugün üretilebilen kategoriler — sağlayıcı arayüzünün tanıdıkları. */
export function isProducibleCategory(
  category: OutfitLayerCategory,
): category is TryOnGarmentCategory {
  return category !== 'ACCESSORY';
}

// ── 2. PARÇA BAZLI YENİDEN ÜRETİM ───────────────────────────────────────────

/**
 * Sıralı parçalar için ÖNEK anahtarları üretir: i. anahtar, ilk (i+1) parçanın
 * birlikte giydirilmiş hâlini temsil eder.
 *
 * Son anahtar tüm kombinin anahtarıdır; ara anahtarlar hem yeniden kullanım
 * hem de kısmi sonuç için gerekir.
 */
export function outfitStepKeys(input: {
  photoContentHash: string;
  orderedVariantIds: readonly string[];
  mode: 'FAST' | 'QUALITY';
  promptVersion?: number;
  composeVersion?: number;
}): string[] {
  return input.orderedVariantIds.map((_, index) =>
    multiTryOnCacheKey({
      photoContentHash: input.photoContentHash,
      orderedVariantIds: input.orderedVariantIds.slice(0, index + 1),
      mode: input.mode,
      promptVersion: input.promptVersion,
      composeVersion: input.composeVersion,
    }),
  );
}

export interface OutfitPlanStep<T extends OutfitPieceLike> {
  piece: OrderedOutfitPiece<T>;
  key: string;
}

export interface OutfitPlan<T extends OutfitPieceLike> {
  /** Üretim YAPILMADAN yeniden kullanılan baştaki katman sayısı. */
  reusedCount: number;
  /** Taban görselin geldiği önek anahtarı; null ise kullanıcının ham fotoğrafı. */
  baseKey: string | null;
  /** Yalnızca bunlar üretilir — kota ve maliyet bu sayı üzerinden hesaplanır. */
  steps: readonly OutfitPlanStep<T>[];
}

/**
 * ⚠️ MALİYETİN KALBİ.
 *
 * Kullanıcı kombindeki bir parçayı değiştirdiğinde tüm kombin baştan
 * üretilmez: hazır sonucu olan EN DERİN önek bulunur ve üretim oradan devam
 * eder. 5 parçalı bir kombinde son parçanın değişmesi 5 üretim değil 1
 * üretimdir — beşte bir maliyet, beşte bir bekleme.
 *
 * ⚠️ NEDEN "yalnızca değişen katman" DEĞİL de "değişen katman VE ÜSTÜ":
 *    besteleme sıralıdır, her katman bir öncekinin çıktısının üstüne
 *    giydirilir. Pantolon değişirse ceket ESKİ pantolonun üstüne çizilmiş
 *    hâldedir; yalnızca pantolonu yeniden üretmek, ceketi eski pantolonla
 *    birlikte taşıyan bir görselin üstüne ikinci bir pantolon çizmek olurdu.
 *    Sonuç sessizce bozuk çıkar — ve bozuk bir görselin bedeli, fazladan bir
 *    üretimin bedelinden yüksektir.
 *
 *    Katman sırası tam da bu yüzden "en çok değişen en üstte" olacak şekilde
 *    kurulmuştur: kullanıcı karuselde en sık dış giyim ve aksesuar dener,
 *    onlar da zincirin sonundadır.
 *
 * `hasResult` bir anahtarın hazır (üretilmiş ve saklanmış) sonucu olup
 * olmadığını söyler. Önek anahtarı kendisinden önceki TÜM parçaları taşıdığı
 * için tek başına yeterlidir: ara adımların kayıtları silinmiş olsa bile
 * hazır olan en derin önek doğru tabandır.
 */
export function planOutfitComposition<T extends OutfitPieceLike>(input: {
  pieces: readonly OrderedOutfitPiece<T>[];
  keys: readonly string[];
  hasResult: (key: string) => boolean;
}): OutfitPlan<T> {
  if (input.pieces.length !== input.keys.length) {
    // Programlama hatası: anahtarlar parçalardan üretilir, sayıları ayrışamaz.
    // Sessizce kısa listeye göre çalışmak yanlış katmanı yeniden üretirdi.
    throw appError('VALIDATION_FAILED', {
      internalMessage: `Kombin planı: parça sayısı (${input.pieces.length}) ile anahtar sayısı (${input.keys.length}) uyuşmuyor`,
    });
  }

  let reusedCount = 0;
  let baseKey: string | null = null;

  // En derinden başlanır: hazır bulunan ilk önek, üretilmeyecek en uzun öneki verir.
  for (let index = input.keys.length - 1; index >= 0; index -= 1) {
    const key = input.keys[index];
    if (key !== undefined && input.hasResult(key)) {
      reusedCount = index + 1;
      baseKey = key;
      break;
    }
  }

  const steps: OutfitPlanStep<T>[] = [];
  for (let index = reusedCount; index < input.pieces.length; index += 1) {
    const piece = input.pieces[index];
    const key = input.keys[index];
    if (piece === undefined || key === undefined) continue;
    steps.push({ piece, key });
  }

  return { reusedCount, baseKey, steps };
}

/**
 * Ara katman görselinin depo anahtarı.
 *
 * ⚠️ SONUÇ GÖRSELİNDEN AYRI TUTULUR ve FİLİGRANSIZDIR. Filigran her katmanda
 *    üst üste binerse hem okunamaz hâle gelir hem de sağlayıcı bir sonraki
 *    katmanı filigran piksellerinin üstüne çizer. Filigran YALNIZCA
 *    kullanıcıya gösterilecek görsele, gösterilmeden önce eklenir
 *    (bkz. apps/worker → TryOnProcessor).
 *
 * ⚠️ Bu nesne de kullanıcının vücut görüntüsüdür: private kovada durur, imzalı
 *    ve kısa ömürlü adres dışında erişilmez, kullanıcı geçmişini sildiğinde
 *    sonuç görselleriyle BİRLİKTE silinir.
 *
 * // TODO(depo-anahtarları): `storageKeys` tablosuna taşınmalı; bugün orada
 * //   olmaması, o dosyanın bu görevin kapsamı dışında olmasındandır.
 */
export function outfitIntermediateKey(tryOnJobId: string): string {
  return `tryon/compose/${tryOnJobId}.raw.webp`;
}

// ── 3. BESTELEME ────────────────────────────────────────────────────────────

export interface IssuedIntermediateImage {
  url: string;
  /**
   * ⚠️ ADRESİ kapatır, NESNEYİ SİLMEZ. Nesne bir sonraki kombinin öneki
   *    olarak yeniden kullanılacak; silinirse parça değişiminde tüm zincir
   *    baştan üretilir.
   */
  revoke(): Promise<void>;
}

/**
 * Ara katman görselini kalıcılaştırıp sağlayıcının çekebileceği kısa ömürlü,
 * imzalı bir adres üretir.
 *
 * ⚠️ Sağlayıcı bizim depomuzdan çeker; ona Buffer gönderilmez ve kalıcı
 *    bağlantı verilmez (bkz. worker → SignedUrlIssuer, aynı sözleşme).
 */
export interface IntermediateImagePublisher {
  publish(input: {
    /** Önek anahtarı — nesnenin kimliği bu anahtara bağlanır. */
    cacheKey: string;
    image: Buffer;
    contentType: string;
  }): Promise<IssuedIntermediateImage>;
}

export interface OutfitComposeStep {
  variantId: string;
  category: TryOnGarmentCategory;
  /** Sağlayıcının çekeceği ürün görselinin imzalı adresi. */
  garmentImageUrl: string;
  /** Önek anahtarı: hem önbellek hem de sağlayıcı idempotency anahtarı. */
  cacheKey: string;
}

export interface OutfitCompositionRequest {
  /**
   * Başlangıç görseli: yeniden kullanılan önek varsa ONUN çıktısı, yoksa
   * kullanıcının fotoğrafı. Her ikisi de imzalı ve kısa ömürlüdür.
   */
  baseImageUrl: string;
  /** ⚠️ YALNIZCA üretilecek adımlar; yeniden kullanılanlar buraya girmez. */
  steps: readonly OutfitComposeStep[];
  mode: 'FAST' | 'QUALITY';
}

export interface OutfitStepOutcome {
  variantId: string;
  category: TryOnGarmentCategory;
  cacheKey: string;
  status: 'SUCCEEDED' | 'FAILED';
  provider?: string;
  reason?: TryOnFailureReason;
  costMicroUsd: bigint;
  latencyMs: number;
  /** Başarılı adımın ham (filigransız) çıktısı. */
  image?: Buffer;
  contentType?: string;
  visualConfidence?: number;
}

export interface OutfitCompositionResult {
  /**
   * SUCCEEDED : istenen tüm katmanlar giydirildi.
   * PARTIAL   : bir kısmı giydirildi, gösterilebilir bir görsel var.
   * FAILED    : ilk adım bile üretilemedi, gösterilecek yeni bir şey yok.
   */
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  steps: readonly OutfitStepOutcome[];
  /** Bu çağrıda başarıyla giydirilen katman sayısı. */
  appliedCount: number;
  /** Son BAŞARILI adımın çıktısı — kısmi sonuçta gösterilecek görsel budur. */
  image?: Buffer;
  contentType?: string;
  /** Başarısız adımlar dâhil TOPLAM maliyet: fatura açıklanabilir olmalı. */
  totalCostMicroUsd: bigint;
  failure?: {
    variantId: string;
    category: TryOnGarmentCategory;
    reason: TryOnFailureReason;
    /** Kalıcı hata tekrar denenmez — aynı sonuç, ikinci kez ödenmiş. */
    permanent: boolean;
  };
}

/**
 * KATMANLARI SIRAYLA GİYDİRİR.
 *
 * Her adımın çıktısı bir sonraki adımın "kişi görseli" olur. Zincir bu yüzden
 * paralelleştirilemez: ikinci katman, birincinin sonucunu görmeden çizilemez.
 *
 * ⚠️ KISMİ BAŞARI KARARI — 3 parçadan 2'si giydirilebildiyse ne olur:
 *    kullanıcıya YARIM KOMBİN GÖSTERİLİR, ama "istediğin kombin bu" denmez.
 *    Sonuç PARTIAL işaretlenir ve giydirilemeyen parça açıkça bildirilir.
 *
 *    Neden hata değil: üretilmiş katmanların parası ödenmiştir ve kullanıcının
 *    seçtiği parçaların çoğu görselde gerçekten vardır; hepsini çöpe atıp
 *    "olmadı" demek, ödenen bedeli de kullanıcının ilgisini de yakar.
 *
 *    Neden sessizce tam sonuç gibi gösterilmez: kullanıcı 3 parça seçtiyse
 *    kararını 3 parçaya göre verecektir. Eksik parçayı söylemeden görseli
 *    sunmak, görmediği bir kombini satın almasına yol açar — ve iade sebebi
 *    olarak geri döner. Ayrıca eksik kalan parça çoğu zaman tam da denemek
 *    istediği parçadır.
 *
 *    Kısmi sonuç ayrıca UCUZDUR: başarılı önek saklandığı için kullanıcı
 *    yalnızca eksik parçayı tekrar denediğinde önceki katmanlar yeniden
 *    üretilmez.
 *
 * ⚠️ Yeniden deneme burada YAPILMAZ: sağlayıcı seçimi ve tekrar mantığı
 *    `generateWithFallback` + `resilient()` içindedir. Burada da denenirse
 *    kalıcı hatalar katman sayısı kadar daha para yakar.
 */
export async function composeOutfit(
  providers: readonly TryOnProvider[],
  request: OutfitCompositionRequest,
  publisher: IntermediateImagePublisher,
): Promise<OutfitCompositionResult> {
  const outcomes: OutfitStepOutcome[] = [];
  const issued: IssuedIntermediateImage[] = [];

  let personImageUrl = request.baseImageUrl;
  let totalCost = 0n;
  let lastImage: { image: Buffer; contentType: string } | undefined;
  let failure: OutfitCompositionResult['failure'];

  try {
    for (const step of request.steps) {
      const chain = await generateWithFallback(providers, {
        personImageUrl,
        garmentImageUrl: step.garmentImageUrl,
        category: step.category,
        mode: request.mode,
        // Sağlayıcı tarafında tekilleştirme: aynı önek iki kez gönderilirse
        // ikinci çağrı için para ödemeyiz.
        idempotencyKey: step.cacheKey,
      });

      totalCost += chain.totalCostMicroUsd;

      if (chain.result.status === 'FAILED') {
        outcomes.push({
          variantId: step.variantId,
          category: step.category,
          cacheKey: step.cacheKey,
          status: 'FAILED',
          provider: chain.attempted.at(-1)?.provider,
          reason: chain.result.reason,
          costMicroUsd: chain.totalCostMicroUsd,
          latencyMs: chain.result.latencyMs,
        });

        failure = {
          variantId: step.variantId,
          category: step.category,
          reason: chain.result.reason,
          permanent: isPermanentFailure(chain.result.reason),
        };

        // ⚠️ Zincir KESİLİR. Sonraki katman bu katmanın çıktısının üstüne
        //    çizilecekti; taban yoksa devam etmek "ceketi havaya giydirmek"
        //    olur ve her adım ayrıca para harcar.
        break;
      }

      outcomes.push({
        variantId: step.variantId,
        category: step.category,
        cacheKey: step.cacheKey,
        status: 'SUCCEEDED',
        provider: chain.attempted.at(-1)?.provider,
        costMicroUsd: chain.totalCostMicroUsd,
        latencyMs: chain.result.latencyMs,
        image: chain.result.image,
        contentType: chain.result.contentType,
        visualConfidence: chain.result.visualConfidence,
      });

      lastImage = { image: chain.result.image, contentType: chain.result.contentType };

      /**
       * ⚠️ SON ADIMIN ÇIKTISI DA YAYIMLANIR.
       *
       * Bir sonraki katman için gerekmese bile: kullanıcı bu kombine yarın bir
       * parça daha eklerse, bugünkü sonuç o isteğin öneki olur ve hiçbir
       * katman yeniden üretilmez. Bir nesne yazmanın bedeli, bir üretimin
       * bedelinin yanında yok hükmündedir.
       */
      const published = await publisher.publish({
        cacheKey: step.cacheKey,
        image: chain.result.image,
        contentType: chain.result.contentType,
      });

      issued.push(published);
      personImageUrl = published.url;
    }
  } finally {
    // Başarı da olsa hata da olsa sağlayıcının erişimi kapatılır.
    await Promise.all(issued.map((image) => image.revoke())).catch(() => {
      // Adres kapatma hatası üretimi geçersiz kılmaz; adresler zaten kısa ömürlü.
    });
  }

  const appliedCount = outcomes.filter((outcome) => outcome.status === 'SUCCEEDED').length;
  const status: OutfitCompositionResult['status'] =
    appliedCount === request.steps.length ? 'SUCCEEDED' : appliedCount === 0 ? 'FAILED' : 'PARTIAL';

  return {
    status,
    steps: outcomes,
    appliedCount,
    image: lastImage?.image,
    contentType: lastImage?.contentType,
    totalCostMicroUsd: totalCost,
    failure,
  };
}
