/**
 * SENARYO 10 — HATA ZARFI TEK BİÇİM Mİ, İÇ DETAY SIZIYOR MU
 *
 * İki soru:
 *   a) 404 / 401 / 403 / 409 / 422 / 429 — hepsi AYNI zarfta mı?
 *   b) Yığın izi, SQL, dosya yolu, sağlayıcı kodu veya ortam değeri sızıyor mu?
 *
 * Zarf tek bir yerde üretiliyor (GlobalExceptionFilter) ama zarfa GİRMEYEN
 * hatalar da var: NestJS'in kendi 404'ü, gövde ayrıştırma hataları, guard'ların
 * fırlattığı HttpException'lar. Bu senaryo zarfın gerçekten İSTİSNASIZ
 * olduğunu, farklı katmanlardan hata üreterek sınıyor.
 *
 * ⚠️ Bu dosya hız limitini BİLEREK tetikliyor ve kendi temizliğini yapıyor;
 *    aksi hâlde sonraki senaryolar 429'a takılırdı.
 */
import { randomUUID } from 'node:crypto';
import { basariBekle, hataBekle, type Yanit } from '../destek/istemci.js';
import { benzersiz, musteriOlustur } from '../destek/kurulum.js';
import { expect, test } from '../destek/test.js';
import { hizLimitiSifirla } from '../destek/veritabani.js';

/** Zarfta bulunması ZORUNLU alanlar. */
const ZORUNLU_ALANLAR = ['code', 'message', 'httpStatus', 'retryable', 'requestId'] as const;

