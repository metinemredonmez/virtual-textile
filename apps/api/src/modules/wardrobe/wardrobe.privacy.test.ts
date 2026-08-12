import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@vt/contracts';
import { WardrobeService } from './wardrobe.service.js';
import {
  isOwnWardrobeKey,
  isWardrobeKey,
  wardrobeKeys,
  WARDROBE_KEY_PREFIX,
} from './wardrobe.keys.js';
import type {
  WardrobeItem,
  WardrobePhotoStoragePort,
  WardrobeRepositoryPort,
  WardrobeStylistPort,
  WardrobeTryOnPort,
} from './wardrobe.ports.js';
import type { WardrobeCreateInput } from './wardrobe.schema.js';

/**
 * GARDIROP FOTOĞRAFI GİZLİLİĞİ — KVKK
 *
 * ⚠️ Kullanıcının kendi dolabından çektiği fotoğraf ÖZEL NİTELİKLİ VERİDİR;
 *    satıcının yayımladığı ürün görseli değildir. Sınanan güvenceler:
 *
 *   1. Fotoğraf private kovaya gider — anahtar `wardrobe/` önekli ve
 *      `userId` içerir.
 *   2. Okuma yalnızca KISA ÖMÜRLÜ İMZALI URL ile olur; kalıcı/public adres
 *      hiçbir yanıtta dönmez.
 *   3. Depo anahtarı istemciye SIZMAZ ve istemciden ALINMAZ.
 *   4. Satın alınan parçanın ürün görseli AYRI muamele görür (public, imzasız).
 *   5. Silme, depo nesnesini de kaldırır.
 *   6. Kombin önerisi için LLM tarafına fotoğraf/anahtar GÖNDERİLMEZ.
 */

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

const CREATE_INPUT: WardrobeCreateInput = {
  category: 'OUTERWEAR',
  color: 'Lacivert',
  label: 'Annemin ördüğü hırka',
  contentType: 'image/jpeg',
  sizeBytes: 1024 * 512,
};

function manualItem(overrides: Partial<WardrobeItem> = {}): WardrobeItem {
  return {
    id: 'w-1',
    userId: 'u-1',
    source: 'MANUAL',
    variantId: null,
    category: 'OUTERWEAR',
    color: 'Lacivert',
    label: 'Annemin ördüğü hırka',
    photoKey: 'wardrobe/u-1/w-1',
    productImageKey: null,
    sourceOrderItemId: null,
    createdAt: new Date('2026-03-01T10:00:00Z'),
    ...overrides,
  };
}

function purchasedItem(overrides: Partial<WardrobeItem> = {}): WardrobeItem {
  return manualItem({
    id: 'w-2',
    source: 'PURCHASE',
    variantId: 'v-1',
    photoKey: null,
    productImageKey: 'products/p-1/i-1/800.webp',
    sourceOrderItemId: 'oi-1',
    ...overrides,
  });
}

interface Harness {
  service: WardrobeService;
  repository: WardrobeRepositoryPort;
  storage: WardrobePhotoStoragePort;
  stylist: WardrobeStylistPort;
}

