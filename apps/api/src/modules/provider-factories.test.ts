import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '@vt/config';
import { PrismaService } from '../infra/prisma.service.js';
import { APP_LOGGER } from '../infra/infra.module.js';

/**
 * ⚠️ `env()` MOCK'LANIYOR.
 *
 * Fabrikalar varsayılan olarak `env()`'ten okur. Gerçek `env()` süreç ortamını
 * doğrular ve eksik bir değişkende FIRLATIR — testte bu, ölçmek istediğimiz
 * şeyin (seçim mantığı) yerine ortam kurulumunu ölçmek olurdu.
 *
 * `importOriginal` ile gerçek modül korunuyor: `@vt/config` yalnızca `env`
 * değil, adapter'ların kullandığı MEDIA / RESILIENCE / SIGNED_URL_TTL_SECONDS
 * sabitlerini de yayımlıyor. Modülün tamamı sahteyle değiştirilseydi
 * `R2StorageProvider` boyut tavanını okuyamaz ve test, seçim mantığı yüzünden
 * değil eksik sabit yüzünden kırılırdı.
 */
let currentEnv: Env;

vi.mock('@vt/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vt/config')>();
  return { ...actual, env: (): Env => currentEnv };
});

const {
  logProviderWiring,
  providerWiring,
  resetProviderWiringLog,
  resetR2Storage,
  UnconfiguredTryOnProvider,
} = await import('@vt/adapters');

const { createPaymentProvider } = await import('./checkout/index.js');
const { UnconfiguredPaymentProvider } = await import('./checkout/checkout.bridges.js');
const { createImageProcessor, createStorageProvider, MediaModule } =
  await import('./media/index.js');
const { MEDIA_IMAGE_PROCESSOR, MEDIA_STORAGE } = await import('./media/index.js');
const { UnconfiguredStorageProvider } = await import('./media/media.bridges.js');
const { SharpImageProcessor } = await import('./media/sharp-image-processor.js');
const { createTryOnProviderChain } = await import('./ai/index.js');
const { createLlmProvider } = await import('./stylist/index.js');
const { UnavailableLlmProvider } = await import('./stylist/llm/stylist-llm.provider.js');

/**
 * Fabrikaların okuduğu alanlar. Tam `Env` şeması onlarca alan taşıyor ve
 * hiçbiri bu kararlara girmiyor; tür dönüşümü bilinçli ve testle sınırlı.
 */
const ANAHTARSIZ = {
  NODE_ENV: 'test',

  IYZICO_BASE_URL: 'https://sandbox-api.iyzipay.com',
  IYZICO_API_KEY: '',
  IYZICO_SECRET_KEY: '',
  IYZICO_WEBHOOK_SECRET: '',

  R2_ENDPOINT: '',
  R2_ACCESS_KEY_ID: '',
  R2_SECRET_ACCESS_KEY: '',
  R2_BUCKET_PUBLIC: 'vt-public-products',
  R2_BUCKET_PRIVATE: 'vt-private-user-photos',
  R2_PUBLIC_URL: '',

  FAL_KEY: '',
  FAL_TRYON_MODEL: 'fal-ai/idm-vton',
  GOOGLE_AI_API_KEY: '',
  GOOGLE_AI_IMAGE_MODEL: 'gemini-2.5-flash-image',

  ANTHROPIC_API_KEY: '',
  ANTHROPIC_MODEL: 'claude-sonnet-5',
} as const;

/** ⚠️ Sahte de olsa "anahtar gibi görünen" değerler: log sızıntısı testi bunları arıyor. */
const GIZLI = {
  iyzicoApi: 'iyz-api-GIZLI-1',
  iyzicoSecret: 'iyz-secret-GIZLI-2',
  iyzicoWebhook: 'iyz-webhook-GIZLI-3',
  r2Access: 'r2-access-GIZLI-4',
  r2Secret: 'r2-secret-GIZLI-5',
  fal: 'fal-GIZLI-6',
  google: 'google-GIZLI-7',
  anthropic: 'sk-ant-GIZLI-8',
} as const;

const env = (overrides: Partial<Record<keyof typeof ANAHTARSIZ, string>> = {}): Env =>
  ({ ...ANAHTARSIZ, ...overrides }) as unknown as Env;

