import { z } from 'zod';
import { Money } from '@vt/contracts';
import { SEARCH } from '@vt/config';
import type { CatalogService, ProductListItem } from '../../catalog/catalog.service.js';
import type { OutfitService } from '../../cart/index.js';
import type { LlmToolSpec, TryOnPort, UserProfilePort } from '../stylist.ports.js';
import { evaluateColorHarmony } from './color-harmony.js';
import { HallucinatedProductError, ProductLedger, type LedgerProduct } from './product-ledger.js';

/**
 * ARAÇ KATMANI
 *
 * ⚠️ Model serbest metinle ürün ÜRETEMEZ. Öneriye konu olabilecek her ürün,
 *    bu dosyadaki bir aracın döndürdüğü sonuçtan gelmek zorundadır; kimlik
 *    doğrulaması `ProductLedger` tarafından yapılır.
 *
 * ⚠️ Araçlar SUNUCUDA çalışır. Sepete ekleme ve sanal deneme gibi yan etkili
 *    işlemler, kullanıcının kendi oturumu ve yetkisiyle yürütülür; modelin
 *    ürettiği kullanıcı kimliği ya da sahiplik iddiası hiçbir yerde dikkate
 *    alınmaz — modele güvenilen tek şey NİYETİDİR, kimliği değil.
 *
 * Tüm araçlar mevcut modül servislerini çağırır (CatalogService,
 * OutfitService). Bu modül başka modülün Prisma tablosuna dokunmaz.
 */

/** Bir turda kaç arama yapılabileceğinin tavanı — maliyet ve gecikme koruması. */
const MAX_SEARCH_RESULTS = 8;

// ── Girdi şemaları ─────────────────────────────────────────────────────────

/**
 * ⚠️ PARA: JSON bigint taşıyamaz, model de bigint üretemez. Sınırda TAM SAYI
 *    kuruş kabul edilir ve HEMEN bigint'e çevrilir. Bu değer hiçbir yerde
 *    Number aritmetiğine girmez.
 */
const priceMinorSchema = z.number().int().nonnegative().max(100_000_000);

const searchProductsSchema = z.object({
  query: z.string().trim().min(1).max(120),
  category: z.string().trim().max(120).optional(),
  colors: z.array(z.string().trim().min(1).max(40)).max(5).optional(),
  maxPriceMinor: priceMinorSchema.optional(),
  size: z.string().trim().min(1).max(20).optional(),
  gender: z.enum(['WOMAN', 'MAN', 'UNISEX', 'KIDS']).optional(),
});

const productIdSchema = z.string().uuid();

const getProductDetailsSchema = z.object({ productId: productIdSchema });
const getUserProfileSchema = z.object({}).optional();
const checkCompatibilitySchema = z.object({
  productIds: z.array(productIdSchema).min(2).max(6),
});
const applyToTryOnSchema = z.object({ variantId: z.string().uuid() });
const addOutfitToCartSchema = z.object({
  productIds: z.array(productIdSchema).min(1).max(8),
  outfitName: z.string().trim().min(1).max(80),
});

// ── Sağlayıcıya verilen şema tanımları ─────────────────────────────────────

/**
 * Araç tanımları.
 *
 * Açıklamalar modelin TEK yönlendirmesi: ne zaman çağıracağını, ne
 * döneceğini ve neyi ÇAĞIRMADAN yapamayacağını burada okur. Kısa tutulursa
 * model araç yerine kendi bilgisini kullanmaya kayar.
 */
