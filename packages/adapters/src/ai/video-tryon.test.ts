import { checkBudget, loadEnv, usdToMicro, type AiBudget } from '@vt/config';
import { AppError } from '@vt/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  checkVideoBudget,
  clampVideoDuration,
  createVideoTryOnProvider,
  FalVideoTryOnProvider,
  isVideoTryOnConfigured,
  UnconfiguredVideoTryOnProvider,
  UnimplementedVideoWatermarker,
  videoBudgetFromEnv,
  videoTryOnEstimate,
  videoVisualConfidence,
  VIDEO_TRYON,
  type VideoTryOnEnv,
  type VideoTryOnRequest,
} from './video-tryon.js';

/**
 * ⚠️ Bu testlerin ASIL İŞİ özelliğin KAPALI KALDIĞINI kanıtlamaktır.
 * Video üretimi istek başına ~0,50 $; "yanlışlıkla açık" bir bayrak, bir
 * gecede günlük AI bütçesinin tamamını yakabilir.
 */

// Sahte anahtar — gitleaks kalıplarına takılmayacak biçimde.
const FAKE_FAL_KEY = 'PLACEHOLDER-NOT-A-SECRET-01';

const enabledEnv: VideoTryOnEnv = {
  AI_VIDEO_TRYON_ENABLED: true,
  FAL_KEY: FAKE_FAL_KEY,
  GOOGLE_AI_API_KEY: '',
  FAL_VIDEO_TRYON_MODEL: 'fal-ai/test-video-tryon',
};

const request: VideoTryOnRequest = {
  personImageUrl: 'https://signed/person',
  garmentImageUrl: 'https://signed/garment',
  category: 'UPPER_BODY',
  durationSeconds: 5,
  idempotencyKey: 'video-k1',
};

// ── Fabrika: kapalıyken Unconfigured döner mi ──────────────────────────────

