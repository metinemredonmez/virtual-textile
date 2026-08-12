import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@vt/contracts';
import { ESTIMATED_UNIT_COST_MICRO_USD, estimateCost, resetEnvCache } from '@vt/config';
import { MAX_OUTFIT_PIECES, MIN_OUTFIT_PIECES, outfitStepKeys } from '@vt/adapters';
import { AiFeature } from '@vt/db';
import { MultiTryOnService } from './multi-tryon.service.js';
import type { ConsentPort, TryOnCatalogPort, TryOnStoragePort } from './ai.ports.js';
import type { ConsentRecordLike } from './consent.rules.js';

/**
 * ÇOKLU ÜRÜN DENEME — API tarafı.
 *
 * Sınanan üç güvence:
 *   1. Katman sırası SUNUCUDA belirlenir; istemcinin gönderdiği sıra değil.
 *   2. Bir parça değiştiğinde YALNIZCA ilgili katman (ve üstü) üretilir.
 *   3. Rıza ve kota kapıları çoklu akışta da atlanamaz; kota PARÇA BAŞINA düşer.
 */

const REQUIRED_ENV: Record<string, string> = {
  APP_URL: 'https://example.com',
  API_URL: 'https://api.example.com',
  CORS_ORIGINS: 'https://example.com',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(128),
  JWT_REFRESH_SECRET: 'b'.repeat(128),
  FIELD_ENCRYPTION_KEY: 'c'.repeat(64),
  INTERNAL_API_TOKEN: 'd'.repeat(32),
};

function useTestEnv(dailyQuota = '10'): void {
  for (const [key, value] of Object.entries(REQUIRED_ENV)) process.env[key] = value;
  process.env.AI_TRYON_DAILY_PER_USER = dailyQuota;
  resetEnvCache();
}

const granted = (type: ConsentRecordLike['type']): ConsentRecordLike => ({
  type,
  granted: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
});

const BOTH_GRANTED = [granted('PHOTO_PROCESSING'), granted('CROSS_BORDER_TRANSFER')];

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

const CATEGORIES: Record<string, 'LOWER_BODY' | 'UPPER_BODY' | 'OUTERWEAR' | 'DRESS'> = {
  'v-pantolon': 'LOWER_BODY',
  'v-gomlek': 'UPPER_BODY',
  'v-ceket': 'OUTERWEAR',
  'v-ceket-2': 'OUTERWEAR',
  'v-elbise': 'DRESS',
};

/** Kombinin kanonik sırası: alt → üst → dış. */
const ORDERED = ['v-pantolon', 'v-gomlek', 'v-ceket'];

function keysFor(variantIds: readonly string[], mode: 'FAST' | 'QUALITY' = 'FAST'): string[] {
  return outfitStepKeys({ photoContentHash: 'hash-1', orderedVariantIds: variantIds, mode });
}

type JobRow = {
  id: string;
  cacheKey: string;
  status: string;
  attempts: number;
  resultKey: string | null;
  visualConfidence: number | null;
  errorCode: string | null;
};

const succeeded = (id: string, cacheKey: string): JobRow => ({
  id,
  cacheKey,
  status: 'SUCCEEDED',
  attempts: 1,
  resultKey: `tryon/${id}.webp`,
  visualConfidence: 84,
  errorCode: null,
});

function createPrisma(rows: JobRow[] = [], overrides: Record<string, unknown> = {}) {
  let created = 0;
  const tx = {
    tryOnJob: {
      create: vi.fn(() => {
        created += 1;
        return Promise.resolve({ id: `new-job-${created}` });
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    outboxEvent: { create: vi.fn().mockResolvedValue({ id: 'evt-1' }) },
  };

  const prisma = {
    userPhoto: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'photo-1',
        contentHash: 'hash-1',
        qualityScore: 85,
        qualityIssues: null,
      }),
    },
    tryOnJob: {
      findMany: vi.fn().mockResolvedValue(rows),
      count: vi.fn().mockResolvedValue(0),
    },
    aiUsageLog: {
      create: vi.fn().mockResolvedValue({}),
      aggregate: vi.fn().mockResolvedValue({ _sum: { costMicroUsd: 0n } }),
    },
    $transaction: vi.fn(async (callback: (t: typeof tx) => Promise<unknown>) => callback(tx)),
    ...overrides,
  };

  return { prisma, tx };
}