function makeHarness(repositoryOverrides: Partial<WardrobeRepositoryPort> = {}): Harness {
  const repository: WardrobeRepositoryPort = {
    listByUser: vi.fn().mockResolvedValue([]),
    findOwned: vi.fn().mockResolvedValue(null),
    insertPurchasedIgnoringDuplicates: vi.fn().mockResolvedValue(0),
    insertManual: vi.fn(async (command) =>
      manualItem({ photoKey: command.photoKey, color: command.color, label: command.label }),
    ),
    deleteOwned: vi.fn().mockResolvedValue(null),
    ...repositoryOverrides,
  };

  const storage: WardrobePhotoStoragePort = {
    signedUploadUrl: vi.fn().mockResolvedValue('https://r2.example.com/put?sig=PLACEHOLDER'),
    signedReadUrl: vi.fn().mockResolvedValue('https://r2.example.com/get?sig=PLACEHOLDER'),
    exists: vi.fn().mockResolvedValue(true),
    delete: vi.fn().mockResolvedValue(undefined),
  };

  const stylist: WardrobeStylistPort = { suggestOutfits: vi.fn().mockResolvedValue([]) };
  const tryOn: WardrobeTryOnPort = { prepareOutfit: vi.fn() };

  const service = new WardrobeService(repository, storage, stylist, tryOn, silentLogger as never);

  return { service, repository, storage, stylist };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('gardırop fotoğrafı — depolama anahtarı', () => {
  it('anahtar private önekli ve kullanıcı kimliğini içerir', () => {
    const key = wardrobeKeys.photo('u-1', 'w-1');

    expect(key).toBe('wardrobe/u-1/w-1');
    expect(key.startsWith(WARDROBE_KEY_PREFIX)).toBe(true);
    expect(isWardrobeKey(key)).toBe(true);
  });

  /**
   * ⚠️ Anahtar kullanıcı kimliğini taşıdığı için "başkasının fotoğrafını
   *    oku/sil" saldırısında istemcinin çevirebileceği alan kalmaz.
   */
  it('başka kullanıcının anahtarı sahiplik kontrolünden geçmez', () => {
    expect(isOwnWardrobeKey('wardrobe/u-1/w-1', 'u-1')).toBe(true);
    expect(isOwnWardrobeKey('wardrobe/u-2/w-9', 'u-1')).toBe(false);
    // Önek benzerliğiyle kandırma denemesi.
    expect(isOwnWardrobeKey('wardrobe/u-10/w-9', 'u-1')).toBe(false);
  });

  it('ürün görseli anahtarı gardırop anahtarı sayılmaz', () => {
    expect(isWardrobeKey('products/p-1/i-1/800.webp')).toBe(false);
    expect(isWardrobeKey('user-photos/u-1/p-1')).toBe(false);
  });
});

describe('gardırop fotoğrafı — yükleme', () => {
  it('yükleme adresi sunucuda üretilen anahtara imzalanır', async () => {
    const { service, storage } = makeHarness();

    const ticket = await service.requestUpload('u-1', CREATE_INPUT);

    const call = vi.mocked(storage.signedUploadUrl).mock.calls[0]?.[0];
    expect(call?.key).toBe(`wardrobe/u-1/${ticket.itemId}`);
    // Kısa ömürlü olmalı — kopyalanan bağlantı uzun süre çalışmasın.
    expect(call?.expiresInSeconds).toBeLessThanOrEqual(600);
    expect(call?.maxSizeBytes).toBe(CREATE_INPUT.sizeBytes);
  });

  /**
   * ⚠️ Bilet aşamasında satır AÇILMAZ: yüklemeyi yarıda bırakan kullanıcı
   *    gardırobunda görselsiz hayalet parça bırakmamalı.
   */
  it('yükleme bileti veritabanına kayıt yazmaz', async () => {
    const { service, repository } = makeHarness();

    await service.requestUpload('u-1', CREATE_INPUT);

    expect(repository.insertManual).not.toHaveBeenCalled();
  });

  it('onayda anahtar oturumdaki kullanıcıdan yeniden üretilir', async () => {
    const { service, repository, storage } = makeHarness();

    await service.confirmUpload('u-1', '11111111-1111-4111-8111-111111111111', CREATE_INPUT);

    expect(storage.exists).toHaveBeenCalledWith(
      'wardrobe/u-1/11111111-1111-4111-8111-111111111111',
    );
    const written = vi.mocked(repository.insertManual).mock.calls[0]?.[0];
    expect(written?.photoKey).toBe('wardrobe/u-1/11111111-1111-4111-8111-111111111111');
    expect(written?.userId).toBe('u-1');
  });

  it('dosya depoda yoksa kayıt açılmaz', async () => {
    const { service, repository, storage } = makeHarness();
    vi.mocked(storage.exists).mockResolvedValue(false);

    await expect(
      service.confirmUpload('u-1', '11111111-1111-4111-8111-111111111111', CREATE_INPUT),
    ).rejects.toBeInstanceOf(AppError);

    expect(repository.insertManual).not.toHaveBeenCalled();
  });
});

describe('gardırop fotoğrafı — okuma', () => {
  it('kullanıcının kendi parçası yalnızca imzalı URL ile döner', async () => {
    const { service, repository, storage } = makeHarness({
      listByUser: vi.fn().mockResolvedValue([manualItem()]),
    });

    const [view] = await service.list('u-1');

    expect(storage.signedReadUrl).toHaveBeenCalledWith({
      key: 'wardrobe/u-1/w-1',
      expiresInSeconds: expect.any(Number),
    });
    expect(view?.imageUrl).toContain('sig=');
    // ⚠️ İstemci bu adresin geçici olduğunu BİLMELİ; önbelleğe alıp saklamasın.
    expect(view?.imageUrlExpires).toBe(true);
    expect(repository.listByUser).toHaveBeenCalledWith('u-1');
  });

  /**
   * ⚠️ İmzalı URL kısa ömürlü olmalıdır. Uzun TTL, paylaşılan bir bağlantının
   *    uzun süre çalışması demektir.
   */
  it('okuma imzası kısa ömürlüdür', async () => {
    const { service, storage } = makeHarness({
      listByUser: vi.fn().mockResolvedValue([manualItem()]),
    });

    await service.list('u-1');

    const ttl = vi.mocked(storage.signedReadUrl).mock.calls[0]?.[0].expiresInSeconds ?? Infinity;
    expect(ttl).toBeLessThanOrEqual(900);
  });

  /**
   * ⚠️ ANAHTAR SIZMAMALI. Dışarı verilseydi istemci onu başka uçlara geri
   *    göndermeye başlar, "istemciden anahtar alma" yasağı fiilen delinirdi.
   */
  it('yanıtta depo anahtarı bulunmaz', async () => {
    const { service } = makeHarness({
      listByUser: vi.fn().mockResolvedValue([manualItem()]),
    });

    const [view] = await service.list('u-1');
    const serialized = JSON.stringify(view);

    expect(serialized).not.toContain('wardrobe/u-1/w-1');
    expect(view).not.toHaveProperty('photoKey');
    expect(view).not.toHaveProperty('productImageKey');
  });

  /**
   * ⚠️ ÜRÜN GÖRSELİ FARKLI MUAMELE GÖRÜR: satıcının pazarlama materyalidir,
   *    public kovadadır ve imzalanmaz. Aynı alandan dönse de yolu ayrıdır.
   */
  it('satın alınan parçanın ürün görseli imzalanmaz', async () => {
    const { service, storage } = makeHarness({
      listByUser: vi.fn().mockResolvedValue([purchasedItem()]),
    });

    const [view] = await service.list('u-1');

    expect(storage.signedReadUrl).not.toHaveBeenCalled();
    expect(view?.imageUrl).toBe('products/p-1/i-1/800.webp');
    expect(view?.imageUrlExpires).toBe(false);
  });

  it('karışık gardıropta yalnızca kullanıcı fotoğrafı imzalanır', async () => {
    const { service, storage } = makeHarness({
      listByUser: vi.fn().mockResolvedValue([manualItem(), purchasedItem()]),
    });

    const views = await service.list('u-1');

    expect(storage.signedReadUrl).toHaveBeenCalledTimes(1);
    expect(views.filter((v) => v.imageUrlExpires)).toHaveLength(1);
  });
});

describe('gardırop fotoğrafı — silme', () => {
  it('parça silinince depo nesnesi de silinir', async () => {
    const { service, storage } = makeHarness({
      deleteOwned: vi.fn().mockResolvedValue(manualItem()),
    });

    await service.remove('u-1', 'w-1');

    expect(storage.delete).toHaveBeenCalledWith('wardrobe/u-1/w-1');
  });

  /**
   * ⚠️ Sahiplik koşulu SORGUYA girer: "önce oku, sonra sahibini kontrol et"
   *    yazılsaydı o kontrolün bir gün düşmesiyle başkasının parçası silinirdi.
   */
  it('silme sahiplik koşuluyla sorgulanır', async () => {
    const { service, repository } = makeHarness({
      deleteOwned: vi.fn().mockResolvedValue(manualItem()),
    });

    await service.remove('u-1', 'w-1');

    expect(repository.deleteOwned).toHaveBeenCalledWith('u-1', 'w-1');
  });

  /** ⚠️ 404 — 403 değil; varlık bilgisi sızmasın. */
  it('başkasının parçası için NOT_FOUND döner', async () => {
    const { service, storage } = makeHarness({
      deleteOwned: vi.fn().mockResolvedValue(null),
    });

    await expect(service.remove('u-1', 'w-9')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('satın alınan parça silinince ürün görseli depodan SİLİNMEZ', async () => {
    const { service, storage } = makeHarness({
      deleteOwned: vi.fn().mockResolvedValue(purchasedItem()),
    });

    await service.remove('u-1', 'w-2');

    // Ürün görseli satıcıya aittir; kullanıcının gardırobundan çıkarması
    // katalogdaki görseli silmez.
    expect(storage.delete).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ Depo silme başarısız olursa YETİM NESNE kalır; kullanıcıya "silindi"
   *    denmiş olur. Bu bir KVKK borcudur ve HATA seviyesinde loglanmalıdır.
   */
  it('depo silme başarısız olursa hata loglanır ama istek düşmez', async () => {
    const { service, storage } = makeHarness({
      deleteOwned: vi.fn().mockResolvedValue(manualItem()),
    });
    vi.mocked(storage.delete).mockRejectedValue(new Error('R2 erişilemedi'));

    await expect(service.remove('u-1', 'w-1')).resolves.toBeUndefined();
    expect(silentLogger.error).toHaveBeenCalled();
  });
});

describe('kombin önerisi — veri minimizasyonu', () => {
  /**
   * ⚠️ Kullanıcının dolabının FOTOĞRAFI yurt dışındaki LLM sağlayıcısına
   *    GİTMEZ. Danışmana yalnızca kategori/renk/etiket verilir.
   */
  it('danışmana fotoğraf, anahtar veya imzalı URL gönderilmez', async () => {
    const { service, stylist } = makeHarness({
      listByUser: vi.fn().mockResolvedValue([manualItem(), purchasedItem()]),
    });

    await service.suggestOutfits('u-1', 3);

    const payload = vi.mocked(stylist.suggestOutfits).mock.calls[0]?.[0];
    const serialized = JSON.stringify(payload);

    expect(serialized).not.toContain('wardrobe/');
    expect(serialized).not.toContain('products/');
    expect(serialized).not.toContain('sig=');
    expect(payload?.items[0]).toEqual({
      itemId: 'w-1',
      category: 'OUTERWEAR',
      color: 'Lacivert',
      label: 'Annemin ördüğü hırka',
    });
  });

  it('boş gardıropta danışman hiç çalıştırılmaz', async () => {
    const { service, stylist } = makeHarness({ listByUser: vi.fn().mockResolvedValue([]) });

    const result = await service.suggestOutfits('u-1', 3);

    expect(result).toEqual([]);
    expect(stylist.suggestOutfits).not.toHaveBeenCalled();
  });
});
