import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '@vt/config';
import type { Logger } from '../../common/logger.js';
import type { CatalogService, ProductListResult } from './catalog.service.js';
import type { ProductListQuery } from './catalog.schema.js';
import type {
  CatalogVocabulary,
  IntentResponse,
  QuotaSubject,
  SearchAiUsageEntry,
} from './natural-search.ports.js';

/**
 * ⚠️ `env()` MOCK'LANIYOR.
 *
 * Servis bütçe kontrolü için `aiBudgetFromEnv(env())` okuyor; gerçek `env()`
 * süreç ortamını doğrular ve eksik bir değişkende FIRLATIR. Testte bu, ölçmek
 * istediğimiz şeyin (düşüş davranışı) yerine ortam kurulumunu ölçmek olurdu.
 * `importOriginal` ile modülün geri kalanı (checkBudget, aiBudgetFromEnv,
 * sabitler) GERÇEK kalır — bütçe kararı gerçekten hesaplanır.
 */
let currentEnv: Env;

vi.mock('@vt/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vt/config')>();
  return { ...actual, env: (): Env => currentEnv };
});

const { NaturalSearchService } = await import('./natural-search.service.js');
const { NATURAL_SEARCH } = await import('@vt/config');

const BUTCELI = {
  AI_DAILY_BUDGET_USD: 50,
  AI_MONTHLY_BUDGET_USD: 1200,
  AI_TRYON_DAILY_PER_USER: 10,
  AI_TRYON_DAILY_PER_GUEST: 2,
  AI_STYLIST_DAILY_PER_USER: 30,
} as unknown as Env;

const SOZ_VARLIGI: CatalogVocabulary = {
  categorySlugs: ['kadin-ust-giyim', 'kadin-elbise'],
  colors: ['Siyah', 'Bej'],
  brands: ['Mavi Jeans'],
};

const BOS_SONUC: ProductListResult = {
  items: [],
  nextCursor: null,
  total: 0,
  facets: { colors: [], sizes: [], brands: [], priceRange: null },
  didYouMean: null,
};

/** Modelin doğru çalıştığı hâl: cümle → filtre. */
const GECERLI_CIKTI: IntentResponse = {
  raw: {
    keywords: ['blazer ceket'],
    category: 'kadin-ust-giyim',
    maxPriceMinor: 500_000,
    occasion: 'iş görüşmesi',
  },
  usage: { inputTokens: 620, outputTokens: 48 },
  costMicroUsd: 900n,
  latencyMs: 740,
  model: 'test-model',
};

interface Ortam {
  service: InstanceType<typeof NaturalSearchService>;
  listProducts: ReturnType<typeof vi.fn>;
  interpret: ReturnType<typeof vi.fn>;
  consume: ReturnType<typeof vi.fn>;
  refund: ReturnType<typeof vi.fn>;
  record: ReturnType<typeof vi.fn>;
}

function kur(
  options: {
    isConfigured?: boolean;
    interpret?: () => Promise<IntentResponse>;
    quotaAllowed?: boolean;
    spent?: { todayMicroUsd: bigint; thisMonthMicroUsd: bigint };
  } = {},
): Ortam {
  const listProducts = vi.fn((_query: ProductListQuery): Promise<ProductListResult> =>
    Promise.resolve(BOS_SONUC),
  );
  const interpret = vi.fn(
    options.interpret ?? ((): Promise<IntentResponse> => Promise.resolve(GECERLI_CIKTI)),
  );
  const consume = vi.fn((_subject: QuotaSubject) => Promise.resolve(options.quotaAllowed ?? true));
  const refund = vi.fn((_subject: QuotaSubject) => Promise.resolve());
  const record = vi.fn((_entry: SearchAiUsageEntry) => Promise.resolve());

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;

  const service = new NaturalSearchService(
    { listProducts } as unknown as CatalogService,
    {
      name: 'test-provider',
      model: 'test-model',
      isConfigured: options.isConfigured ?? true,
      interpret,
    },
    { load: (): Promise<CatalogVocabulary> => Promise.resolve(SOZ_VARLIGI) },
    { consume, refund },
    {
      record,
      spent: () => Promise.resolve(options.spent ?? { todayMicroUsd: 0n, thisMonthMicroUsd: 0n }),
    },
    logger,
  );

  return { service, listProducts, interpret, consume, refund, record };
}

beforeEach(() => {
  currentEnv = BUTCELI;
});