function createCatalog(): TryOnCatalogPort {
  return {
    findVariant: vi.fn((variantId: string) =>
      Promise.resolve({
        variantId,
        productId: `p-${variantId}`,
        productTitle: variantId,
        size: 'M',
        color: 'Siyah',
        tryOnCategory: CATEGORIES[variantId] ?? 'UPPER_BODY',
        imageKey: `products/${variantId}/1.webp`,
        sizeChart: null,
        brandFit: null,
        isPurchasable: true,
      }),
    ),
    findProductForSizing: vi.fn(),
    findProductIdByVariant: vi.fn(),
  };
}

function build(
  records: ConsentRecordLike[] = BOTH_GRANTED,
  rows: JobRow[] = [],
  overrides: Record<string, unknown> = {},
) {
  const { prisma, tx } = createPrisma(rows, overrides);
  const consents: ConsentPort = { findRecords: vi.fn().mockResolvedValue(records) };
  const catalog = createCatalog();
  const storage: TryOnStoragePort = {
    signedResultUrl: vi.fn().mockResolvedValue('https://signed.example/result'),
  };

  const service = new MultiTryOnService(
    prisma as never,
    consents,
    catalog,
    storage,
    silentLogger as never,
  );

  return { service, prisma, tx, consents, catalog, storage };
}

const ACTOR = { userId: 'user-1' };

/** ⚠️ İstemci sırası bilinçli olarak KARIŞIK: ceket önce gönderiliyor. */
const INPUT = {
  userPhotoId: 'photo-1',
  variantIds: ['v-ceket', 'v-pantolon', 'v-gomlek'],
  mode: 'FAST' as const,
};

function outboxPayload(tx: ReturnType<typeof createPrisma>['tx']) {
  const call = tx.outboxEvent.create.mock.calls[0]?.[0] as {
    data: { type: string; payload: Record<string, unknown> };
  };
  return call.data;
}

beforeEach(() => {
  vi.clearAllMocks();
  useTestEnv();
});

