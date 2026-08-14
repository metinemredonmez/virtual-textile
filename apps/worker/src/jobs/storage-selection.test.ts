import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import { resetR2Storage, type R2Env, type StorageProvider } from '@vt/adapters';
import { selectStorage } from '../infra.module.js';

const WITH_KEYS: R2Env = {
  R2_ENDPOINT: 'https://hesap.r2.cloudflarestorage.com',
  R2_ACCESS_KEY_ID: 'anahtar',
  R2_SECRET_ACCESS_KEY: 'gizli',
  R2_BUCKET_PUBLIC: 'vt-public-products',
  R2_BUCKET_PRIVATE: 'vt-private-user-photos',
  R2_PUBLIC_URL: 'https://cdn.example.com',
};

const WITHOUT_KEYS: R2Env = {
  ...WITH_KEYS,
  R2_ENDPOINT: '',
  R2_ACCESS_KEY_ID: '',
  R2_SECRET_ACCESS_KEY: '',
};

function createLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

/** Fabrikanın süreç genelindeki tek örneği testler arasında sızmasın. */
beforeEach(() => {
  resetR2Storage();
});

describe('depo seçimi — anahtar yoksa yer tutucu', () => {
  it('anahtar yoksa gerçek sürücü fabrikası hiç çağrılmaz', () => {
    const logger = createLogger();
    const factory = vi.fn();

    const { storage, status } = selectStorage(WITHOUT_KEYS, logger, factory);

    expect(storage.name).toBe('placeholder');
    expect(status).toEqual({
      driver: 'placeholder',
      configured: false,
      deleteWorks: false,
      reason: 'anahtar-yok',
    });
    expect(factory).not.toHaveBeenCalled();
  });

  it('kısmi yapılandırma gerçek depo saymaz — üç anahtar birden gerekir', () => {
    const logger = createLogger();
    const { status } = selectStorage({ ...WITH_KEYS, R2_SECRET_ACCESS_KEY: '' }, logger, vi.fn());

    // Eksik anahtarla SigV4 imzası üretilemez; "yarı çalışan" depo yoktur.
    expect(status.configured).toBe(false);
  });

  it('⚠️ yer tutucu aktifken açılışta UYARI basar — sessiz kalmaz', () => {
    const logger = createLogger();

    selectStorage(WITHOUT_KEYS, logger, vi.fn());

    const warned = vi
      .mocked(logger.warn)
      .mock.calls.some((call) =>
        call.some(
          (argument) =>
            typeof argument === 'string' &&
            argument.includes('depo yapılandırılmadı — fotoğraf silme çalışmıyor'),
        ),
      );
    expect(warned).toBe(true);
  });

  it('⚠️ yer tutucunun delete() çağrısı nesneyi SİLMEZ, yalnızca loglar', async () => {
    const logger = createLogger();
    const { storage, status } = selectStorage(WITHOUT_KEYS, logger, vi.fn());

    // Hata vermez — çağıran taraf "silindi" sanır. Taahhüdün fiilen yerine
    // getirilmediğini yalnızca `deleteWorks: false` söyler.
    await expect(storage.delete('user-photos/u1/p1', 'private')).resolves.toBeUndefined();
    expect(status.deleteWorks).toBe(false);
  });

  it('⚠️ yer tutucu put() çağrısında sessizce başarılı DÖNMEZ', () => {
    const logger = createLogger();
    const { storage } = selectStorage(WITHOUT_KEYS, logger, vi.fn());

    // "Yükledim" deyip hiçbir yere yazmayan depo, hata veren depodan pahalıdır.
    // Hata SENKRON fırlatılır; çağıranlar `await` ettiği için bu davranış
    // korunuyor (mevcut yer tutucunun davranışı değiştirilmedi).
    expect(() =>
      storage.put({
        key: 'user-photos/u1/p1',
        visibility: 'private',
        body: Buffer.from('x'),
        contentType: 'image/webp',
      }),
    ).toThrow('yapılandırılmadı');
  });
});