describe('kısa sorgu LLM’e HİÇ gitmez', () => {
  it('tek kelimelik sorguda sağlayıcı çağrılmaz', async () => {
    const ortam = kur();

    const sonuc = await ortam.service.search({
      query: 'elbise',
      userId: 'u1',
      clientIp: '1.1.1.1',
    });

    expect(ortam.interpret).not.toHaveBeenCalled();
    expect(sonuc.interpretation.outcome).toBe('SHORT_QUERY');
    expect(sonuc.interpretation.filter).toBeNull();
  });

  it('kısa sorguda KOTA DA harcanmaz — çağrı yapılmadıysa hak da tükenmemeli', async () => {
    const ortam = kur();

    await ortam.service.search({ query: 'siyah elbise', userId: 'u1', clientIp: '1.1.1.1' });

    expect(ortam.consume).not.toHaveBeenCalled();
    expect(ortam.interpret).not.toHaveBeenCalled();
  });

  it('kısa sorgu yine de normal aramaya iner', async () => {
    const ortam = kur();

    await ortam.service.search({ query: 'siyah elbise', userId: 'u1', clientIp: '1.1.1.1' });

    expect(ortam.listProducts).toHaveBeenCalledTimes(1);
    expect(ortam.listProducts.mock.calls[0]?.[0]).toMatchObject({
      q: 'siyah elbise',
      inStockOnly: true,
      sort: 'relevance',
    });
  });

  it('yalnızca marka adı yazıldığında sağlayıcı çağrılmaz', async () => {
    const ortam = kur();

    const sonuc = await ortam.service.search({
      query: 'Mavi Jeans',
      userId: 'u1',
      clientIp: '1.1.1.1',
    });

    expect(ortam.interpret).not.toHaveBeenCalled();
    expect(sonuc.interpretation.outcome).toBe('BRAND_ONLY');
  });

  it('uzun cümlede sağlayıcı çağrılır', async () => {
    const ortam = kur();

    await ortam.service.search({
      query: '5000 TL altı iş görüşmesi için sade bir kombin',
      userId: 'u1',
      clientIp: '1.1.1.1',
    });

    expect(ortam.interpret).toHaveBeenCalledTimes(1);
  });
});

describe('niyet filtreye çevrilir ve katalog servisine verilir', () => {
  it('model ürün seçmez; filtre üretir ve arama onu uygular', async () => {
    const ortam = kur();

    const sonuc = await ortam.service.search({
      query: '5000 TL altı iş görüşmesi için sade bir kombin',
      userId: 'u1',
      clientIp: '1.1.1.1',
    });

    expect(sonuc.interpretation.outcome).toBe('INTERPRETED');
    expect(ortam.listProducts.mock.calls[0]?.[0]).toMatchObject({
      q: 'blazer ceket',
      category: 'kadin-ust-giyim',
      maxPriceMinor: 500_000n,
      inStockOnly: true,
      limit: NATURAL_SEARCH.pageSize,
    });
  });

  it('kullanım amacı istemciye döner ama tsquery’ye girmez', async () => {
    const ortam = kur();

    const sonuc = await ortam.service.search({
      query: '5000 TL altı iş görüşmesi için sade bir kombin',
      userId: 'u1',
      clientIp: '1.1.1.1',
    });

    expect(sonuc.interpretation.filter?.occasion).toBe('iş görüşmesi');
    expect(ortam.listProducts.mock.calls[0]?.[0].q).toBe('blazer ceket');
  });

  it('sağlayıcının bildirdiği maliyet deftere yazılır', async () => {
    const ortam = kur();

    await ortam.service.search({
      query: '5000 TL altı iş görüşmesi için sade bir kombin',
      userId: 'u1',
      clientIp: '1.1.1.1',
    });

    expect(ortam.record).toHaveBeenCalledTimes(1);
    expect(ortam.record.mock.calls[0]?.[0]).toMatchObject({
      userId: 'u1',
      costMicroUsd: 900n,
      success: true,
    });
  });
});

