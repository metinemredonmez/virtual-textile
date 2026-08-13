import { describe, expect, it } from 'vitest';
import { MEDIA, SIGNED_URL_TTL_SECONDS } from '@vt/config';
import { AppError } from '@vt/contracts';
import { storageKeys, visibilityForKey } from '../storage.provider.js';
import { R2StorageProvider } from './r2.provider.js';
import { assertVisibilityMatchesKey, resolveSignedUrlTtl, type R2Config } from './r2.config.js';
import type { R2Driver, R2HeadResult, R2PresignInput, R2PutInput } from './r2.driver.js';

const config: R2Config = {
  endpoint: 'https://acc.r2.cloudflarestorage.com',
  accessKeyId: 'key',
  secretAccessKey: 'secret',
  bucketPublic: 'vt-public-products',
  bucketPrivate: 'vt-private-user-photos',
  publicUrl: 'https://cdn.example.com',
};

/** Ağa çıkmayan sürücü — hangi kovaya ne gittiğini kaydeder. */
class FakeDriver implements R2Driver {
  readonly name = 'fake';
  readonly puts: R2PutInput[] = [];
  readonly deletes: Array<{ bucket: string; key: string }> = [];
  readonly batchDeletes: Array<{ bucket: string; keys: readonly string[] }> = [];
  readonly presigns: R2PresignInput[] = [];
  head: R2HeadResult | null = { sizeBytes: 10, contentType: 'image/webp', etag: 'e' };

  putObject(input: R2PutInput): Promise<{ etag: string }> {
    this.puts.push(input);
    return Promise.resolve({ etag: 'etag-1' });
  }
  getObject(_bucket: string, _key: string): Promise<Buffer> {
    return Promise.resolve(Buffer.from('x'));
  }
  deleteObject(bucket: string, key: string): Promise<void> {
    this.deletes.push({ bucket, key });
    return Promise.resolve();
  }
  deleteObjects(bucket: string, keys: readonly string[]): Promise<void> {
    this.batchDeletes.push({ bucket, keys });
    return Promise.resolve();
  }
  headObject(): Promise<R2HeadResult | null> {
    return Promise.resolve(this.head);
  }
  presign(input: R2PresignInput): Promise<string> {
    this.presigns.push(input);
    return Promise.resolve(`https://signed/${input.key}?ttl=${input.expiresInSeconds}`);
  }
}

const setup = (): { provider: R2StorageProvider; driver: FakeDriver } => {
  const driver = new FakeDriver();
  return { provider: new R2StorageProvider(config, driver), driver };
};

describe('R2StorageProvider — kova ayrımı', () => {
  it('kullanıcı fotoğrafını private kovaya yazar', async () => {
    const { provider, driver } = setup();
    const key = storageKeys.userPhoto('user-1', 'photo-1');

    await provider.put({
      key,
      visibility: 'private',
      body: Buffer.from('data'),
      contentType: 'image/webp',
    });

    expect(driver.puts[0]?.bucket).toBe(config.bucketPrivate);
  });

  it('kullanıcı fotoğrafının public kovaya yazılmasını REDDEDER', async () => {
    const { provider, driver } = setup();
    const key = storageKeys.userPhoto('user-1', 'photo-1');

    await expect(
      provider.put({
        key,
        visibility: 'public',
        body: Buffer.from('data'),
        contentType: 'image/webp',
      }),
    ).rejects.toBeInstanceOf(AppError);

    expect(driver.puts).toHaveLength(0);
  });

  it('ürün görselini public kovaya yazar ve uzun önbellek verir', async () => {
    const { provider, driver } = setup();

    await provider.put({
      key: storageKeys.productImage('p1', 'i1', 1024),
      visibility: 'public',
      body: Buffer.from('data'),
      contentType: 'image/webp',
    });

    expect(driver.puts[0]?.bucket).toBe(config.bucketPublic);
    expect(driver.puts[0]?.cacheControl).toContain('max-age=31536000');
  });

  it('private nesneler önbelleklenmez', async () => {
    const { provider, driver } = setup();

    await provider.put({
      key: storageKeys.tryOnResult('job-1'),
      visibility: 'private',
      body: Buffer.from('data'),
      contentType: 'image/webp',
    });

    expect(driver.puts[0]?.cacheControl).toContain('no-store');
  });

  it('şemada tanınmayan geçici anahtarlarda çağıranın kararına uyar', async () => {
    const { provider, driver } = setup();

    // Ham (EXIF temizlenmemiş) yükleme bilinçli olarak private tutulur.
    await provider.put({
      key: 'staging/products/p1/i1',
      visibility: 'private',
      body: Buffer.from('data'),
      contentType: 'image/jpeg',
    });

    expect(driver.puts[0]?.bucket).toBe(config.bucketPrivate);
  });
});

