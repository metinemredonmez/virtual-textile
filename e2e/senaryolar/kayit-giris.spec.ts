/**
 * SENARYO 1 — KAYIT → /me → ÇIKIŞ → GİRİŞ → OTURUM LİSTESİ
 *
 * Modül testleri `AuthService`i doğrudan çağırıyor; bu senaryo aradaki
 * KATMANLARI sınıyor: guard, zarf interceptor, çerez ayarları ve oturumun
 * HTTP üzerinden gerçekten kapanıp kapanmadığı.
 *
 * En kritik iddia: çıkıştan sonra ELDEKİ access token'ın çalışmaması.
 * JWT kendi başına iptal edilemez; sunucu bunu oturum durumuna bakarak
 * çözüyor (JwtAuthGuard → isSessionActive). O kontrol bir gün düşerse
 * kullanıcı "çıkış yaptım" der ama token 15 dakika daha geçerli kalır —
 * paylaşılan bir bilgisayarda doğrudan hesap ele geçirmedir.
 */
import { basariBekle, hataBekle } from '../destek/istemci.js';
import { girisYap, musteriOlustur } from '../destek/kurulum.js';
import { expect, test } from '../destek/test.js';
import { hizLimitiSifirla } from '../destek/veritabani.js';

test.describe('Kayıt ve giriş akışı', () => {
  test('kayıt → /me → çıkış → giriş → oturum listesi', async ({ api, defter }) => {
    // ── 1. Kayıt ──────────────────────────────────────────────────────────
    const kullanici = await musteriOlustur(api, defter);

    expect(kullanici.rol, 'Yeni kayıt her zaman CUSTOMER olmalı').toBe('CUSTOMER');

    // ── 2. Kimliğim ───────────────────────────────────────────────────────
    const ben = await api.get('/v1/auth/me');
    basariBekle(ben, 200);

    const benVeri = ben.veri<{
      id: string;
      email: string | null;
      role: string;
      sellerIds: string[];
    }>();

    expect(benVeri.id).toBe(kullanici.id);
    expect(benVeri.email).toBe(kullanici.eposta.toLowerCase());
    expect(benVeri.role).toBe('CUSTOMER');
    expect(benVeri.sellerIds, 'Müşterinin mağazası olmamalı').toEqual([]);

    // ⚠️ Şifre özeti hiçbir biçimde dönmemeli.
    expect(Object.keys(benVeri)).not.toContain('passwordHash');

    // ── 3. Oturum listesi: tek cihaz, "bu cihaz" işaretli ────────────────
    const ilkOturumlar = await api.get('/v1/auth/sessions');
    basariBekle(ilkOturumlar, 200);

    const ilkListe = ilkOturumlar.veri<Array<{ id: string; current: boolean }>>();
    expect(ilkListe, 'Kayıt sonrası tam bir aktif oturum olmalı').toHaveLength(1);
    expect(ilkListe[0]?.current, 'Tek oturum "bu cihaz" olarak işaretlenmeli').toBe(true);

    const ilkOturumId = ilkListe[0]?.id;
    const kayitTokeni = api.token;

    // ── 4. Çıkış ──────────────────────────────────────────────────────────
    const cikis = await api.post('/v1/auth/logout');
    expect(cikis.durum, 'Çıkış 204 dönmeli (gövde yok)').toBe(204);

    // ⚠️ ASIL İDDİA: eldeki token artık işe yaramamalı.
    const cikistanSonra = await api.get('/v1/auth/me');
    hataBekle(cikistanSonra, 'AUTH_TOKEN_INVALID', 401);

    // ── 5. Tekrar giriş ───────────────────────────────────────────────────
    const yeniToken = await girisYap(api, kullanici);
    expect(yeniToken, 'Yeni giriş yeni bir token üretmeli').not.toBe(kayitTokeni);

    const tekrarBen = await api.get('/v1/auth/me');
    basariBekle(tekrarBen, 200);
    expect(tekrarBen.veri<{ id: string }>().id).toBe(kullanici.id);

    // ── 6. Oturum listesi: kapanan oturum GÖRÜNMEMELİ ────────────────────
    const sonOturumlar = await api.get('/v1/auth/sessions');
    basariBekle(sonOturumlar, 200);

    const sonListe = sonOturumlar.veri<Array<{ id: string; current: boolean }>>();
    expect(sonListe, 'Kapatılmış oturum listede kalmamalı').toHaveLength(1);
    expect(
      sonListe.map((oturum) => oturum.id),
      'Çıkış yapılan oturum kimliği hâlâ listede',
    ).not.toContain(ilkOturumId);
    expect(sonListe[0]?.current).toBe(true);
  });

  test('refresh çerezi httpOnly ve yol kısıtlı gelmeli', async ({ api, defter }) => {
    // Refresh token gövdede dönerse XSS ile çalınabilir; çerez ayarları bu
    // yüzden sözleşmenin parçası, "iyi olurdu" değil.
    const kullanici = await musteriOlustur(api, defter);
    await hizLimitiSifirla('login');

    const giris = await api.post('/v1/auth/login', {
      govde: { identifier: kullanici.eposta, password: kullanici.sifre },
    });
    basariBekle(giris, 200);

    const govde = giris.veri<{ tokens: Record<string, unknown> }>();
    expect(
      Object.keys(govde.tokens),
      'Refresh token GÖVDEDE dönmemeli — yalnızca httpOnly çerezde',
    ).not.toContain('refreshToken');

    const hamCerez = giris.basliklar['set-cookie'] ?? '';
    expect(hamCerez, 'Refresh çerezi (vt_rt) ayarlanmalı').toContain('vt_rt=');
    expect(hamCerez, 'Çerez httpOnly olmalı — JavaScript okuyamamalı').toMatch(/httponly/i);
    expect(hamCerez, 'Çerez SameSite=Strict olmalı — CSRF koruması').toMatch(/samesite=strict/i);
    expect(hamCerez, 'Çerez yalnızca /v1/auth altına gitmeli — her isteğe eklenmemeli').toMatch(
      /path=\/v1\/auth/i,
    );
  });

  test('aynı e-posta ile ikinci kayıt reddedilir', async ({ api, ikinciApi, defter }) => {
    const kullanici = await musteriOlustur(api, defter);

    // ⚠️ Reddin sebebi 409 (e-posta kayıtlı) olmalı, 429 (hız limiti) değil.
    await hizLimitiSifirla('register');

    const tekrar = await ikinciApi.post('/v1/auth/register', {
      govde: {
        email: kullanici.eposta,
        password: 'PLACEHOLDER-NOT-A-SECRET-PW3',
        firstName: 'Baska',
        lastName: 'Kisi',
        acceptedTerms: true,
      },
    });

    hataBekle(tekrar, 'AUTH_EMAIL_TAKEN', 409);
  });

  test('kullanım koşulları kabul edilmeden kayıt olunamaz', async ({ ikinciApi }) => {
    // ⚠️ Sayaç sıfırlanmazsa reddin sebebi doğrulama değil hız limiti olur ve
    //    test yanlış nedenle yeşil yanar.
    await hizLimitiSifirla('register');

    const yanit = await ikinciApi.post('/v1/auth/register', {
      govde: {
        email: `kosulsuz-${String(Date.now())}@e2e.test`,
        password: 'PLACEHOLDER-NOT-A-SECRET-PW4',
        firstName: 'Test',
        lastName: 'Kullanici',
        acceptedTerms: false,
      },
    });

    hataBekle(yanit, 'VALIDATION_FAILED', 400);

    const detay = yanit.hata.details as { fields?: Array<{ path: string }> } | undefined;
    expect(
      detay?.fields?.map((alan) => alan.path),
      'Hangi alanın hatalı olduğu istemciye bildirilmeli',
    ).toContain('acceptedTerms');
  });

  test('yanlış şifre AUTH_INVALID_CREDENTIALS döner ve hesabın varlığını sızdırmaz', async ({
    api,
    ikinciApi,
    defter,
  }) => {
    const kullanici = await musteriOlustur(api, defter);
    await hizLimitiSifirla('login');

    const yanlisSifre = await ikinciApi.post('/v1/auth/login', {
      govde: { identifier: kullanici.eposta, password: 'KesinlikleYanlis2026' },
    });
    hataBekle(yanlisSifre, 'AUTH_INVALID_CREDENTIALS', 401);

    const olmayanHesap = await ikinciApi.post('/v1/auth/login', {
      govde: { identifier: `yok-${String(Date.now())}@e2e.test`, password: 'HerhangiBirSifre1' },
    });

    // ⚠️ İKİ DURUM AYNI KODU DÖNMELİ. Farklı dönselerdi, saldırgan hangi
    //    e-postaların kayıtlı olduğunu tek tek çıkarabilirdi.
    expect(
      olmayanHesap.hataKodu,
      'Var olmayan hesap ile yanlış şifre AYNI hatayı dönmeli (kullanıcı sayımı engeli)',
    ).toBe(yanlisSifre.hataKodu);
  });
});
