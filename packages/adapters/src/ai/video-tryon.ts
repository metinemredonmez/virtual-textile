import { TRYON, usdToMicro } from '@vt/config';
import { appError } from '@vt/contracts';
import { circuitFor, type CircuitBreaker } from '../resilience/circuit-breaker.js';
import { resilient, TimeoutError } from '../resilience/resilient.js';
import { isFalConfigured, type TryOnKeys } from '../wiring.js';
import { meterCost, readReportedCostMicroUsd, type CostMetering } from './ai-cost.js';
import {
  AiBodyError,
  asRecord,
  bodyPreview,
  downloadBinary,
  readNumber,
  readPath,
  readString,
  requestJson,
} from './http.js';
import { classifyTryOnError, type TryOnClassification } from './tryon.error-map.js';
import type { TryOnFailureReason, TryOnGarmentCategory } from './tryon.provider.js';
import { clampScore } from './tryon.quality.js';

/**
 * VİDEO SANAL DENEME — FAZ 3, VARSAYILAN OLARAK KAPALI
 *
 * ⚠️ BU DOSYADAKİ HİÇBİR ŞEY KENDİLİĞİNDEN DEVREYE GİRMEZ. Kod hazırdır;
 *    anahtar çevrilene kadar fabrika `UnconfiguredVideoTryOnProvider` döner.
 *
 * Neden kapalı (docs/ozellik-yol-haritasi.md → "Faz 3 — video try-on"):
 * video üretimi görsel üretiminden KAT KAT pahalıdır. Statik try-on ~$0,06-0,08
 * iken video muhtemelen $0,50-1,00 mertebesindedir — yani TEK bir video isteği,
 * on statik denemenin parasını yakar. Yol haritasının kararı net: birim ekonomi
 * (komisyon marjı + `AI_DAILY_BUDGET_USD`) yeniden hesaplanmadan açılmaz.
 * Bu yüzden özellik bir bayrağa bağlıdır ve bayrak varsayılan olarak KAPALIDIR.
 *
 * Kapalı olmasını KOD İÇİNDE zorlamanın nedeni: "nasılsa kimse çağırmaz"
 * varsayımı bir güvence değildir. Bir modül yanlışlıkla bu sağlayıcıyı
 * bağlarsa, bayrak kapalıyken çağrı GÖRÜNÜR biçimde hata verir; sessizce
 * çalışıp fatura üretmez.
 *
 * ⚠️ KVKK: statik try-on ile aynı — kullanıcı fotoğrafı YURT DIŞINA aktarılır,
 *    CROSS_BORDER_TRANSFER rızası çağrıdan önce kontrol edilmiş olmalıdır.
 *    Bu adapter rızayı kontrol ETMEZ; o karar uygulama katmanındadır.
 *    Ek risk: çıktı artık hareketli görüntüdür ve kullanıcının fotoğrafı
 *    değil "videosu" gibi algılanır — filigran zorunluluğu bu yüzden daha da
 *    kritiktir (bkz. VideoWatermarker).
 */

// ── Sabitler ───────────────────────────────────────────────────────────────

/**
 * Video üretimine özgü sınırlar.
 *
 * ⚠️ `@vt/config`teki `TRYON` sabitlerinden AYRI tutuluyor: oradaki değerler
 *    (25/60 sn zaman aşımı, 10 MB tavan) görsel üretimin ölçüsüdür ve videoya
 *    uygulanırsa her istek zaman aşımına düşer. Aynı kutuya koymak, iki farklı
 *    maliyet sınıfını tek ayarla yönetmek demek olurdu.
 */
export const VIDEO_TRYON = {
  /**
   * Toplam bütçe — gönderim + kuyrukta bekleme + üretim + indirme.
   * Dakikalar mertebesinde: video modelleri 5 saniyelik bir klip için
   * rutin olarak 1-3 dakika harcar. Görsel tarafındaki 25 sn burada
   * "her istek başarısız" demekti.
   */
  timeoutMs: 300_000,
  /**
   * Yoklama aralığı. Çok sık yoklamak sağlayıcının hız limitini yakar ve
   * hiçbir şeyi hızlandırmaz; çok seyrek yoklamak tamamlanmış bir işi
   * boşuna bekletir.
   */
  pollIntervalMs: 5_000,
  /**
   * Yoklama, `timeoutMs`ten bu kadar ÖNCE bırakılır.
   *
   * ⚠️ Sebep para değil İZ: zaman aşımı `resilient()` tarafında gerçekleşirse
   *    yarış (race) iç kapsamı iptal eder ve kuyruğa alınmış işin
   *    `request_id`si kaybolur. O iş faturalanacaktır; kimliğini kaybetmek,
   *    ödediğimiz bir çıktıyı bir daha bulamamak demektir.
   */
  pollGiveUpMarginMs: 10_000,
  /** Talep edilebilecek klip süresi. Süre doğrudan MALİYETTİR (bkz. estimate). */
  minDurationSeconds: 2,
  maxDurationSeconds: 8,
  defaultDurationSeconds: 5,
  /**
   * İndirilecek video için üst sınır (48 MB).
   *
   * ⚠️ `MEDIA.maxUploadBytes` (10 MB) kullanılamaz: 5 saniyelik 720p bir klip
   *    rahatlıkla onu aşar ve her üretim "çok büyük" diye çöpe giderdi —
   *    üstelik parası ödendikten sonra.
   */
  maxVideoBytes: 48 * 1024 * 1024,
  /**
   * Yasal uyarı metni statik try-on ile AYNI. Ayrı bir metin yazmak, aynı
   * yükümlülüğün iki yerde ayrışması demek olurdu.
   */
  watermarkText: TRYON.watermarkText,
} as const;