describe('hiçbir yapay zekâ arızası kullanıcıya hata olarak yansımaz', () => {
  const CUMLE = '5000 TL altı iş görüşmesi için sade bir kombin';

  it('sağlayıcı çökerse normal aramaya düşer, hata FIRLATMAZ', async () => {
    const ortam = kur({
      interpret: () => Promise.reject(new TypeError('fetch failed')),
    });

    const sonuc = await ortam.service.search({ query: CUMLE, userId: 'u1', clientIp: '1.1.1.1' });

    expect(sonuc.interpretation.outcome).toBe('PROVIDER_ERROR');
    expect(ortam.listProducts.mock.calls[0]?.[0].q).toBe(CUMLE);
  });

  it('başarısız çağrı da deftere yazılır — başarısız çağrı da para harcar', async () => {
    const ortam = kur({ interpret: () => Promise.reject(new TypeError('fetch failed')) });

    await ortam.service.search({ query: CUMLE, userId: 'u1', clientIp: '1.1.1.1' });

    expect(ortam.record.mock.calls[0]?.[0]).toMatchObject({ success: false });
  });

  it('model şemaya uymayan çıktı üretirse (uydurma ürün) normal aramaya düşer', async () => {
    const ortam = kur({
      interpret: () =>
        Promise.resolve({
          ...GECERLI_CIKTI,
          raw: {
            keywords: ['ceket'],
            // ⚠️ Modelin uydurduğu ürün: şema bunu reddeder.
            products: [{ id: 'uydurma', title: 'Olmayan Ceket', priceMinor: 123 }],
          },
        }),
    });

    const sonuc = await ortam.service.search({ query: CUMLE, userId: 'u1', clientIp: '1.1.1.1' });

    expect(sonuc.interpretation.outcome).toBe('INVALID_OUTPUT');
    expect(sonuc.interpretation.filter).toBeNull();
    expect(ortam.listProducts.mock.calls[0]?.[0].q).toBe(CUMLE);
  });

  it('sağlayıcı yapılandırılmamışsa çağrı hiç yapılmaz', async () => {
    const ortam = kur({ isConfigured: false });

    const sonuc = await ortam.service.search({ query: CUMLE, userId: 'u1', clientIp: '1.1.1.1' });

    expect(ortam.interpret).not.toHaveBeenCalled();
    expect(ortam.consume).not.toHaveBeenCalled();
    expect(sonuc.interpretation.outcome).toBe('PROVIDER_NOT_CONFIGURED');
  });

  it('kota dolduğunda 429 değil, sade arama döner', async () => {
    const ortam = kur({ quotaAllowed: false });

    const sonuc = await ortam.service.search({ query: CUMLE, userId: 'u1', clientIp: '1.1.1.1' });

    expect(sonuc.interpretation.outcome).toBe('QUOTA_EXCEEDED');
    expect(ortam.interpret).not.toHaveBeenCalled();
    expect(ortam.listProducts).toHaveBeenCalledTimes(1);
  });

  it('platform bütçesi dolduğunda çağrı yapılmaz ve KOTA İADE EDİLİR', async () => {
    const ortam = kur({
      // Günlük tavan 50 $ = 50.000.000 mikro-dolar.
      spent: { todayMicroUsd: 60_000_000n, thisMonthMicroUsd: 60_000_000n },
    });

    const sonuc = await ortam.service.search({ query: CUMLE, userId: 'u1', clientIp: '1.1.1.1' });

    expect(sonuc.interpretation.outcome).toBe('BUDGET_EXCEEDED');
    expect(ortam.interpret).not.toHaveBeenCalled();
    expect(ortam.refund).toHaveBeenCalledWith({ kind: 'user', id: 'u1' });
  });

  it('sağlayıcı hatasında kota İADE EDİLMEZ — çağrı yapıldı, para harcanmış olabilir', async () => {
    const ortam = kur({ interpret: () => Promise.reject(new TypeError('fetch failed')) });

    await ortam.service.search({ query: CUMLE, userId: 'u1', clientIp: '1.1.1.1' });

    expect(ortam.refund).not.toHaveBeenCalled();
  });
});

describe('kota öznesi', () => {
  const CUMLE = '5000 TL altı iş görüşmesi için sade bir kombin';

  it('girişli kullanıcı kimliğiyle sayılır', async () => {
    const ortam = kur();

    await ortam.service.search({ query: CUMLE, userId: 'u1', clientIp: '9.9.9.9' });

    expect(ortam.consume).toHaveBeenCalledWith({ kind: 'user', id: 'u1' });
  });

  it('misafir IP ile sayılır — kimliksiz kullanım kotasız kullanım olamaz', async () => {
    const ortam = kur();

    await ortam.service.search({ query: CUMLE, userId: null, clientIp: '9.9.9.9' });

    expect(ortam.consume).toHaveBeenCalledWith({ kind: 'guest', id: '9.9.9.9' });
  });

  it('misafirin kullanım kaydı da yazılır, kullanıcı kimliği boş kalır', async () => {
    const ortam = kur();

    await ortam.service.search({ query: CUMLE, userId: null, clientIp: '9.9.9.9' });

    expect(ortam.record.mock.calls[0]?.[0]).toMatchObject({ userId: null, success: true });
  });
});
