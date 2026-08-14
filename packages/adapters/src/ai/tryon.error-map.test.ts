import { describe, expect, it, vi } from 'vitest';
import { CircuitOpenError } from '../resilience/circuit-breaker.js';
import { TimeoutError } from '../resilience/resilient.js';
import { FalTryOnProvider } from './fal.js';
import { GeminiTryOnProvider } from './gemini.js';
import { AiHttpError } from './http.js';
import { classifyTryOnError, classifyTryOnSignal, isTryOnRetryable } from './tryon.error-map.js';
import { generateWithFallback, isPermanentFailure, type TryOnRequest } from './tryon.provider.js';

/**
 * SINIFLANDIRMA TESTLERİ
 *
 * Bu testler "kod çalışıyor mu"dan çok "para yanıyor mu"yu koruyor:
 * kalıcı/geçici ayrımı yanlışsa ya zincir boşuna kesilir ya da garanti
 * başarısız bir üretim her sağlayıcıda tekrar faturalanır.
 */

const request: TryOnRequest = {
  personImageUrl: 'https://signed.test/person',
  garmentImageUrl: 'https://signed.test/garment',
  category: 'UPPER_BODY',
  mode: 'FAST',
  idempotencyKey: 'idem-1',
};

// ── Test yardımcıları ──────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status });
}

/** Kalite eşiğinin üstünde kalmak için yeterince büyük sahte görsel. */
function imageResponse(bytes = 70_000): Response {
  return new Response(new Uint8Array(bytes).fill(7), {
    headers: { 'content-type': 'image/webp' },
  });
}

/**
 * Her çağrıda YENİ Response üretir. Response gövdesi bir kez okunabildiği için
 * yeniden denemeli testlerde tek nesneyi paylaşmak sahte hatalara yol açar.
 */
function falFetch(main: () => Response): { impl: typeof fetch; calls: () => number } {
  let count = 0;
  const impl = vi.fn((input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.startsWith('https://cdn.test/')) return Promise.resolve(imageResponse());
    count += 1;
    return Promise.resolve(main());
  });
  return { impl: impl as unknown as typeof fetch, calls: () => count };
}

function geminiFetch(main: () => Response): { impl: typeof fetch; calls: () => number } {
  let count = 0;
  const impl = vi.fn((input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    // Gemini gövdede base64 ister; imzalı URL'leri önce biz indiririz.
    if (url.startsWith('https://signed.test/')) return Promise.resolve(imageResponse(30_000));
    count += 1;
    return Promise.resolve(main());
  });
  return { impl: impl as unknown as typeof fetch, calls: () => count };
}

function falProvider(fetchImpl: typeof fetch): FalTryOnProvider {
  return new FalTryOnProvider({ apiKey: 'test-key', model: 'fal-ai/idm-vton', fetchImpl });
}

function geminiProvider(fetchImpl: typeof fetch): GeminiTryOnProvider {
  return new GeminiTryOnProvider({
    apiKey: 'test-key',
    model: 'gemini-2.5-flash-image',
    fetchImpl,
  });
}

const falSuccessBody = {
  image: { url: 'https://cdn.test/out.webp', content_type: 'image/webp' },
  has_nsfw_concepts: [false],
};

const geminiSuccessBody = {
  candidates: [
    {
      finishReason: 'STOP',
      content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aGVsbG8td29ybGQ=' } }] },
    },
  ],
  usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 1290 },
};

// ── Saf sınıflandırma ──────────────────────────────────────────────────────

