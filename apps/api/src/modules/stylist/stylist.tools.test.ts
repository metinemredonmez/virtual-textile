import { describe, expect, it, vi } from 'vitest';
import type { CatalogService, ProductListItem } from '../catalog/catalog.service.js';
import type { OutfitService } from '../cart/index.js';
import type { TryOnPort, UserProfilePort } from './stylist.ports.js';
import { StylistToolExecutor, type ToolContext } from './tools/stylist.tools.js';
import { findUnknownIdsInText, ProductLedger } from './tools/product-ledger.js';
import { evaluateColorHarmony } from './tools/color-harmony.js';

/**
 * ARAÇ YANITI DOĞRULAMASI
 *
 * Sınanan tek soru: model katalogda OLMAYAN bir ürün kimliği verirse ne olur?
 * Beklenen cevap "sessizce geçilmez": araç hata döner, hiçbir yan etki
 * oluşmaz (sepete ekleme yapılmaz) ve olay sayaca yazılır.
 */

const REAL_PRODUCT_ID = '0192f3a1-1111-7000-8000-aaaaaaaaaaaa';
const REAL_VARIANT_ID = '0192f3a1-2222-7000-8000-bbbbbbbbbbbb';
/** Modelin uydurduğu, biçimi geçerli ama katalogda karşılığı olmayan kimlik. */
const FAKE_PRODUCT_ID = '0192f3a1-9999-7000-8000-cccccccccccc';
const FAKE_VARIANT_ID = '0192f3a1-8888-7000-8000-dddddddddddd';

function listItem(overrides: Partial<ProductListItem> = {}): ProductListItem {
  return {
    id: REAL_PRODUCT_ID,
    slug: 'keten-gomlek',
    title: 'Keten Gömlek',
    brandName: 'Marka',
    storeSlug: 'magaza',
    imageKey: null,
    blurhash: null,
    priceMinor: 89_900n,
    listPriceMinor: null,
    colors: ['Bej'],
    tryOnScore: null,
    tryOnable: true,
    ...overrides,
  };
}

interface Harness {
  executor: StylistToolExecutor;
  ctx: ToolContext;
  outfitCreate: ReturnType<typeof vi.fn>;
  productBySlug: ReturnType<typeof vi.fn>;
  tryOnPrepare: ReturnType<typeof vi.fn>;
}

function makeHarness(): Harness {
  const listProducts = vi.fn().mockResolvedValue({
    items: [listItem()],
    nextCursor: null,
    total: 1,
    facets: { colors: [], sizes: [], brands: [], priceRange: null },
    didYouMean: null,
  });

  const productBySlug = vi.fn().mockResolvedValue({
    id: REAL_PRODUCT_ID,
    slug: 'keten-gomlek',
    title: 'Keten Gömlek',
    brandName: 'Marka',
    variants: [
      { id: REAL_VARIANT_ID, color: 'Bej', size: 'M', priceMinor: 89_900n, available: true },
    ],
  });

  const catalog = { listProducts, productBySlug } as unknown as CatalogService;

  const outfitCreate = vi.fn().mockResolvedValue({
    outfit: { id: 'outfit-1', name: 'Kombin', tryOnJobId: null, createdAt: new Date(), items: [] },
    cart: { totalMinor: 89_900n },
  });
  const outfits = { create: outfitCreate } as unknown as OutfitService;

  const profiles: UserProfilePort = { findByUserId: vi.fn().mockResolvedValue(null) };
  const tryOnPrepare = vi.fn().mockResolvedValue({ available: true });
  const tryOn = { prepare: tryOnPrepare } as unknown as TryOnPort;

  return {
    executor: new StylistToolExecutor(catalog, outfits, profiles, tryOn),
    ctx: { userId: 'user-1', ledger: new ProductLedger(), preferredSize: null },
    outfitCreate,
    productBySlug: productBySlug as unknown as ReturnType<typeof vi.fn>,
    tryOnPrepare: tryOnPrepare as unknown as ReturnType<typeof vi.fn>,
  };
}

