import { CircuitOpenError } from '../resilience/circuit-breaker.js';
import { TimeoutError } from '../resilience/resilient.js';
import { AiBodyError, AiHttpError } from './http.js';
import { isPermanentFailure, type TryOnFailureReason } from './tryon.provider.js';

/**
 * SAĞLAYICI YANITI → TryOnFailureReason
 *
 * ⚠️ BU DOSYA PARA HARCATIR. Sınıflandırma fallback zincirinin davranışını
 * belirler:
 *   - KALICI (INVALID_INPUT / CONTENT_BLOCKED / NO_PERSON_DETECTED) → zincir KESİLİR
 *   - GEÇİCİ (PROVIDER_ERROR / TIMEOUT / RATE_LIMITED / QUOTA_EXCEEDED) → sıradaki sağlayıcı denenir
 *
 * İki yanlış yönün maliyeti simetrik DEĞİL:
 *
 *  a) Geçici hatayı KALICI sanmak → zincir gereksiz kesilir. Aslında çalışacak
 *     bir deneme kullanıcıya "olmadı" der; kota iade edilir, para yanmaz ama
 *     kullanıcıya fotoğrafının engellendiği gibi YANLIŞ bir şey söylenir.
 *
 *  b) Kalıcı hatayı GEÇİCİ sanmak → aynı fotoğraf her sağlayıcıda tekrar
 *     denenir. Sonuç garantili başarısızdır ama her deneme faturalanır.
 *
 * Karar: KALICI yalnızca POZİTİF KANIT ile verilir; bilinmeyen her şey
 * GEÇİCİ'dir. Gerekçe: (b)'nin maliyeti zincir uzunluğuyla SINIRLIDIR
 * (2-3 sağlayıcı, ~0,12 $), (a)'nın maliyeti sınırsızdır — kusursuz
 * fotoğrafı olan kullanıcı ürünü hiçbir zaman deneyemez ve bunu bizim
 * hatamız olarak değil kendi fotoğrafının kusuru olarak öğrenir.
 */

export interface TryOnClassification {
  reason: TryOnFailureReason;
  /** Sağlayıcının ham kodu — loglanır, kullanıcıya GÖSTERİLMEZ. */
  providerCode?: string;
  /** Hangi kural eşleşti. Yanlış sınıflandırma ayıklamanın tek yolu budur. */
  rule: string;
}

/**
 * İçerik güvenlik filtresi kanıtı.
 * ⚠️ Yalnız başına "blocked" YOK: "account blocked" bir fatura sorunudur,
 * içerik reddi değil; onu CONTENT_BLOCKED sayarsak zinciri boşuna keseriz.
 */
const CONTENT_BLOCKED_PATTERNS = [
  'nsfw',
  'content policy',
  'content_policy',
  'content filter',
  'safety filter',
  'safety_filter',
  'blocked by safety',
  'content blocked',
  'image_safety',
  'prohibited_content',
  'prohibited content',
  'moderation',
  'sexually explicit',
  'sensitive content',
  'inappropriate content',
] as const;

/** "Fotoğrafta kişi yok" kanıtı. Üçüncü denemede de kişi bulunmayacaktır. */
const NO_PERSON_PATTERNS = [
  'no person',
  'no human',
  'no_person',
  'person not detected',
  'person could not be detected',
  'could not detect a person',
  'unable to detect a person',
  'detect any person',
  'no body detected',
  'human not detected',
  'no full body',
  'no full-body',
  'pose estimation failed',
  'human parsing failed',
] as const;

/** Girdi geçersiz — aynı istek her sağlayıcıda aynı sonucu verir. */
const INVALID_INPUT_PATTERNS = [
  'invalid image',
  'invalid_image',
  'unsupported image',
  'unsupported format',
  'unsupported mime',
  'invalid url',
  'invalid_url',
  'failed to download',
  'could not download',
  'unable to fetch image',
  'image too large',
  'corrupted image',
  'decode error',
  'invalid_argument',
  'validation error',
  'unprocessable',
] as const;