describe('R2StorageProvider — publicUrl', () => {
  it('ürün görseli için CDN adresi üretir', () => {
    const { provider } = setup();
    const key = storageKeys.productImage('p1', 'i1', 640);
    expect(provider.publicUrl(key)).toBe(`https://cdn.example.com/${key}`);
  });

  it('kullanıcı fotoğrafı için public adres ÜRETMEZ', () => {
    const { provider } = setup();
    expect(() => provider.publicUrl(storageKeys.userPhoto('u1', 'p1'))).toThrow(AppError);
  });

  it('try-on sonucu için public adres ÜRETMEZ', () => {
    const { provider } = setup();
    expect(() => provider.publicUrl(storageKeys.tryOnResult('job-1'))).toThrow(AppError);
  });
});

describe('resolveSignedUrlTtl — ömür tavanı', () => {
  it('kullanıcı fotoğrafında sabitteki tavana kırpar', () => {
    const key = storageKeys.userPhoto('u1', 'p1');
    expect(resolveSignedUrlTtl(key, 'get', 86_400)).toBe(SIGNED_URL_TTL_SECONDS.userPhoto);
  });

  it('istenen süre tavandan kısaysa onu korur', () => {
    const key = storageKeys.userPhoto('u1', 'p1');
    expect(resolveSignedUrlTtl(key, 'get', 60)).toBe(60);
  });

  it('try-on sonucunda kendi tavanını uygular', () => {
    expect(resolveSignedUrlTtl(storageKeys.tryOnResult('j1'), 'get', 99_999)).toBe(
      SIGNED_URL_TTL_SECONDS.tryOnResult,
    );
  });

  it('yükleme URL ömrü her zaman MEDIA.uploadUrlTtlSeconds ile sınırlı', () => {
    expect(resolveSignedUrlTtl('staging/products/p1/i1', 'put', 86_400)).toBe(
      MEDIA.uploadUrlTtlSeconds,
    );
  });

  it('sıfır veya negatif ömür reddedilir', () => {
    expect(() => resolveSignedUrlTtl('staging/x/y', 'put', 0)).toThrow(AppError);
  });
});