describe('classifyTryOnSignal — HTTP durum kodları', () => {
  it('5xx GEÇİCİ kalır, gövdede "invalid" geçse bile', () => {
    // ⚠️ Kritik: "500 Internal error: invalid state" mesajı kullanıcının
    // fotoğrafı hakkında hiçbir şey söylemez. Kalıcı sayılırsa zincir kesilir
    // ve aslında çalışacak olan yedek sağlayıcı hiç denenmez.
    const result = classifyTryOnSignal({ status: 500, text: 'invalid image state internal' });
    expect(result.reason).toBe('PROVIDER_ERROR');
    expect(isPermanentFailure(result.reason)).toBe(false);
  });

  it('504 zaman aşımına eşlenir', () => {
    expect(classifyTryOnSignal({ status: 504 }).reason).toBe('TIMEOUT');
  });

  it('429 hız limitidir', () => {
    expect(classifyTryOnSignal({ status: 429, text: 'too many requests' }).reason).toBe(
      'RATE_LIMITED',
    );
  });

  it('429 + bakiye mesajı kota aşımıdır (beklemek çözmez)', () => {
    expect(classifyTryOnSignal({ status: 429, text: 'insufficient balance' }).reason).toBe(
      'QUOTA_EXCEEDED',
    );
  });

  it('402 kota aşımıdır', () => {
    expect(classifyTryOnSignal({ status: 402 }).reason).toBe('QUOTA_EXCEEDED');
  });

  it('⚠️ 401/403 BİZİM anahtar hatamızdır — zinciri KESMEZ', () => {
    // Yedek sağlayıcının anahtarı farklıdır; kalıcı sayarsak çalışan yolu
    // kendi yapılandırma hatamız yüzünden kapatırız.
    const unauthorized = classifyTryOnSignal({ status: 401, text: 'invalid api key' });
    const forbidden = classifyTryOnSignal({ status: 403, text: 'forbidden' });

    // PROVIDER_ERROR'dan AYRI kod: gerçek kesinti ile kendi yapılandırma
    // hatamız alarm panosunda aynı kutuya düşmemeli.
    expect(unauthorized.reason).toBe('MISCONFIGURED');
    expect(forbidden.reason).toBe('MISCONFIGURED');

    // ⚠️ Asıl güvence bu: ayrı kod verdik ama zinciri KESMEDİK. Kalıcı
    //    işaretlenseydi fal anahtarı bozukken gemini hiç denenmezdi.
    expect(isPermanentFailure(unauthorized.reason)).toBe(false);
    expect(isPermanentFailure(forbidden.reason)).toBe(false);
  });

  it('403 + içerik politikası mesajı KALICI içerik reddidir', () => {
    const result = classifyTryOnSignal({ status: 403, text: 'blocked by safety policy' });
    expect(result.reason).toBe('CONTENT_BLOCKED');
    expect(isPermanentFailure(result.reason)).toBe(true);
  });

  it('eşleşmeyen 4xx geçersiz girdi sayılır', () => {
    expect(classifyTryOnSignal({ status: 422, text: '' }).reason).toBe('INVALID_INPUT');
  });

  it('⚠️ BİLİNMEYEN yanıt GEÇİCİ varsayılır', () => {
    // Varsayılanı kalıcı yapmak, tanımadığımız tek bir sağlayıcı mesajı
    // yüzünden tüm zinciri kapatmak demektir.
    const result = classifyTryOnSignal({ text: 'something we have never seen' });
    expect(result.reason).toBe('PROVIDER_ERROR');
    expect(isPermanentFailure(result.reason)).toBe(false);
  });
});

describe('classifyTryOnSignal — gövde anahtar kelimeleri', () => {
  const cases: Array<[string, string]> = [
    ['NSFW content detected', 'CONTENT_BLOCKED'],
    ['request violates our content policy', 'CONTENT_BLOCKED'],
    ['flagged by moderation', 'CONTENT_BLOCKED'],
    ['no person detected in the image', 'NO_PERSON_DETECTED'],
    ['could not detect a person', 'NO_PERSON_DETECTED'],
    ['human parsing failed', 'NO_PERSON_DETECTED'],
    ['invalid image format', 'INVALID_INPUT'],
    ['failed to download the garment', 'INVALID_INPUT'],
    ['unsupported format: tiff', 'INVALID_INPUT'],
    ['quota exceeded for this project', 'QUOTA_EXCEEDED'],
  ];

  for (const [text, expected] of cases) {
    it(`"${text}" → ${expected}`, () => {
      expect(classifyTryOnSignal({ text }).reason).toBe(expected);
    });
  }

  it('"account blocked" içerik reddi DEĞİLDİR', () => {
    // Fatura/hesap sorunu kalıcı içerik reddiyle karıştırılırsa kullanıcıya
    // "fotoğrafınız işlenemedi" denir ve gerçek sorun (ödeme) görünmez olur.
    const result = classifyTryOnSignal({ text: 'your account is blocked, billing required' });
    expect(result.reason).toBe('QUOTA_EXCEEDED');
    expect(isPermanentFailure(result.reason)).toBe(false);
  });
});

