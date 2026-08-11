import { MEDIA, TRYON, env } from '@vt/config';
import type { CircuitBreaker } from '../resilience/circuit-breaker.js';
import { resilient } from '../resilience/resilient.js';
import { googlePrice, meterCost, tokenCostMicroUsd, type CostMetering } from './ai-cost.js';
import {
  asRecord,
  downloadBinary,
  readArray,
  readNumber,
  readPath,
  readString,
  requestJson,
} from './http.js';
import {
  GEMINI_NO_PERSON_SENTINEL,
  classifyGeminiBlockReason,
  classifyGeminiFinishReason,
  classifyGeminiTextResponse,
  classifyTryOnError,
  isTryOnRetryable,
  type TryOnClassification,
} from './tryon.error-map.js';
import type { MeteredTryOnFailure, MeteredTryOnResult } from './tryon.metered.js';
import type { TryOnGarmentCategory, TryOnProvider, TryOnRequest } from './tryon.provider.js';
import { visualConfidenceFrom } from './tryon.quality.js';

/**
 * GOOGLE GEMINI SANAL DENEME ADAPTER'I (yedek sağlayıcı)
 *
 * `TryOnProvider` arayüzünü fal ile BİREBİR aynı şekilde uygular; fallback
 * zinciri iki sağlayıcı arasındaki farkı görmez.
 *
 * ⚠️ ÖNEMLİ FARK: Gemini görseli URL'den ÇEKMEZ, gövdede base64 ister. Bu
 *    yüzden imzalı URL'leri önce biz indiririz. Sonucu:
 *     - Ek gecikme (iki indirme) ve ~%33 daha büyük istek gövdesi.
 *     - Fotoğraf bir kez daha bizim belleğimizden geçer; diske YAZILMAZ.
 *    KVKK açısından aktarım niteliği değişmez: yurt dışına aktarımdır ve
 *    CROSS_BORDER_TRANSFER rızası gerektirir.
 */

export interface GeminiTryOnConfig {
  apiKey: string;
  /** env().GOOGLE_AI_IMAGE_MODEL — ör. 'gemini-2.5-flash-image' */
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  circuitBreaker?: CircuitBreaker;
  now?: () => number;
  maxImageBytes?: number;
}

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Görsel çıktısı sabit sayıda çıkış tokenı olarak faturalanır. Yanıt
 * `usageMetadata` taşımadığında tahminin dayanağı budur.
 */
const GEMINI_IMAGE_OUTPUT_TOKENS = 1_290;

const GARMENT_LABEL: Readonly<Record<TryOnGarmentCategory, string>> = {
  UPPER_BODY: 'üst beden giysisi (tişört, gömlek, bluz vb.)',
  LOWER_BODY: 'alt beden giysisi (pantolon, etek, şort vb.)',
  DRESS: 'elbise',
  OUTERWEAR: 'dış giyim (mont, ceket, kaban vb.)',
};

/**
 * Prompt'ta modelden kişi yoksa TAM OLARAK bir işaret yazması istenir.
 *
 * Neden: modelin "bu fotoğrafta bir insan göremiyorum" cümlesini anahtar
 * kelimeyle yakalamak kırılgandır — dil, üslup ve model sürümü değişir.
 * Deterministik bir işaret, NO_PERSON_DETECTED sınıflandırmasını tahminden
 * çıkarıp ölçüme çevirir. Bu sınıflandırma KALICI olduğu için doğruluğu
 * doğrudan paraya dokunur.
 */
function buildPrompt(category: TryOnGarmentCategory): string {
  return [
    'Sana iki görsel veriyorum: birincisi bir kişinin fotoğrafı, ikincisi bir giysi ürün görseli.',
    `Giysi türü: ${GARMENT_LABEL[category]}.`,
    'Görev: kişinin fotoğrafındaki mevcut giysiyi bu ürünle değiştirerek gerçekçi bir görsel üret.',
    'Kişinin yüzünü, vücut oranlarını, duruşunu, ten rengini ve arka planı DEĞİŞTİRME.',
    'Yalnızca görseli döndür, açıklama yazma.',
    `Fotoğrafta tam boy bir kişi tespit edemezsen görsel üretme ve yalnızca şunu yaz: ${GEMINI_NO_PERSON_SENTINEL}`,
  ].join('\n');
}

export class GeminiTryOnProvider implements TryOnProvider {
  readonly name = 'gemini';