/** Bakiye/kota bitti — hız limitinden farklı, beklemek çözmez. */
const QUOTA_PATTERNS = [
  'quota exceeded',
  'exceeded your quota',
  'insufficient balance',
  'exhausted balance',
  'insufficient credit',
  'out of credits',
  'payment required',
  'billing',
] as const;

function matches(haystack: string, patterns: readonly string[]): string | undefined {
  return patterns.find((pattern) => haystack.includes(pattern));
}

export interface TryOnSignal {
  /** HTTP durum kodu. 200 yanıt gövdesinden sınıflandırma yapılıyorsa verilmez. */
  status?: number;
  /** Yanıt gövdesi / hata mesajı. */
  text?: string;
  /** Sağlayıcının yapısal hata kodu (varsa). */
  providerCode?: string;
}

/**
 * Tek sınıflandırma noktası. Kural SIRASI davranışın kendisidir:
 *
 * 1) 5xx  : sunucu tarafı, tanımı gereği geçici. Gövdede "invalid" geçse bile
 *           kalıcıya çevirmeyiz — "500 Internal error: invalid state" mesajı
 *           kullanıcının fotoğrafı hakkında hiçbir şey söylemez.
 * 2) 429  : hız limiti. Gövde bakiye bitişine işaret ediyorsa QUOTA_EXCEEDED.
 * 3) 402  : ödeme gerekli → QUOTA_EXCEEDED.
 * 4) 401/403 : anahtarımız/izinlerimiz — KULLANICININ hatası değil. Yedek
 *           sağlayıcının anahtarı farklıdır, o yüzden GEÇİCİ sayılır ve zincir
 *           devam eder. (Ama gövde içerik reddi diyorsa o kazanır.)
 * 5) gövde anahtar kelimeleri: içerik → kişi yok → geçersiz girdi
 * 6) diğer 4xx : geçersiz girdi
 * 7) hiçbiri : PROVIDER_ERROR (geçici) — varsayılan güvenli taraftır.
 */
export function classifyTryOnSignal(signal: TryOnSignal): TryOnClassification {
  const status = signal.status;
  const haystack = `${signal.text ?? ''} ${signal.providerCode ?? ''}`.toLowerCase();
  const code = signal.providerCode;

  if (status !== undefined && status >= 500) {
    // 504/524: ağ geçidi zaman aşımı. TIMEOUT ile PROVIDER_ERROR'ın ikisi de
    // geçici; ayırmak yalnızca alarm panosunda doğru kutuya düşsün diyedir.
    const reason: TryOnFailureReason =
      status === 504 || status === 524 ? 'TIMEOUT' : 'PROVIDER_ERROR';
    return { reason, ...(code ? { providerCode: code } : {}), rule: `http-${status}` };
  }

  if (status === 429) {
    const quotaHit = matches(haystack, QUOTA_PATTERNS);
    return quotaHit
      ? {
          reason: 'QUOTA_EXCEEDED',
          ...(code ? { providerCode: code } : {}),
          rule: `http-429:${quotaHit}`,
        }
      : { reason: 'RATE_LIMITED', ...(code ? { providerCode: code } : {}), rule: 'http-429' };
  }

  if (status === 402) {
    return { reason: 'QUOTA_EXCEEDED', ...(code ? { providerCode: code } : {}), rule: 'http-402' };
  }

  if (status === 408) {
    return { reason: 'TIMEOUT', ...(code ? { providerCode: code } : {}), rule: 'http-408' };
  }

  const blocked = matches(haystack, CONTENT_BLOCKED_PATTERNS);
  if (blocked) {
    return {
      reason: 'CONTENT_BLOCKED',
      ...(code ? { providerCode: code } : {}),
      rule: `content:${blocked}`,
    };
  }

  if (status === 401 || status === 403) {
    // ⚠️ Yapılandırma hatası. Kalıcı gibi görünür ama BİZİM tarafımızdadır;
    // kullanıcının fotoğrafıyla ilgisi yoktur, o yüzden zinciri kesmeyiz.
    return {
      reason: 'PROVIDER_ERROR',
      ...(code ? { providerCode: code } : {}),
      rule: `http-${status}-auth`,
    };
  }

  const noPerson = matches(haystack, NO_PERSON_PATTERNS);
  if (noPerson) {
    return {
      reason: 'NO_PERSON_DETECTED',
      ...(code ? { providerCode: code } : {}),
      rule: `no-person:${noPerson}`,
    };
  }

  const invalid = matches(haystack, INVALID_INPUT_PATTERNS);
  if (invalid) {
    return {
      reason: 'INVALID_INPUT',
      ...(code ? { providerCode: code } : {}),
      rule: `invalid:${invalid}`,
    };
  }

  const quota = matches(haystack, QUOTA_PATTERNS);
  if (quota) {
    return {
      reason: 'QUOTA_EXCEEDED',
      ...(code ? { providerCode: code } : {}),
      rule: `quota:${quota}`,
    };
  }

  if (status !== undefined && status >= 400 && status < 500) {
    return {
      reason: 'INVALID_INPUT',
      ...(code ? { providerCode: code } : {}),
      rule: `http-${status}`,
    };
  }

  // ⚠️ VARSAYILAN GEÇİCİ. Bilinmeyeni kalıcı ilan etmek, tanımadığımız bir
  // sağlayıcı mesajı yüzünden çalışan bir yolu kapatmaktır.
  return {
    reason: 'PROVIDER_ERROR',
    ...(code ? { providerCode: code } : {}),
    rule: 'default-transient',
  };
}