describe('POST /tryon/outfit — rıza kapısı', () => {
  it('rıza yoksa reddeder ve HİÇBİR ÜRETİM İZİ bırakmaz', async () => {
    const { service, prisma, tx } = build([]);

    await expect(service.create(INPUT, ACTOR)).rejects.toBeInstanceOf(AppError);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.tryOnJob.create).not.toHaveBeenCalled();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('yurt dışı aktarım rızası tek başına eksikse reddeder', async () => {
    const { service } = build([granted('PHOTO_PROCESSING')]);

    await expect(service.create(INPUT, ACTOR)).rejects.toMatchObject({
      code: 'CONSENT_CROSS_BORDER_REQUIRED',
    });
  });

  it('rıza kontrolü fotoğraf ve katalog okumasından ÖNCE yapılır', async () => {
    const { service, prisma, catalog } = build([]);

    await expect(service.create(INPUT, ACTOR)).rejects.toBeInstanceOf(AppError);

    expect(prisma.userPhoto.findFirst).not.toHaveBeenCalled();
    expect(catalog.findVariant).not.toHaveBeenCalled();
  });
});

describe('POST /tryon/outfit — katman sırası', () => {
  it('⚠️ SIRA SUNUCUDA BELİRLENİR: istemci ceketi ilk gönderse de en üstte kalır', async () => {
    const { service, tx } = build();

    const result = await service.create(INPUT, ACTOR);

    expect(result.steps.map((step) => step.variantId)).toEqual(ORDERED);
    expect(result.steps.map((step) => step.layerIndex)).toEqual([0, 1, 2]);

    // Outbox olayı da aynı sırayı taşır — worker sıralamayı yeniden yorumlamaz.
    const payload = outboxPayload(tx).payload as { steps: { variantId: string }[] };
    expect(payload.steps.map((step) => step.variantId)).toEqual(ORDERED);
  });

  it('farklı istemci sıraları AYNI önbellek anahtarlarını üretir', async () => {
    const first = build();
    await first.service.create(INPUT, ACTOR);
    const firstKeys = (
      outboxPayload(first.tx).payload as { steps: { cacheKey: string }[] }
    ).steps.map((step) => step.cacheKey);

    vi.clearAllMocks();
    const second = build();
    await second.service.create(
      { ...INPUT, variantIds: ['v-gomlek', 'v-ceket', 'v-pantolon'] },
      ACTOR,
    );
    const secondKeys = (
      outboxPayload(second.tx).payload as { steps: { cacheKey: string }[] }
    ).steps.map((step) => step.cacheKey);

    expect(secondKeys).toEqual(firstKeys);
  });

  it('anahtarlar ÖNEK yapısındadır — kanonik sıradan üretilir', async () => {
    const { service, tx } = build();

    await service.create(INPUT, ACTOR);

    const payload = outboxPayload(tx).payload as { steps: { cacheKey: string }[] };
    expect(payload.steps.map((step) => step.cacheKey)).toEqual(keysFor(ORDERED));
  });

  it('aynı bölgeyi kaplayan iki parça reddedilir ve üretim başlamaz', async () => {
    const { service, tx } = build();

    await expect(
      service.create({ ...INPUT, variantIds: ['v-elbise', 'v-pantolon'] }, ACTOR),
    ).rejects.toMatchObject({ code: 'OUTFIT_LAYER_CONFLICT' });

    expect(tx.tryOnJob.create).not.toHaveBeenCalled();
  });

  it('try-on desteklenmeyen parça varsa kombinin TAMAMI reddedilir', async () => {
    const { service, catalog, tx } = build();
    (catalog.findVariant as ReturnType<typeof vi.fn>).mockImplementation((variantId: string) =>
      Promise.resolve({
        variantId,
        productId: 'p',
        productTitle: variantId,
        size: 'TEK EBAT',
        color: 'Altın',
        // Kolye: kategori yok → denenemez.
        tryOnCategory: variantId === 'v-gomlek' ? null : (CATEGORIES[variantId] ?? 'UPPER_BODY'),
        imageKey: 'products/p/1.webp',
        sizeChart: null,
        brandFit: null,
        isPurchasable: true,
      }),
    );

    await expect(service.create(INPUT, ACTOR)).rejects.toMatchObject({
      code: 'PRODUCT_NOT_TRYONABLE',
    });
    expect(tx.tryOnJob.create).not.toHaveBeenCalled();
  });

  it('satıştan kalkmış parça varsa üretim başlamaz', async () => {
    const { service, catalog, tx } = build();
    (catalog.findVariant as ReturnType<typeof vi.fn>).mockImplementation((variantId: string) =>
      Promise.resolve({
        variantId,
        productId: 'p',
        productTitle: variantId,
        size: 'M',
        color: 'Siyah',
        tryOnCategory: CATEGORIES[variantId] ?? 'UPPER_BODY',
        imageKey: 'products/p/1.webp',
        sizeChart: null,
        brandFit: null,
        isPurchasable: variantId !== 'v-ceket',
      }),
    );

    await expect(service.create(INPUT, ACTOR)).rejects.toMatchObject({
      code: 'VARIANT_UNAVAILABLE',
    });
    expect(tx.tryOnJob.create).not.toHaveBeenCalled();
  });
});

/**
 * KOMBİN RET KODLARI
 *
 * Önceden üç ret de `VALIDATION_FAILED` dönüyordu; kullanıcı "geçersiz istek"
 * mesajıyla ne yapacağını bilemediği için aynı kombini tekrar gönderiyordu.
 * Sınanan şey mesajın EYLEM İÇERMESİ ve kodun ret sebebine göre AYRIŞMASI.
 */
describe('POST /tryon/outfit — kombin ret kodları', () => {
  async function rejectionOf(variantIds: readonly string[]): Promise<AppError> {
    const { service, tx } = build();
    const error = await service
      .create({ ...INPUT, variantIds: [...variantIds] }, ACTOR)
      .then(() => null)
      .catch((caught: unknown) => caught as AppError);

    expect(error).toBeInstanceOf(AppError);
    // Ret her zaman üretimden ÖNCE: reddedilen kombin için para harcanmaz.
    expect(tx.tryOnJob.create).not.toHaveBeenCalled();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
    return error as AppError;
  }

  it('aynı katmanda iki parça → OUTFIT_LAYER_CONFLICT ve mesaj çözümü söyler', async () => {
    // İki ceket: ikisi de DIŞ giyim, aynı bölgeyi kaplar.
    const error = await rejectionOf(['v-ceket', 'v-ceket-2']);

    expect(error.code).toBe('OUTFIT_LAYER_CONFLICT');
    expect(error.httpStatus).toBe(422);
    // `domain` → beklenen bir iş sonucudur, Sentry gürültüsü yaratmaz.
    expect(error.family).toBe('domain');
    expect(error.retryable).toBe(false);
    // Kullanıcı ne yapacağını okuyabilmeli: "bırakın" fiili mesajın çekirdeği.
    expect(error.userMessage).toContain('bırakın');
  });

  it('elbise + pantolon da katman çakışmasıdır — mesaj elbiseyi açıkça anar', async () => {
    const error = await rejectionOf(['v-elbise', 'v-pantolon']);

    expect(error.code).toBe('OUTFIT_LAYER_CONFLICT');
    /**
     * ⚠️ Bu senaryo mesajın neden bölge adı vermediğini belgeliyor: "üst
     *    giyimden birini bırakın" denseydi burada YANLIŞ yönlendirme olurdu —
     *    çakışan parçalar elbise ve pantolondur.
     */
    expect(error.userMessage).toContain('elbise');
  });

  it('aynı varyant iki kez → OUTFIT_DUPLICATE_PIECE', async () => {
    const error = await rejectionOf(['v-gomlek', 'v-gomlek']);

    expect(error.code).toBe('OUTFIT_DUPLICATE_PIECE');
    expect(error.httpStatus).toBe(422);
    expect(error.family).toBe('domain');
  });

  it('sınır üstü parça sayısı → OUTFIT_PIECE_COUNT_INVALID, mesajda İKİ SINIR da vardır', async () => {
    const tooMany = Array.from({ length: MAX_OUTFIT_PIECES + 1 }, (_, i) => `v-fazla-${i}`);
    const error = await rejectionOf(tooMany);

    expect(error.code).toBe('OUTFIT_PIECE_COUNT_INVALID');
    expect(error.userMessage).toContain(String(MIN_OUTFIT_PIECES));
    expect(error.userMessage).toContain(String(MAX_OUTFIT_PIECES));
    // Parametreler doldurulmazsa yer tutucu kullanıcıya sızardı (bkz. interpolate).
    expect(error.userMessage).not.toContain('{');
  });

  it('sınır altı parça sayısı AYNI koda düşer — kullanıcının eylemi tek', async () => {
    const error = await rejectionOf(['v-gomlek']);

    expect(error.code).toBe('OUTFIT_PIECE_COUNT_INVALID');
  });

  it('ret sebebi istemciye details ile taşınır, kullanıcı mesajına SIZMAZ', async () => {
    const error = await rejectionOf(['v-elbise', 'v-pantolon']);

    // İstemci hangi parçayı işaretleyeceğini buradan bilir.
    expect(error.details).toMatchObject({
      reason: 'LAYER_CONFLICT',
      variantIds: ['v-elbise', 'v-pantolon'],
    });
    // Varyant kimliği ve iç bölge adı kullanıcıya gösterilmez.
    expect(error.userMessage).not.toContain('v-elbise');
    expect(error.userMessage).not.toContain('UPPER');
  });

  it('artık genel VALIDATION_FAILED dönmez — her ret kendi kodunu taşır', async () => {
    const codes = await Promise.all(
      [['v-ceket', 'v-ceket-2'], ['v-gomlek', 'v-gomlek'], ['v-gomlek']].map(
        async (variantIds) => (await rejectionOf(variantIds)).code,
      ),
    );

    expect(codes).not.toContain('VALIDATION_FAILED');
    expect(new Set(codes).size).toBe(3);
  });
});

/**
 * AI MALİYET DEFTERİ — şema enum'u ile TS tarafının EŞİTLİĞİ.
 *
 * ⚠️ `packages/config` `@vt/db`'ye bağlı değil (yapılandırma katmanı veritabanı
 *    istemcisini çekmemeli), bu yüzden `AiFeature` birleşimi Prisma enum'ından
 *    TÜRETİLEMEZ ve elle güncellenir. İki liste ayrışırsa maliyet o özellik
 *    için ya yazılamaz ya da tahmin edilemez — ikisi de sessiz para kaybıdır.
 *    Bu testin yeri burasıdır çünkü `estimateCost` uygulama tarafında ilk kez
 *    bu serviste çağrılıyor.
 */
describe('AiFeature enum ↔ tahmini birim maliyet tablosu', () => {
  it('SEARCH_NL şemada tanımlı — doğal dil arama maliyeti deftere yazılabilir', () => {
    expect(AiFeature.SEARCH_NL).toBe('SEARCH_NL');
  });

  it('şemadaki HER AiFeature değerinin tahmini birim maliyeti vardır', () => {
    const missing = Object.values(AiFeature).filter(
      (feature) => !(feature in ESTIMATED_UNIT_COST_MICRO_USD),
    );

    expect(missing).toEqual([]);
  });

  it('arama niyeti çıkarımı danışman turundan ucuzdur', () => {
    // Tek küçük JSON çıktısı + önbelleklenen sistem istemi (bkz. NATURAL_SEARCH).
    expect(estimateCost('SEARCH_NL')).toBeGreaterThan(0n);
    expect(estimateCost('SEARCH_NL')).toBeLessThan(estimateCost('STYLIST'));
  });
});

describe('POST /tryon/outfit — parça bazlı yeniden üretim', () => {
  it('hiçbir önek hazır değilse her katman için ayrı iş açılır', async () => {
    const { service, tx } = build();

    const result = await service.create(INPUT, ACTOR);

    expect(result.outcome).toBe('QUEUED');
    expect(tx.tryOnJob.create).toHaveBeenCalledTimes(3);
    if (result.outcome !== 'QUEUED') return;
    expect(result.generatedStepCount).toBe(3);
    expect(result.reusedStepCount).toBe(0);
  });

  it('⚠️ SON PARÇA DEĞİŞİNCE YALNIZCA O KATMAN ÜRETİLİR', async () => {
    // Pantolon + gömlek öneki daha önce üretilmiş; ceket yeni.
    const previous = keysFor(['v-pantolon', 'v-gomlek', 'v-ceket-2']);
    const rows = [succeeded('job-1', previous[0]!), succeeded('job-2', previous[1]!)];

    const { service, tx } = build(BOTH_GRANTED, rows);

    const result = await service.create(
      { ...INPUT, variantIds: ['v-ceket', 'v-pantolon', 'v-gomlek'] },
      ACTOR,
    );

    // 3 üretim yerine 1 üretim: maliyetin kalbi budur.
    expect(tx.tryOnJob.create).toHaveBeenCalledTimes(1);
    if (result.outcome !== 'QUEUED') throw new Error('kuyruğa alınmalıydı');
    expect(result.generatedStepCount).toBe(1);
    expect(result.reusedStepCount).toBe(2);

    // Açılan tek iş, DEĞİŞEN parçanın işidir.
    const createArgs = tx.tryOnJob.create.mock.calls[0]?.[0] as { data: { variantId: string } };
    expect(createArgs.data.variantId).toBe('v-ceket');

    // Taban görsel, yeniden kullanılan öneğin işinden gelir.
    const payload = outboxPayload(tx).payload as { baseJobId: string | null };
    expect(payload.baseJobId).toBe('job-2');
  });

  it('değişmeyen katmanlar için YENİ İŞ AÇILMAZ ve outbox’a girmez', async () => {
    const previous = keysFor(['v-pantolon', 'v-gomlek', 'v-ceket-2']);
    const { service, tx } = build(BOTH_GRANTED, [
      succeeded('job-1', previous[0]!),
      succeeded('job-2', previous[1]!),
    ]);

    await service.create({ ...INPUT, variantIds: ['v-ceket', 'v-pantolon', 'v-gomlek'] }, ACTOR);

    const payload = outboxPayload(tx).payload as { steps: { variantId: string }[] };
    expect(payload.steps).toHaveLength(1);
    expect(payload.steps[0]?.variantId).toBe('v-ceket');
  });

  it('ara katman değişince o katman VE ÜSTÜ üretilir', async () => {
    // Yalnızca pantolon öneki hazır: gömlek değişti, ceket onun üstündeydi.
    const { service, tx } = build(BOTH_GRANTED, [succeeded('job-1', keysFor(ORDERED)[0]!)]);

    const result = await service.create(INPUT, ACTOR);

    expect(tx.tryOnJob.create).toHaveBeenCalledTimes(2);
    if (result.outcome !== 'QUEUED') throw new Error('kuyruğa alınmalıydı');
    expect(result.reusedStepCount).toBe(1);
  });

  it('en alttaki parça değişince zincirin tamamı üretilir', async () => {
    // Farklı bir pantolonla üretilmiş kombinin anahtarları TUTMAZ.
    const other = keysFor(['v-pantolon-2', 'v-gomlek', 'v-ceket']);
    const { service, tx } = build(BOTH_GRANTED, [
      succeeded('job-1', other[0]!),
      succeeded('job-2', other[1]!),
      succeeded('job-3', other[2]!),
    ]);

    await service.create(INPUT, ACTOR);

    expect(tx.tryOnJob.create).toHaveBeenCalledTimes(3);
  });

  it('kombinin tamamı hazırsa hiç üretim yapılmaz ve önbellek isabeti loglanır', async () => {
    const keys = keysFor(ORDERED);
    const { service, tx, prisma } = build(BOTH_GRANTED, [
      succeeded('job-1', keys[0]!),
      succeeded('job-2', keys[1]!),
      succeeded('job-3', keys[2]!),
    ]);

    const result = await service.create(INPUT, ACTOR);

    expect(result.outcome).toBe('CACHED');
    expect(tx.tryOnJob.create).not.toHaveBeenCalled();
    if (result.outcome !== 'CACHED') return;
    expect(result.jobId).toBe('job-3');
    expect(result.resultUrl).toBe('https://signed.example/result');

    const log = prisma.aiUsageLog.create.mock.calls[0]?.[0] as {
      data: { cacheHit: boolean; costMicroUsd: bigint; imageCount: number };
    };
    expect(log.data.cacheHit).toBe(true);
    expect(log.data.costMicroUsd).toBe(0n);
    expect(log.data.imageCount).toBe(3);
  });

  it('devam eden bir katman varsa ikinci bir üretim başlatılmaz', async () => {
    const keys = keysFor(ORDERED);
    const { service, tx } = build(BOTH_GRANTED, [
      succeeded('job-1', keys[0]!),
      {
        id: 'job-2',
        cacheKey: keys[1]!,
        status: 'RUNNING',
        attempts: 1,
        resultKey: null,
        visualConfidence: null,
        errorCode: null,
      },
    ]);

    const result = await service.create(INPUT, ACTOR);

    expect(result.outcome).toBe('QUEUED');
    expect(tx.tryOnJob.create).not.toHaveBeenCalled();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });
});

describe('POST /tryon/outfit — kota (parça başına)', () => {
  it('⚠️ ÇOKLU DENEME TEK DENEME SAYILMAZ: kota parça sayısı kadar düşer', async () => {
    // Günlük hak 10, bugün 8 kullanılmış → 3 parçalık kombin sığmaz.
    useTestEnv('10');
    const { service, tx } = build(BOTH_GRANTED, [], {
      tryOnJob: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(8) },
    });

    await expect(service.create(INPUT, ACTOR)).rejects.toMatchObject({
      code: 'TRYON_QUOTA_EXCEEDED',
    });
    expect(tx.tryOnJob.create).not.toHaveBeenCalled();
  });

  it('kalan hak tam yetiyorsa kabul edilir', async () => {
    useTestEnv('10');
    const { service } = build(BOTH_GRANTED, [], {
      tryOnJob: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(7) },
    });

    await expect(service.create(INPUT, ACTOR)).resolves.toMatchObject({ outcome: 'QUEUED' });
  });

  it('yeniden kullanılan katmanlar kotadan DÜŞMEZ', async () => {
    // Hak 10, 9'u kullanılmış; iki katman hazır olduğu için yalnızca 1 üretim var.
    useTestEnv('10');
    const previous = keysFor(['v-pantolon', 'v-gomlek', 'v-ceket-2']);
    const { service } = build(
      BOTH_GRANTED,
      [succeeded('job-1', previous[0]!), succeeded('job-2', previous[1]!)],
      {
        tryOnJob: {
          findMany: vi
            .fn()
            .mockResolvedValue([
              succeeded('job-1', previous[0]!),
              succeeded('job-2', previous[1]!),
            ]),
          count: vi.fn().mockResolvedValue(9),
        },
      },
    );

    await expect(
      service.create({ ...INPUT, variantIds: ['v-ceket', 'v-pantolon', 'v-gomlek'] }, ACTOR),
    ).resolves.toMatchObject({ outcome: 'QUEUED' });
  });

  it('önbellek isabeti kotadan DÜŞMEZ — hak dolu olsa bile sonuç döner', async () => {
    useTestEnv('1');
    const keys = keysFor(ORDERED);
    const rows = [
      succeeded('job-1', keys[0]!),
      succeeded('job-2', keys[1]!),
      succeeded('job-3', keys[2]!),
    ];
    const { service } = build(BOTH_GRANTED, rows, {
      tryOnJob: {
        findMany: vi.fn().mockResolvedValue(rows),
        count: vi.fn().mockResolvedValue(99),
      },
    });

    await expect(service.create(INPUT, ACTOR)).resolves.toMatchObject({ outcome: 'CACHED' });
  });

  it('platform bütçesi dolduysa üretim başlamaz', async () => {
    process.env.AI_DAILY_BUDGET_USD = '1';
    resetEnvCache();

    const { service, tx } = build(BOTH_GRANTED, [], {
      aiUsageLog: {
        create: vi.fn(),
        aggregate: vi.fn().mockResolvedValue({ _sum: { costMicroUsd: 999_000_000n } }),
      },
    });

    await expect(service.create(INPUT, ACTOR)).rejects.toMatchObject({
      code: 'AI_BUDGET_EXCEEDED',
    });
    expect(tx.tryOnJob.create).not.toHaveBeenCalled();

    delete process.env.AI_DAILY_BUDGET_USD;
    resetEnvCache();
  });
});