/** Sağlayıcı içerik türü bildirmezse varsayılan. */
const DEFAULT_VIDEO_CONTENT_TYPE = 'video/mp4';

/**
 * `AiUsageLog.feature` için kullanılacak değer.
 *
 * ⚠️ ŞEMA DEĞİŞİKLİĞİ GEREKTİRİR: `AiFeature` enum'ında bu değer HENÜZ YOK.
 *    Migration yazıldı ama UYGULANMADI:
 *    `packages/db/prisma/migrations-pending/20260812090000_ai_feature_video_tryon/`
 *
 *    Değer neden 'TRYON' olamaz: maliyet paneli ve bütçe sorguları
 *    `feature` alanına göre gruplanıyor. Video harcamasını TRYON kovasına
 *    yazmak, iki farklı birim maliyeti (0,06 $ ve 0,50 $) tek ortalamada
 *    eritir — birim ekonomiyi ölçmek için açılan özellik, tam da ölçülmesi
 *    gereken sayıyı bozar.
 */
export const VIDEO_TRYON_USAGE_FEATURE = 'VIDEO_TRYON';

// ── Arayüz ─────────────────────────────────────────────────────────────────

/**
 * ⚠️ FİLİGRAN DURUMU — tip sisteminde taşınır, yorumda değil.
 *
 * Statik try-on'da filigran worker'da ekleniyor (`tryon.watermarker.ts`) ve
 * sonuç tipi bunu belirtmiyor; oraya bakan biri "eklendi mi" sorusunu ancak
 * çağrı zincirini okuyarak yanıtlayabiliyor. Videoda bu risk daha büyük
 * olduğu için durum SONUCUN ÜZERİNDE taşınır: filigransız bir çıktıyı
 * yanlışlıkla yayına vermek, derleme hatası olmadan mümkün olmamalı.
 */
export type VideoWatermarkState =
  /** Sağlayıcıdan geldiği hâl — YAYINLANAMAZ. */
  | 'NOT_APPLIED'
  /** Tüm karelere gömüldü — yayınlanabilir. Bkz. VideoWatermarker. */
  | 'ALL_FRAMES';

/**
 * ⚠️ FİLİGRAN VİDEODA DA ZORUNLU — VE İLK KAREYE DEĞİL, TÜM KARELERE.
 *
 * UYGULAMA BİLİNÇLİ OLARAK YAZILMADI (özellik kapalı; bkz. dosya başlığı).
 * Burada yalnızca yeri ve gerekçesi bırakılmıştır.
 *
 * Neden tüm kareler:
 *  1. Videodan tek kare çıkarmak (ekran görüntüsü, `ffmpeg -ss`, tarayıcıda
 *     duraklat-kaydet) sıradan bir kullanıcı hareketidir. Yalnızca ilk kare
 *     işaretliyse, çıkarılan HER DİĞER kare filigransız bir "gerçek fotoğraf"
 *     gibi dolaşıma girer — yasal uyarının koruduğu şey tam olarak budur.
 *  2. İlk kareyi kırpmak bir düzenleme değil, bir düğmedir. Uyarı, kaldırılması
 *     içeriği bozmadan mümkün olan bir yere konulamaz.
 *  3. Otomatik oynatılan önizlemeler klibi çoğu zaman ortadan başlatır;
 *     kullanıcı ilk kareyi hiç görmeyebilir.
 *
 * Neden şimdi yazılmadı: kare kare bindirme videoyu YENİDEN KODLAMAYI
 * gerektirir (ffmpeg + drawtext). Bu, worker'a yeni bir sistem bağımlılığı
 * (// NEEDS-DEP: ffmpeg) ve her istek başına ek CPU süresi ekler; ikisi de
 * özellik açılırken birim ekonomiye dahil edilmesi gereken kalemlerdir.
 * Maliyet kararı verilmeden bağımlılık getirmek, kararın kendisini peşinen
 * vermek olurdu.
 */
export interface VideoWatermarker {
  /**
   * Uyarı metnini videonun TÜM karelerine gömer.
   * Fail-closed: başarısızsa FIRLATIR — filigransız video DÖNDÜRMEZ.
   */
  embedAllFrames(
    video: Buffer,
    text: string,
  ): Promise<{ video: Buffer; contentType: string; watermark: 'ALL_FRAMES' }>;
}

/**
 * Uygulama gelene kadar geçerli olan yer tutucu.
 *
 * ⚠️ Sessizce "filigranladım" demez, FIRLATIR. Bir sonraki geliştirici video
 *    yayın akışını bağlamaya çalıştığında burada durur — kod tabanı ona
 *    filigransız bir çıkış yolu bırakmaz.
 */
export class UnimplementedVideoWatermarker implements VideoWatermarker {
  embedAllFrames(): Promise<never> {
    return Promise.reject(
      appError('SERVICE_UNAVAILABLE', {
        internalMessage:
          'Video filigranı (tüm kareler) henüz uygulanmadı — filigransız video yayınlanamaz',
      }),
    );
  }
}

export interface VideoTryOnRequest {
  /** İmzalı, kısa ömürlü URL. Statik try-on ile aynı kural. */
  personImageUrl: string;
  garmentImageUrl: string;
  category: TryOnGarmentCategory;
  /**
   * Talep edilen klip süresi (saniye).
   * ⚠️ Süre doğrudan maliyettir; `clampVideoDuration` ile sınırlanır.
   */
  durationSeconds: number;
  /**
   * Sağlayıcı tarafında tekilleştirme için gönderilir.
   * ⚠️ `resilient()`e VERİLMEZ — bkz. FalVideoTryOnProvider.generate.
   */
  idempotencyKey: string;
}

