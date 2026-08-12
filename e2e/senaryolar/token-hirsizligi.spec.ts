/**
 * SENARYO 2 — REFRESH ROTASYONU VE TOKEN HIRSIZLIĞI
 *
 * Sorulan soru: eski (rotasyonla iptal edilmiş) bir refresh token tekrar
 * kullanıldığında, kullanıcının TÜM oturumları gerçekten düşüyor mu?
 *
 * Bu davranış birim testinde de var (auth.test.ts) ama orada `TokenService`
 * doğrudan çağrılıyor. HTTP üzerinden ise araya çerez yolu (`path=/v1/auth`),
 * çerez adı, `clearCookie` çağrısı ve guard'ın oturum kontrolü giriyor.
 * Zincirin herhangi bir halkası kopsa birim testi yeşil kalır, sistem açık olur.
 *
 * ⚠️ Playwright'ın çerez kavanozuna GÜVENİLMİYOR: kavanoz eski değeri
 *    yenisiyle değiştirir, dolayısıyla "eskiyi tekrar gönder" senaryosu
 *    kavanozla yazılamaz. Değerler Set-Cookie'den elle yakalanıp elle geri
 *    gönderiliyor — saldırganın yapacağı şey de tam olarak budur.
 */
import { basariBekle, hataBekle } from '../destek/istemci.js';
import { girisYap, musteriOlustur } from '../destek/kurulum.js';
import { expect, test } from '../destek/test.js';
import { hizLimitiSifirla } from '../destek/veritabani.js';

const REFRESH_CEREZI = 'vt_rt';