describe('POST /tryon/outfit — kısmi başarı', () => {
  const keys = keysFor(ORDERED);

  const permanentlyFailed = (cacheKey: string): JobRow => ({
    id: 'job-3',
    cacheKey,
    status: 'FAILED_PERMANENT',
    attempts: 1,
    resultKey: null,
    visualConfidence: null,
    errorCode: 'TRYON_CONTENT_BLOCKED',
  });

  it('giydirilebilen katmanlar varsa YARIM KOMBİN gösterilir, eksik parça bildirilir', async () => {
    const { service } = build(BOTH_GRANTED, [
      succeeded('job-1', keys[0]!),
      succeeded('job-2', keys[1]!),
      permanentlyFailed(keys[2]!),
    ]);

    const result = await service.create(INPUT, ACTOR);

    expect(result.outcome).toBe('PARTIAL');
    if (result.outcome !== 'PARTIAL') return;
    expect(result.appliedCount).toBe(2);
    // Gösterilen görsel, giydirilebilen en derin katmanın sonucudur.
    expect(result.jobId).toBe('job-2');
    expect(result.resultUrl).toBe('https://signed.example/result');
    // ⚠️ Eksik parça AÇIKÇA söylenir: kullanıcı görmediği kombini satın almasın.
    expect(result.missing).toMatchObject({
      variantId: 'v-ceket',
      category: 'OUTERWEAR',
      errorCode: 'TRYON_CONTENT_BLOCKED',
    });
  });

  it('hiçbir katman giydirilemediyse gösterilecek görsel yoktur — FAILED', async () => {
    const { service } = build(BOTH_GRANTED, [permanentlyFailed(keys[0]!)]);

    const result = await service.create(INPUT, ACTOR);

    expect(result.outcome).toBe('FAILED');
    if (result.outcome !== 'FAILED') return;
    expect(result.failedVariantId).toBe('v-pantolon');
  });

  it('⚠️ KALICI HATA OTOMATİK TEKRARLANMAZ — yoklama para yakmaz', async () => {
    const { service, tx } = build(BOTH_GRANTED, [
      succeeded('job-1', keys[0]!),
      succeeded('job-2', keys[1]!),
      permanentlyFailed(keys[2]!),
    ]);

    await service.create(INPUT, ACTOR);

    expect(tx.tryOnJob.create).not.toHaveBeenCalled();
    expect(tx.tryOnJob.update).not.toHaveBeenCalled();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('geçici hata sınır dolmadan yeniden kuyruğa alınır', async () => {
    const { service, tx } = build(BOTH_GRANTED, [
      succeeded('job-1', keys[0]!),
      succeeded('job-2', keys[1]!),
      {
        id: 'job-3',
        cacheKey: keys[2]!,
        status: 'FAILED',
        attempts: 1,
        resultKey: null,
        visualConfidence: null,
        errorCode: 'TRYON_PROVIDER_ERROR',
      },
    ]);

    const result = await service.create(INPUT, ACTOR);

    expect(result.outcome).toBe('QUEUED');
    // Yeni satır açılmaz, var olan satır tazelenir.
    expect(tx.tryOnJob.create).not.toHaveBeenCalled();
    expect(tx.tryOnJob.update).toHaveBeenCalledTimes(1);

    // ⚠️ `queuedAt` tazelenir: kota "bugün açılmış işler" üzerinden sayılır.
    const updateArgs = tx.tryOnJob.update.mock.calls[0]?.[0] as {
      data: { status: string; queuedAt: Date };
    };
    expect(updateArgs.data.status).toBe('QUEUED');
    expect(updateArgs.data.queuedAt).toBeInstanceOf(Date);
  });

  it('deneme hakkı tükenmiş geçici hata da tekrarlanmaz', async () => {
    const { service, tx } = build(BOTH_GRANTED, [
      succeeded('job-1', keys[0]!),
      succeeded('job-2', keys[1]!),
      {
        id: 'job-3',
        cacheKey: keys[2]!,
        status: 'FAILED',
        attempts: 3, // TRYON.maxAttempts
        resultKey: null,
        visualConfidence: null,
        errorCode: 'TRYON_PROVIDER_ERROR',
      },
    ]);

    const result = await service.create(INPUT, ACTOR);

    expect(result.outcome).toBe('PARTIAL');
    expect(tx.tryOnJob.update).not.toHaveBeenCalled();
  });
});

describe('POST /tryon/outfit — kuyruk sözleşmesi', () => {
  it('işler ve outbox olayı AYNI transaction içinde yazılır', async () => {
    const { service, prisma, tx } = build();

    await service.create(INPUT, ACTOR);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.tryOnJob.create).toHaveBeenCalledTimes(3);
    expect(tx.outboxEvent.create).toHaveBeenCalledTimes(1);
  });

  it('zincir TEK olayla taşınır — katmanlar paralel işlenemez', async () => {
    const { service, tx } = build();

    await service.create(INPUT, ACTOR);

    const event = outboxPayload(tx);
    expect(event.type).toBe('tryon.outfit_requested');

    const payload = event.payload as { steps: unknown[]; baseJobId: string | null };
    expect(payload.steps).toHaveLength(3);
    expect(payload.baseJobId).toBeNull();
  });

  it('her katman kendi varyantını ve ÖNEK anahtarını taşır', async () => {
    const { service, tx } = build();

    await service.create(INPUT, ACTOR);

    const payload = outboxPayload(tx).payload as {
      steps: { variantId: string; cacheKey: string; layerIndex: number; category: string }[];
    };

    expect(payload.steps.map((step) => step.layerIndex)).toEqual([0, 1, 2]);
    expect(payload.steps.map((step) => step.category)).toEqual([
      'LOWER_BODY',
      'UPPER_BODY',
      'OUTERWEAR',
    ]);
    expect(payload.steps.map((step) => step.cacheKey)).toEqual(keysFor(ORDERED));
  });

  it('bekleme tahmini parça sayısıyla çarpılır — katmanlar sırayla üretilir', async () => {
    const single = build();
    const singleResult = await single.service.create(
      { ...INPUT, variantIds: ['v-pantolon', 'v-gomlek'] },
      ACTOR,
    );

    const triple = build();
    const tripleResult = await triple.service.create(INPUT, ACTOR);

    if (singleResult.outcome !== 'QUEUED' || tripleResult.outcome !== 'QUEUED') {
      throw new Error('ikisi de kuyruğa alınmalıydı');
    }
    expect(tripleResult.estimatedSeconds).toBeGreaterThan(singleResult.estimatedSeconds);
  });

  it('QUALITY modu farklı anahtar üretir — FAST sonucu yeniden kullanılmaz', async () => {
    const keys = keysFor(ORDERED, 'FAST');
    const { service, tx } = build(BOTH_GRANTED, [
      succeeded('job-1', keys[0]!),
      succeeded('job-2', keys[1]!),
      succeeded('job-3', keys[2]!),
    ]);

    const result = await service.create({ ...INPUT, mode: 'QUALITY' }, ACTOR);

    expect(result.outcome).toBe('QUEUED');
    expect(tx.tryOnJob.create).toHaveBeenCalledTimes(3);
  });
});