describe('classifyTryOnError — fırlatılan hatalar', () => {
  it('zaman aşımı → TIMEOUT', () => {
    expect(classifyTryOnError(new TimeoutError('fal.generate', 25_000)).reason).toBe('TIMEOUT');
  });

  it('devre açık → PROVIDER_ERROR (anında yedeğe geç)', () => {
    const result = classifyTryOnError(new CircuitOpenError('fal', 30_000));
    expect(result.reason).toBe('PROVIDER_ERROR');
    expect(result.providerCode).toBe('CIRCUIT_OPEN');
  });

  it('ağ hatası → PROVIDER_ERROR', () => {
    const error = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    expect(classifyTryOnError(error).reason).toBe('PROVIDER_ERROR');
  });

  it('HTTP hatası gövdesiyle birlikte sınıflandırılır', () => {
    const error = new AiHttpError(422, 'fal', 'no person detected');
    expect(classifyTryOnError(error).reason).toBe('NO_PERSON_DETECTED');
  });
});

// ── Yeniden deneme politikası ──────────────────────────────────────────────

describe('isTryOnRetryable — para koruması', () => {
  it('⚠️ zaman aşımı TEKRAR DENENMEZ (üretim tamamlanmış olabilir)', () => {
    expect(isTryOnRetryable(new TimeoutError('fal.generate', 25_000))).toBe(false);
  });

  it('devre açıkken tekrar denenmez', () => {
    expect(isTryOnRetryable(new CircuitOpenError('fal', 1_000))).toBe(false);
  });

  it('429 ve 5xx tekrar denenir (istek işlenmeden reddedilmiştir)', () => {
    expect(isTryOnRetryable(new AiHttpError(429, 'fal', ''))).toBe(true);
    expect(isTryOnRetryable(new AiHttpError(503, 'fal', ''))).toBe(true);
  });

  it('4xx tekrar denenmez — aynı istek aynı sonucu verir', () => {
    expect(isTryOnRetryable(new AiHttpError(422, 'fal', ''))).toBe(false);
    expect(isTryOnRetryable(new AiHttpError(403, 'fal', ''))).toBe(false);
  });
});

// ── fal sağlayıcısı: yanıt → sonuç ─────────────────────────────────────────

