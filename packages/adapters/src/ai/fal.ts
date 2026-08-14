import { MEDIA, TRYON, env } from '@vt/config';
import type { CircuitBreaker } from '../resilience/circuit-breaker.js';
import { resilient } from '../resilience/resilient.js';
import {
  falTryOnEstimate,
  meterCost,
  readReportedCostMicroUsd,
  type CostMetering,
} from './ai-cost.js';
import {
  AiHttpError,
  asRecord,
  bodyPreview,
  downloadBinary,
  readArray,
  readNumber,
  readPath,
  readString,
  requestJson,
} from './http.js';
import type { MeteredTryOnFailure, MeteredTryOnResult } from './tryon.metered.js';
import {
  classifyTryOnError,
  classifyTryOnSignal,
  isTryOnRetryable,
  type TryOnClassification,
} from './tryon.error-map.js';
import type { TryOnGarmentCategory, TryOnProvider, TryOnRequest } from './tryon.provider.js';
import { visualConfidenceFrom } from './tryon.quality.js';

/**
 * fal.ai SANAL DENEME ADAPTER'I (birincil sağlayıcı)
 *
 * ⚠️ KVKK: bu çağrıyla kullanıcı fotoğrafı YURT DIŞINA aktarılır. Çağırmadan
 *    önce CROSS_BORDER_TRANSFER rızası kontrol edilmiş olmalıdır — adapter
 *    rızayı kontrol ETMEZ, o karar uygulama katmanındadır. Buraya gelen URL'ler
 *    kısa ömürlü ve tek kullanımlıktır (bkz. SIGNED_URL_TTL_SECONDS.aiProviderInput).
 *
 * Senkron `fal.run` uç noktası kullanılır: kuyruk uç noktası (queue.fal.run)
 * ikinci bir yoklama döngüsü gerektirir ve bizim zaman aşımı bütçemiz zaten
 * tek çağrıdan kısa (FAST 25 sn).
 */

export interface FalTryOnConfig {
  apiKey: string;
  /** env().FAL_TRYON_MODEL — ör. 'fal-ai/idm-vton' */
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  circuitBreaker?: CircuitBreaker;
  now?: () => number;
  /** Üretilen görsel için üst sınır. Varsayılan: MEDIA.maxUploadBytes. */
  maxImageBytes?: number;
  /** Test için değiştirilebilir kuyruk kökü. */
  queueBaseUrl?: string;
}

const FAL_BASE_URL = 'https://fal.run';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  KUYRUK UCU — SENKRON UÇ YERİNE.
 *
 *  ⚠️ CANLI ARIZADAN DOĞDU (2026-08-14). Önce `https://fal.run/{model}`
 *     kullanılıyordu: bu SENKRON uçtur, bağlantıyı açık tutup üretimin
 *     bitmesini bekler. Ölçüldü:
 *
 *         fal: TIMEOUT (25001ms)   → sınır 25 sn iken
 *         fal: TIMEOUT (~60000ms)  → sınır 60 sn'ye çıkarıldıktan sonra
 *
 *     Yani süreyi büyütmek çözmedi; senkron uç bizim beklediğimizden uzun
 *     sürüyor. Sebebi büyük ihtimalle SOĞUK BAŞLANGIÇ: model uzun süre
 *     çağrılmamışsa fal onu yüklerken istek kuyrukta bekliyor ve bu süre
 *     üretim süresine ekleniyor. Düşük trafikte bu KURAL, istisna değil.
 *
 *  Kuyruk ucu bunu üç şekilde çözer:
 *    1. Gönderim ANINDA döner (`request_id`), bağlantı tutulmaz. Uzun ömürlü
 *       HTTP bağlantılarını kesen ara vekiller/yük dengeleyiciler devre dışı.
 *    2. Durum yoklanabilir — "kuyrukta bekliyor" ile "asıldı" ayırt edilir.
 *    3. Bizim süre bütçemiz üretimi DEĞİL, toplam bekleyişi sınırlar.
 *
 *  ⚠️ WORKER ZATEN ASENKRON: iş BullMQ kuyruğunda, tarayıcı yoklama yapıyor.
 *     Yani burada beklemek kimseyi bloklamıyor — senkron uçta ısrar etmek
 *     hiçbir şey kazandırmıyordu.
 * ═══════════════════════════════════════════════════════════════════════════
 */
const FAL_QUEUE_BASE_URL = 'https://queue.fal.run';

