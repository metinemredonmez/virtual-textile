import { describe, expect, it, vi } from 'vitest';
import { KOLEKSIYON_SLUGLARI, SITE_BANNER_WIDTHS, SITE_IMAGE_MAX_CARDS } from '@vt/config';
import { AppError } from '@vt/contracts';
import { AdminSiteImageService } from './admin-site-image.service.js';
import type { AdminActor } from './audit.js';

/**
 * ═══════════ SİTE GÖRSELİ SERVİSİ — DOĞRULAMA VE BOŞ DURUM ══════════════════
 *
 * Burada ölçülen üç şey var ve üçü de "yazıldı ama yanlış şeyi servis ediyor"
 * sınıfına karşı:
 *
 *   1. HEDEF DOĞRULAMASI. `slot` bir `String` kolonu ve `targetKey`in FK'si
 *      yok — veritabanı hiçbir şeyi reddetmiyor. Katılık YALNIZCA burada.
 *   2. BOŞ DURUM. Afiş tanımlanmamışsa ana sayfa KIRILMAZ.
 *   3. KART KAPISI. Yayında olmayan ürün ve deneme kapısından geçmeyen ürün
 *      kartta ne göstermeli.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const ACTOR: AdminActor = { id: 'admin-1', role: 'ADMIN', ipAddress: '203.0.113.7' };

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function build(prismaOverrides: Record<string, unknown> = {}) {
  const storage = {
    name: 'fake',
    put: vi.fn().mockResolvedValue({ key: 'k', etag: 'e' }),
    get: vi.fn().mockResolvedValue(Buffer.from('x')),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteMany: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(true),
    signedUrl: vi.fn().mockResolvedValue('https://signed.example/put'),
    publicUrl: vi.fn((key: string) => `https://cdn.example.com/${key}`),
  };

  const processor = {
    name: 'fake',
    sanitize: vi.fn().mockResolvedValue({
      buffer: Buffer.from('clean'),
      contentType: 'image/webp',
      widthPx: 2400,
      heightPx: 1050,
      sizeBytes: 5,
    }),
    analyze: vi.fn(),
    derive: vi.fn().mockResolvedValue([]),
    blurhash: vi.fn().mockResolvedValue('LEHV6n'),
  };

  const prisma = {
    siteImage: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    siteImageCard: { findUnique: vi.fn().mockResolvedValue(null) },
    category: { findUnique: vi.fn().mockResolvedValue(null) },
    product: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(),
    ...prismaOverrides,
  };

  const service = new AdminSiteImageService(
    prisma as never,
    storage as never,
    processor as never,
    silentLogger as never,
  );

  return { service, prisma, storage, processor };
}

// ══════════════════════════ HEDEF DOĞRULAMASI ═══════════════════════════════

describe('hedef doğrulaması — yazma anında katı', () => {
  /**
   * ⚠️ Sessizce yok saymak yerine REDDEDİLİYOR. Hedef gönderen istemci bir
   *    şeyi yanlış anlamıştır; kabul edilirse o yanlış anlama bir sonraki
   *    turda özellik sanılır ("HERO'nun da hedefi varmış").
   */
  it('HERO hedef KABUL ETMEZ', async () => {
    const { service } = build();

    await expect(
      service.requestUpload({
        slot: 'HERO',
        targetKey: 'kadin',
        contentType: 'image/jpeg',
        sizeBytes: 1000,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('HERO hedefsiz kabul edilir ve imzalı adres üretir', async () => {
    const { service, storage } = build();

    const ticket = await service.requestUpload({
      slot: 'HERO',
      contentType: 'image/jpeg',
      sizeBytes: 1000,
    });

    expect(ticket.uploadUrl).toBe('https://signed.example/put');
    /**
     * ⚠️ EN KRİTİK İDDİA. Ham dosya PRIVATE kovaya inmeli: imzalı URL ile
     *    gelen dosya EXIF/GPS taşır ve doğrudan public kovaya yazılsaydı, biz
     *    işleyene kadar çekim konumu CDN'den indirilebilir olurdu.
     */
    expect(storage.signedUrl).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: 'private', operation: 'put' }),
    );
    // Anahtar `staging/` önekinde — iki gizlilik listesi de onu tanıyor.
    const call = storage.signedUrl.mock.calls[0]?.[0] as { key: string };
    expect(call.key.startsWith('staging/site/')).toBe(true);
  });

  it('kapak hedefSİZ gönderilirse reddeder', async () => {
    const { service } = build();

    await expect(
      service.requestUpload({
        slot: 'CATEGORY_COVER',
        contentType: 'image/jpeg',
        sizeBytes: 1000,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  /**
   * ⚠️ Hedef `Category.id`dir, SLUG DEĞİL. Slug @unique ama DEĞİŞMEZ değil:
   *    yönetici bir gün "kadin-elbise"yi "elbise" yapar ve slug'a bağlanmış
   *    kapak sessizce boşa düşerdi.
   */
  it('CATEGORY_COVER var olmayan kategoriyi reddeder', async () => {
    const { service, prisma } = build();
    (prisma.category.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await expect(
      service.requestUpload({
        slot: 'CATEGORY_COVER',
        targetKey: '00000000-0000-7000-8000-000000000000',
        contentType: 'image/jpeg',
        sizeBytes: 1000,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('CATEGORY_COVER var olan kategoriyi kabul eder', async () => {
    const { service, prisma } = build();
    (prisma.category.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cat-1' });

    await expect(
      service.requestUpload({
        slot: 'CATEGORY_COVER',
        targetKey: 'cat-1',
        contentType: 'image/jpeg',
        sizeBytes: 1000,
      }),
    ).resolves.toMatchObject({ requiredContentType: 'image/jpeg' });
  });

  /**
   * ⚠️ BU TESTİN ASIL İŞİ, `apps/api`nin koleksiyon listesini GERÇEKTEN
   *    görebildiğini kanıtlamak. Liste `apps/web` içinde kalsaydı API onu
   *    okuyamazdı (tsconfig yol eşlemesi yok) ve doğrulama hiç yazılamazdı;
   *    yönetici `spor-gıyım` yazar, satır yazılır, kapak hiçbir sayfada
   *    görünmezdi.
   */
  it("COLLECTION_COVER yalnızca config listesindeki slug'ı kabul eder", async () => {
    const { service } = build();

    await expect(
      service.requestUpload({
        slot: 'COLLECTION_COVER',
        targetKey: KOLEKSIYON_SLUGLARI[0],
        contentType: 'image/jpeg',
        sizeBytes: 1000,
      }),
    ).resolves.toBeDefined();

    await expect(
      service.requestUpload({
        slot: 'COLLECTION_COVER',
        targetKey: 'spor-gıyım',
        contentType: 'image/jpeg',
        sizeBytes: 1000,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });
});

// ══════════════════════════ BOŞ DURUM ═══════════════════════════════════════

describe('boş durum — afiş tanımlanmamışsa', () => {
  /**
   * ⚠️ PAZARLIK DIŞI: `null` döner, 404 DEĞİL. 404 olsaydı ana sayfa,
   *    yönetici hiçbir şey yapmadığı için hata sınırına giderdi. Vitrin bu
   *    durumda bugünkü davranışına (ilk ürünün fotoğrafı) düşer.
   */
  it('hero ucu null döndürür, FIRLATMAZ', async () => {
    const { service } = build();

    await expect(service.readHero()).resolves.toEqual({ image: null });
  });

  it('kapak listesi boş dizi döndürür', async () => {
    const { service } = build();

    await expect(service.readBySlot('CATEGORY_COVER')).resolves.toEqual({ items: [] });
  });

  /**
   * ⚠️ "Aynı anda tek aktif hero" kuralı DB kısıtıyla değil, BU SORGUYLA
   *    uygulanıyor (Prisma kısmi unique yazamıyor ve kısıt yöneticiyi "önce
   *    eskisini kapat" çıkmazına sokardı). Sıra deterministik olmalı: en küçük
   *    sortOrder, eşitlikte en yeni.
   */
  it('hero seçimi deterministiktir: aktif + sortOrder asc + createdAt desc', async () => {
    const { service, prisma } = build();

    await service.readHero();

    expect(prisma.siteImage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slot: 'HERO', isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      }),
    );
  });
});

// ══════════════════════════ ÜRÜN KARTLARI ═══════════════════════════════════

const heroRow = (cards: unknown[] = []) => ({
  id: 'si-1',
  slot: 'HERO',
  targetKey: null,
  storageKey: 'site/banner/si-1/original',
  widthPx: 2400,
  heightPx: 1050,
  blurhash: null,
  title: null,
  subtitle: null,
  linkHref: null,
  isActive: true,
  sortOrder: 0,
  createdAt: new Date('2026-08-13T00:00:00Z'),
  updatedAt: new Date('2026-08-13T00:00:00Z'),
  cards,
});

const cardRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'card-1',
  siteImageId: 'si-1',
  productId: 'p-1',
  sortOrder: 0,
  product: {
    id: 'p-1',
    slug: 'keten-gomlek',
    title: 'Keten Gömlek',
    brandName: 'Marka',
    status: 'PUBLISHED',
    category: { tryOnCategory: 'UPPER_BODY' },
    images: [{ storageKey: 'products/p-1/i-1/original' }],
    variants: [{ id: 'v-1', priceMinor: 129000n, listPriceMinor: 149000n }],
    ...overrides,
  },
});

describe('afiş kartları — okuma kapıları', () => {
  it('kart ürünün DETAY şeklini taşır: varyant kimliği ve fiyat dahil', async () => {
    const { service, prisma } = build();
    (prisma.siteImage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      heroRow([cardRow()]),
    );

    const { image } = await service.readHero();

    /**
     * ⚠️ `defaultVariantId` OLMADAN kart "Sepete Ekle" ÇİZEMEZ: `SepeteEkle`
     *    zorunlu prop'u `variantIdler: readonly string[]` ve liste tipinde
     *    varyant yok. Tek istekte gelmesinin sebebi bu.
     */
    expect(image?.cards[0]).toMatchObject({
      productId: 'p-1',
      defaultVariantId: 'v-1',
      priceMinor: 129000n,
      tryOnable: true,
    });
  });

  /**
   * ⚠️ FK YAYIN DURUMUNU BİLMEZ. Ürün ARCHIVED'a çekilince cascade tetiklenmez,
   *    satır durur — kart ise gösterilmemelidir. Filtre olmasaydı vitrin
   *    yayından kaldırılmış bir ürünü afişin üzerinde tanıtmaya devam ederdi.
   */
  it('⚠️ yayında OLMAYAN ürünün kartı düşer', async () => {
    const { service, prisma } = build();
    (prisma.siteImage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      heroRow([cardRow({ status: 'ARCHIVED' })]),
    );

    const { image } = await service.readHero();

    expect(image?.cards).toHaveLength(0);
  });

  /**
   * ⚠️ DENEME KAPISI İKİ YARIMDIR ve kart YALNIZ İLK YARIYA bakamaz.
   *    `tryOnCategory !== null` ayakkabı için de doğrudur; ikinci yarı bugünkü
   *    sağlayıcı yeteneğidir. Yalnız ilk yarıya bakan bir kart,
   *    `PRODUCT_NOT_TRYONABLE` ile geri dönen bir düğme çizerdi.
   */
  it('⚠️ sağlayıcının denemediği kategori (SHOES) tryOnable:false döner', async () => {
    const { service, prisma } = build();
    (prisma.siteImage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      heroRow([cardRow({ category: { tryOnCategory: 'SHOES' } })]),
    );

    const { image } = await service.readHero();

    expect(image?.cards[0]?.tryOnable).toBe(false);
    // Kart yine döner — yalnızca "Sepete Ekle" gösterilecek, kart silinmeyecek.
    expect(image?.cards).toHaveLength(1);
  });

  /** Kategorisi olmayan ürün (parfüm, hediye kartı) da denenemez. */
  it('kategorisiz ürün tryOnable:false döner', async () => {
    const { service, prisma } = build();
    (prisma.siteImage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      heroRow([cardRow({ category: { tryOnCategory: null } })]),
    );

    const { image } = await service.readHero();

    expect(image?.cards[0]?.tryOnable).toBe(false);
  });

  /**
   * ⚠️ Aktif varyantı kalmamış ürün: `defaultVariantId` null olur ve kart
   *    "Sepete Ekle" göstermez. `0n` fiyat "bedava" demek olurdu, o yüzden
   *    fiyatın da anlamsız olduğu bu durumda düğme hiç çizilmemeli.
   */
  it('aktif varyantı olmayan ürün defaultVariantId:null döner', async () => {
    const { service, prisma } = build();
    (prisma.siteImage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      heroRow([cardRow({ variants: [] })]),
    );

    const { image } = await service.readHero();

    expect(image?.cards[0]?.defaultVariantId).toBeNull();
  });
});

describe('afiş kartları — yazma kapıları', () => {
  it('bilinmeyen afişe kart eklenemez', async () => {
    const { service } = build();

    await expect(
      service.addCard(ACTOR, 'yok', {
        productId: '00000000-0000-7000-8000-000000000000',
        sortOrder: 0,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  /**
   * ⚠️ Kartı çizen tek ekran vitrin afişidir. Kapağa kart bağlanabilseydi
   *    yönetici bağlar, kaydedilir ve HİÇBİR YERDE görünmezdi — bu depoda altı
   *    kez yaşanan arızanın ta kendisi.
   */
  it('⚠️ kapağa (CATEGORY_COVER) kart eklenemez', async () => {
    const { service, prisma } = build();
    (prisma.siteImage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'si-2',
      slot: 'CATEGORY_COVER',
      cards: [],
    });

    await expect(
      service.addCard(ACTOR, 'si-2', {
        productId: '00000000-0000-7000-8000-000000000000',
        sortOrder: 0,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  /** Tavan bir YERLEŞİM ölçümüdür: dördüncü kart 1024px'te afişten taşar. */
  it(`⚠️ ${String(SITE_IMAGE_MAX_CARDS)} karttan fazlası reddedilir`, async () => {
    const { service, prisma } = build();
    (prisma.siteImage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'si-1',
      slot: 'HERO',
      cards: Array.from({ length: SITE_IMAGE_MAX_CARDS }, (_, i) => ({ id: `c-${String(i)}` })),
    });

    await expect(
      service.addCard(ACTOR, 'si-1', {
        productId: '00000000-0000-7000-8000-000000000000',
        sortOrder: 0,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  /**
   * ⚠️ Yayında olmayan ürün YAZMA anında reddedilir. Kabul edilseydi okuma
   *    filtresi kartı düşürür, yönetici "ekledim ama görünmüyor" derdi ve
   *    sebebini hiçbir yerde göremezdi.
   */
  it('⚠️ yayında olmayan ürün karta bağlanamaz', async () => {
    const { service, prisma } = build();
    (prisma.siteImage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'si-1',
      slot: 'HERO',
      cards: [],
    });
    (prisma.product.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await expect(
      service.addCard(ACTOR, 'si-1', {
        productId: '00000000-0000-7000-8000-000000000000',
        sortOrder: 0,
      }),
    ).rejects.toBeInstanceOf(AppError);

    // Sorgu `status: PUBLISHED` filtresini gerçekten taşıyor mu?
    expect(prisma.product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'PUBLISHED' }) }),
    );
  });
});

// ══════════════════════════ YÜKLEME AKIŞI ═══════════════════════════════════

describe('onay akışı — baytlardan doğrulama', () => {
  it('depoda olmayan yükleme onaylanamaz', async () => {
    const { service, storage } = build();
    storage.exists.mockResolvedValue(false);

    await expect(
      service.confirm(ACTOR, 'si-1', { slot: 'HERO', sortOrder: 0 }),
    ).rejects.toBeInstanceOf(AppError);
  });

  /**
   * ⚠️ Biçim İSTEMCİ BEYANINDAN değil İÇERİKTEN okunur. Beyan kabul edilseydi
   *    `image/webp` diyen bir HTML dosyası public kovaya inebilirdi.
   */
  it('⚠️ tanınmayan içerik reddedilir ve ham dosya silinir', async () => {
    const { service, storage } = build();
    storage.get.mockResolvedValue(Buffer.from('bu bir görsel değil'));

    await expect(
      service.confirm(ACTOR, 'si-1', { slot: 'HERO', sortOrder: 0 }),
    ).rejects.toBeInstanceOf(AppError);

    // Reddedilen ham dosya private kovada bırakılmaz.
    expect(storage.delete).toHaveBeenCalledWith(
      expect.stringContaining('staging/site/'),
      'private',
    );
  });
});

describe('silme — depo nesneleri', () => {
  /**
   * ⚠️ Türevler de silinir. Yalnız `original` silinseydi `SITE_BANNER_WIDTHS`
   *    kadar nesne depoda süresiz kalırdı ve kimse onları arayacak bir kayıt
   *    bulamazdı — satır gitmiş olurdu.
   */
  it('asıl nesne ve TÜM türevler silinir', async () => {
    const { service, prisma, storage } = build();
    (prisma.siteImage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'si-1',
      slot: 'HERO',
      targetKey: null,
      isActive: true,
    });
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          siteImage: { delete: vi.fn().mockResolvedValue({}) },
          auditLog: { create: vi.fn().mockResolvedValue({}) },
        }),
    );

    await service.remove(ACTOR, 'si-1');

    const keys = storage.deleteMany.mock.calls[0]?.[0] as string[];
    expect(keys).toHaveLength(SITE_BANNER_WIDTHS.length + 1);
    expect(storage.deleteMany).toHaveBeenCalledWith(expect.anything(), 'public');
  });
});