/**
 * ⚠️ Başarısızlık sebepleri statik try-on ile AYNI birleşimi kullanır.
 *
 * Ayrı bir birleşim tanımlamak cazip ama yanlış olurdu: sınıflandırma
 * `tryon.error-map.ts`te tek noktada yapılıyor ve o dosya "bu dosya para
 * harcatır" uyarısıyla ince ayarlı. İkinci bir sebep listesi, ikinci bir
 * sınıflandırıcı demektir; ikisi zamanla ayrışır ve hangi hatanın zinciri
 * kestiği sorusu iki ayrı cevaba sahip olur.
 */
export type VideoTryOnFailureReason = TryOnFailureReason;

interface VideoTryOnResultBase {
  latencyMs: number;
  costMicroUsd: bigint;
  /**
   * Sağlayıcının kuyruk kimliği.
   *
   * ⚠️ BAŞARISIZLIKTA DA TAŞINIR. Kuyruğa alınmış bir video, biz beklemekten
   *    vazgeçsek bile üretilir ve FATURALANIR. Kimliği kaybedersek ödediğimiz
   *    çıktıyı sonradan bulmanın yolu kalmaz; fatura satırı da hiçbir işle
   *    eşleşmez.
   */
  providerRequestId?: string;
}

export interface VideoTryOnSuccess extends VideoTryOnResultBase {
  status: 'SUCCEEDED';
  /** Üretilen videonun ham baytları. */
  video: Buffer;
  contentType: string;
  /** Sağlayıcının bildirdiği gerçek süre; yoksa talep edilen süre. */
  durationSeconds: number;
  /** 0-100. Statik taraftaki `visualConfidence` ile aynı amaç. */
  visualConfidence: number;
  model: string;
  /**
   * ⚠️ Adapter HER ZAMAN 'NOT_APPLIED' döner. Filigran bu katmanın işi değil;
   *    burada yalnızca "henüz eklenmedi" gerçeği taşınır.
   */
  watermark: VideoWatermarkState;
}

export interface VideoTryOnFailure extends VideoTryOnResultBase {
  status: 'FAILED';
  reason: VideoTryOnFailureReason;
  /** Sağlayıcı kodu veya eşleşen kural — loglanır, kullanıcıya gösterilmez. */
  providerCode?: string;
}

export type VideoTryOnResult = VideoTryOnSuccess | VideoTryOnFailure;

export type MeteredVideoTryOnSuccess = VideoTryOnSuccess & CostMetering;
export type MeteredVideoTryOnFailure = VideoTryOnFailure & CostMetering;
export type MeteredVideoTryOnResult = MeteredVideoTryOnSuccess | MeteredVideoTryOnFailure;

export interface VideoTryOnProvider {
  readonly name: string;
  readonly supportedCategories: readonly TryOnGarmentCategory[];
  generate(request: VideoTryOnRequest): Promise<VideoTryOnResult>;
}

/**
 * Süreyi sınırlar.
 *
 * ⚠️ Sınırsız süre = sınırsız fatura. Video modelleri SANİYE BAŞINA
 *    fiyatlanır; istemciden gelen "durationSeconds: 60" değeri, tek istekte
 *    günlük video bütçesinin tamamını yakabilir. Tavan burada, girdinin
 *    okunduğu ilk noktada uygulanır.
 */
export function clampVideoDuration(seconds: number): number {
  if (!Number.isFinite(seconds)) return VIDEO_TRYON.defaultDurationSeconds;
  const rounded = Math.round(seconds);
  if (rounded < VIDEO_TRYON.minDurationSeconds) return VIDEO_TRYON.minDurationSeconds;
  if (rounded > VIDEO_TRYON.maxDurationSeconds) return VIDEO_TRYON.maxDurationSeconds;
  return rounded;
}

// ── Maliyet ────────────────────────────────────────────────────────────────

/**
 * Model başına SANİYE BAŞINA üretim ücreti (mikro-dolar).
 *
 * ⚠️ Statik tabloda (`FAL_TRYON_UNIT_COST_MICRO_USD`) birim "üretim"di; burada
 *    "üretim × saniye". Video modelleri klip uzunluğuna göre faturalandığı
 *    için sabit bir üretim ücreti yazmak, 8 saniyelik klibi 2 saniyelik gibi
 *    göstermek olurdu.
 *
 * ⚠️ Fiyatlar DOĞRULANMAMIŞ tahmindir — özellik açılmadan önce sağlayıcının
 *    güncel fiyat listesiyle ve `docs/ai-costs.md` ile birlikte güncellenmeli.
 */
export const FAL_VIDEO_TRYON_MICRO_USD_PER_SECOND: Readonly<Record<string, bigint>> = {};

/**
 * Tabloda olmayan model için varsayılan: 0,10 $/saniye.
 * 5 saniyelik klip → 0,50 $. Yol haritasındaki "$0,50-1,00" aralığının ALT
 * ucu; tahmini düşük tutmak bütçe alarmını geç çalar, o yüzden bilinçli olarak
 * aralığın ortasına değil, ölçülene kadar temkinli tarafa yakın durulur.
 */
const VIDEO_DEFAULT_MICRO_USD_PER_SECOND = 100_000n;

/** Klip süresine göre maliyet tahmini (mikro-dolar). */
export function videoTryOnEstimate(model: string, durationSeconds: number): bigint {
  const perSecond =
    FAL_VIDEO_TRYON_MICRO_USD_PER_SECOND[model] ?? VIDEO_DEFAULT_MICRO_USD_PER_SECOND;
  return perSecond * BigInt(clampVideoDuration(durationSeconds));
}