export const STYLIST_TOOLS: readonly LlmToolSpec[] = [
  {
    name: 'search_products',
    description:
      'Katalogda ürün arar ve satın alınabilir sonuçları döner. Bir ürünü önermeden önce ' +
      'MUTLAKA bu aracı (veya get_product_details) çağırmalısın; bu araçtan dönmemiş hiçbir ' +
      'ürünü, markayı veya fiyatı yazma. Kullanıcı bütçe söylediyse maxPriceMinor ver. ' +
      'Sonuçlar zaten stokta olanlarla sınırlıdır.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Serbest metin arama, ör. "keten gömlek"' },
        category: {
          type: 'string',
          description: 'Kategori bağlantı adresi, ör. "kadin-ust-giyim"',
        },
        colors: {
          type: 'array',
          items: { type: 'string' },
          description: 'Türkçe renk adları, ör. ["siyah","bej"]',
        },
        maxPriceMinor: {
          type: 'integer',
          description: 'Üst fiyat sınırı KURUŞ cinsinden tam sayı (1.500 TL = 150000)',
        },
        size: { type: 'string', description: 'Beden, ör. "M"' },
        gender: { type: 'string', enum: ['WOMAN', 'MAN', 'UNISEX', 'KIDS'] },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_product_details',
    description:
      'Tek bir ürünün detayını, renk/beden varyantlarını ve stok durumunu döner. productId ' +
      'yalnızca daha önce search_products sonucundan gelmiş olabilir. Sepete eklemeden veya ' +
      'beden konuşmadan önce bunu çağır.',
    inputSchema: {
      type: 'object',
      properties: { productId: { type: 'string', description: 'search_products sonucundaki id' } },
      required: ['productId'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_user_profile',
    description:
      'Kullanıcının beden tercihi, kalıp tercihi, favorileri ve son satın aldığı bedenleri ' +
      'döner. Yalnızca öneriyi gerçekten değiştirecekse çağır. Vücut ölçüsü DÖNMEZ ve ' +
      'ölçü hakkında yorum yapamazsın.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'check_outfit_compatibility',
    description:
      'Verilen ürünlerin renk uyumunu değerlendirir ve kullanıcıya aktarılabilir bir gerekçe ' +
      'döner. Kombin önermeden ÖNCE çağır; sonuç "CLASHING" ise o kombini kullanıcıya sunma, ' +
      'parçalardan birini değiştir.',
    inputSchema: {
      type: 'object',
      properties: {
        productIds: { type: 'array', items: { type: 'string' }, description: '2-6 ürün kimliği' },
      },
      required: ['productIds'],
      additionalProperties: false,
    },
  },
  {
    name: 'apply_to_tryon',
    description:
      'Seçilen varyantı sanal deneme ekranında açmak için istemciye sinyal üretir. variantId ' +
      'yalnızca get_product_details sonucundan gelebilir. Denemeyi sen tamamlamazsın; ' +
      'kullanıcı fotoğrafını ve iznini kendi ekranında verir.',
    inputSchema: {
      type: 'object',
      properties: { variantId: { type: 'string', description: 'get_product_details varyant id' } },
      required: ['variantId'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_outfit_to_cart',
    description:
      'Ürünleri adlandırılmış bir kombin olarak kullanıcının sepetine ekler. YALNIZCA kullanıcı ' +
      'açıkça istediğinde çağır. Stokta olmayan parçalar atlanır ve sonuçta bildirilir; ' +
      'toplam tutarı sonuçtan oku, kendin hesaplama.',
    inputSchema: {
      type: 'object',
      properties: {
        productIds: { type: 'array', items: { type: 'string' } },
        outfitName: { type: 'string', description: 'Kombin adı, ör. "İş görüşmesi"' },
      },
      required: ['productIds', 'outfitName'],
      additionalProperties: false,
    },
  },
];

// ── Yürütücü ───────────────────────────────────────────────────────────────

export interface ToolExecutionResult {
  content: string;
  isError: boolean;
  /** İstemciye SSE ile iletilecek yan etki (sepet güncellendi, deneme aç). */
  clientAction?: { type: string; payload: unknown };
}

export interface ToolContext {
  userId: string;
  ledger: ProductLedger;
  /** Profilden okunan beden — varyant seçiminde kullanılır. */
  preferredSize: string | null;
}

interface ProductDetailShape {
  id: string;
  slug: string;
  title: string;
  brandName: string;
  variants: Array<{
    id: string;
    color: string;
    size: string;
    priceMinor: bigint;
    available: boolean;
  }>;
}

export class StylistToolExecutor {
  /**
   * Sepet yazma işi doğrudan CartService'e değil, OutfitService'e verilir:
   * kombin kaydı ile kalemleri tek transaction'da yazan akış oradadır. Aynı işi
   * burada CartService ile kurmak, kalemsiz kombin bırakma riskini bu modüle
   * kopyalamak olurdu.
   */
  constructor(
    private readonly catalog: CatalogService,
    private readonly outfits: OutfitService,
    private readonly profiles: UserProfilePort,
    private readonly tryOn: TryOnPort,
  ) {}

  /**
   * Aracı çalıştırır ve modele metin döner.
   *
   * ⚠️ HİÇBİR ARAÇ HATASI YUKARI FIRLATILMAZ. Fırlatılırsa tek bir yanlış
   *    parametre tüm sohbeti düşürür; oysa modelin doğru davranışı hatayı
   *    okuyup düzeltmesidir. Hata metni modele döner, akış devam eder.
   *    Tek istisna: uydurma ürün kimlikleri de hata olarak döner ama AYRICA
   *    deftere sayaç olarak işlenir (bkz. ProductLedger) — sessizce geçmez.
   */
  async execute(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolExecutionResult> {
    try {
      switch (name) {
        case 'search_products':
          return await this.searchProducts(searchProductsSchema.parse(rawInput), ctx);
        case 'get_product_details':
          return await this.getProductDetails(getProductDetailsSchema.parse(rawInput), ctx);
        case 'get_user_profile':
          getUserProfileSchema.parse(rawInput);
          return await this.getUserProfile(ctx);
        case 'check_outfit_compatibility':
          return this.checkCompatibility(checkCompatibilitySchema.parse(rawInput), ctx);
        case 'apply_to_tryon':
          return await this.applyToTryOn(applyToTryOnSchema.parse(rawInput), ctx);
        case 'add_outfit_to_cart':
          return await this.addOutfitToCart(addOutfitToCartSchema.parse(rawInput), ctx);
        default:
          return fail(`Bilinmeyen araç: ${name}`);
      }
    } catch (error) {
      if (error instanceof HallucinatedProductError) {
        // Modele NE olduğu açıkça söylenir; "bulunamadı" demek yetmez, çünkü
        // model o zaman aynı uydurma kimlikle tekrar dener.
        return fail(
          'Bu kimlik bu konuşmada hiçbir araçtan dönmedi, yani katalogda karşılığı yok. ' +
            'Uydurma kimlik kullanma; önce search_products ile ara ve dönen kimliği kullan.',
        );
      }
      if (error instanceof z.ZodError) {
        return fail(`Geçersiz araç parametresi: ${error.issues.map((i) => i.message).join('; ')}`);
      }
      // Katalog/sepet servisinin fırlattığı AppError dâhil her şey.
      return fail(error instanceof Error ? error.message : 'Araç çalıştırılamadı.');
    }
  }

  // ── search_products ──────────────────────────────────────────────────────

  private async searchProducts(
    input: z.infer<typeof searchProductsSchema>,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> {
    const result = await this.catalog.listProducts({
      q: input.query,
      category: input.category,
      gender: input.gender,
      color: input.colors,
      size: input.size ? [input.size] : undefined,
      // Bütçe: model "biraz üstü de olur" diyemesin diye filtre SORGUDA uygulanır.
      maxPriceMinor: input.maxPriceMinor === undefined ? undefined : BigInt(input.maxPriceMinor),
      // Stokta olmayan ürün öneri havuzuna hiç girmemeli.
      inStockOnly: true,
      sort: 'relevance',
      limit: Math.min(MAX_SEARCH_RESULTS, SEARCH.defaultPageSize),
    });

    ctx.ledger.recordMany(result.items.map(toLedgerProduct));

    return ok({
      total: result.total,
      // Model fiyatı hesaplamasın diye BİÇİMLENDİRİLMİŞ metin de veriliyor.
      products: result.items.map((item) => ({
        productId: item.id,
        title: item.title,
        brand: item.brandName,
        price: Money.formatMoney({ amountMinor: item.priceMinor, currency: 'TRY' }),
        priceMinor: item.priceMinor.toString(),
        colors: item.colors,
        tryOnable: item.tryOnable,
      })),
      note:
        result.items.length === 0
          ? 'Sonuç yok. Kullanıcıya aramayı nasıl daraltacağını sor; ürün uydurma.'
          : 'Yalnızca bu listedeki ürünleri önerebilirsin.',
    });
  }

  // ── get_product_details ──────────────────────────────────────────────────

  private async getProductDetails(
    input: z.infer<typeof getProductDetailsSchema>,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> {
    // ⚠️ Defter burada hem allowlist hem kimlik→slug çözücüsü. Katalog servisi
    //    ürünü slug ile veriyor; slug'ı yalnızca daha önce bize DÖNMÜŞ bir
    //    üründen bulabiliriz. Yani uydurma kimlik çözülemez.
    const known = ctx.ledger.require(input.productId);
    const detail = (await this.catalog.productBySlug(known.slug)) as ProductDetailShape;

    const variants = detail.variants.map((variant) => ({
      id: variant.id,
      color: variant.color,
      size: variant.size,
      available: variant.available,
    }));

    ctx.ledger.record({
      ...known,
      title: detail.title,
      brandName: detail.brandName,
      variants,
      purchasable: variants.some((v) => v.available),
    });

    return ok({
      productId: known.id,
      title: detail.title,
      brand: detail.brandName,
      variants: detail.variants.map((variant) => ({
        variantId: variant.id,
        color: variant.color,
        size: variant.size,
        price: Money.formatMoney({ amountMinor: variant.priceMinor, currency: 'TRY' }),
        inStock: variant.available,
      })),
      note: 'inStock=false olan bedeni önerme.',
    });
  }

  // ── get_user_profile ─────────────────────────────────────────────────────

  private async getUserProfile(ctx: ToolContext): Promise<ToolExecutionResult> {
    const profile = await this.profiles.findByUserId(ctx.userId);
    if (!profile) {
      return ok({ known: false, note: 'Profil bilgisi yok; beden konusunda iddialı olma.' });
    }

    if (profile.usualSize) ctx.preferredSize = profile.usualSize;

    // ⚠️ KVKK: boy/kilo/ölçü bu şekilde HİÇ yer almaz (bkz. stylist.ports.ts).
    return ok({
      known: true,
      usualSize: profile.usualSize,
      fitPreference: profile.fitPref,
      favorites: profile.favorites,
      recentPurchases: profile.recentPurchases,
      note: 'Beden bir tahmindir; "tam olur" deme. Vücut ve kilo hakkında yorum yapma.',
    });
  }

  // ── check_outfit_compatibility ───────────────────────────────────────────

  private checkCompatibility(
    input: z.infer<typeof checkCompatibilitySchema>,
    ctx: ToolContext,
  ): ToolExecutionResult {
    const products = ctx.ledger.requireAll(input.productIds);
    const dominantColors = products.map((product) => product.colors[0] ?? '');
    const harmony = evaluateColorHarmony(dominantColors);

    return ok({
      verdict: harmony.verdict,
      score: harmony.score,
      reasons: harmony.notes,
      items: products.map((product, index) => ({
        productId: product.id,
        title: product.title,
        color: dominantColors[index] ?? null,
      })),
      note:
        harmony.verdict === 'CLASHING'
          ? 'Bu kombini kullanıcıya sunma; bir parçayı nötr tonla değiştir ve tekrar kontrol et.'
          : 'Gerekçeyi kendi cümlelerinle aktar.',
    });
  }

  // ── apply_to_tryon ───────────────────────────────────────────────────────

  private async applyToTryOn(
    input: z.infer<typeof applyToTryOnSchema>,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> {
    const { product } = ctx.ledger.requireVariant(input.variantId);
    const handoff = await this.tryOn.prepare({ variantId: input.variantId, userId: ctx.userId });

    if (!handoff.available) {
      return ok({
        opened: false,
        reason: handoff.reason ?? 'Bu ürün için sanal deneme desteklenmiyor.',
      });
    }

    return {
      content: JSON.stringify({
        opened: true,
        productTitle: product.title,
        note: 'Sonucun bir tahmin olduğunu, gerçek kalıbın farklılık gösterebileceğini söyle.',
      }),
      isError: false,
      clientAction: {
        type: 'tryon.open',
        payload: handoff.action ?? { type: 'OPEN_TRYON', variantId: input.variantId },
      },
    };
  }

  // ── add_outfit_to_cart ───────────────────────────────────────────────────

  private async addOutfitToCart(
    input: z.infer<typeof addOutfitToCartSchema>,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> {
    const products = ctx.ledger.requireAll(input.productIds);

    // Detayı çekilmemiş ürünün varyantı bilinmez; sepete "ürün" değil "varyant"
    // eklenir. Eksik detayları burada tamamlıyoruz ki model iki adımı
    // karıştırdığında akış kırılmasın.
    for (const product of products) {
      if (product.variants.length === 0) {
        await this.getProductDetails({ productId: product.id }, ctx);
      }
    }

    const chosen: Array<{ variantId: string; quantity: number }> = [];
    const unavailable: string[] = [];

    for (const productId of input.productIds) {
      const product = ctx.ledger.require(productId);
      const variant = pickVariant(product, ctx.preferredSize);
      if (!variant) {
        unavailable.push(product.title);
        continue;
      }
      chosen.push({ variantId: variant.id, quantity: 1 });
    }

    if (chosen.length === 0) {
      return ok({
        added: false,
        unavailable,
        note: 'Hiçbir parça stokta değil. Alternatif ara, sepete ekleme.',
      });
    }

    const { outfit, cart } = await this.outfits.create(
      { kind: 'user', userId: ctx.userId },
      { name: input.outfitName, items: chosen },
    );

    return {
      content: JSON.stringify({
        added: true,
        outfitName: outfit.name,
        addedCount: outfit.items.length,
        unavailable,
        // ⚠️ Toplam SEPETTEN okunur. Model kalem fiyatlarını toplarsa kupon,
        //    kargo ve fiyat değişimini kaçırır ve kullanıcıya yanlış tutar söyler.
        cartTotal: Money.formatMoney({ amountMinor: cart.totalMinor, currency: 'TRY' }),
        note: 'Toplam tutarı yukarıdaki gibi aktar, kendin hesaplama.',
      }),
      isError: false,
      clientAction: { type: 'cart.updated', payload: { outfitId: outfit.id } },
    };
  }
}

// ── Yardımcılar ────────────────────────────────────────────────────────────

function ok(payload: unknown): ToolExecutionResult {
  return { content: JSON.stringify(payload), isError: false };
}

function fail(message: string): ToolExecutionResult {
  return { content: JSON.stringify({ error: message }), isError: true };
}

function toLedgerProduct(item: ProductListItem): LedgerProduct {
  return {
    id: item.id,
    slug: item.slug,
    title: item.title,
    brandName: item.brandName,
    priceMinor: item.priceMinor,
    colors: item.colors,
    variants: [],
    purchasable: true,
  };
}

/**
 * Sepete eklenecek varyantı seçer.
 *
 * Kullanıcının bilinen bedeni önce denenir; yoksa satılabilir ilk varyant.
 * Beden tahminini KULLANICI ADINA kesinleştirmiyoruz — sepetteki kalem
 * değiştirilebilir ve danışman "kesin bu beden" demiyor.
 */
function pickVariant(
  product: LedgerProduct,
  preferredSize: string | null,
): LedgerProduct['variants'][number] | undefined {
  const available = product.variants.filter((variant) => variant.available);
  if (available.length === 0) return undefined;
  if (preferredSize) {
    const match = available.find(
      (variant) =>
        variant.size.toLocaleUpperCase('tr-TR') === preferredSize.toLocaleUpperCase('tr-TR'),
    );
    if (match) return match;
  }
  return available[0];
}