describe('FalTryOnProvider — sağlayıcı yanıtı hangi sebebe düşüyor', () => {
  it('başarılı üretim SUCCEEDED döner ve maliyet kaydeder', async () => {
    const { impl } = falFetch(() => jsonResponse(falSuccessBody));
    const result = await falProvider(impl).generate(request);

    expect(result.status).toBe('SUCCEEDED');
    if (result.status !== 'SUCCEEDED') return;
    expect(result.image.byteLength).toBe(70_000);
    expect(result.costMicroUsd).toBeGreaterThan(0n);
    // Sağlayıcı para bildirmedi → tahmin olduğu alan adıyla belli.
    expect(result.costBasis).toBe('MODEL_ESTIMATE');
    expect(result.estimatedCostMicroUsd).toBe(result.costMicroUsd);
    expect(result.reportedCostMicroUsd).toBeUndefined();
  });

  it('sağlayıcı maliyeti bildirirse TAHMİN yerine o kullanılır', async () => {
    const { impl } = falFetch(() => jsonResponse({ ...falSuccessBody, cost_usd: 0.05 }));
    const result = await falProvider(impl).generate(request);

    expect(result.costMicroUsd).toBe(50_000n);
    expect(result.costBasis).toBe('PROVIDER_REPORTED');
    expect(result.reportedCostMicroUsd).toBe(50_000n);
  });

  it('⚠️ NSFW bayrağı KALICI içerik reddidir ve maliyet YİNE kaydedilir', async () => {
    const { impl } = falFetch(() =>
      jsonResponse({ image: { url: 'https://cdn.test/out.webp' }, has_nsfw_concepts: [true] }),
    );
    const result = await falProvider(impl).generate(request);

    expect(result.status).toBe('FAILED');
    if (result.status !== 'FAILED') return;
    expect(result.reason).toBe('CONTENT_BLOCKED');
    expect(isPermanentFailure(result.reason)).toBe(true);
    // Üretim çalıştı ve faturalandı; 0 yazmak defteri eksik tutardı.
    expect(result.costMicroUsd).toBeGreaterThan(0n);
  });

  it('422 doğrulama hatası → INVALID_INPUT (kalıcı)', async () => {
    const { impl } = falFetch(() =>
      textResponse(JSON.stringify({ detail: 'invalid image url' }), 422),
    );
    const result = await falProvider(impl).generate(request);

    expect(result.status).toBe('FAILED');
    if (result.status !== 'FAILED') return;
    expect(result.reason).toBe('INVALID_INPUT');
    expect(isPermanentFailure(result.reason)).toBe(true);
  });

  it('200 ama görsel yok + "kişi bulunamadı" → NO_PERSON_DETECTED (kalıcı)', async () => {
    const { impl } = falFetch(() => jsonResponse({ error: 'no person detected in human image' }));
    const result = await falProvider(impl).generate(request);

    expect(result.status).toBe('FAILED');
    if (result.status !== 'FAILED') return;
    expect(result.reason).toBe('NO_PERSON_DETECTED');
    expect(isPermanentFailure(result.reason)).toBe(true);
  });

  it('200 ama tanınmayan gövde → PROVIDER_ERROR (geçici, zincir devam eder)', async () => {
    const { impl } = falFetch(() => jsonResponse({ status: 'weird' }));
    const result = await falProvider(impl).generate(request);

    expect(result.status).toBe('FAILED');
    if (result.status !== 'FAILED') return;
    expect(result.reason).toBe('PROVIDER_ERROR');
    expect(isPermanentFailure(result.reason)).toBe(false);
  });

  it('401 → PROVIDER_ERROR: yapılandırma hatamız zinciri kesmez', async () => {
    const { impl } = falFetch(() => textResponse('{"detail":"Unauthorized"}', 401));
    const result = await falProvider(impl).generate(request);

    expect(result.status).toBe('FAILED');
    if (result.status !== 'FAILED') return;
    expect(isPermanentFailure(result.reason)).toBe(false);
  });

  it('5xx yeniden denenir, tükenince GEÇİCİ hata döner', async () => {
    const { impl, calls } = falFetch(() => textResponse('upstream exploded', 503));
    const result = await falProvider(impl).generate(request);

    expect(calls()).toBe(2); // 1 deneme + 1 yeniden deneme
    expect(result.status).toBe('FAILED');
    if (result.status !== 'FAILED') return;
    expect(result.reason).toBe('PROVIDER_ERROR');
  });

  it('4xx yeniden DENENMEZ — aynı istek aynı sonucu verir, kota yakar', async () => {
    const { impl, calls } = falFetch(() => textResponse('{"detail":"invalid image"}', 400));
    await falProvider(impl).generate(request);
    expect(calls()).toBe(1);
  });

  it('zaman aşımında maliyet TAHMİN EDİLİR, sıfır yazılmaz', async () => {
    // Sağlayıcı tarafında üretim tamamlanmış ve faturalanmış olabilir.
    const impl = vi.fn(() =>
      Promise.reject(new TimeoutError('fal.generate', 25_000)),
    ) as unknown as typeof fetch;

    const result = await falProvider(impl).generate(request);

    expect(result.status).toBe('FAILED');
    if (result.status !== 'FAILED') return;
    expect(result.reason).toBe('TIMEOUT');
    expect(result.costMicroUsd).toBeGreaterThan(0n);
    expect(result.estimatedCostMicroUsd).toBeGreaterThan(0n);
  });

  it('ağ hatasında maliyet SIFIRDIR — istek üretime hiç ulaşmadı', async () => {
    const impl = vi.fn(() =>
      Promise.reject(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })),
    ) as unknown as typeof fetch;

    const result = await falProvider(impl).generate(request);

    expect(result.status).toBe('FAILED');
    if (result.status !== 'FAILED') return;
    expect(result.costMicroUsd).toBe(0n);
  });

  it('generate ASLA fırlatmaz — fırlatırsa fallback zinciri kaybolur', async () => {
    const impl = vi.fn(() => Promise.reject(new Error('beklenmedik'))) as unknown as typeof fetch;
    await expect(falProvider(impl).generate(request)).resolves.toMatchObject({ status: 'FAILED' });
  });
});

// ── Gemini sağlayıcısı ─────────────────────────────────────────────────────