describe('depo seçimi — anahtar varsa gerçek R2', () => {
  it('gerçek R2 sürücüsüne geçer ve silme çalışır olarak raporlanır', () => {
    const logger = createLogger();

    // Varsayılan fabrika kullanılıyor: `@vt/adapters` gerçek AWS SDK sürücüsünü
    // kurar. Kurulum ağ çağrısı yapmaz, bu yüzden testte güvenli.
    const { storage, status } = selectStorage(WITH_KEYS, logger);

    expect(storage.name).toBe('r2');
    expect(status).toEqual({
      driver: 'r2',
      configured: true,
      deleteWorks: true,
      reason: null,
    });
  });

  it('gerçek sürücü seçilince yer tutucu uyarısı BASILMAZ', () => {
    const logger = createLogger();

    selectStorage(WITH_KEYS, logger);

    const warned = vi
      .mocked(logger.warn)
      .mock.calls.some((call) =>
        call.some(
          (argument) => typeof argument === 'string' && argument.includes('depo yapılandırılmadı'),
        ),
      );
    expect(warned).toBe(false);
    expect(logger.info).toHaveBeenCalled();
  });

  it('fabrika null dönerse yer tutucuya düşer', () => {
    const logger = createLogger();

    const { storage, status } = selectStorage(WITH_KEYS, logger, () => null);

    expect(storage.name).toBe('placeholder');
    expect(status.reason).toBe('anahtar-yok');
  });

  it('sürücü kurulumu patlarsa proses ayakta kalır, durum "kurulum-hatasi" olur', () => {
    const logger = createLogger();

    const { storage, status } = selectStorage(WITH_KEYS, logger, () => {
      throw new Error('istemci kurulamadı');
    });

    // Outbox, bildirim ve rezervasyon işleri depodan bağımsız çalışmalı.
    expect(storage.name).toBe('placeholder');
    expect(status.reason).toBe('kurulum-hatasi');
    expect(status.deleteWorks).toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('depo durumu sözleşmesi', () => {
  it('deleteWorks yalnızca gerçek sürücüde true olur', () => {
    const real: StorageProvider = selectStorage(WITH_KEYS, createLogger()).storage;
    const fake: StorageProvider = selectStorage(WITHOUT_KEYS, createLogger()).storage;

    expect(real.name).not.toBe(fake.name);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  İMZALI GİRDİ URL'İ — GÖRÜNÜRLÜK ANAHTARDAN TÜRETİLİR.
 *
 *  ⚠️ CANLI ARIZADAN DOĞDU (2026-08-14). `SignedUrlIssuer` her anahtar için
 *     `visibility: 'private'` yazıyordu. Ama iki farklı anahtar için
 *     çağrılıyor:
 *
 *         kullanıcı fotoğrafı  user-photos/…  → private  ✓
 *         ÜRÜN GÖRSELİ         products/…     → PUBLIC   ✗
 *
 *     `assertVisibilityMatchesKey` public anahtara private istendiğinde ATIYOR
 *     ("kova karışması engellendi") — koruma DOĞRU, hata çağırandaydı.
 *     Sonuç: HER sanal deneme sağlayıcıya ULAŞMADAN düştü.
 *
 *  ⚠️ VERİTABANI SÖYLÜYORDU: `provider=NULL · latencyMs=NULL`. Sağlayıcı adı
 *     boşsa hiçbir sağlayıcı çağrılmamıştır — hata ondan ÖNCEDEDİR. Kod
 *     `TRYON_PROVIDER_ERROR` yazdığı için günlerce sağlayıcıda arandı.
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe('SignedUrlIssuer — kova seçimi', () => {
  async function istenenGorunurluk(key: string): Promise<string> {
    const { SignedUrlIssuer } = await import('./tryon.processor.js');
    let istenen = '';

    const storage = {
      signedUrl: async (input: { key: string; visibility: string }) => {
        istenen = input.visibility;
        return `https://ornek/${input.key}`;
      },
    } as never;
    const redis = { set: async () => 'OK', del: async () => 1 } as never;

    await new SignedUrlIssuer(storage, redis).issue(key);
    return istenen;
  }

  it('kullanıcı fotoğrafı PRIVATE kovadan istenir', async () => {
    expect(await istenenGorunurluk('user-photos/kullanici-1/foto-1')).toBe('private');
  });

  it('⚠️ ÜRÜN GÖRSELİ PUBLIC kovadan istenir — sabit private HER DENEMEYİ DÜŞÜRÜYORDU', async () => {
    // Mutasyon: `visibilityForKey(key)` yerine `'private'` yazılınca kırılır.
    expect(await istenenGorunurluk('products/urun-1/gorsel-1/original')).toBe('public');
  });

  it('try-on sonucu PRIVATE — sonuç görseli herkese açılmaz', async () => {
    expect(await istenenGorunurluk('tryon/is-1.webp')).toBe('private');
  });
});