// ── Bütçe — AYRI KOVA ──────────────────────────────────────────────────────

/**
 * VİDEO BÜTÇESİ NEDEN AYRI
 *
 * ⚠️ Video harcaması `AI_DAILY_BUDGET_USD` kovasına YAZILAMAZ. Sebep aritmetik:
 *    günlük görsel bütçesi 50 $ ve bir video ~0,50 $ ise, yüz video tüm günün
 *    statik try-on, stil danışmanı ve gömme bütçesini bitirir. O noktada
 *    kullanıcıların çoğu, hiç talep etmedikleri bir özelliğin parasıyla
 *    kapatılmış bir sanal denemeyle karşılaşır.
 *
 * Ayrı kova iki şeyi garanti eder:
 *  1. Video ne kadar tutarsa tutsun, statik try-on çalışmaya devam eder.
 *  2. Videonun gerçek birim maliyeti TEK BAŞINA ölçülebilir — Faz 3 kararının
 *     dayanacağı sayı budur (bkz. docs/ozellik-yol-haritasi.md).
 *
 * ⚠️ Kovanın ayrı olması, harcamanın da ayrı SORGULANMASINI gerektirir:
 *    `AiUsageLog` toplamı değil, `feature = VIDEO_TRYON` filtreli toplam
 *    okunmalıdır (bkz. VIDEO_TRYON_USAGE_FEATURE).
 */
export interface VideoAiBudget {
  dailyPlatformUsd: number;
  /** 1.0 = tavan dolunca video tamamen kapanır. */
  hardStopRatio: number;
  alertThresholds: readonly number[];
}

export interface VideoBudgetEnv {
  AI_VIDEO_DAILY_BUDGET_USD: number;
}

export function videoBudgetFromEnv(config: VideoBudgetEnv): VideoAiBudget {
  return {
    dailyPlatformUsd: config.AI_VIDEO_DAILY_BUDGET_USD,
    hardStopRatio: 1.0,
    alertThresholds: [0.5, 0.8, 0.95],
  };
}

/**
 * Harcama girdisi.
 *
 * ⚠️ Alan adları statik bütçedeki (`checkBudget`) `todayMicroUsd` /
 *    `thisMonthMicroUsd`tan BİLEREK farklı. İki kovanın girdisi aynı adı
 *    taşısaydı, yanlışlıkla platform toplamını buraya geçirmek derleme
 *    hatası vermez, yalnızca video tavanını sessizce yanlış yerden ölçerdi.
 */
export interface VideoSpend {
  /** BUGÜN yalnızca VİDEO özelliğine harcanan tutar. Platform toplamı DEĞİL. */
  videoTodayMicroUsd: bigint;
  /**
   * Yapılmak ÜZERE olan isteğin tahmini maliyeti (süre × birim fiyat).
   *
   * ⚠️ Statik bütçe kontrolünde bu alan yok ve olmaması doğru: 0,06 $'lık bir
   *    çağrının tavanı aşması önemsiz bir taşmadır. Videoda tek çağrı 0,50-1,00 $
   *    olduğu için "zaten aştık mı" sorusu GEÇ kalır — sorulması gereken
   *    "bu çağrıyla aşacak mıyız". Aradaki fark, tavanın bir kez %100 yerine
   *    %200 aşılmasıdır.
   */
  pendingRequestMicroUsd: bigint;
}

export type VideoBudgetDecision =
  { allowed: true; warnAtRatio?: number } | { allowed: false; reason: 'VIDEO_DAILY_BUDGET' };

/**
 * Video çağrısına izin verilir mi. Çağrı YAPILMADAN ÖNCE sorulur.
 *
 * ⚠️ `checkBudget`in video karşılığı DEĞİL, ondan farklı bir karardır:
 *    bekleyen isteğin maliyetini de hesaba katar (bkz. VideoSpend).
 */
export function checkVideoBudget(budget: VideoAiBudget, spent: VideoSpend): VideoBudgetDecision {
  const dailyMicro = usdToMicro(budget.dailyPlatformUsd);
  const limit = usdToMicro(budget.dailyPlatformUsd * budget.hardStopRatio);

  // Tavan sıfır/negatifse özellik kapalı demektir; "sınırsız" değil.
  if (limit <= 0n) return { allowed: false, reason: 'VIDEO_DAILY_BUDGET' };

  const projected = spent.videoTodayMicroUsd + spent.pendingRequestMicroUsd;
  if (projected > limit) return { allowed: false, reason: 'VIDEO_DAILY_BUDGET' };

  const ratio = Number(projected) / Number(dailyMicro);
  const crossed = [...budget.alertThresholds].reverse().find((threshold) => ratio >= threshold);

  return crossed === undefined ? { allowed: true } : { allowed: true, warnAtRatio: crossed };
}

// ── fal.ai video sağlayıcısı ───────────────────────────────────────────────