describe('GeminiTryOnProvider — sağlayıcı yanıtı hangi sebebe düşüyor', () => {
  it('başarılı üretimde maliyet token KULLANIMINDAN hesaplanır', async () => {
    const { impl } = geminiFetch(() => jsonResponse(geminiSuccessBody));
    const result = await geminiProvider(impl).generate(request);

    expect(result.status).toBe('SUCCEEDED');
    if (result.status !== 'SUCCEEDED') return;
    // 1200 giriş × 300 nano + 1290 çıkış × 30.000 nano = 39.060.000 nano → 39.060 mikro
    expect(result.costMicroUsd).toBe(39_060n);
    expect(result.costBasis).toBe('PROVIDER_USAGE');
  });

  it('promptFeedback.blockReason → CONTENT_BLOCKED (kalıcı)', async () => {
    const { impl } = geminiFetch(() => jsonResponse({ promptFeedback: { blockReason: 'SAFETY' } }));
    const result = await geminiProvider(impl).generate(request);

    expect(result.status).toBe('FAILED');
    if (result.status !== 'FAILED') return;
    expect(result.reason).toBe('CONTENT_BLOCKED');
    expect(result.providerCode).toBe('SAFETY');
    expect(isPermanentFailure(result.reason)).toBe(true);
  });

  it('finishReason IMAGE_SAFETY → CONTENT_BLOCKED (kalıcı)', async () => {
    const { impl } = geminiFetch(() =>
      jsonResponse({ candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }] }),
    );
    const result = await geminiProvider(impl).generate(request);

    expect(result.status).toBe('FAILED');
    if (result.status !== 'FAILED') return;
    expect(result.reason).toBe('CONTENT_BLOCKED');
  });

  it('⚠️ model işareti yazarsa NO_PERSON_DETECTED (kalıcı) — deterministik', async () => {
    const { impl } = geminiFetch(() =>
      jsonResponse({
        candidates: [
          { finishReason: 'STOP', content: { parts: [{ text: 'NO_PERSON_DETECTED' }] } },
        ],
      }),
    );
    const result = await geminiProvider(impl).generate(request);

    expect(result.status).toBe('FAILED');
    if (result.status !== 'FAILED') return;
    expect(result.reason).toBe('NO_PERSON_DETECTED');
    expect(isPermanentFailure(result.reason)).toBe(true);
  });

  it('⚠️ görsel yerine SERBEST metin → GEÇİCİ, kalıcı DEĞİL', async () => {
    // Model bazen sadece gevezelik eder. Bunu kalıcı saymak, çalışacak bir
    // yeniden denemeyi kullanıcıya "olmaz" diye kapatmaktır.
    const { impl } = geminiFetch(() =>
      jsonResponse({
        candidates: [
          { finishReason: 'STOP', content: { parts: [{ text: 'Elbette, yardımcı olayım.' }] } },
        ],
      }),
    );
    const result = await geminiProvider(impl).generate(request);

    expect(result.status).toBe('FAILED');
    if (result.status !== 'FAILED') return;
    expect(result.reason).toBe('PROVIDER_ERROR');
    expect(isPermanentFailure(result.reason)).toBe(false);
  });

  it('metin "kişi yok" diyorsa işaret olmasa da yakalanır', async () => {
    const { impl } = geminiFetch(() =>
      jsonResponse({
        candidates: [
          {
            finishReason: 'STOP',
            content: { parts: [{ text: 'I could not detect a person in this photo.' }] },
          },
        ],
      }),
    );
    const result = await geminiProvider(impl).generate(request);

    expect(result.status).toBe('FAILED');
    if (result.status !== 'FAILED') return;
    expect(result.reason).toBe('NO_PERSON_DETECTED');
  });

  it('429 → RATE_LIMITED (geçici)', async () => {
    const { impl } = geminiFetch(() =>
      textResponse('{"error":{"message":"Resource has been exhausted"}}', 429),
    );
    const result = await geminiProvider(impl).generate(request);

    expect(result.status).toBe('FAILED');
    if (result.status !== 'FAILED') return;
    expect(result.reason).toBe('RATE_LIMITED');
    expect(isPermanentFailure(result.reason)).toBe(false);
  });

  it('403 anahtar hatası kalıcı sayılmaz', async () => {
    const { impl } = geminiFetch(() =>
      textResponse('{"error":{"status":"PERMISSION_DENIED"}}', 403),
    );
    const result = await geminiProvider(impl).generate(request);

    expect(result.status).toBe('FAILED');
    if (result.status !== 'FAILED') return;
    expect(isPermanentFailure(result.reason)).toBe(false);
  });
});

// ── Zincir davranışı (gerçek adapter'larla uçtan uca) ──────────────────────