/** Fırlatılan hatayı sınıflandırır (taşıma katmanı + devre kesici dahil). */
export function classifyTryOnError(error: unknown): TryOnClassification {
  if (error instanceof TimeoutError) {
    return { reason: 'TIMEOUT', rule: 'timeout' };
  }

  if (error instanceof CircuitOpenError) {
    // Devre açık: sağlayıcı zaten çökük. Anında yedek sağlayıcıya geçilsin.
    return { reason: 'PROVIDER_ERROR', providerCode: 'CIRCUIT_OPEN', rule: 'circuit-open' };
  }

  if (error instanceof AiHttpError) {
    return classifyTryOnSignal({
      status: error.status,
      text: error.bodyPreview,
      ...(error.providerCode ? { providerCode: error.providerCode } : {}),
    });
  }

  if (error instanceof AiBodyError) {
    return classifyTryOnSignal({ text: error.bodyPreview });
  }

  const networkCode = (error as { code?: unknown } | null)?.code;
  if (typeof networkCode === 'string') {
    return { reason: 'PROVIDER_ERROR', providerCode: networkCode, rule: 'network' };
  }

  return { reason: 'PROVIDER_ERROR', rule: 'unknown-throw' };
}

/**
 * Sanal denemede hangi hatalar TEKRAR DENENİR.
 *
 * ⚠️ `defaultIsRetryable`ten bilerek ayrılıyoruz: ZAMAN AŞIMI TEKRAR DENENMEZ.
 * İki nedenle:
 *  1. Para: 25 sn'de yanıt vermeyen çağrı sağlayıcı tarafında TAMAMLANMIŞ ve
 *     faturalanmış olabilir. Tekrar denemek ikinci bir üretim ücretidir ve
 *     fal/gemini idempotency garantisi VERMİYOR.
 *  2. Zaman: FAST modun tüm bütçesi 25 sn. İkinci deneme kullanıcıyı 50 sn
 *     bekletir; o süre içinde zaten sepete gidip ürünü almış olurdu.
 * Zaman aşımı yerine sıradaki sağlayıcıya geçmek hem daha ucuz hem daha hızlı.
 */