/** Durum yoklama aralığı. Kısa tutulur: üretim bitince beklemek istemiyoruz. */
const KUYRUK_YOKLAMA_ARALIGI_MS = 1500;

/**
 * ⚠️ YOKLAMA DÖNGÜSÜ KENDİ SÜRE SINIRINI TAŞIR VE BU ZORUNLU.
 *
 *    Dış sarmalayıcı (`resilient` → `withTimeout`) zaman aşımını
 *    `Promise.race` ile uyguluyor ve iptal sinyalini `fn`e GEÇİRMİYOR.
 *    Döngü kendi kendini durdurmazsa, dışarıda "zaman aşımı" denmesine
 *    rağmen arka planda yoklamaya DEVAM EDER — sızıntı ve boşa istek.
 *
 *    Pay, dış bütçenin bitiminden hemen önce durmak içindir; böylece hata
 *    "yoklama bitmedi" olarak bizim tarafımızdan, anlaşılır biçimde doğar.
 */
const KUYRUK_GUVENLIK_PAYI_MS = 3000;

/**
 * Kategori eşlemesi. fal'ın IDM-VTON ailesi üç kategori tanır; OUTERWEAR için
 * ayrı bir sınıfı yoktur ve üst beden olarak işlenir. Desteklenmeyen bir
 * kategoriyi göndermek 422 döndürür — o yüzden burada eşliyoruz, sağlayıcıya
 * bırakmıyoruz.
 */
const FAL_CATEGORY: Readonly<Record<TryOnGarmentCategory, string>> = {
  UPPER_BODY: 'upper_body',
  LOWER_BODY: 'lower_body',
  DRESS: 'dresses',
  OUTERWEAR: 'upper_body',
};

/**
 * GİYSİ AÇIKLAMASI — `idm-vton` şemasında ZORUNLU alan.
 *
 * ⚠️ Model bu metni giysiyi anlamak için okuyor; boş geçmek şemayı geçse bile
 *    sonucu kötüleştirir. Kısa ve nesnel tutuluyor: marka/renk gibi ayrıntılar
 *    zaten GÖRSELDE var ve metinle tekrarlamak modeli yanıltabilir.
 *
 * ⚠️ İngilizce — model istemi İngilizce okuyor. Bu bir arayüz metni DEĞİL,
 *    sağlayıcıya giden teknik bir parametre; sözlüğe girmez.
 */
const FAL_DESCRIPTION: Record<TryOnGarmentCategory, string> = {
  UPPER_BODY: 'a garment worn on the upper body',
  LOWER_BODY: 'a garment worn on the lower body',
  DRESS: 'a full-length dress',
  OUTERWEAR: 'an outer layer garment worn over other clothing',
};

export class FalTryOnProvider implements TryOnProvider {
  readonly name = 'fal';

  /**
   * Dördü de desteklenir (OUTERWEAR üst beden olarak). Liste daraltılırsa
   * `generateWithFallback` bu sağlayıcıyı ilgili kategoride hiç denemez.
   */
  readonly supportedCategories: readonly TryOnGarmentCategory[] = [
    'UPPER_BODY',
    'LOWER_BODY',
    'DRESS',
    'OUTERWEAR',
  ];

  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly baseUrl: string;
  private readonly queueBaseUrl: string;
  private readonly maxImageBytes: number;

  constructor(private readonly config: FalTryOnConfig) {
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    this.now = config.now ?? Date.now;
    this.baseUrl = config.baseUrl ?? FAL_BASE_URL;
    this.queueBaseUrl = config.queueBaseUrl ?? FAL_QUEUE_BASE_URL;
    this.maxImageBytes = config.maxImageBytes ?? MEDIA.maxUploadBytes;
  }

  async generate(request: TryOnRequest): Promise<MeteredTryOnResult> {
    const startedAt = this.now();

    return resilient<MeteredTryOnResult>(
      {
        provider: this.name,
        operation: 'generate',
        errorCode: 'TRYON_PROVIDER_ERROR',
        // Mod bazlı bütçe: FAST 25 sn, QUALITY 60 sn (bkz. TRYON.timeoutMs).
        timeoutMs: TRYON.timeoutMs[request.mode],
        idempotencyKey: request.idempotencyKey,
        // ⚠️ En fazla 2 deneme. Sağlayıcı idempotency GARANTİSİ VERMİYOR;
        //    yeniden deneme ikinci bir üretim ücreti riskidir. Sınırı düşük
        //    tutmak bu riski sınırlı ve öngörülebilir kılar.
        retryAttempts: 2,
        isRetryable: isTryOnRetryable,
        ...(this.config.circuitBreaker ? { circuitBreaker: this.config.circuitBreaker } : {}),
        // ⚠️ `generate` ASLA fırlatmaz: fırlatırsa `generateWithFallback`
        //    zincirin tamamını kaybeder ve yedek sağlayıcı hiç denenmez.
        //    Hata, sınıflandırılmış bir TryOnFailure'a çevrilir.
        fallback: (error) => this.toFailure(error, startedAt),
      },
      () => this.call(request, startedAt),
    );
  }