/** Yanıt gövdesinde ASLA görünmemesi gereken izler. */
const SIZINTI_DESENLERI: Array<{ ad: string; desen: RegExp }> = [
  { ad: 'yığın izi', desen: /\n\s+at\s+[\w$.<>]+\s*\(/ },
  { ad: 'kaynak dosya yolu', desen: /\/(?:apps|packages|node_modules)\/[\w-]+\/(?:src|dist)\// },
  {
    ad: 'SQL parçası',
    desen: /\b(?:SELECT|INSERT INTO|UPDATE\s+\w+\s+SET|FROM\s+"?\w+"?\s+WHERE)\b/i,
  },
  { ad: 'Prisma hata kodu', desen: /\bP\d{4}\b/ },
  { ad: 'Prisma iç adı', desen: /PrismaClient|prisma\.\w+\.\w+/ },
  {
    ad: 'Postgres tablo adı',
    desen: /\b(?:user_users|order_orders|finance_ledger_entries|catalog_products)\b/,
  },
  { ad: 'sağlayıcı adı', desen: /\biyzico|iyzipay\b/i },
  { ad: 'JWT sırrı / bağlantı dizesi', desen: /postgres(?:ql)?:\/\/|redis:\/\/|JWT_[A-Z_]*SECRET/ },
  { ad: 'Node hata kodu', desen: /\bE(?:CONNREFUSED|CONNRESET|NOTFOUND|TIMEDOUT)\b/ },
];

function zarfiDogrula(yanit: Yanit): void {
  expect(
    typeof yanit.govde,
    `${yanit.yol} → gövde JSON nesnesi olmalı, gelen: ${yanit.ozet()}`,
  ).toBe('object');

  const govde = yanit.govde as Record<string, unknown> | null;
  expect(govde, `${yanit.yol} → gövde null olmamalı`).not.toBeNull();
  if (govde === null) return;

  // ⚠️ Hata gövdesi { error: {...} } DIŞINDA bir şey içermemeli. `message`
  //    veya `statusCode` gibi kök alanlar, Nest'in ham yanıtının zarfı
  //    atlattığının işaretidir.
  expect(
    Object.keys(govde),
    `${yanit.yol} → hata gövdesinde yalnızca "error" olmalı: ${yanit.ozet()}`,
  ).toEqual(['error']);

  const hata = govde['error'] as Record<string, unknown>;
  for (const alan of ZORUNLU_ALANLAR) {
    expect(hata[alan], `${yanit.yol} → zarfta "${alan}" eksik`).toBeDefined();
  }

  expect(hata['httpStatus'], `${yanit.yol} → gövdedeki durum HTTP durumuyla aynı olmalı`).toBe(
    yanit.durum,
  );
  expect(typeof hata['code']).toBe('string');
  expect(typeof hata['message']).toBe('string');
  expect(typeof hata['retryable']).toBe('boolean');
  expect(typeof hata['requestId']).toBe('string');

  // Kullanıcıya gösterilecek mesaj doldurulmamış yer tutucu içermemeli.
  expect(
    hata['message'] as string,
    `${yanit.yol} → mesajda doldurulmamış yer tutucu var: ${String(hata['message'])}`,
  ).not.toMatch(/\{[a-zA-Z]\w*\}/);
}

function sizintiAra(yanit: Yanit): void {
  const metin = typeof yanit.govde === 'string' ? yanit.govde : JSON.stringify(yanit.govde);

  for (const { ad, desen } of SIZINTI_DESENLERI) {
    expect(
      desen.test(metin),
      `⚠️ ${yanit.yol} yanıtında ${ad} sızıntısı var: ${metin.slice(0, 400)}`,
    ).toBe(false);
  }
}

test.describe('Hata zarfı tutarlılığı', () => {
  test('404 / 401 / 403 / 409 / 422 aynı zarf biçiminde döner', async ({
    api,
    ikinciApi,
    defter,
  }) => {
    const kullanici = await musteriOlustur(api, defter);

    interface Ornek {
      ad: string;
      durum: number;
      kod: string;
      calistir: () => Promise<Yanit>;
    }

    const ornekler: Ornek[] = [
      {
        ad: '404 — var olmayan ürün (domain hatası)',
        durum: 404,
        kod: 'PRODUCT_NOT_FOUND',
        calistir: () => api.get(`/v1/products/${benzersiz('yok')}`),
      },
      {
        ad: '404 — hiç tanımlanmamış yol (Nest kaynaklı)',
        durum: 404,
        kod: 'NOT_FOUND',
        calistir: () => api.get('/v1/boyle-bir-uc-yok'),
      },
      {
        ad: '404 — var olmayan sipariş',
        durum: 404,
        kod: 'ORDER_NOT_FOUND',
        calistir: () => api.get('/v1/orders/VT-260101-9999'),
      },
      {
        ad: '401 — token yok (guard kaynaklı)',
        durum: 401,
        kod: 'AUTH_TOKEN_MISSING',
        calistir: () => ikinciApi.get('/v1/auth/me'),
      },
      {
        ad: '403 — rol yetersiz (RolesGuard kaynaklı)',
        durum: 403,
        kod: 'AUTH_FORBIDDEN',
        calistir: () => api.get('/v1/admin/sellers'),
      },
      {
        ad: '400 — şema doğrulaması (Zod kaynaklı)',
        durum: 400,
        kod: 'VALIDATION_FAILED',
        calistir: () => api.post('/v1/cart/items', { govde: { variantId: 'uuid-degil' } }),
      },
      {
        ad: '422 — iş kuralı (boş sepetle checkout)',
        durum: 422,
        kod: 'CART_EMPTY',
        calistir: () =>
          api.post('/v1/checkout/init', {
            govde: {
              shipping: {
                address: {
                  title: 'Ev',
                  firstName: 'Test',
                  lastName: 'Kullanici',
                  phone: '+905321112233',
                  city: 'İstanbul',
                  district: 'Kadıköy',
                  line1: 'E2E Mahallesi Test Sokak No 1',
                },
              },
              email: `zarf-${randomUUID().slice(0, 8)}@e2e.test`,
            },
            idempotencyKey: randomUUID(),
          }),
      },
      {
        ad: '409 — çakışma (aynı e-posta ile ikinci kayıt)',
        durum: 409,
        kod: 'AUTH_EMAIL_TAKEN',
        calistir: async () => {
          await hizLimitiSifirla('register');
          return ikinciApi.post('/v1/auth/register', {
            govde: {
              email: kullanici.eposta,
              password: 'PLACEHOLDER-NOT-A-SECRET-PW3',
              firstName: 'Baska',
              lastName: 'Kisi',
              acceptedTerms: true,
            },
          });
        },
      },
    ];

    ikinciApi.kimlikSil();

    for (const ornek of ornekler) {
      const yanit = await ornek.calistir();

      expect(yanit.durum, `${ornek.ad} → beklenen HTTP durumu`).toBe(ornek.durum);
      expect(yanit.hataKodu, `${ornek.ad} → beklenen hata kodu`).toBe(ornek.kod);

      zarfiDogrula(yanit);
      sizintiAra(yanit);
    }
  });

  test('429 aynı zarfta döner ve Retry-After başlığı taşır', async ({ ikinciApi }) => {
    // ⚠️ Hız limiti guard'dan fırlıyor, denetleyiciden değil. Zarfın oradan da
    //    geçtiğini doğrulamak gerekiyor — guard'lar filtreyi atlarsa istemci
    //    beklenmedik bir gövdeyle karşılaşır.
    await hizLimitiSifirla('register');

    let limitYaniti: Yanit | null = null;

    // Limit: IP başına saatte 3 kayıt. Dördüncüde düşmeli.
    for (let deneme = 0; deneme < 6 && limitYaniti === null; deneme += 1) {
      const yanit = await ikinciApi.post('/v1/auth/register', {
        govde: {
          email: `${benzersiz('limit')}@e2e.test`,
          password: 'PLACEHOLDER-NOT-A-SECRET-PW4',
          firstName: 'Limit',
          lastName: 'Testi',
          acceptedTerms: true,
        },
      });

      if (yanit.durum === 429) limitYaniti = yanit;
      else if (yanit.basarili) {
        // Oluşan kullanıcıları temizleyebilmek için kaydediyoruz; bu test
        // `defter` fixture'ını kullanmıyor (limit sayacını paylaşmamak için),
        // bu yüzden silme aşağıda elle yapılıyor.
        olusanKullanicilar.push(yanit.veri<{ user: { id: string } }>().user.id);
      }
    }

    try {
      expect(
        limitYaniti,
        '⚠️ Kayıt hız limiti hiç devreye girmedi — 6 art arda kayıt kabul edildi',
      ).not.toBeNull();
      if (limitYaniti === null) return;

      zarfiDogrula(limitYaniti);
      sizintiAra(limitYaniti);

      const hata = limitYaniti.hata;
      expect(hata.code, '429 için katalog kodu RATE_LIMITED olmalı').toBe('RATE_LIMITED');
      expect(hata.retryable, 'Hız limiti tekrar denenebilir olmalı').toBe(true);
      expect(
        hata.retryAfterSeconds,
        'İstemcinin ne kadar bekleyeceği gövdede olmalı',
      ).toBeGreaterThan(0);

      // ⚠️ Başlık da zorunlu: standart istemciler gövdeyi değil `Retry-After`
      //    başlığını okur.
      expect(
        limitYaniti.basliklar['retry-after'],
        'Retry-After başlığı gönderilmeli',
      ).toBeDefined();
      expect(
        Number(limitYaniti.basliklar['retry-after']),
        'Retry-After sayısal olmalı',
      ).toBeGreaterThan(0);

      expect(
        hata.message,
        'Mesajdaki bekleme süresi yer tutucusu doldurulmuş olmalı',
      ).not.toContain('{retryAfter}');
    } finally {
      // Sayaç mutlaka sıfırlanmalı, aksi hâlde sonraki senaryolar 429 alır.
      await hizLimitiSifirla('register');
      await kullanicilariSil();
    }
  });

  test('bozuk JSON gövdesi zarfa dönüşür ve iç detay sızdırmaz', async ({ ikinciApi }) => {
    // ⚠️ ZARFIN EN ZAYIF NOKTASI. Gövde ayrıştırma hatası Express'in
    //    body-parser ARA KATMANINDAN gelir; Nest'in exception filter'ı ise
    //    route seviyesinde çalışır. Ara katmanda fırlayan hata filtreye hiç
    //    uğramadan Express'in varsayılan hata işleyicisine düşerse yanıt HTML
    //    olur ve geliştirme modunda YIĞIN İZİ içerir.
    //
    //    Bu test kırmızı yanarsa çözüm, hatayı yakalayıp katalog zarfına
    //    çeviren bir ara katman eklemektir (`main.ts`, cookieParser'dan sonra).
    const yanit = await ikinciApi.post('/v1/auth/login', {
      govde: '{"identifier": "bozuk", ',
      basliklar: { 'Content-Type': 'application/json' },
    });

    expect(yanit.durum, 'Bozuk gövde 4xx dönmeli').toBeGreaterThanOrEqual(400);
    expect(yanit.durum, 'Bozuk gövde 5xx OLMAMALI').toBeLessThan(500);

    expect(
      typeof yanit.govde === 'object' && yanit.govde !== null,
      `⚠️ Bozuk JSON yanıtı JSON zarfı değil: ${yanit.ozet()} — ` +
        'gövde ayrıştırma hatası GlobalExceptionFilter’a uğramıyor olabilir.',
    ).toBe(true);

    zarfiDogrula(yanit);
    sizintiAra(yanit);
  });

  test('doğrulama hatası ALAN ADI verir ama DEĞER sızdırmaz', async ({ api, defter }) => {
    await musteriOlustur(api, defter);

    const gizliDeger = 'gizli-sifre-degeri-123456';
    const yanit = await api.post('/v1/auth/password/change', {
      govde: { currentPassword: gizliDeger, newPassword: 'kisa' },
    });

    hataBekle(yanit, 'VALIDATION_FAILED', 400);
    zarfiDogrula(yanit);

    const detay = yanit.hata.details as { fields?: Array<{ path: string }> } | undefined;
    expect(
      detay?.fields?.map((alan) => alan.path),
      'Hangi alanın hatalı olduğu bildirilmeli',
    ).toContain('newPassword');

    // ⚠️ Alan ADLARI güvenli, DEĞERLER değil. Girilen şifre hata gövdesine
    //    yazılırsa erişim loglarına ve hata izleme sistemine düz metin gider.
    expect(
      JSON.stringify(yanit.govde),
      '⚠️ Gönderilen şifre değeri hata yanıtında görünüyor',
    ).not.toContain(gizliDeger);
  });

  test('başarılı yanıtlar da tek zarfta döner', async ({ api }) => {
    // Zarfın yalnızca hata tarafını doğrulamak yeterli değil: istemci başarı
    // ve hata için tek bir okuma stratejisi kullanıyor.
    const ornekler = ['/v1/categories', '/v1/products', '/v1/cart'];

    api.kimlikSil();
    api.oturumKimligi = randomUUID();

    for (const yol of ornekler) {
      const yanit = await api.get(yol);
      basariBekle(yanit, 200);

      const govde = yanit.govde as Record<string, unknown>;
      expect(
        Object.keys(govde).sort(),
        `${yol} → başarı zarfı yalnızca data ve meta içermeli`,
      ).toEqual(['data', 'meta']);

      const meta = govde['meta'] as Record<string, unknown>;
      expect(typeof meta['requestId'], `${yol} → meta.requestId zorunlu`).toBe('string');
    }
  });

  test('sağlık ucu zarfsız ve public olmalı', async ({ ikinciApi }) => {
    // ⚠️ /health BİLEREK global önekin (v1) DIŞINDA: yük dengeleyici ve
    //    orkestratör sabit bir yol bekler, API sürümü değişince bozulmamalı.
    ikinciApi.kimlikSil();

    const saglik = await ikinciApi.get('/health');
    expect(saglik.durum, 'Sağlık ucu kimliksiz 200 dönmeli').toBe(200);

    const derin = await ikinciApi.get('/health/deep');
    expect([200, 503], `Derin sağlık kontrolü 200 veya 503 dönmeli: ${derin.ozet()}`).toContain(
      derin.durum,
    );

    if (derin.durum === 503) sizintiAra(derin);
  });
});

// ── 429 testinin elle temizliği ────────────────────────────────────────────
// Bu test `defter` fixture'ını kullanmıyor: fixture her testte hız limitini
// etkileyen kurulum çağrıları yapıyor ve limitin kendisini ölçmek isteyen bir
// testte bu kabul edilemez. Bu yüzden kayıt listesi burada tutuluyor.
const olusanKullanicilar: string[] = [];

async function kullanicilariSil(): Promise<void> {
  if (olusanKullanicilar.length === 0) return;
  const { db } = await import('../destek/veritabani.js');
  await db().user.deleteMany({ where: { id: { in: olusanKullanicilar } } });
  olusanKullanicilar.length = 0;
}
