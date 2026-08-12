import { describe, expect, it } from 'vitest';
import { appError, AppError, integrationError, isAppError, toAppError } from './app-error.js';
import { ERROR_CATALOG, ERROR_CODES, shouldReport } from './error-catalog.js';

describe('hata kataloğu', () => {
  it('her kodun geçerli bir HTTP durumu ve Türkçe mesajı vardır', () => {
    for (const code of ERROR_CODES) {
      const def = ERROR_CATALOG[code];
      expect(def.status, `${code} durum kodu`).toBeGreaterThanOrEqual(400);
      expect(def.status, `${code} durum kodu`).toBeLessThan(600);
      expect(def.message.length, `${code} mesajı boş`).toBeGreaterThan(0);
    }
  });

  it('domain ve validation aileleri Sentry’ye raporlanmaz', () => {
    expect(shouldReport('domain')).toBe(false);
    expect(shouldReport('validation')).toBe(false);
    expect(shouldReport('integration')).toBe(true);
    expect(shouldReport('system')).toBe(true);
  });

  it('4xx hatalar Sentry gürültüsü yaratmaz — belgelenmiş istisnalar hariç', () => {
    /**
     * Kural: 4xx = beklenen iş sonucu → raporlanmaz.
     *
     * İstisnalar, HTTP durumu 4xx olsa da KÖK NEDENİ bizim tarafımızda olan
     * ve sessizce geçilmemesi gereken durumlardır:
     *  - PAYMENT_AMOUNT_MISMATCH: istemcinin gönderdiği tutar ile sunucunun
     *    hesapladığı tutar tutmuyor → kurcalama veya hesaplama hatası. Alarm şart.
     *  - COMMISSION_RULE_NOT_FOUND: her kategori için geçerli bir kural olmalı.
     *    Yoksa referans verisi bozuk → sipariş alınamaz. Alarm şart.
     */
    const documentedExceptions = ['PAYMENT_AMOUNT_MISMATCH', 'COMMISSION_RULE_NOT_FOUND'];

    const noisy = ERROR_CODES.filter((code) => {
      const def = ERROR_CATALOG[code];
      return (
        def.status >= 400 &&
        def.status < 500 &&
        shouldReport(def.family) &&
        !documentedExceptions.includes(code)
      );
    });
    expect(noisy).toEqual([]);
  });

  /**
   * KOMBİN RET KODLARI — üçü de KULLANICI SEÇİMİNİN sonucudur.
   *
   * Aile seçimi bilinçli: şema tutuyor (kimlikler geçerli), reddeden şey GİYİM
   * KURALI. Bu yüzden `domain` + 422; `validation` olsaydı biçim hatalarıyla
   * aynı kovaya düşer ve panelde ayırt edilemezdi.
   */
  it('kombin ret kodları kullanıcı hatasıdır: 422 + domain + tekrarlanamaz', () => {
    const outfitCodes = ERROR_CODES.filter((code) => code.startsWith('OUTFIT_'));
    expect(outfitCodes).toEqual([
      'OUTFIT_LAYER_CONFLICT',
      'OUTFIT_PIECE_COUNT_INVALID',
      'OUTFIT_DUPLICATE_PIECE',
    ]);

    for (const code of outfitCodes) {
      const def = ERROR_CATALOG[code];
      expect(def.status, `${code} durum kodu`).toBe(422);
      expect(def.family, `${code} ailesi`).toBe('domain');
      // Aynı istek tekrar gönderilse aynı sonucu verir; istemci retry etmemeli.
      expect(def.retryable, `${code} retry`).toBe(false);
    }
  });

  /**
   * ⚠️ Bu kodların VAR OLMA SEBEBİ, genel `VALIDATION_FAILED` mesajının
   *    kullanıcıya ne yapacağını söylememesiydi. Mesajın EYLEM içerdiğini
   *    sınamazsak kodları ekleyip mesajı yine genel bırakmak mümkün olurdu.
   */
  it('kombin ret mesajları kullanıcıya bir EYLEM söyler', () => {
    const actionVerbs = ['bırakın', 'çıkarın', 'seçebilirsiniz', 'seçin', 'değiştirin'];

    for (const code of ERROR_CODES.filter((c) => c.startsWith('OUTFIT_'))) {
      const { message } = ERROR_CATALOG[code];
      expect(
        actionVerbs.some((verb) => message.includes(verb)),
        `${code} mesajı eylem içermiyor: ${message}`,
      ).toBe(true);
    }
  });
});

describe('AppError', () => {
  it('davranışını katalogdan alır', () => {
    const err = appError('INSUFFICIENT_STOCK', { params: { available: 2 } });
    expect(err.httpStatus).toBe(409);
    expect(err.family).toBe('domain');
    expect(err.retryable).toBe(false);
    expect(err.userMessage).toContain('2 adet');
  });

  it('eksik parametreyi yer tutucu olarak bırakır, patlamaz', () => {
    const err = appError('INSUFFICIENT_STOCK');
    expect(err.userMessage).toContain('{available}');
  });

  it('log mesajı ile kullanıcı mesajını ayırır', () => {
    const err = appError('INTERNAL_ERROR', { internalMessage: 'prisma bağlantısı koptu' });
    expect(err.message).toBe('prisma bağlantısı koptu');
    expect(err.userMessage).not.toContain('prisma');
  });

  it('log nesnesi kullanıcı verisi sızdırmaz', () => {
    const err = appError('AUTH_INVALID_CREDENTIALS', { details: { email: 'a@b.com' } });
    expect(JSON.stringify(err.toLogObject())).not.toContain('a@b.com');
  });
});

describe('IntegrationError', () => {
  it('sağlayıcı bağlamını taşır ama kullanıcıya sızdırmaz', () => {
    const err = integrationError(
      'PAYMENT_PROVIDER_DOWN',
      { provider: 'iyzico', operation: 'initiate3ds', providerCode: '5012' },
      { cause: new Error('ECONNRESET') },
    );
    expect(err.provider).toBe('iyzico');
    expect(err.toLogObject().providerCode).toBe('5012');
    expect(err.userMessage).not.toContain('iyzico');
    expect(err.userMessage).not.toContain('5012');
    expect(err.retryable).toBe(true);
  });
});

describe('toAppError', () => {
  it('AppError’u olduğu gibi geçirir', () => {
    const original = appError('CART_EMPTY');
    expect(toAppError(original)).toBe(original);
  });

  it('bilinmeyen hatayı INTERNAL_ERROR’a çevirir ve iç mesajı sızdırmaz', () => {
    const err = toAppError(new Error('SELECT * FROM users WHERE token = "abc"'));
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.userMessage).not.toContain('SELECT');
    expect(isAppError(err)).toBe(true);
  });

  it('Error olmayan değerleri de işler', () => {
    expect(toAppError('bir şeyler ters gitti').code).toBe('INTERNAL_ERROR');
  });
});