/**
 * SAĞLAYICI SEÇİMİ: fal — GEREKÇE
 *
 * 1. Girdi sayısı. Video try-on İKİ koşullandırma görseli ister (kişi + ürün).
 *    Gemini'nin video modeli (Veo) `image-to-video` olarak TEK başlangıç
 *    karesi + metin alır; giysi kimliği metinden kurulamaz. Oradan gitmek
 *    "önce statik try-on üret, sonra onu canlandır" demek olurdu: iki ayrı
 *    üretim, iki ayrı fatura ve ikinci geçişte bozulan giysi detayı. Bu,
 *    zaten pahalı olan özelliği iki kat pahalı ve daha kötü yapardı.
 *
 * 2. Anahtar ve KVKK. `FAL_KEY` zaten var ve fal zaten birincil try-on
 *    sağlayıcısı; yeni bir satıcı, yeni bir sözleşme, yeni bir yurt dışı
 *    aktarım değerlendirmesi gerekmez. Kapalı gelecek bir özellik için
 *    ikinci bir tedarikçi ilişkisi açmak erken maliyettir.
 *
 * 3. Kuyruk uç noktası. Dakikalarca süren üretim için `queue.fal.run`
 *    `request_id` verir ve durum yoklanabilir. Statik adapter bilinçli olarak
 *    senkron `fal.run` kullanıyor (bkz. fal.ts) çünkü bütçesi 25 sn; video
 *    için bu mümkün değildir, bağlantı kopar ve iş kaybolur.
 *
 * ⚠️ Model slug'ı VARSAYILAN OLARAK BOŞ (`FAL_VIDEO_TRYON_MODEL`). Tahmin
 *    edilmiş bir slug üretimde 404'tür ve "özelliği açtım ama çalışmıyor"
 *    diye okunur. Slug, özellik açılırken fal kataloğundan DOĞRULANARAK
 *    verilmelidir; verilmediyse fabrika `Unconfigured` döner.
 */
const FAL_QUEUE_BASE_URL = 'https://queue.fal.run';

const FAL_VIDEO_CATEGORY: Readonly<Record<TryOnGarmentCategory, string>> = {
  UPPER_BODY: 'upper_body',
  LOWER_BODY: 'lower_body',
  DRESS: 'dresses',
  OUTERWEAR: 'upper_body',
};

export interface FalVideoTryOnConfig {
  apiKey: string;
  /** env().FAL_VIDEO_TRYON_MODEL — boşsa fabrika bu sınıfı hiç kurmaz. */
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  circuitBreaker?: CircuitBreaker;
  now?: () => number;
  /** Test için enjekte edilebilir bekleme. */
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  pollIntervalMs?: number;
  maxVideoBytes?: number;
}

/**
 * Çağrı başına paylaşılan iz.
 *
 * ⚠️ Neden `this` üzerinde tutulmuyor: sağlayıcı örneği paylaşılır ve eşzamanlı
 *    çağrılar birbirinin `request_id`sini ezerdi. Neden yerel değişken de
 *    değil: zaman aşımı `resilient()` tarafında, yani bu kapsamın DIŞINDA
 *    gerçekleşir; fallback'in kuyruk kimliğini görebilmesi için ize ortak bir
 *    referans üzerinden ulaşması gerekir.
 */
interface VideoCallTrace {
  requestId?: string;
  /**
   * Sağlayıcıya TAAHHÜT EDİLMİŞ tutar. Gönderim başarılı olduğu anda dolar:
   * o noktadan sonra biz vazgeçsek de iş üretilir ve faturalanır.
   */
  committedMicroUsd: bigint;
}

export class FalVideoTryOnProvider implements VideoTryOnProvider {
  readonly name = 'fal-video';

  /** Statik tarafla aynı kategoriler (OUTERWEAR üst beden olarak eşlenir). */
  readonly supportedCategories: readonly TryOnGarmentCategory[] = [
    'UPPER_BODY',
    'LOWER_BODY',
    'DRESS',
    'OUTERWEAR',
  ];

  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly maxVideoBytes: number;

  constructor(private readonly config: FalVideoTryOnConfig) {
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    this.now = config.now ?? Date.now;
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.baseUrl = config.baseUrl ?? FAL_QUEUE_BASE_URL;
    this.timeoutMs = config.timeoutMs ?? VIDEO_TRYON.timeoutMs;
    this.pollIntervalMs = config.pollIntervalMs ?? VIDEO_TRYON.pollIntervalMs;
    this.maxVideoBytes = config.maxVideoBytes ?? VIDEO_TRYON.maxVideoBytes;
  }

  async generate(request: VideoTryOnRequest): Promise<MeteredVideoTryOnResult> {
    const startedAt = this.now();
    const trace: VideoCallTrace = { committedMicroUsd: 0n };

    return resilient<MeteredVideoTryOnResult>(
      {
        provider: this.name,
        operation: 'generate',
        errorCode: 'TRYON_PROVIDER_ERROR',
        timeoutMs: this.timeoutMs,
        /**
         * ⚠️ `idempotencyKey` BİLEREK VERİLMEDİ — retry YAPISAL OLARAK KAPALI.
         *
         * `resilient()` anahtar yoksa denemeyi 1'e sabitler (bkz. resilient.ts).
         * `retryAttempts: 0` yazmak da aynı sonucu verirdi ama biri onu ileride
         * 2 yapabilir; anahtarın yokluğu bu kapıyı kapatır.
         *
         * Neden hiç retry yok: statik try-on'da ikinci deneme ~0,06 $ riskti ve
         * sınır 2 denemeyle tutuluyordu. Videoda ikinci deneme 0,50-1,00 $'dır
         * ve fal idempotency GARANTİSİ VERMEZ — üstelik kuyruk uç noktasında
         * ikinci gönderim İKİNCİ BİR İŞ yaratır. Başarısız bir videoyu tekrar
         * denemek yerine kullanıcı kotasını iade etmek her zaman daha ucuzdur.
         *
         * Anahtar yine de sağlayıcıya BAŞLIKLA gönderilir (bkz. submit):
         * fal dikkate alırsa çift üretimi engeller, yok sayarsa zararsızdır.
         */
        ...(this.config.circuitBreaker ? { circuitBreaker: this.config.circuitBreaker } : {}),
        // ⚠️ `generate` ASLA fırlatmaz: çağıran taraf (kuyruk işçisi) hata ile
        //    başarısız sonucu ayırt edip kotayı iade edebilsin diye.
        fallback: (error) => this.toFailure(error, startedAt, trace),
      },
      () => this.call(request, startedAt, trace),
    );
  }