const ODEMELI = {
  IYZICO_API_KEY: GIZLI.iyzicoApi,
  IYZICO_SECRET_KEY: GIZLI.iyzicoSecret,
  IYZICO_WEBHOOK_SECRET: GIZLI.iyzicoWebhook,
};

const DEPOLU = {
  R2_ENDPOINT: 'https://acc.r2.cloudflarestorage.com',
  R2_ACCESS_KEY_ID: GIZLI.r2Access,
  R2_SECRET_ACCESS_KEY: GIZLI.r2Secret,
  R2_PUBLIC_URL: 'https://cdn.example.com',
};

beforeEach(() => {
  currentEnv = env();
  // Depolama sağlayıcısı süreç başına tek örnek olarak önbelleklenir; testler
  // arası sızarsa "anahtar yokken yer tutucu" iddiası bir önceki testin
  // örneğiyle çürütülür.
  resetR2Storage();
  resetProviderWiringLog();
});

// ── Ödeme ──────────────────────────────────────────────────────────────────

describe('ödeme sağlayıcısı fabrikası', () => {
  it('anahtar yoksa fail-closed yer tutucu döner', () => {
    expect(createPaymentProvider(env())).toBeInstanceOf(UnconfiguredPaymentProvider);
  });

  it('yalnızca API anahtarı varsa yine yer tutucu döner — ikisi de gerekir', () => {
    expect(createPaymentProvider(env({ IYZICO_API_KEY: GIZLI.iyzicoApi }))).toBeInstanceOf(
      UnconfiguredPaymentProvider,
    );
    expect(createPaymentProvider(env({ IYZICO_SECRET_KEY: GIZLI.iyzicoSecret }))).toBeInstanceOf(
      UnconfiguredPaymentProvider,
    );
  });

  it('anahtarlar varsa gerçek iyzico sağlayıcısı döner', () => {
    expect(createPaymentProvider(env(ODEMELI)).name).toBe('iyzico');
  });

  it('parametre verilmezse env() üzerinden seçim yapar', () => {
    currentEnv = env(ODEMELI);
    expect(createPaymentProvider().name).toBe('iyzico');
  });

  /**
   * ⚠️ Yer tutucu SESSİZCE BAŞARILI DÖNMEZ. Bu, ödemede yapılabilecek en
   *    tehlikeli hatadır: tahsil edilmemiş sipariş kargoya verilir.
   */
  it('yer tutucu her çağrıda görünür hata verir', async () => {
    const provider = createPaymentProvider(env());
    await expect(provider.inquire('conv-1')).rejects.toThrow();
  });
});

// ── Depolama ───────────────────────────────────────────────────────────────

describe('depolama sağlayıcısı fabrikası', () => {
  it('anahtar yoksa fail-closed yer tutucu döner', () => {
    expect(createStorageProvider(env())).toBeInstanceOf(UnconfiguredStorageProvider);
  });

  it('üç anahtardan biri eksikse yer tutucu döner', () => {
    const eksikler = [
      { ...DEPOLU, R2_ENDPOINT: '' },
      { ...DEPOLU, R2_ACCESS_KEY_ID: '' },
      { ...DEPOLU, R2_SECRET_ACCESS_KEY: '' },
    ];

    for (const eksik of eksikler) {
      resetR2Storage();
      expect(createStorageProvider(env(eksik))).toBeInstanceOf(UnconfiguredStorageProvider);
    }
  });

  it('anahtarlar varsa gerçek R2 sağlayıcısı döner', () => {
    const provider = createStorageProvider(env(DEPOLU));

    expect(provider).not.toBeInstanceOf(UnconfiguredStorageProvider);
    expect(provider.name).toBe('r2');
  });

  /** ⚠️ Tek `S3Client`: bağlantı havuzu ve devre kesici bölünmemeli. */
  it('yapılandırılmış depo süreç başına tek örnektir', () => {
    expect(createStorageProvider(env(DEPOLU))).toBe(createStorageProvider(env(DEPOLU)));
  });
});

// ── Görsel işleme ──────────────────────────────────────────────────────────