function parse(content: string): Record<string, unknown> {
  return JSON.parse(content) as Record<string, unknown>;
}

describe('araç yanıtı doğrulaması — uydurma ürün kimliği', () => {
  it('arama sonucundaki ürünü deftere yazar ve detayına izin verir', async () => {
    const h = makeHarness();

    await h.executor.execute('search_products', { query: 'keten gömlek' }, h.ctx);
    expect(h.ctx.ledger.has(REAL_PRODUCT_ID)).toBe(true);

    const detail = await h.executor.execute(
      'get_product_details',
      { productId: REAL_PRODUCT_ID },
      h.ctx,
    );

    expect(detail.isError).toBe(false);
    expect(h.ctx.ledger.hallucinationCount).toBe(0);
  });

  it('katalogda olmayan ürün kimliğinde HATA döner, sessizce geçmez', async () => {
    const h = makeHarness();
    await h.executor.execute('search_products', { query: 'keten gömlek' }, h.ctx);

    const result = await h.executor.execute(
      'get_product_details',
      { productId: FAKE_PRODUCT_ID },
      h.ctx,
    );

    // 1) Araç açıkça hata döner — model "bulundu" sanamaz.
    expect(result.isError).toBe(true);
    expect(String(parse(result.content).error)).toContain('katalogda karşılığı yok');

    // 2) Olay sayaca yazılır; denetim bunu okur.
    expect(h.ctx.ledger.hallucinationCount).toBe(1);

    // 3) Katalog servisine hiç gidilmez: uydurma kimlik sorguya dönüşmez.
    expect(h.productBySlug).not.toHaveBeenCalled();

    // 4) Öneri listesine sızmaz.
    expect(h.ctx.ledger.suggestedProductIds()).not.toContain(FAKE_PRODUCT_ID);
  });

  it('uydurma kimlikle sepete ekleme YAN ETKİ ÜRETMEZ', async () => {
    const h = makeHarness();
    await h.executor.execute('search_products', { query: 'keten gömlek' }, h.ctx);

    const result = await h.executor.execute(
      'add_outfit_to_cart',
      { productIds: [FAKE_PRODUCT_ID], outfitName: 'Yaz kombini' },
      h.ctx,
    );

    expect(result.isError).toBe(true);
    // ⚠️ En kritik satır: uydurma ürün sepete YAZILMAZ.
    expect(h.outfitCreate).not.toHaveBeenCalled();
    expect(h.ctx.ledger.hallucinationCount).toBe(1);
  });

  it('gerçek ve uydurma kimlik karışıksa TÜM işlem reddedilir', async () => {
    const h = makeHarness();
    await h.executor.execute('search_products', { query: 'keten gömlek' }, h.ctx);
    await h.executor.execute('get_product_details', { productId: REAL_PRODUCT_ID }, h.ctx);

    const result = await h.executor.execute(
      'add_outfit_to_cart',
      { productIds: [REAL_PRODUCT_ID, FAKE_PRODUCT_ID], outfitName: 'Karışık' },
      h.ctx,
    );

    // Kısmi yazma yok: "iki parçalık kombin" dedik, tek parça sepete girmez.
    expect(result.isError).toBe(true);
    expect(h.outfitCreate).not.toHaveBeenCalled();
  });

  it('uydurma varyant kimliğiyle sanal deneme açılmaz', async () => {
    const h = makeHarness();
    await h.executor.execute('search_products', { query: 'keten gömlek' }, h.ctx);
    await h.executor.execute('get_product_details', { productId: REAL_PRODUCT_ID }, h.ctx);

    const result = await h.executor.execute(
      'apply_to_tryon',
      { variantId: FAKE_VARIANT_ID },
      h.ctx,
    );

    expect(result.isError).toBe(true);
    expect(h.tryOnPrepare).not.toHaveBeenCalled();
    expect(h.ctx.ledger.hallucinationCount).toBe(1);
  });

  it('gerçek varyantla sanal deneme istemci eylemi üretir', async () => {
    const h = makeHarness();
    await h.executor.execute('search_products', { query: 'keten gömlek' }, h.ctx);
    await h.executor.execute('get_product_details', { productId: REAL_PRODUCT_ID }, h.ctx);

    const result = await h.executor.execute(
      'apply_to_tryon',
      { variantId: REAL_VARIANT_ID },
      h.ctx,
    );

    expect(result.isError).toBe(false);
    expect(result.clientAction?.type).toBe('tryon.open');
  });

  it('uyum kontrolü uydurma kimlikte çalışmaz', async () => {
    const h = makeHarness();
    await h.executor.execute('search_products', { query: 'keten gömlek' }, h.ctx);

    const result = await h.executor.execute(
      'check_outfit_compatibility',
      { productIds: [REAL_PRODUCT_ID, FAKE_PRODUCT_ID] },
      h.ctx,
    );

    expect(result.isError).toBe(true);
    expect(h.ctx.ledger.hallucinationCount).toBe(1);
  });

  it('biçimi bozuk kimlik doğrulama hatası döner, akışı düşürmez', async () => {
    const h = makeHarness();

    const result = await h.executor.execute('get_product_details', { productId: 'abc' }, h.ctx);

    expect(result.isError).toBe(true);
    expect(h.ctx.ledger.hallucinationCount).toBe(0);
  });
});