  private async call(request: TryOnRequest, startedAt: number): Promise<MeteredTryOnResult> {
    const json = await this.kuyrukIleUret(request, startedAt);


    const reportedCost = readReportedCostMicroUsd(json);
    const estimatedCost = falTryOnEstimate(this.config.model);
    const metering = meterCost({
      ...(reportedCost === undefined ? {} : { reportedMicroUsd: reportedCost }),
      estimatedMicroUsd: estimatedCost,
    });

    // ── İçerik güvenliği: 200 OK ama üretim reddedilmiş olabilir ──────────
    // fal NSFW tespitinde siyah/boş görsel döndürür ve bayrağı gövdede taşır.
    // ⚠️ Bu KALICI hatadır: yedek sağlayıcı da aynı fotoğrafı reddedecektir.
    //    Ürün riski: iç giyim/mayo kategorilerinde yanlış pozitif olabilir.
    //    Bu kabul edilmiş bir üründür kararıdır — yanlış pozitifte kullanıcıya
    //    "fotoğrafınız işlenemedi" denir, kotası iade edilir.
    const nsfwFlags = readArray(json, 'has_nsfw_concepts');
    if (nsfwFlags.some((flag) => flag === true)) {
      return this.failure(
        { reason: 'CONTENT_BLOCKED', providerCode: 'has_nsfw_concepts', rule: 'fal-nsfw-flag' },
        startedAt,
        metering,
      );
    }

    const image = extractImage(json);
    if (!image) {
      // Görsel yok: sebep gövdede metin olarak olabilir (kişi bulunamadı vb.).
      // Üretim denendiği için maliyet YİNE kaydedilir.
      const classification = classifyTryOnSignal({ text: bodyPreview(JSON.stringify(json)) });
      return this.failure(classification, startedAt, metering);
    }

    const downloaded = await downloadBinary(
      image.url,
      this.name,
      this.fetchImpl,
      this.maxImageBytes,
    );

    return {
      status: 'SUCCEEDED',
      image: downloaded.bytes,
      contentType: image.contentType ?? downloaded.contentType,
      visualConfidence: visualConfidenceFrom({
        mode: request.mode,
        byteLength: downloaded.bytes.byteLength,
        ...(image.score === undefined ? {} : { providerScore: image.score }),
      }),
      costMicroUsd: metering.costMicroUsd,
      latencyMs: this.now() - startedAt,
      model: this.config.model,
      ...meteringFields(metering),
    };
  }