describe('görsel işleyici fabrikası', () => {
  /**
   * ⚠️ Bu KOŞULSUZDUR ve öyle kalmalıdır. EXIF/GPS temizliği bu işleyicide
   *    yapılıyor; bir ortam değişkenine bağlansaydı, unutulan tek bir anahtar
   *    kullanıcının ev konumunu taşıyan fotoğrafı depoya sokabilirdi.
   */
  it('anahtarsız ortamda bile gerçek sharp işleyicisini döner', () => {
    expect(createImageProcessor()).toBeInstanceOf(SharpImageProcessor);
    expect(createImageProcessor().name).toBe('sharp');
  });
});

// ── Sanal deneme ───────────────────────────────────────────────────────────

describe('sanal deneme sağlayıcı zinciri', () => {
  it('anahtar yoksa tek elemanlı fail-closed zincir döner', () => {
    const chain = createTryOnProviderChain(env());

    expect(chain).toHaveLength(1);
    expect(chain[0]).toBeInstanceOf(UnconfiguredTryOnProvider);
  });

  it('yalnızca FAL_KEY varsa zincir tek sağlayıcıdan oluşur', () => {
    const chain = createTryOnProviderChain(env({ FAL_KEY: GIZLI.fal }));

    expect(chain.map((provider) => provider.name)).toEqual(['fal']);
  });

  it('yalnızca GOOGLE_AI_API_KEY varsa gemini birincil olur', () => {
    const chain = createTryOnProviderChain(env({ GOOGLE_AI_API_KEY: GIZLI.google }));

    expect(chain.map((provider) => provider.name)).toEqual(['gemini']);
  });

  /** ⚠️ Sıra önemli: fal birincil, gemini yedek (bkz. tryon.factory.ts). */
  it('ikisi de varsa zincir fal → gemini sırasındadır', () => {
    const chain = createTryOnProviderChain(
      env({ FAL_KEY: GIZLI.fal, GOOGLE_AI_API_KEY: GIZLI.google }),
    );

    expect(chain.map((provider) => provider.name)).toEqual(['fal', 'gemini']);
  });

  /**
   * ⚠️ Yapılandırılmamış sağlayıcı BAŞARISIZ SONUÇ değil HATA üretir: başarısız
   *    sonuç "denendi ve olmadı" demektir ve kesinti sanılıp kullanıcı kotası
   *    harcanmış gibi işlenebilir.
   */
  it('yapılandırılmamış zincir çağrıldığında hata verir', async () => {
    const [provider] = createTryOnProviderChain(env());

    await expect(provider?.generate({} as never)).rejects.toThrow();
  });
});

// ── Stil danışmanı ─────────────────────────────────────────────────────────

describe('stil danışmanı LLM fabrikası', () => {
  it('anahtar yoksa kullanılamaz sağlayıcı döner', () => {
    const provider = createLlmProvider(env());

    expect(provider).toBeInstanceOf(UnavailableLlmProvider);
    expect(provider.isConfigured).toBe(false);
  });

  it('ANTHROPIC_API_KEY varsa gerçek sağlayıcı döner', () => {
    const provider = createLlmProvider(env({ ANTHROPIC_API_KEY: GIZLI.anthropic }));

    expect(provider.isConfigured).toBe(true);
    expect(provider.name).toBe('anthropic');
    expect(provider.model).toBe('claude-sonnet-5');
  });
});

// ── Açılış raporu ──────────────────────────────────────────────────────────