  private async call(
    request: VideoTryOnRequest,
    startedAt: number,
    trace: VideoCallTrace,
  ): Promise<MeteredVideoTryOnResult> {
    const duration = clampVideoDuration(request.durationSeconds);
    const estimate = videoTryOnEstimate(this.config.model, duration);

    const requestId = await this.submit(request, duration);

    // ⚠️ BU SATIRDAN SONRA PARA TAAHHÜT EDİLDİ. İş kuyruğa girdi; biz
    //    beklemekten vazgeçsek bile üretilir ve faturalanır. Bundan sonraki
    //    her başarısızlık SIFIR maliyetle değil, tahminle kaydedilir.
    trace.requestId = requestId;
    trace.committedMicroUsd = estimate;

    const payload = await this.awaitResult(requestId, startedAt);

    const reported = readReportedCostMicroUsd(payload);
    const { costMicroUsd, ...metering } = meterCost({
      ...(reported === undefined ? {} : { reportedMicroUsd: reported }),
      estimatedMicroUsd: estimate,
    });

    const video = extractVideo(payload);
    if (!video) {
      // Üretim denendi ve faturalandı; gövdedeki metin sebebi söyleyebilir.
      const classification = classifyTryOnError(
        new AiBodyError(this.name, bodyPreview(JSON.stringify(payload))),
      );
      return this.failure(classification, startedAt, { costMicroUsd, ...metering }, requestId);
    }

    // ⚠️ Boyut kontrolü İNDİRMEDEN ÖNCE: `downloadBinary` tüm gövdeyi belleğe
    //    alıp sonra ölçüyor (bkz. http.ts). 10 MB'lık bir görselde bu kabul
    //    edilebilirdi; onlarca MB'lık videoda kuyruk işçisinin belleğini
    //    sağlayıcının insafına bırakmak olur. Sağlayıcı boyutu bildirdiğinde
    //    indirmeye hiç başlamayız.
    //    (NOT: kalıcı çözüm akış hâlinde indirme + erken iptaldir; `http.ts`
    //     bu görevin kapsamı dışında olduğu için burada ön kontrolle yetinildi.)
    if (video.fileSize !== undefined && video.fileSize > this.maxVideoBytes) {
      const classification = classifyTryOnError(
        new AiBodyError(this.name, `video ${video.fileSize} bayt, sınır ${this.maxVideoBytes}`),
      );
      return this.failure(classification, startedAt, { costMicroUsd, ...metering }, requestId);
    }

    const downloaded = await downloadBinary(
      video.url,
      this.name,
      this.fetchImpl,
      this.maxVideoBytes,
    );

    const actualDuration = video.durationSeconds ?? duration;

    return {
      status: 'SUCCEEDED',
      video: downloaded.bytes,
      // ⚠️ `downloadBinary` içerik türü yoksa 'image/png'e düşer — görsel
      //    tarafı için doğru, video için yanlış. Sağlayıcının bildirdiği tür
      //    önce gelir; o da yoksa video varsayılanına düşülür.
      contentType: video.contentType ?? videoContentTypeOf(downloaded.contentType),
      durationSeconds: actualDuration,
      visualConfidence: videoVisualConfidence({
        byteLength: downloaded.bytes.byteLength,
        durationSeconds: actualDuration,
        requestedDurationSeconds: duration,
      }),
      costMicroUsd,
      latencyMs: this.now() - startedAt,
      model: this.config.model,
      providerRequestId: requestId,
      // ⚠️ Adapter filigran EKLEMEZ — bkz. VideoWatermarker.
      watermark: 'NOT_APPLIED',
      ...metering,
    };
  }

  /** Kuyruğa gönderir, `request_id` döner. */
  private async submit(request: VideoTryOnRequest, durationSeconds: number): Promise<string> {
    const { json } = await requestJson({
      url: `${this.baseUrl}/${this.config.model}`,
      provider: this.name,
      fetchImpl: this.fetchImpl,
      headers: this.headers(request.idempotencyKey),
      body: {
        human_image_url: request.personImageUrl,
        garment_image_url: request.garmentImageUrl,
        category: FAL_VIDEO_CATEGORY[request.category],
        duration: durationSeconds,
      },
    });

    const requestId = readString(json, 'request_id') ?? readString(json, 'requestId');
    if (!requestId) {
      // Kuyruk kimliği yoksa işi izleyemeyiz. Gönderim başarılı görünse bile
      // sonucu alamayacağımız için burada durmak, körlemesine yoklamaktan iyidir.
      throw new AiBodyError(this.name, bodyPreview(JSON.stringify(json)));
    }
    return requestId;
  }

  /**
   * Tamamlanana kadar yoklar, sonra sonucu okur.
   *
   * ⚠️ Kendi son teslim tarihi var (`timeoutMs - pollGiveUpMarginMs`):
   *    `resilient()`in zaman aşımına yakalanmak, iz nesnesini taşıyan
   *    fallback'in çalışmasını engellemez ama bu kapsamdaki temizliği
   *    yarıda keser. Kendi süremizde bırakmak, TIMEOUT'u sınıflandırılmış
   *    ve `request_id`li olarak döndürmemizi sağlar.
   */
  private async awaitResult(requestId: string, startedAt: number): Promise<unknown> {
    const deadline = Math.max(0, this.timeoutMs - VIDEO_TRYON.pollGiveUpMarginMs);
    const statusUrl = `${this.baseUrl}/${this.config.model}/requests/${requestId}/status`;

    for (;;) {
      const { json } = await requestJson({
        url: statusUrl,
        method: 'GET',
        provider: this.name,
        fetchImpl: this.fetchImpl,
        headers: this.headers(),
      });

      const status = (readString(json, 'status') ?? '').toUpperCase();

      if (status === 'COMPLETED' || status === 'OK') break;

      if (status === 'FAILED' || status === 'ERROR' || status === 'CANCELLED') {
        // Sebep gövdede metin olarak gelir; sınıflandırma tek noktada yapılır.
        throw new AiBodyError(this.name, bodyPreview(JSON.stringify(json)));
      }

      if (this.now() - startedAt >= deadline) {
        throw new TimeoutError(`${this.name}.poll`, deadline);
      }

      await this.sleep(this.pollIntervalMs);
    }

    const { json } = await requestJson({
      url: `${this.baseUrl}/${this.config.model}/requests/${requestId}`,
      method: 'GET',
      provider: this.name,
      fetchImpl: this.fetchImpl,
      headers: this.headers(),
    });

    return json;
  }