  readonly supportedCategories: readonly TryOnGarmentCategory[] = [
    'UPPER_BODY',
    'LOWER_BODY',
    'DRESS',
    'OUTERWEAR',
  ];

  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly baseUrl: string;
  private readonly maxImageBytes: number;

  constructor(private readonly config: GeminiTryOnConfig) {
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    this.now = config.now ?? Date.now;
    this.baseUrl = config.baseUrl ?? GEMINI_BASE_URL;
    this.maxImageBytes = config.maxImageBytes ?? MEDIA.maxUploadBytes;
  }

  async generate(request: TryOnRequest): Promise<MeteredTryOnResult> {
    const startedAt = this.now();

    return resilient<MeteredTryOnResult>(
      {
        provider: this.name,
        operation: 'generate',
        errorCode: 'TRYON_PROVIDER_ERROR',
        timeoutMs: TRYON.timeoutMs[request.mode],
        idempotencyKey: request.idempotencyKey,
        retryAttempts: 2,
        isRetryable: isTryOnRetryable,
        ...(this.config.circuitBreaker ? { circuitBreaker: this.config.circuitBreaker } : {}),
        fallback: (error) => this.toFailure(error, startedAt),
      },
      () => this.call(request, startedAt),
    );
  }

  private async call(request: TryOnRequest, startedAt: number): Promise<MeteredTryOnResult> {
    // İki indirme paralel yapılır: seri yapmak FAST modun 25 sn bütçesinden
    // gereksiz yere ikinci bir RTT götürür.
    const [person, garment] = await Promise.all([
      downloadBinary(request.personImageUrl, this.name, this.fetchImpl, this.maxImageBytes),
      downloadBinary(request.garmentImageUrl, this.name, this.fetchImpl, this.maxImageBytes),
    ]);

    const { json } = await requestJson({
      url: `${this.baseUrl}/models/${this.config.model}:generateContent`,
      provider: this.name,
      fetchImpl: this.fetchImpl,
      headers: {
        // ⚠️ Anahtar BAŞLIKTA gider, sorgu dizesinde değil: query string
        //    proxy ve erişim loglarına düz metin yazılır.
        'x-goog-api-key': this.config.apiKey,
        'Content-Type': 'application/json',
      },
      body: {
        contents: [
          {
            role: 'user',
            parts: [
              { text: buildPrompt(request.category) },
              {
                inlineData: { mimeType: person.contentType, data: person.bytes.toString('base64') },
              },
              {
                inlineData: {
                  mimeType: garment.contentType,
                  data: garment.bytes.toString('base64'),
                },
              },
            ],
          },
        ],
        generationConfig: {
          // TEXT de isteniyor: kişi bulunamadığında modelin işaret metnini
          // yazabilmesi için tek kanal bu.
          responseModalities: ['TEXT', 'IMAGE'],
          candidateCount: 1,
        },
      },
    });

    const metering = this.meterFromUsage(json);

    // 1) İstek modele HİÇ gitmediyse: prompt seviyesinde engellendi.
    const blocked = classifyGeminiBlockReason(readPath(json, 'promptFeedback', 'blockReason'));
    if (blocked) return this.failure(blocked, startedAt, metering);

    // 2) Üretim başladı ama sonlandırma sebebi güvenlik/kesinti olabilir.
    const finish = classifyGeminiFinishReason(readPath(json, 'candidates', 0, 'finishReason'));
    if (finish && finish.reason === 'CONTENT_BLOCKED') {
      return this.failure(finish, startedAt, metering);
    }

    const parts = readArray(readPath(json, 'candidates', 0, 'content'), 'parts');
    const inline = extractInlineImage(parts);

    // 3) Görsel yok, metin var: kişi bulunamadı işareti burada aranır.
    if (!inline) {
      const text = extractText(parts);
      const classification =
        text.trim() === ''
          ? (finish ?? {
              reason: 'PROVIDER_ERROR' as const,
              rule: 'gemini-empty-candidate',
            })
          : classifyGeminiTextResponse(text);
      return this.failure(classification, startedAt, metering);
    }

    const bytes = Buffer.from(inline.data, 'base64');
    if (bytes.byteLength === 0) {
      return this.failure(
        { reason: 'PROVIDER_ERROR', rule: 'gemini-empty-image' },
        startedAt,
        metering,
      );
    }

    return {
      status: 'SUCCEEDED',
      image: bytes,
      contentType: inline.mimeType,
      visualConfidence: visualConfidenceFrom({
        mode: request.mode,
        byteLength: bytes.byteLength,
        // Yedek sağlayıcı olduğu için taban güven bilinçli olarak düşürülmez;
        // ama güvenlik derecelendirmesi "sınırda" diyorsa skor düşer.
        flaggedBorderline: hasBorderlineSafetyRating(json),
      }),
      costMicroUsd: metering.costMicroUsd,
      latencyMs: this.now() - startedAt,
      model: this.config.model,
      ...meteringFields(metering),
    };
  }