export function isTryOnRetryable(error: unknown): boolean {
  if (error instanceof TimeoutError) return false;
  if (error instanceof CircuitOpenError) return false;

  if (error instanceof AiHttpError) {
    // 429 ve 5xx: henüz üretim yapılmadan reddedilmiş olma ihtimali yüksek.
    return error.status === 429 || (error.status >= 500 && error.status < 600);
  }

  // Ağ hatası: istek karşıya hiç ulaşmamış olabilir, ucuz bir tekrar denemeye değer.
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string';
}

/** Kalıcı mı? `tryon.provider.ts`teki tek doğruluk kaynağına delege eder. */
export function isPermanentClassification(classification: TryOnClassification): boolean {
  return isPermanentFailure(classification.reason);
}

// ── Gemini'ye özgü yapısal sinyaller ──────────────────────────────────────

/**
 * Gemini metin yerine YAPISAL bir sonlanma sebebi döndürür. Metin eşlemeye
 * güvenmek yerine bunu okumak sınıflandırmayı deterministik yapar.
 */
export function classifyGeminiFinishReason(value: unknown): TryOnClassification | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  const normalized = value.toUpperCase();

  switch (normalized) {
    case 'SAFETY':
    case 'IMAGE_SAFETY':
    case 'PROHIBITED_CONTENT':
    case 'BLOCKLIST':
    case 'SPII':
    case 'RECITATION':
      return {
        reason: 'CONTENT_BLOCKED',
        providerCode: normalized,
        rule: `gemini-finish:${normalized}`,
      };
    case 'MAX_TOKENS':
    case 'OTHER':
    case 'MALFORMED_FUNCTION_CALL':
      // Model çıktıyı tamamlayamadı — girdiyle ilgili değil, tekrar denenebilir.
      return {
        reason: 'PROVIDER_ERROR',
        providerCode: normalized,
        rule: `gemini-finish:${normalized}`,
      };
    case 'STOP':
      return undefined;
    default:
      return undefined;
  }
}

/** `promptFeedback.blockReason` doluysa istek modele HİÇ gitmemiştir. */
export function classifyGeminiBlockReason(value: unknown): TryOnClassification | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  const normalized = value.toUpperCase();
  if (normalized === 'BLOCK_REASON_UNSPECIFIED') return undefined;
  return {
    reason: 'CONTENT_BLOCKED',
    providerCode: normalized,
    rule: `gemini-block:${normalized}`,
  };
}

/**
 * Modelden görsel yerine METİN geldiğinde çalışır.
 *
 * Gemini "bu fotoğrafta kişi göremiyorum" gibi bir cümle yazar. Anahtar kelime
 * avına güvenmemek için prompt'ta modelden tam olarak `NO_PERSON_DETECTED`
 * işaretini yazması istenir; işaret varsa sınıflandırma deterministiktir,
 * yoksa anahtar kelimelere düşeriz.
 */
export const GEMINI_NO_PERSON_SENTINEL = 'NO_PERSON_DETECTED';

export function classifyGeminiTextResponse(text: string): TryOnClassification {
  if (text.toUpperCase().includes(GEMINI_NO_PERSON_SENTINEL)) {
    return { reason: 'NO_PERSON_DETECTED', rule: 'gemini-sentinel' };
  }
  const fallback = classifyTryOnSignal({ text });
  return fallback.rule === 'default-transient'
    ? { reason: 'PROVIDER_ERROR', rule: 'gemini-text-no-image' }
    : fallback;
}

// TODO(kod-gerekli): TRYON_PROVIDER_MISCONFIGURED (503, integration) — şu an
// 401/403 (bizim anahtar/izin hatamız) PROVIDER_ERROR olarak raporlanıyor ve
// gerçek sağlayıcı kesintisinden ayırt edilemiyor. Kod eklendiğinde buradaki
// `http-401-auth` / `http-403-auth` kuralları ve alarm eşiği güncellenmeli.