  private headers(idempotencyKey?: string): Record<string, string> {
    return {
      // fal şeması: "Key <anahtar>" — "Bearer" DEĞİL.
      Authorization: `Key ${this.config.apiKey}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}),
    };
  }

  /**
   * Fırlatılan hatayı sınıflandırılmış başarısızlığa çevirir.
   *
   * ⚠️ MALİYET KARARI statik taraftan FARKLI. Orada yalnızca TIMEOUT
   *    faturalanmış sayılıyordu; burada ölçüt "iş kuyruğa girdi mi":
   *     - Gönderim başarısızsa (ağ, 4xx, 5xx) hiçbir şey üretilmedi → 0.
   *     - Gönderim başarılıysa, sonrasında ne olursa olsun iş üretilir ve
   *       faturalanır → tahmin yazılır.
   *    Kuyruk modeli bu ayrımı mümkün kıldığı için tahminden ölçüme bir adım
   *    daha yakınız; senkron çağrıda böyle bir işaret yoktu.
   */
  private toFailure(
    error: unknown,
    startedAt: number,
    trace: VideoCallTrace,
  ): MeteredVideoTryOnFailure {
    const classification = classifyTryOnError(error);
    const { costMicroUsd, ...metering } = meterCost({
      estimatedMicroUsd: trace.committedMicroUsd,
    });

    return this.failure(classification, startedAt, { costMicroUsd, ...metering }, trace.requestId);
  }

  private failure(
    classification: TryOnClassification,
    startedAt: number,
    metering: CostMetering & { costMicroUsd: bigint },
    requestId: string | undefined,
  ): MeteredVideoTryOnFailure {
    const { costMicroUsd, ...rest } = metering;
    return {
      status: 'FAILED',
      reason: classification.reason,
      providerCode: classification.providerCode ?? classification.rule,
      costMicroUsd,
      latencyMs: this.now() - startedAt,
      ...(requestId ? { providerRequestId: requestId } : {}),
      ...rest,
    };
  }
}

/** fal sonucu videoyu `video` ya da `videos[0]` altında verir. İkisi de okunur. */
function extractVideo(json: unknown):
  | {
      url: string;
      contentType?: string;
      fileSize?: number;
      durationSeconds?: number;
    }
  | undefined {
  const direct = asRecord(readPath(json, 'video'));
  const fromList = asRecord(readPath(json, 'videos', 0));
  const node = direct ?? fromList;
  if (!node) return undefined;

  const url = readString(node, 'url');
  if (!url) return undefined;

  const contentType = readString(node, 'content_type') ?? readString(node, 'contentType');
  const fileSize = readNumber(node, 'file_size') ?? readNumber(node, 'fileSize');
  const durationSeconds =
    readNumber(node, 'duration') ?? readNumber(json, 'duration') ?? readNumber(node, 'duration_s');

  return {
    url,
    ...(contentType ? { contentType } : {}),
    ...(fileSize === undefined ? {} : { fileSize }),
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
  };
}

/** İndirme başlığı video değilse varsayılana düşer (bkz. çağrı yerindeki not). */
function videoContentTypeOf(downloaded: string): string {
  return downloaded.startsWith('video/') ? downloaded : DEFAULT_VIDEO_CONTENT_TYPE;
}

/**
 * VİDEO GÜVEN SKORU (0-100)
 *
 * ⚠️ `visualConfidenceFrom` (statik) YENİDEN KULLANILMADI: oradaki eşikler
 *    (20 KB / 60 KB) tek karelik bir görselin ölçüsüdür. Video için aynı
 *    eşikler her çıktıyı "mükemmel" ilan ederdi — 5 saniyelik bozuk bir klip
 *    bile 60 KB'ı rahatça geçer. Ölçü burada SANİYE BAŞINA bayttır.
 *
 * Statik taraftaki temkinli tutum korunur: emin olmadığımızda skor düşer.
 */
export function videoVisualConfidence(input: {
  byteLength: number;
  durationSeconds: number;
  requestedDurationSeconds: number;
}): number {
  const seconds = Math.max(1, input.durationSeconds);
  const bytesPerSecond = input.byteLength / seconds;

  // Video için taban, statik QUALITY'den düşük tutulur: hareketli çıktıda
  // artefakt görme olasılığı daha yüksek ve tek karede fark edilmeyen bir
  // bozulma videoda göze batar.
  let score = 70;

  // 40 KB/sn altı: neredeyse kesin boş/donuk klip (model çöktü, siyah kare).
  if (bytesPerSecond < 40 * 1024) score -= 35;
  else if (bytesPerSecond < 120 * 1024) score -= 12;

  // Sağlayıcı istenenden kısa klip döndürdüyse kırpılmış demektir.
  if (input.durationSeconds + 0.5 < input.requestedDurationSeconds) score -= 10;

  return clampScore(score);
}

// ── Fabrika — KAPALI GELİR ─────────────────────────────────────────────────

/**
 * Neden `Unconfigured` bir SEBEP taşıyor: "video neden çalışmıyor" sorusunun
 * üç farklı cevabı var (bayrak kapalı / anahtar yok / model verilmemiş) ve
 * üçü de operatörden farklı bir iş ister. Tek bir "yapılandırılmadı" mesajı,
 * bayrağı açmış ama model vermemiş birine hiçbir şey söylemez.
 */
export type VideoUnconfiguredReason = 'FLAG_OFF' | 'MISSING_KEY' | 'MISSING_MODEL';

const UNCONFIGURED_MESSAGE: Readonly<Record<VideoUnconfiguredReason, string>> = {
  FLAG_OFF:
    'Video sanal deneme KAPALI (AI_VIDEO_TRYON_ENABLED=false). Birim ekonomi yeniden hesaplanmadan açılmamalıdır.',
  MISSING_KEY: 'Video sanal deneme açık ama FAL_KEY tanımlı değil.',
  MISSING_MODEL:
    'Video sanal deneme açık ama FAL_VIDEO_TRYON_MODEL tanımlı değil — model slug fal kataloğundan doğrulanarak verilmelidir.',
};

/**
 * HİÇBİR VİDEO SAĞLAYICISI DEVREDE DEĞİL.
 *
 * ⚠️ `{ status: 'FAILED' }` DÖNMEZ, FIRLATIR — statik taraftaki
 *    `UnconfiguredTryOnProvider` ile aynı gerekçe: başarısız bir sonuç
 *    "sağlayıcı denedi, olmadı" demektir ve çağıran taraf onu kesinti sayıp
 *    kullanıcı kotasını harcanmış işleyebilir. Burada olan bir kesinti değil,
 *    özelliğin KAPALI olmasıdır.
 */
export class UnconfiguredVideoTryOnProvider implements VideoTryOnProvider {
  readonly name = 'unconfigured-video';

  /**
   * Dördü de listelenir — statik taraftaki gerekçenin aynısı: boş liste,
   * çağıranın bu sağlayıcıyı sessizce ATLAMASINA yol açar.
   */
  readonly supportedCategories: readonly TryOnGarmentCategory[] = [
    'UPPER_BODY',
    'LOWER_BODY',
    'DRESS',
    'OUTERWEAR',
  ];

  constructor(readonly reason: VideoUnconfiguredReason) {}

  generate(): Promise<VideoTryOnResult> {
    return Promise.reject(
      appError('SERVICE_UNAVAILABLE', {
        internalMessage: UNCONFIGURED_MESSAGE[this.reason],
      }),
    );
  }
}

/**
 * Video sağlayıcısının ortam dilimi.
 * `TryOnKeys` genişletilir ki "fal yapılandırılmış mı" sorusu tek kaynaktan
 * (`isFalConfigured`) yanıtlansın — ikinci bir yüklem zamanla ayrışırdı.
 */
export type VideoTryOnEnv = TryOnKeys & {
  AI_VIDEO_TRYON_ENABLED: boolean;
  FAL_VIDEO_TRYON_MODEL: string;
};

/**
 * Özellik gerçekten açık mı. Açılış raporu ve admin paneli bunu okur;
 * `createVideoTryOnProvider` ile AYNI koşulu kullanır ki rapor ile davranış
 * ayrışmasın.
 */
export function isVideoTryOnConfigured(config: VideoTryOnEnv): boolean {
  return videoUnconfiguredReason(config) === undefined;
}

function videoUnconfiguredReason(config: VideoTryOnEnv): VideoUnconfiguredReason | undefined {
  // ⚠️ SIRA ÖNEMLİ: bayrak önce sorulur. Anahtar ve model dolu olsa bile
  //    bayrak kapalıysa cevap "kapalı"dır — yapılandırma eksikliği değil,
  //    ürün kararıdır ve mesajı da öyle olmalıdır.
  if (!config.AI_VIDEO_TRYON_ENABLED) return 'FLAG_OFF';
  if (!isFalConfigured(config)) return 'MISSING_KEY';
  if (config.FAL_VIDEO_TRYON_MODEL === '') return 'MISSING_MODEL';
  return undefined;
}

/**
 * VİDEO SAĞLAYICISI — ORTAMDAN KURULUM.
 *
 * ⚠️ Statik taraftan farklı olarak ZİNCİR DÖNMEZ, tek sağlayıcı döner.
 *    Fallback zinciri, başarısız bir video isteğinin faturasını İKİYE
 *    KATLARDI (0,50 $ + 0,50 $) ve elde hâlâ video olmazdı. Birim ekonomisi
 *    henüz ölçülmemiş bir özellikte doğru davranış, bir kez denemek ve
 *    başarısızsa kullanıcı kotasını iade etmektir.
 *
 * ⚠️ Devre kesici 'fal' DEĞİL 'fal-video' adıyla açılır. Aynı kesiciyi
 *    paylaşsalardı, pahalı video çağrılarındaki arızalar gelir üreten statik
 *    try-on yolunu da kapatırdı — ve tersi.
 */
export function createVideoTryOnProvider(config: VideoTryOnEnv): VideoTryOnProvider {
  const reason = videoUnconfiguredReason(config);
  if (reason !== undefined) return new UnconfiguredVideoTryOnProvider(reason);

  return new FalVideoTryOnProvider({
    apiKey: config.FAL_KEY,
    model: config.FAL_VIDEO_TRYON_MODEL,
    circuitBreaker: circuitFor('fal-video'),
  });
}