  /**
   * Google parasal maliyet DÖNDÜRMEZ; token sayımı döndürür. Parayı kendi
   * fiyat tablomuzdan hesaplarız — bu yüzden basis `PROVIDER_USAGE`'dır:
   * ölçüme dayanır ama fiyat varsayımı bizimdir.
   */
  private meterFromUsage(json: unknown): CostMetering & { costMicroUsd: bigint } {
    const usage = asRecord(readPath(json, 'usageMetadata'));
    const price = googlePrice(this.config.model);

    if (usage) {
      const inputTokens = readNumber(usage, 'promptTokenCount') ?? 0;
      const outputTokens = readNumber(usage, 'candidatesTokenCount') ?? GEMINI_IMAGE_OUTPUT_TOKENS;
      return meterCost({
        estimatedMicroUsd: tokenCostMicroUsd({ inputTokens, outputTokens }, price),
        fromUsage: true,
      });
    }

    return meterCost({
      estimatedMicroUsd: tokenCostMicroUsd(
        { inputTokens: 0, outputTokens: GEMINI_IMAGE_OUTPUT_TOKENS },
        price,
      ),
    });
  }

  /** Bkz. `FalTryOnProvider.toFailure` — zaman aşımı faturalanmış sayılır. */
  private toFailure(error: unknown, startedAt: number): MeteredTryOnFailure {
    const classification = classifyTryOnError(error);
    const billed = classification.reason === 'TIMEOUT';

    const metering = meterCost({
      estimatedMicroUsd: billed
        ? tokenCostMicroUsd(
            { inputTokens: 0, outputTokens: GEMINI_IMAGE_OUTPUT_TOKENS },
            googlePrice(this.config.model),
          )
        : 0n,
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
      // Bkz. FalTryOnProvider.failure — kod yoksa eşleşen kural iz olarak kalır.
      providerCode: classification.providerCode ?? classification.rule,
      costMicroUsd: metering.costMicroUsd,
      latencyMs: this.now() - startedAt,
      ...meteringFields(metering),
    };
  }
}

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

/** camelCase ve snake_case iki gösterim de kabul edilir (API sürümleri farklı kullanıyor). */
function extractInlineImage(parts: unknown[]): { mimeType: string; data: string } | undefined {
  for (const part of parts) {
    const node = asRecord(readPath(part, 'inlineData')) ?? asRecord(readPath(part, 'inline_data'));
    if (!node) continue;
    const data = readString(node, 'data');
    if (!data) continue;
    return {
      data,
      mimeType: readString(node, 'mimeType') ?? readString(node, 'mime_type') ?? 'image/png',
    };
  }
  return undefined;
}

function extractText(parts: unknown[]): string {
  return parts
    .map((part) => readString(part, 'text') ?? '')
    .filter((text) => text !== '')
    .join(' ');
}

/**
 * Güvenlik derecelendirmesi "orta/yüksek" ise içerik engellenmemiştir ama
 * sınırdadır. Sonucu göstermeye devam ederiz, güven skorunu düşürerek.
 */
function hasBorderlineSafetyRating(json: unknown): boolean {
  const ratings = readArray(readPath(json, 'candidates', 0), 'safetyRatings');
  return ratings.some((rating) => {
    const probability = readString(rating, 'probability');
    return probability === 'MEDIUM' || probability === 'HIGH';
  });
}

/** Ortamdan yapılandırılmış yedek sağlayıcı. */
export function geminiTryOnProviderFromEnv(
  overrides: Partial<GeminiTryOnConfig> = {},
): GeminiTryOnProvider {
  const environment = env();
  return new GeminiTryOnProvider({
    apiKey: environment.GOOGLE_AI_API_KEY,
    model: environment.GOOGLE_AI_IMAGE_MODEL,
    ...overrides,
  });
}