describe('defterin turlar arası taşınması', () => {
  it('önceki turda bulunan ürün yeni turda uydurma sayılmaz', async () => {
    const first = makeHarness();
    await first.executor.execute('search_products', { query: 'keten gömlek' }, first.ctx);
    const snapshot = first.ctx.ledger.toSnapshot();

    const second = makeHarness();
    second.ctx.ledger = ProductLedger.hydrate([snapshot]);

    const result = await second.executor.execute(
      'get_product_details',
      { productId: REAL_PRODUCT_ID },
      second.ctx,
    );

    expect(result.isError).toBe(false);
    expect(second.ctx.ledger.hallucinationCount).toBe(0);
  });

  it('bozuk kayıt atlanır, defter yine kurulur', () => {
    const ledger = ProductLedger.hydrate([null, { version: 9 }, { version: 1, products: 'x' }]);
    expect(ledger.knownIds()).toHaveLength(0);
  });
});

describe('düz metindeki uydurma kimlikler', () => {
  it('defterde olmayan kimliği metinde yakalar', () => {
    const ledger = new ProductLedger();
    ledger.record({
      id: REAL_PRODUCT_ID,
      slug: 'keten-gomlek',
      title: 'Keten Gömlek',
      brandName: 'Marka',
      priceMinor: 89_900n,
      colors: ['Bej'],
      variants: [],
      purchasable: true,
    });

    const unknown = findUnknownIdsInText(
      `Sana ${REAL_PRODUCT_ID} ve ${FAKE_PRODUCT_ID} ürünlerini öneriyorum.`,
      ledger,
    );

    expect(unknown).toEqual([FAKE_PRODUCT_ID]);
  });

  it('kimlik geçmeyen normal metinde uyarı üretmez', () => {
    expect(findUnknownIdsInText('Bej keten gömlek güzel durur.', new ProductLedger())).toEqual([]);
  });
});

describe('renk uyumu kural motoru', () => {
  it('çatışan renkleri reddeder', () => {
    expect(evaluateColorHarmony(['Kırmızı', 'Pembe']).verdict).toBe('CLASHING');
  });

  it('nötr kombini güvenli sayar', () => {
    expect(evaluateColorHarmony(['Siyah', 'Beyaz']).verdict).toBe('HARMONIOUS');
  });

  it('renk bilgisi yetersizse kesin hüküm vermez', () => {
    expect(evaluateColorHarmony(['Bej', 'Zümrüt Yeşili Melanj Desen']).verdict).not.toBe(
      'CLASHING',
    );
    expect(evaluateColorHarmony(['', '']).verdict).toBe('UNKNOWN');
  });
});