  /**
   * KUYRUĞA GÖNDER → DURUMU YOKLA → SONUCU AL.
   *
   * ⚠️ ÜÇ AYRI HTTP İSTEĞİ ama TEK mantıksal çağrı. Dönen değer, senkron ucun
   *    döndürdüğü gövdenin AYNISIDIR — bu yüzden `call()`un geri kalanı
   *    (NSFW bayrağı, görsel çıkarma, maliyet ölçümü) hiç değişmedi.
   */
  private async kuyrukIleUret(request: TryOnRequest, startedAt: number): Promise<unknown> {
    const bitis = startedAt + TRYON.timeoutMs[request.mode] - KUYRUK_GUVENLIK_PAYI_MS;

    // ── 1) Gönder ────────────────────────────────────────────────────────
    const { json: gonderim } = await requestJson({
      url: `${this.queueBaseUrl}/${this.config.model}`,
      provider: this.name,
      fetchImpl: this.fetchImpl,
      headers: {
        // fal şeması: "Key <anahtar>" — "Bearer" DEĞİL.
        Authorization: `Key ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        // Sağlayıcı tarafında tekilleştirme için gönderilir. fal bunu
        // belgelemiyor; yok sayarsa zararsızdır, dikkate alırsa retry'da
        // ikinci üretimi engeller. Bu yüzden retry sayısı yine de düşük tutulur.
        'X-Idempotency-Key': request.idempotencyKey,
      },
      body: {
        human_image_url: request.personImageUrl,
        garment_image_url: request.garmentImageUrl,
        category: FAL_CATEGORY[request.category],
        /**
         * ⚠️ ZORUNLU ALAN — YOKLUĞU ÜRETİMDE HER DENEMEYİ DÜŞÜRÜYORDU.
         *
         *  Canlıda ölçüldü (2026-08-14): iş worker'a ulaşıyor, fal'a gidiyor
         *  ve 4,6 saniyede `TRYON_PROVIDER_ERROR` ile düşüyordu. Sağlayıcıya
         *  worker'ın gönderdiği gövdenin AYNISI elle atıldı:
         *
         *      POST https://fal.run/fal-ai/idm-vton   →  HTTP 422
         *      {"detail":[{"loc":["body","description"],
         *                  "msg":"Field required","type":"missing"}]}
         *
         *  Yani `description` şemada ZORUNLU ve biz hiç göndermiyorduk.
         *
         * ⚠️ HİÇBİR TESTİN GÖREMEYECEĞİ BİR ARIZAYDI: birim testlerde `fetch`
         *    sahtelenir, sahte uç gövdeyi doğrulamaz. Sağlayıcı şemasını
         *    yalnızca GERÇEK uç doğrular ve ona hiç istek atılmamıştı.
         *
         * ⚠️ METİN KATEGORİDEN TÜRETİLİYOR, ürün başlığından DEĞİL. İki sebep:
         *    (1) `TryOnRequest` ürün metnini taşımıyor ve onu eklemek sözleşmeyi
         *        sağlayıcıya özel bir alanla kirletirdi;
         *    (2) ürün başlıkları Türkçe ("Keten Oversize Gömlek") ve model
         *        istemi İngilizce okuyor — çeviri borcu doğururdu. Kategori
         *        eşlemesi zaten var ve deterministtir.
         */
        description: FAL_DESCRIPTION[request.category],
        // QUALITY modda daha çok adım: kalite/latency kaldıracı burada.
        num_inference_steps: request.mode === 'QUALITY' ? 40 : 20,
      },
    });

    /**
     * ⚠️ KUYRUK ADRESLERİ YOKSA GÖVDE ZATEN SONUÇTUR. fal bazı modellerde
     *    (ve senkron uçta) doğrudan sonucu döndürüyor. Burada körü körüne
     *    yoklamaya girsek, hazır sonucu elimizde tutarken sonsuza kadar
     *    "durum" arardık.
     */
    const durumAdresi = readString(gonderim, 'status_url');
    const sonucAdresi = readString(gonderim, 'response_url');
    if (!durumAdresi || !sonucAdresi) return gonderim;

    // ── 2) Yokla ─────────────────────────────────────────────────────────
    for (;;) {
      if (this.now() >= bitis) {
        // ⚠️ KENDİ ZAMAN AŞIMIMIZ. Dış sarmalayıcı iptal sinyalini bize
        //    geçirmiyor; durmazsak arka planda yoklamaya devam ederdik.
        throw new AiHttpError(408, this.name, `kuyruk beklemesi aşıldı: ${this.config.model}`);
      }

      await bekle(KUYRUK_YOKLAMA_ARALIGI_MS);

      const { json: durum } = await requestJson({
        url: durumAdresi,
        method: 'GET',
        provider: this.name,
        fetchImpl: this.fetchImpl,
        headers: { Authorization: `Key ${this.config.apiKey}` },
      });

      const asama = readString(durum, 'status');
      if (asama === 'COMPLETED') break;

      /**
       * ⚠️ IN_QUEUE ve IN_PROGRESS DIŞINDAKİ HER ŞEY HATADIR. Bilinmeyen bir
       *    aşamada beklemeye devam etmek, bütçeyi boşa yakıp sonunda
       *    anlaşılmaz bir zaman aşımı üretirdi. Adı geçen aşamayı hataya
       *    yazıyoruz ki sınıflandırıcı ve log bir şey görsün.
       */
      if (asama !== 'IN_QUEUE' && asama !== 'IN_PROGRESS') {
        throw new AiHttpError(502, this.name, `beklenmeyen kuyruk durumu: ${asama ?? 'yok'}`);
      }
    }

    // ── 3) Sonucu al ─────────────────────────────────────────────────────
    const { json: sonuc } = await requestJson({
      url: sonucAdresi,
      method: 'GET',
      provider: this.name,
      fetchImpl: this.fetchImpl,
      headers: { Authorization: `Key ${this.config.apiKey}` },
    });

    return sonuc;
  }

  /**
   * Fırlatılan hatayı sınıflandırılmış başarısızlığa çevirir.
   *
   * ⚠️ Maliyet kararı: ZAMAN AŞIMINDA maliyet TAHMİN EDİLİR, sıfır yazılmaz.
   * Zaman aşımına uğrayan çağrı sağlayıcı tarafında tamamlanmış ve faturaya
   * yazılmış olabilir; sıfır yazmak defterimizi sistematik olarak eksik tutar
   * ve ay sonunda faturayla arayı kapatılamaz bir fark oluşur.
   * Buna karşılık taşıma hataları (ağ, 5xx, devre açık) üretime hiç ulaşmamış
   * sayılır ve 0 maliyetle kaydedilir.
   */
  private toFailure(error: unknown, startedAt: number): MeteredTryOnFailure {
    const classification = classifyTryOnError(error);
    const billed = classification.reason === 'TIMEOUT';

    const metering = meterCost({
      estimatedMicroUsd: billed ? falTryOnEstimate(this.config.model) : 0n,
    });

    return this.failure(classification, startedAt, metering);
  }

  private failure(
    classification: TryOnClassification,
    startedAt: number,
    metering: CostMetering & { costMicroUsd: bigint },
  ): MeteredTryOnFailure {
    return {
      status: 'FAILED',
      reason: classification.reason,
      // Sağlayıcı kodu yoksa hangi KURALIN eşleştiği yazılır. Yanlış
      // sınıflandırmayı üretimde ayıklamanın tek yolu bu izdir; alan yalnızca
      // loglanır, kullanıcıya gösterilmez.
      providerCode: classification.providerCode ?? classification.rule,
      costMicroUsd: metering.costMicroUsd,
      latencyMs: this.now() - startedAt,
      ...meteringFields(metering),
    };
  }
}

/** Ölçüm alanlarını sonuca kopyalar (`costMicroUsd` ayrıca yazılır). */
function meteringFields(metering: CostMetering): CostMetering {
  return {
    ...(metering.reportedCostMicroUsd === undefined
      ? {}
      : { reportedCostMicroUsd: metering.reportedCostMicroUsd }),
    ...(metering.estimatedCostMicroUsd === undefined
      ? {}
      : { estimatedCostMicroUsd: metering.estimatedCostMicroUsd }),
    costBasis: metering.costBasis,
  };
}

/**
 * fal modelleri çıktıyı ya `image` ya `images[0]` altında verir. İkisini de
 * okuruz: model değiştiğinde adapter'ın sessizce "görsel yok" demesi,
 * kullanıcıya sebepsiz başarısızlık göstermek demektir.
 */
function extractImage(
  json: unknown,
): { url: string; contentType?: string; score?: number } | undefined {
  const direct = asRecord(readPath(json, 'image'));
  const fromList = asRecord(readPath(json, 'images', 0));
  const node = direct ?? fromList;
  if (!node) return undefined;

  const url = readString(node, 'url');
  if (!url) return undefined;

  const contentType = readString(node, 'content_type') ?? readString(node, 'contentType');
  const score = readNumber(json, 'confidence') ?? readNumber(node, 'score');

  return {
    url,
    ...(contentType ? { contentType } : {}),
    ...(score === undefined ? {} : { score }),
  };
}

/** Ortamdan yapılandırılmış birincil sağlayıcı. */
export function falTryOnProviderFromEnv(overrides: Partial<FalTryOnConfig> = {}): FalTryOnProvider {
  const environment = env();
  return new FalTryOnProvider({
    apiKey: environment.FAL_KEY,
    model: environment.FAL_TRYON_MODEL,
    ...overrides,
  });
}

// NOT: görsel indirme hatası burada özel olarak yakalanmaz; `downloadBinary`
// fırlatır, `classifyTryOnError` onu GEÇİCİ hata sayar ve zincir yedek
// sağlayıcıya geçer. Üretim ücreti bu durumda da kaydedilir.

/**
 * ⚠️ `setTimeout` DOĞRUDAN KULLANILMIYOR, sarmalanıyor: yoklama döngüsünde
 *    testlerin sahte saatle ilerleyebilmesi için tek bir yerde durması gerek.
 */
function bekle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