describe('fabrika seçimi — özellik KAPALI gelir', () => {
  it('bayrak kapalıyken, anahtar ve model dolu olsa bile Unconfigured döner', () => {
    const provider = createVideoTryOnProvider({ ...enabledEnv, AI_VIDEO_TRYON_ENABLED: false });

    expect(provider).toBeInstanceOf(UnconfiguredVideoTryOnProvider);
    expect((provider as UnconfiguredVideoTryOnProvider).reason).toBe('FLAG_OFF');
  });

  it('bayrak açık ama FAL_KEY yoksa Unconfigured döner', () => {
    const provider = createVideoTryOnProvider({ ...enabledEnv, FAL_KEY: '' });

    expect(provider).toBeInstanceOf(UnconfiguredVideoTryOnProvider);
    expect((provider as UnconfiguredVideoTryOnProvider).reason).toBe('MISSING_KEY');
  });

  it('bayrak açık, anahtar var ama model slug yoksa Unconfigured döner', () => {
    const provider = createVideoTryOnProvider({ ...enabledEnv, FAL_VIDEO_TRYON_MODEL: '' });

    expect(provider).toBeInstanceOf(UnconfiguredVideoTryOnProvider);
    expect((provider as UnconfiguredVideoTryOnProvider).reason).toBe('MISSING_MODEL');
  });

  it('üçü birden sağlanınca gerçek sağlayıcı kurulur', () => {
    expect(createVideoTryOnProvider(enabledEnv)).toBeInstanceOf(FalVideoTryOnProvider);
  });

  it('yapılandırma raporu ile fabrika AYNI koşulu kullanır', () => {
    expect(isVideoTryOnConfigured(enabledEnv)).toBe(true);
    expect(isVideoTryOnConfigured({ ...enabledEnv, AI_VIDEO_TRYON_ENABLED: false })).toBe(false);
    expect(isVideoTryOnConfigured({ ...enabledEnv, FAL_VIDEO_TRYON_MODEL: '' })).toBe(false);
  });

  it('Unconfigured FIRLATIR — "başarısız sonuç" döndürmez (kota harcanmış sanılmasın)', async () => {
    const provider = new UnconfiguredVideoTryOnProvider('FLAG_OFF');

    await expect(provider.generate()).rejects.toBeInstanceOf(AppError);
    await expect(provider.generate()).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('kapalı olma sebebi mesajda ayırt edilir', async () => {
    await expect(new UnconfiguredVideoTryOnProvider('FLAG_OFF').generate()).rejects.toThrow(
      /AI_VIDEO_TRYON_ENABLED/,
    );
    await expect(new UnconfiguredVideoTryOnProvider('MISSING_MODEL').generate()).rejects.toThrow(
      /FAL_VIDEO_TRYON_MODEL/,
    );
  });

  it('Unconfigured kategorileri BOŞ bırakmaz — sessizce atlanmamalı', () => {
    expect(new UnconfiguredVideoTryOnProvider('FLAG_OFF').supportedCategories).toContain(
      'UPPER_BODY',
    );
  });
});

describe('env şeması — varsayılan KAPALI', () => {
  const base = {
    NODE_ENV: 'development',
    APP_URL: 'http://localhost:3000',
    API_URL: 'http://localhost:3001',
    CORS_ORIGINS: 'http://localhost:3000',
    DATABASE_URL: 'postgresql://vt:vt@localhost:5432/virtual_textile',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'a'.repeat(128),
    JWT_REFRESH_SECRET: 'b'.repeat(128),
    FIELD_ENCRYPTION_KEY: 'c'.repeat(64),
    INTERNAL_API_TOKEN: 'PLACEHOLDER-NOT-A-SECRET-02',
  } satisfies NodeJS.ProcessEnv;

  it('hiçbir şey ayarlanmadığında video kapalıdır ve bütçesi düşüktür', () => {
    const env = loadEnv(base);

    expect(env.AI_VIDEO_TRYON_ENABLED).toBe(false);
    expect(env.FAL_VIDEO_TRYON_MODEL).toBe('');
    expect(env.AI_VIDEO_DAILY_BUDGET_USD).toBeLessThan(env.AI_DAILY_BUDGET_USD);
  });

  /**
   * ⚠️ Regresyon kilidi: `z.coerce.boolean()` kullanılsaydı `'false'` metni
   *    TRUE'ya dönüşür ve özellik tam tersine AÇILIRDI.
   */
  it("AI_VIDEO_TRYON_ENABLED='false' metni özelliği AÇMAZ", () => {
    expect(loadEnv({ ...base, AI_VIDEO_TRYON_ENABLED: 'false' }).AI_VIDEO_TRYON_ENABLED).toBe(
      false,
    );
    expect(loadEnv({ ...base, AI_VIDEO_TRYON_ENABLED: '0' }).AI_VIDEO_TRYON_ENABLED).toBe(false);
    expect(loadEnv({ ...base, AI_VIDEO_TRYON_ENABLED: 'true' }).AI_VIDEO_TRYON_ENABLED).toBe(true);
  });

  it('anlamsız bayrak değeri süreci açılışta durdurur (sessizce yorumlanmaz)', () => {
    expect(() => loadEnv({ ...base, AI_VIDEO_TRYON_ENABLED: 'evet' })).toThrow(
      /AI_VIDEO_TRYON_ENABLED/,
    );
  });
});

// ── Bütçe ayrımı ───────────────────────────────────────────────────────────

const imageBudget: AiBudget = {
  dailyPlatformUsd: 50,
  monthlyPlatformUsd: 1200,
  perUserDailyTryOn: 10,
  perGuestDailyTryOn: 2,
  perUserDailyStylistMessages: 30,
  perSellerMonthlyEnrich: 500,
  alertThresholds: [0.5, 0.8, 0.95],
  hardStopRatio: 1.0,
};

describe('video bütçesi AYRI kovadır', () => {
  const videoBudget = videoBudgetFromEnv({ AI_VIDEO_DAILY_BUDGET_USD: 5 });

  it('video tavanı dolduğunda video durur — statik try-on bütçesi ETKİLENMEZ', () => {
    const spentOnVideo = usdToMicro(5);

    expect(
      checkVideoBudget(videoBudget, {
        videoTodayMicroUsd: spentOnVideo,
        pendingRequestMicroUsd: videoTryOnEstimate('m', 5),
      }),
    ).toEqual({ allowed: false, reason: 'VIDEO_DAILY_BUDGET' });

    // Aynı harcama platform kovasına yazılsaydı 50 $'lık günlük bütçenin
    // yalnızca %10'u olurdu: statik try-on çalışmaya devam etmeli.
    expect(
      checkBudget(imageBudget, {
        todayMicroUsd: spentOnVideo,
        thisMonthMicroUsd: usdToMicro(100),
      }).allowed,
    ).toBe(true);
  });

  it('BEKLEYEN isteğin maliyeti de hesaba katılır — tavan tek çağrıda aşılamaz', () => {
    // Tavana 0,20 $ kaldı; 5 saniyelik klip 0,50 $. Harcama henüz tavanı
    // aşmadığı için "zaten aştık mı" sorusu İZİN VERİRDİ.
    const nearlyFull = usdToMicro(4.8);
    const pending = videoTryOnEstimate('m', 5);

    expect(nearlyFull).toBeLessThan(usdToMicro(5));
    expect(
      checkVideoBudget(videoBudget, {
        videoTodayMicroUsd: nearlyFull,
        pendingRequestMicroUsd: pending,
      }),
    ).toEqual({ allowed: false, reason: 'VIDEO_DAILY_BUDGET' });
  });

  it('bütçe altındayken izin verir', () => {
    expect(
      checkVideoBudget(videoBudget, {
        videoTodayMicroUsd: usdToMicro(1),
        pendingRequestMicroUsd: videoTryOnEstimate('m', 5),
      }),
    ).toEqual({ allowed: true });
  });

  it('uyarı eşiği geçilince izin verir ama uyarır', () => {
    const decision = checkVideoBudget(videoBudget, {
      videoTodayMicroUsd: usdToMicro(4),
      pendingRequestMicroUsd: videoTryOnEstimate('m', 5),
    });

    expect(decision.allowed).toBe(true);
    expect(decision.allowed && decision.warnAtRatio).toBe(0.8);
  });

  it('tavan 0 ise "sınırsız" değil KAPALI demektir', () => {
    expect(
      checkVideoBudget(videoBudgetFromEnv({ AI_VIDEO_DAILY_BUDGET_USD: 0 }), {
        videoTodayMicroUsd: 0n,
        pendingRequestMicroUsd: 0n,
      }),
    ).toEqual({ allowed: false, reason: 'VIDEO_DAILY_BUDGET' });
  });

  /** Kovaların neden ayrıldığının sayısal gerekçesi. */
  it('tek bir video, birçok statik denemenin parasını yakar', () => {
    const oneVideo = videoTryOnEstimate('fal-ai/test-video-tryon', 5);
    const oneImage = 60_000n; // FAL_TRYON_UNIT_COST_MICRO_USD['fal-ai/idm-vton']

    expect(oneVideo).toBeGreaterThan(oneImage * 8n);
  });

  it('maliyet süreyle ölçeklenir — süre faturadır', () => {
    expect(videoTryOnEstimate('m', 8)).toBe(videoTryOnEstimate('m', 2) * 4n);
  });
});

describe('süre sınırlama', () => {
  it('tavanın üstündeki talep kırpılır — sınırsız fatura olmaz', () => {
    expect(clampVideoDuration(600)).toBe(VIDEO_TRYON.maxDurationSeconds);
  });

  it('taban altındaki ve geçersiz değerler güvenli tarafa düşer', () => {
    expect(clampVideoDuration(0)).toBe(VIDEO_TRYON.minDurationSeconds);
    expect(clampVideoDuration(Number.NaN)).toBe(VIDEO_TRYON.defaultDurationSeconds);
  });

  it('tahmin, kırpılmış süre üzerinden hesaplanır', () => {
    expect(videoTryOnEstimate('m', 600)).toBe(
      videoTryOnEstimate('m', VIDEO_TRYON.maxDurationSeconds),
    );
  });
});

// ── Sağlayıcı davranışı ────────────────────────────────────────────────────

const VIDEO_BYTES = Buffer.alloc(2 * 1024 * 1024, 7);

interface RouteOptions {
  submit?: { status?: number; body?: unknown };
  statuses?: string[];
  result?: unknown;
  videoBody?: Buffer;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** URL'e göre yönlendiren sahte fetch. Çağrı sayaçları testlerde okunur. */
function routedFetch(options: RouteOptions = {}) {
  const calls = { submit: 0, status: 0, result: 0, download: 0 };
  const statuses = [...(options.statuses ?? ['COMPLETED'])];

  const fetchImpl = vi.fn(
    (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = String(input);

      if (url.endsWith('/status')) {
        calls.status += 1;
        return Promise.resolve(jsonResponse({ status: statuses.shift() ?? 'COMPLETED' }));
      }

      if (url.includes('/requests/')) {
        calls.result += 1;
        return Promise.resolve(jsonResponse(options.result ?? defaultResult()));
      }

      if ((init?.method ?? 'GET') === 'POST') {
        calls.submit += 1;
        const submit = options.submit ?? {};
        return Promise.resolve(
          jsonResponse(submit.body ?? { request_id: 'req-1' }, submit.status ?? 200),
        );
      }

      calls.download += 1;
      return Promise.resolve(
        new Response(options.videoBody ?? VIDEO_BYTES, {
          status: 200,
          headers: { 'content-type': 'video/mp4' },
        }),
      );
    },
  );

  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

function defaultResult(): unknown {
  return {
    video: {
      url: 'https://cdn.test/out.mp4',
      content_type: 'video/mp4',
      file_size: VIDEO_BYTES.byteLength,
      duration: 5,
    },
  };
}

function providerWith(
  options: RouteOptions = {},
  overrides: Partial<ConstructorParameters<typeof FalVideoTryOnProvider>[0]> = {},
) {
  const { fetchImpl, calls } = routedFetch(options);
  const provider = new FalVideoTryOnProvider({
    apiKey: FAKE_FAL_KEY,
    model: 'fal-ai/test-video-tryon',
    baseUrl: 'https://queue.test',
    fetchImpl,
    sleep: () => Promise.resolve(),
    pollIntervalMs: 1,
    ...overrides,
  });
  return { provider, calls, fetchImpl };
}

describe('fal video sağlayıcısı', () => {
  it('gönderir, yoklar, sonucu indirir', async () => {
    const { provider, calls } = providerWith({
      statuses: ['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED'],
    });

    const result = await provider.generate(request);

    expect(result.status).toBe('SUCCEEDED');
    expect(calls.status).toBe(3);
    expect(calls.download).toBe(1);
    if (result.status !== 'SUCCEEDED') return;
    expect(result.contentType).toBe('video/mp4');
    expect(result.durationSeconds).toBe(5);
    expect(result.providerRequestId).toBe('req-1');
  });

  it('sonuç FİLİGRANSIZ işaretlenir — yayına verilebilir sanılmasın', async () => {
    const { provider } = providerWith();
    const result = await provider.generate(request);

    expect(result.status === 'SUCCEEDED' && result.watermark).toBe('NOT_APPLIED');
  });

  it('sağlayıcı maliyet bildirmezse süreye göre TAHMİN yazılır', async () => {
    const { provider } = providerWith();
    const result = await provider.generate(request);

    expect(result.costMicroUsd).toBe(videoTryOnEstimate('fal-ai/test-video-tryon', 5));
    expect(result.costBasis).toBe('MODEL_ESTIMATE');
  });

  it('sağlayıcı maliyet bildirirse ölçüm kullanılır', async () => {
    const { provider } = providerWith({
      result: { ...(defaultResult() as object), cost_usd: 0.62 },
    });

    const result = await provider.generate(request);

    expect(result.costMicroUsd).toBe(620_000n);
    expect(result.costBasis).toBe('PROVIDER_REPORTED');
  });

  /** ⚠️ Video başarısızlığında ikinci deneme = ikinci fatura. */
  it('yeniden deneme KAPALI — 5xx alsa bile tek gönderim yapılır', async () => {
    const { provider, calls } = providerWith({ submit: { status: 503, body: { error: 'nope' } } });

    const result = await provider.generate(request);

    expect(calls.submit).toBe(1);
    expect(result.status).toBe('FAILED');
  });

  it('gönderim başarısızsa maliyet SIFIRDIR — kuyruğa hiçbir iş girmedi', async () => {
    const { provider } = providerWith({ submit: { status: 500, body: { error: 'boom' } } });

    const result = await provider.generate(request);

    expect(result.status).toBe('FAILED');
    expect(result.costMicroUsd).toBe(0n);
    expect(result.providerRequestId).toBeUndefined();
  });

  /**
   * ⚠️ EN PAHALI SESSİZ HATA: kuyruğa alınmış iş üretilir ve faturalanır.
   * Beklemekten vazgeçsek bile kimliği ve maliyeti kaybolmamalı.
   */
  it('yoklama zaman aşımında request_id ve maliyet KAYBOLMAZ', async () => {
    let clock = 0;
    const { provider } = providerWith(
      { statuses: ['IN_QUEUE', 'IN_QUEUE', 'IN_QUEUE', 'IN_QUEUE'] },
      {
        timeoutMs: 60_000,
        now: () => {
          clock += 30_000;
          return clock;
        },
      },
    );

    const result = await provider.generate(request);

    expect(result.status).toBe('FAILED');
    if (result.status !== 'FAILED') return;
    expect(result.reason).toBe('TIMEOUT');
    expect(result.providerRequestId).toBe('req-1');
    expect(result.costMicroUsd).toBe(videoTryOnEstimate('fal-ai/test-video-tryon', 5));
  });

  it('kuyruk işi FAILED dönerse sınıflandırılır ve maliyet yazılır', async () => {
    const { provider } = providerWith({ statuses: ['FAILED'] });

    const result = await provider.generate(request);

    expect(result.status).toBe('FAILED');
    expect(result.costMicroUsd).toBeGreaterThan(0n);
    expect(result.providerRequestId).toBe('req-1');
  });

  it('içerik güvenliği reddi KALICI olarak sınıflandırılır', async () => {
    const { provider } = providerWith({
      result: { error: 'blocked by safety filter', detail: 'nsfw' },
    });

    const result = await provider.generate(request);

    expect(result.status === 'FAILED' && result.reason).toBe('CONTENT_BLOCKED');
  });

  it('request_id dönmezse iş izlenemez — yoklamaya hiç başlanmaz', async () => {
    const { provider, calls } = providerWith({ submit: { body: { queued: true } } });

    const result = await provider.generate(request);

    expect(result.status).toBe('FAILED');
    expect(calls.status).toBe(0);
    expect(result.costMicroUsd).toBe(0n);
  });

  it('bildirilen boyut tavanı aşarsa video İNDİRİLMEZ', async () => {
    const { provider, calls } = providerWith({
      result: {
        video: { url: 'https://cdn.test/huge.mp4', file_size: VIDEO_TRYON.maxVideoBytes + 1 },
      },
    });

    const result = await provider.generate(request);

    expect(calls.download).toBe(0);
    expect(result.status).toBe('FAILED');
  });

  it('generate ASLA fırlatmaz — ağ çökse bile sınıflandırılmış sonuç döner', async () => {
    const provider = new FalVideoTryOnProvider({
      apiKey: FAKE_FAL_KEY,
      model: 'fal-ai/test-video-tryon',
      baseUrl: 'https://queue.test',
      fetchImpl: (() =>
        Promise.reject(
          Object.assign(new Error('kopuk'), { code: 'ECONNRESET' }),
        )) as unknown as typeof fetch,
      sleep: () => Promise.resolve(),
    });

    const result = await provider.generate(request);

    expect(result.status).toBe('FAILED');
    expect(result.costMicroUsd).toBe(0n);
  });

  it('istenenden uzun süre talebi kırpılarak gönderilir', async () => {
    const { provider, fetchImpl } = providerWith();

    await provider.generate({ ...request, durationSeconds: 120 });

    const body = JSON.parse(String(vi.mocked(fetchImpl).mock.calls[0]?.[1]?.body)) as {
      duration: number;
    };
    expect(body.duration).toBe(VIDEO_TRYON.maxDurationSeconds);
  });
});

// ── Filigran seam'i ────────────────────────────────────────────────────────

describe('video filigranı', () => {
  it('uygulanmamış filigran sessizce geçilmez — FIRLATIR', async () => {
    await expect(new UnimplementedVideoWatermarker().embedAllFrames()).rejects.toBeInstanceOf(
      AppError,
    );
  });

  it('filigran metni statik try-on ile aynıdır', () => {
    expect(VIDEO_TRYON.watermarkText).toContain('Yapay zekâ');
  });
});

describe('video güven skoru', () => {
  it('saniye başına bayt çok düşükse skor eşiğin altına iner', () => {
    expect(
      videoVisualConfidence({
        byteLength: 30 * 1024,
        durationSeconds: 5,
        requestedDurationSeconds: 5,
      }),
    ).toBeLessThan(60);
  });

  it('sağlam klip eşiğin üstünde kalır', () => {
    expect(
      videoVisualConfidence({
        byteLength: 5 * 1024 * 1024,
        durationSeconds: 5,
        requestedDurationSeconds: 5,
      }),
    ).toBeGreaterThanOrEqual(60);
  });

  it('kırpılmış klip güveni düşürür', () => {
    const full = videoVisualConfidence({
      byteLength: 5 * 1024 * 1024,
      durationSeconds: 5,
      requestedDurationSeconds: 5,
    });
    const short = videoVisualConfidence({
      byteLength: 5 * 1024 * 1024,
      durationSeconds: 3,
      requestedDurationSeconds: 5,
    });

    expect(short).toBeLessThan(full);
  });
});
