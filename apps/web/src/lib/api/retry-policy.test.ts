import { describe, expect, it, vi } from 'vitest';
import { ApiFailure, ERROR_CATALOG, type ErrorCode } from '@vt/contracts';
import { otomatikTekrarla, RETRY_POLICY, retryBehaviourFor, retryDelayMs } from './retry-policy';

/**
 * ⚠️ BU DOSYA NEDEN VAR: `retry-policy.ts` DÖRT davranış tanımlıyordu ama
 *    yalnızca İKİSİNİN uygulaması vardı. `retryDelayMs` sıfır çağıran taşıyordu,
 *    `'otomatik'` ve `'yonlendir'` hiçbir yerde OKUNMUYORDU — tip yeni kodda
 *    derlemeyi kırıyor, ama davranışın var olmadığını hiçbir şey söylemiyordu.
 *    Kopuk modülü yakalayan tek şey buradaki "her dalın bir tüketicisi var mı"
 *    sorusudur.
 */

/**
 * ⚠️ `code` TİPİ `ErrorCode` — çünkü `ApiErrorBody.code` öyle. "Bilinmeyen kod"
 *    senaryosu `retryBehaviourFor` testinde ayrıca kapsanıyor; orada zaten
 *    düz `string` alan bir imza var.
 */
function hata(code: ErrorCode, retryAfterSeconds?: number): ApiFailure {
  return new ApiFailure({
    code,
    message: 'test',
    httpStatus: 503,
    retryable: true,
    requestId: 'test',
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  });
}

describe('RETRY_POLICY kapsamı', () => {
  it('katalogdaki HER kod için bir davranış tanımlı', () => {
    const eksik = (Object.keys(ERROR_CATALOG) as ErrorCode[]).filter(
      (kod) => !(kod in RETRY_POLICY),
    );
    expect(eksik).toEqual([]);
  });

  it('bilinmeyen kod (sürüm sapması) sessizce YOK dalına düşer', () => {
    expect(retryBehaviourFor('BOYLE_BIR_KOD_YOK')).toEqual({ kind: 'yok' });
  });

  it("'yonlendir' dalının hedefi VE etiket anahtarı var — etiketsiz bağlantı basılamaz", () => {
    for (const [kod, davranis] of Object.entries(RETRY_POLICY)) {
      if (davranis.kind !== 'yonlendir') continue;
      expect(davranis.href, kod).toMatch(/^\//);
      // ⚠️ Artık HAZIR METİN değil SÖZLÜK ANAHTARI tutuluyor: buraya Türkçe bir
      //    cümle yazmak katalog/sözlük dışında üçüncü bir metin kaynağı açardı
      //    ve İngilizce arayüzde Türkçe bir düğme kalırdı.
      expect(davranis.etiketAnahtari, kod).toMatch(/^[a-z]+\.[a-zA-Z]+$/);
    }
  });

  it('PAYMENT_TIMEOUT kullanıcıyı siparişlerine yönlendirir', () => {
    // ⚠️ Katalog mesajı "Siparişlerinizi kontrol edin" diyor; o cümlenin
    //    işaret ettiği yer TIKLANABİLİR olmalı, yoksa kullanıcının en olası
    //    davranışı ödemeyi baştan denemek — yani ikinci tahsilat riski.
    expect(RETRY_POLICY.PAYMENT_TIMEOUT).toEqual({
      kind: 'yonlendir',
      href: '/account/orders',
      etiketAnahtari: 'hata.siparislerimeGit',
    });
  });
});

describe('retryDelayMs', () => {
  it('sunucu `retryAfterSeconds` verdiyse TAHMİN ETMEZ, onu kullanır', () => {
    expect(retryDelayMs(1, 2)).toBe(2000);
    expect(retryDelayMs(3, 2)).toBe(2000);
  });

  it('sunucu pencere vermediyse üstel geri çekilir', () => {
    expect(retryDelayMs(1)).toBe(500);
    expect(retryDelayMs(2)).toBe(1000);
    expect(retryDelayMs(3)).toBe(2000);
  });
});

describe('otomatikTekrarla', () => {
  it('geçici hatada sessizce tekrar dener ve sonucu döndürür', async () => {
    vi.useFakeTimers();
    let cagri = 0;
    const is = vi.fn(async () => {
      cagri += 1;
      if (cagri < 3) throw hata('IDEMPOTENCY_IN_PROGRESS', 2);
      return 'tamam';
    });

    const sonuc = otomatikTekrarla(is);
    await vi.runAllTimersAsync();
    await expect(sonuc).resolves.toBe('tamam');
    expect(is).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('maxAttempts tükenince hatayı AYNEN fırlatır — yutmaz', async () => {
    vi.useFakeTimers();
    const is = vi.fn(async () => {
      throw hata('UPSTREAM_UNAVAILABLE');
    });

    const sonuc = otomatikTekrarla(is);
    const beklenti = expect(sonuc).rejects.toBeInstanceOf(ApiFailure);
    await vi.runAllTimersAsync();
    await beklenti;
    // ⚠️ 3 = OTOMATIK.maxAttempts. Sonsuz döngü olmadığının kanıtı.
    expect(is).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("'otomatik' OLMAYAN kodu HİÇ tekrarlamaz", async () => {
    const is = vi.fn(async () => {
      throw hata('PAYMENT_DECLINED');
    });
    await expect(otomatikTekrarla(is)).rejects.toBeInstanceOf(ApiFailure);
    expect(is).toHaveBeenCalledTimes(1);
  });

  it('zarfsız hatayı (ApiFailure değil) tekrarlamaz, olduğu gibi geçirir', async () => {
    const is = vi.fn(async () => {
      throw new TypeError('ağ');
    });
    await expect(otomatikTekrarla(is)).rejects.toBeInstanceOf(TypeError);
    expect(is).toHaveBeenCalledTimes(1);
  });
});