test.describe('Refresh rotasyonu ve token hırsızlığı tespiti', () => {
  test('rotasyon eski token’ı iptal eder, tekrar kullanım TÜM oturumları düşürür', async ({
    api,
    ikinciApi,
    defter,
  }) => {
    const kullanici = await musteriOlustur(api, defter);

    // ── İKİNCİ CİHAZ ──────────────────────────────────────────────────────
    // Ayrı bir APIRequestContext = ayrı çerez kavanozu = gerçekten ayrı cihaz.
    // Aynı bağlam kullanılsaydı ikinci giriş birincinin çerezini ezerdi ve
    // "tüm oturumlar düştü mü" sorusu sorulamazdı.
    await hizLimitiSifirla('login');
    await girisYap(ikinciApi, kullanici);
    const ikinciCihazTokeni = ikinciApi.token;

    const oturumlar = await api.get('/v1/auth/sessions');
    basariBekle(oturumlar, 200);
    expect(oturumlar.veri<unknown[]>(), 'İki ayrı cihaz iki ayrı oturum üretmeli').toHaveLength(2);

    // ── 1. Rotasyon: refresh çağrısı yeni bir token seti üretir ──────────
    const ilkGiris = await api.post('/v1/auth/login', {
      govde: { identifier: kullanici.eposta, password: kullanici.sifre },
    });
    basariBekle(ilkGiris, 200);

    const eskiRefresh = ilkGiris.cerez(REFRESH_CEREZI);
    expect(eskiRefresh, 'Girişten sonra refresh çerezi gelmeli').not.toBeNull();

    const yenileme = await api.post('/v1/auth/refresh', {
      basliklar: { Cookie: `${REFRESH_CEREZI}=${eskiRefresh ?? ''}` },
    });
    basariBekle(yenileme, 200);

    const yeniRefresh = yenileme.cerez(REFRESH_CEREZI);
    expect(yeniRefresh, 'Yenileme yeni bir refresh token vermeli').not.toBeNull();
    expect(
      yeniRefresh,
      '⚠️ ROTASYON YOK: aynı refresh token geri döndü. Çalınan token süresiz kullanılabilir.',
    ).not.toBe(eskiRefresh);

    // Yeni token çalışmalı — rotasyonun meşru tarafı kırılmamış olmalı.
    const yeniTokenGecerli = await api.post('/v1/auth/refresh', {
      basliklar: { Cookie: `${REFRESH_CEREZI}=${yeniRefresh ?? ''}` },
    });
    basariBekle(yeniTokenGecerli, 200);
    const ucuncuRefresh = yeniTokenGecerli.cerez(REFRESH_CEREZI);

    // ── 2. HIRSIZLIK: ESKİ token tekrar gönderiliyor ─────────────────────
    // Meşru istemci çoktan yenisine geçmişti. Bu isteği yapan taraf token'ı
    // çalmış demektir. Hangisinin saldırgan olduğu bilinemez → hepsi düşer.
    const hirsizlik = await api.post('/v1/auth/refresh', {
      basliklar: { Cookie: `${REFRESH_CEREZI}=${eskiRefresh ?? ''}` },
    });

    hataBekle(hirsizlik, 'AUTH_REFRESH_REUSED', 401);

    expect(
      hirsizlik.basliklar['set-cookie'] ?? '',
      'Hırsızlık tespitinde çerez temizlenmeli — istemci döngüye girmesin',
    ).toContain(`${REFRESH_CEREZI}=`);

    // ── 3. ASIL İDDİA: BÜTÜN oturumlar düştü mü ─────────────────────────
    // İkinci cihaz hırsızlıktan haberdar değildi ama onun da düşmesi gerekir:
    // saldırganın hangi oturumu ele geçirdiği bilinmiyor.
    ikinciApi.token = ikinciCihazTokeni;
    const ikinciCihaz = await ikinciApi.get('/v1/auth/me');
    hataBekle(ikinciCihaz, 'AUTH_TOKEN_INVALID', 401);

    // Hırsızlık anında GEÇERLİ olan en yeni refresh token da ölmüş olmalı;
    // yalnızca eskisini iptal etmek saldırganın elindekini korurdu.
    const enYeniTokenlaDene = await api.post('/v1/auth/refresh', {
      basliklar: { Cookie: `${REFRESH_CEREZI}=${ucuncuRefresh ?? ''}` },
    });
    expect(
      enYeniTokenlaDene.basarili,
      '⚠️ Hırsızlık sonrası en güncel refresh token hâlâ çalışıyor — oturumların tamamı düşmemiş',
    ).toBe(false);
    expect(enYeniTokenlaDene.durum).toBe(401);

    // ── 4. Kurtarma: kullanıcı yeniden giriş yapabilmeli ────────────────
    // Hesabın kalıcı olarak kilitlenmesi doğru davranış olmazdı.
    await hizLimitiSifirla('login');
    const kurtarma = await api.post('/v1/auth/login', {
      govde: { identifier: kullanici.eposta, password: kullanici.sifre },
    });
    basariBekle(kurtarma, 200);
  });

  test('çerezsiz refresh isteği AUTH_TOKEN_MISSING döner', async ({ api }) => {
    const yanit = await api.post('/v1/auth/refresh');
    hataBekle(yanit, 'AUTH_TOKEN_MISSING', 401);
  });

  test('uydurma refresh token AUTH_TOKEN_INVALID döner ve iç detay sızdırmaz', async ({ api }) => {
    const yanit = await api.post('/v1/auth/refresh', {
      basliklar: { Cookie: `${REFRESH_CEREZI}=uydurma-token-degeri-123456789` },
    });

    hataBekle(yanit, 'AUTH_TOKEN_INVALID', 401);

    const govde = JSON.stringify(yanit.govde);
    expect(govde, 'Hata gövdesinde token özeti/iç mesaj olmamalı').not.toContain('özet');
    expect(govde, 'Yığın izi sızmamalı').not.toContain('at ');
  });

  test('şifre değişikliği diğer oturumları düşürür', async ({ api, ikinciApi, defter }) => {
    // Aynı savunma mekanizmasının ikinci kullanım yeri: şifre değiştiren
    // kullanıcı, hesabını ele geçirmiş olabilecek tarafı da atmış olmalı.
    const kullanici = await musteriOlustur(api, defter);

    await hizLimitiSifirla('login');
    await girisYap(ikinciApi, kullanici);
    const digerCihazTokeni = ikinciApi.token;

    const degistir = await api.post('/v1/auth/password/change', {
      govde: { currentPassword: kullanici.sifre, newPassword: 'YepyeniSifre2026x' },
    });
    basariBekle(degistir, 200);

    const sonuc = degistir.veri<{ revokedSessions: number }>();
    expect(
      sonuc.revokedSessions,
      'Şifre değişikliğinde en az bir diğer oturum kapatılmalı',
    ).toBeGreaterThanOrEqual(1);

    ikinciApi.token = digerCihazTokeni;
    const digerCihaz = await ikinciApi.get('/v1/auth/me');
    hataBekle(digerCihaz, 'AUTH_TOKEN_INVALID', 401);
  });
});