describe('açılış sağlayıcı raporu', () => {
  const makeLogger = (): {
    info: ReturnType<typeof vi.fn>;
  } => ({ info: vi.fn() });

  it('yapılandırılmış ve yer tutucu yetenekleri ayırır', () => {
    const wiring = providerWiring(env({ ...ODEMELI, FAL_KEY: GIZLI.fal }));
    const byCapability = new Map(wiring.map((status) => [status.capability, status]));

    expect(byCapability.get('payment')?.implementation).toBe('iyzico');
    expect(byCapability.get('storage')?.configured).toBe(false);
    expect(byCapability.get('image-processing')?.configured).toBe(true);
    expect(byCapability.get('tryon')?.implementation).toBe('fal');
    expect(byCapability.get('stylist-llm')?.implementation).toBe('unconfigured');
  });

  it('iki sağlayıcı yapılandırıldığında zinciri gösterir', () => {
    const wiring = providerWiring(env({ FAL_KEY: GIZLI.fal, GOOGLE_AI_API_KEY: GIZLI.google }));

    expect(wiring.find((status) => status.capability === 'tryon')?.implementation).toBe(
      'fal→gemini',
    );
  });

  it('yalnızca BİR KEZ loglar — dört modül de çağırsa bile', () => {
    const logger = makeLogger();

    logProviderWiring(logger, env());
    logProviderWiring(logger, env());
    logProviderWiring(logger, env());

    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  /**
   * ⚠️ ANAHTAR DEĞERİ LOG'A YAZILMAZ. Bir kez log'a düşen sır, log toplama
   *    sistemine ve oradan yedeklere yayılır; geri alınamaz. Rapor yalnızca
   *    değişken ADINI ve "yapılandırıldı / yapılandırılmadı" durumunu taşır.
   */
  it('anahtar değerlerini log’a yazmaz, yalnızca adlarını', () => {
    const logger = makeLogger();
    const dolu = env({
      ...ODEMELI,
      ...DEPOLU,
      FAL_KEY: GIZLI.fal,
      GOOGLE_AI_API_KEY: GIZLI.google,
      ANTHROPIC_API_KEY: GIZLI.anthropic,
    });

    logProviderWiring(logger, dolu);

    const [payload, message] = logger.info.mock.calls[0] as [Record<string, unknown>, string];
    const serialized = JSON.stringify(payload);

    for (const secret of Object.values(GIZLI)) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain('IYZICO_API_KEY');
    expect(serialized).toContain('yapılandırıldı');
    expect(message).toBe('Sağlayıcı bağlamaları');
  });

  it('yapılandırılmamış yetenekleri ayrıca listeler', () => {
    const logger = makeLogger();

    logProviderWiring(logger, env(ODEMELI));

    const [payload] = logger.info.mock.calls[0] as [{ unconfigured: string[] }];
    expect(payload.unconfigured).toEqual(['storage', 'tryon', 'stylist-llm']);
  });
});

// ── Kablolama duman testi ──────────────────────────────────────────────────

/**
 * ⚠️ Yanlış bağlanmış bir provider yalnızca uygulama AÇILIRKEN patlar; yukarıdaki
 *    testler fabrikaları doğrudan çağırdığı için `inject` dizisindeki bir hatayı
 *    (ör. APP_LOGGER'ın eksik kalması) göremezler. Burada modül gerçek tanımıyla
 *    ayağa kaldırılıyor; ölçülen tek şey KABLOLAMA.
 */
const fakePrisma = {} as PrismaService;
const fakeLogger = {
  info: (): void => undefined,
  warn: (): void => undefined,
  error: (): void => undefined,
  debug: (): void => undefined,
};

/** Gerçekte InfraModule @Global; testte aynı rolü bu sahte üstleniyor. */
@Global()
@Module({
  providers: [
    { provide: PrismaService, useValue: fakePrisma },
    { provide: APP_LOGGER, useValue: fakeLogger },
  ],
  exports: [PrismaService, APP_LOGGER],
})
class FakeInfraModule {}

describe('MediaModule kablolaması', () => {
  it('anahtarsız ortamda derlenir: depo yer tutucu, işleyici gerçek', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FakeInfraModule, MediaModule],
    }).compile();

    expect(moduleRef.get(MEDIA_STORAGE)).toBeInstanceOf(UnconfiguredStorageProvider);
    expect(moduleRef.get(MEDIA_IMAGE_PROCESSOR)).toBeInstanceOf(SharpImageProcessor);

    await moduleRef.close();
  });

  it('anahtarlar geldiğinde KOD DEĞİŞMEDEN gerçek depoya bağlanır', async () => {
    currentEnv = env(DEPOLU);

    const moduleRef = await Test.createTestingModule({
      imports: [FakeInfraModule, MediaModule],
    }).compile();

    expect(moduleRef.get<{ name: string }>(MEDIA_STORAGE).name).toBe('r2');

    await moduleRef.close();
  });
});