describe('R2StorageProvider — imzalı URL', () => {
  it('yükleme URL’inde contentType zorunlu', async () => {
    const { provider } = setup();
    await expect(
      provider.signedUrl({
        key: 'staging/products/p1/i1',
        visibility: 'private',
        expiresInSeconds: 300,
        operation: 'put',
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('boyut sınırını imzaya taşır', async () => {
    const { provider, driver } = setup();

    await provider.signedUrl({
      key: 'staging/products/p1/i1',
      visibility: 'private',
      expiresInSeconds: 300,
      operation: 'put',
      contentType: 'image/jpeg',
      maxSizeBytes: 1_000_000,
    });

    expect(driver.presigns[0]?.contentLength).toBe(1_000_000);
  });

  it('sistem tavanının üstünde yükleme boyutu istenemez', async () => {
    const { provider } = setup();
    await expect(
      provider.signedUrl({
        key: 'staging/products/p1/i1',
        visibility: 'private',
        expiresInSeconds: 300,
        operation: 'put',
        contentType: 'image/jpeg',
        maxSizeBytes: MEDIA.maxUploadBytes + 1,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe('R2StorageProvider — silme', () => {
  it('private kovadan siler', async () => {
    const { provider, driver } = setup();
    const key = storageKeys.userPhoto('u1', 'p1');

    await provider.delete(key, 'private');

    expect(driver.deletes).toEqual([{ bucket: config.bucketPrivate, key }]);
  });

  it('toplu silmeyi sağlayıcı sınırına göre parçalar', async () => {
    const { provider, driver } = setup();
    const keys = Array.from({ length: 1200 }, (_, i) => storageKeys.tryOnResult(`job-${i}`));

    await provider.deleteMany(keys, 'private');

    expect(driver.batchDeletes).toHaveLength(2);
    expect(driver.batchDeletes[0]?.keys).toHaveLength(1000);
    expect(driver.batchDeletes[1]?.keys).toHaveLength(200);
  });

  it('boş listede sağlayıcıya hiç gitmez', async () => {
    const { provider, driver } = setup();
    await provider.deleteMany([], 'private');
    expect(driver.batchDeletes).toHaveLength(0);
  });
});

describe('R2StorageProvider — anahtar doğrulama', () => {
  it('dizin dışına çıkma denemesini reddeder', async () => {
    const { provider } = setup();
    await expect(provider.get('user-photos/../products/p1/i1/original', 'private')).rejects.toThrow(
      AppError,
    );
  });

  it('boş anahtarı reddeder', () => {
    const { provider } = setup();
    expect(() => provider.publicUrl('')).toThrow(AppError);
  });
});

/**
 * ═══════════════ SİTE GÖRSELİ ÖN EKİ — `site/` ══════════════════════════════
 *
 * ⚠️ BU ÜÇ TEST BİRLİKTE BİR KAPIDIR ve kapının koruduğu şey ölçülmüş bir
 *    sessizliktir: `assertVisibilityMatchesKey` TANINMAYAN önekte hiçbir şey
 *    yapmadan `return` ediyor. `site/` iki listeye de yazılmasaydı
 *    `put({ key: 'site/banner/…', visibility: 'private' })` sessizce kabul
 *    edilir, nesne private kovaya inerdi — ve `publicUrl()` kova varlığını
 *    kontrol etmediği için yine de geçerli GÖRÜNEN bir adres üretirdi.
 *    Sonuç: yönetici "yükledim" der, satır yazılır, sayfa 200 döner, görsel
 *    404'tür. Testler o yolu kapatıyor.
 */
describe('site görseli öneki — gizlilik sınıfı', () => {
  it('⚠️ `site/` PUBLIC sayılır — afiş herkese gösterilmek üzere yüklenir', () => {
    expect(visibilityForKey(storageKeys.siteImageOriginal('si-1'))).toBe('public');
    expect(visibilityForKey(storageKeys.siteImage('si-1', 1600))).toBe('public');
  });

  it('⚠️ `site/` anahtarı private olarak yazılmak istenirse FIRLATIR', () => {
    expect(() => assertVisibilityMatchesKey(storageKeys.siteImageOriginal('si-1'), 'private')) //
      .toThrow(AppError);
  });

  it('afiş public kovaya, ham yükleme private kovaya gider', async () => {
    const { provider, driver } = setup();

    await provider.put({
      key: storageKeys.siteImageOriginal('si-1'),
      visibility: 'public',
      body: Buffer.from('x'),
      contentType: 'image/webp',
    });

    // Ham yükleme `staging/` önekindedir — afişin kendisi değil.
    await provider.put({
      key: 'staging/site/si-1',
      visibility: 'private',
      body: Buffer.from('x'),
      contentType: 'image/jpeg',
    });

    expect(driver.puts[0]?.bucket).toBe(config.bucketPublic);
    expect(driver.puts[1]?.bucket).toBe(config.bucketPrivate);
  });
});

describe('R2StorageProvider — yapılandırma güvenliği', () => {
  it('iki kova aynıysa yazmayı reddeder (KVKK)', async () => {
    const provider = new R2StorageProvider(
      { ...config, bucketPrivate: config.bucketPublic },
      new FakeDriver(),
    );

    await expect(
      provider.put({
        key: storageKeys.userPhoto('u1', 'p1'),
        visibility: 'private',
        body: Buffer.from('x'),
        contentType: 'image/webp',
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('boyut tavanını aşan gövdeyi reddeder', async () => {
    const provider = new R2StorageProvider({ ...config, maxUploadBytes: 8 }, new FakeDriver());

    await expect(
      provider.put({
        key: storageKeys.userPhoto('u1', 'p1'),
        visibility: 'private',
        body: Buffer.alloc(9),
        contentType: 'image/webp',
      }),
    ).rejects.toBeInstanceOf(AppError);
  });
});