describe("fallback zinciri gerçek adapter'larla", () => {
  it('fal KALICI hata verirse gemini HİÇ çağrılmaz', async () => {
    const fal = falFetch(() => textResponse('{"detail":"no person detected"}', 422));
    const gemini = geminiFetch(() => jsonResponse(geminiSuccessBody));

    const chain = await generateWithFallback(
      [falProvider(fal.impl), geminiProvider(gemini.impl)],
      request,
    );

    expect(chain.result.status).toBe('FAILED');
    expect(gemini.calls()).toBe(0); // ⚠️ boşuna para yakılmadı
    expect(chain.attempted.map((attempt) => attempt.provider)).toEqual(['fal']);
  });

  it('fal GEÇİCİ hata verirse gemini denenir ve maliyetler toplanır', async () => {
    const fal = falFetch(() => textResponse('{"detail":"Unauthorized"}', 401));
    const gemini = geminiFetch(() => jsonResponse(geminiSuccessBody));

    const chain = await generateWithFallback(
      [falProvider(fal.impl), geminiProvider(gemini.impl)],
      request,
    );

    expect(chain.result.status).toBe('SUCCEEDED');
    expect(gemini.calls()).toBe(1);
    expect(chain.attempted.map((attempt) => attempt.provider)).toEqual(['fal', 'gemini']);
    expect(chain.totalCostMicroUsd).toBe(39_060n);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  SAĞLAYICI GÖVDESİ — ZORUNLU ALANLAR GERÇEKTEN GÖNDERİLİYOR MU?
 *
 *  ⚠️ BU TESTLER CANLI BİR ARIZADAN DOĞDU (2026-08-14). Sanal deneme
 *     üretimde HER SEFERİNDE `TRYON_PROVIDER_ERROR` ile düşüyordu. Gövde
 *     gerçek uca elle atıldı:
 *
 *         POST https://fal.run/fal-ai/idm-vton   →  HTTP 422
 *         {"detail":[{"loc":["body","description"],
 *                     "msg":"Field required","type":"missing"}]}
 *
 *     `description` şemada ZORUNLU ve hiç gönderilmiyordu.
 *
 *  ⚠️ VAR OLAN TESTLER BUNU GÖREMEZDİ VE GÖREMEZ: `fetch` sahtelenir, sahte
 *     uç gövdeyi DOĞRULAMAZ. Sağlayıcı şemasını yalnızca gerçek uç bilir.
 *     Bu testler o boşluğu kapatmıyor — kapatamaz — ama BİLDİĞİMİZ zorunlu
 *     alanların düşmesini yakalıyor. Gerçek şema doğrulaması ancak canlı uca
 *     atılan bir istekle yapılır ve o bu turda elle yapıldı (HTTP 200 döndü).
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe('fal gövdesi — zorunlu alanlar', () => {
  async function govdeyiYakala(category: 'UPPER_BODY' | 'LOWER_BODY' | 'DRESS' | 'OUTERWEAR') {
    let govde: Record<string, unknown> | null = null;

    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      govde = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({ image: { url: 'https://ornek/sonuc.png', content_type: 'image/png' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    await falProvider(fetchImpl)
      .generate({
        personImageUrl: 'https://ornek/insan.jpg',
        garmentImageUrl: 'https://ornek/giysi.jpg',
        category,
        mode: 'FAST',
        idempotencyKey: 'anahtar-1',
      })
      .catch(() => undefined);

    return govde;
  }

  it('⚠️ `description` GÖNDERİLİR — yokluğu üretimde 422 üretiyordu', async () => {
    const govde = await govdeyiYakala('UPPER_BODY');
    // Mutasyon: `description` satırı silinince bu kırılır.
    expect(govde?.['description']).toBe('a garment worn on the upper body');
  });

  it('her kategori kendi açıklamasını gönderir — hiçbiri boş değil', async () => {
    for (const kategori of ['UPPER_BODY', 'LOWER_BODY', 'DRESS', 'OUTERWEAR'] as const) {
      const govde = await govdeyiYakala(kategori);
      expect(typeof govde?.['description']).toBe('string');
      expect(String(govde?.['description']).length).toBeGreaterThan(10);
    }
  });

  it('gerçek uca giden gövde şeması: dört zorunlu alan', async () => {
    const govde = await govdeyiYakala('DRESS');
    // ⚠️ Bu dört ad `fal.run/fal-ai/idm-vton` şemasından; adları değiştirmek
    //    sessizce 422 üretir ve ekranda yalnızca genel bir hata görünür.
    expect(Object.keys(govde ?? {}).sort()).toEqual([
      'category',
      'description',
      'garment_image_url',
      'human_image_url',
      'num_inference_steps',
    ]);
  });
});
