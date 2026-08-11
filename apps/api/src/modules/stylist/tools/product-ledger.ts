/**
 * ÜRÜN DEFTERİ — "UYDURMA ÜRÜN" KORUMASI
 *
 * ⚠️ BU MODÜLÜN EN KRİTİK PARÇASI.
 *
 * Bir dil modeli, katalogda olmayan bir ürünü tam bir güvenle uydurabilir:
 * makul bir başlık, makul bir fiyat, geçerli biçimde bir uuid. Prompt "sadece
 * araçtan dönen ürünleri öner" dese bile bu bir RİCADIR, garanti değil.
 *
 * Garanti burada kurulur: bir ürün kimliği, ancak BU TURDA bir araç çağrısının
 * sonucunda bize döndüyse deftere yazılır. Sonraki araç çağrıları (detay,
 * uyum, sepete ekleme, deneme) yalnızca defterdeki kimlikleri kabul eder.
 * Defterde olmayan kimlik SESSİZCE GEÇİLMEZ: araç hata döndürür, sayaç artar
 * ve olay uyarı seviyesinde loglanır.
 *
 * Defter aynı zamanda kimlik→slug çözücüsüdür: katalog servisi ürünü slug ile
 * veriyor, model ise kimlikle konuşuyor. Eşleme yalnızca deftere yazılmış
 * ürünler için mümkün olduğundan, çözücü ile allowlist AYNI ŞEY olur — ikisi
 * ayrı tutulsaydı biri güncellenip diğeri unutulabilirdi.
 */

export interface LedgerProduct {
  id: string;
  slug: string;
  title: string;
  brandName: string;
  priceMinor: bigint;
  colors: string[];
  /** Detay çağrısı yapıldıysa dolu; satın alınabilir varyantlar. */
  variants: Array<{ id: string; color: string; size: string; available: boolean }>;
  /** En az bir satılabilir varyantı var mı. */
  purchasable: boolean;
}

export class HallucinatedProductError extends Error {
  constructor(
    readonly kind: 'product' | 'variant',
    readonly id: string,
  ) {
    super(
      kind === 'product'
        ? `Ürün kimliği ${id} bu konuşmada hiçbir araçtan dönmedi`
        : `Varyant kimliği ${id} bu konuşmada hiçbir araçtan dönmedi`,
    );
    this.name = 'HallucinatedProductError';
  }
}

export class ProductLedger {
  private readonly products = new Map<string, LedgerProduct>();
  private readonly variantOwners = new Map<string, string>();

  /** Modelin katalog dışı kimlik ürettiği kaç kez yakalandı. */
  private hallucinations = 0;

  /** Bu turda araç çağrılarında GEÇERLİ olarak referans verilen ürünler. */
  private readonly referenced = new Set<string>();

  record(product: LedgerProduct): void {
    const existing = this.products.get(product.id);
    // Detay çağrısı arama sonucunun üzerine yazar (varyant listesi gelir);
    // tersi olmamalı, yoksa varyantlar kaybolur ve sepete ekleme çöker.
    if (existing && product.variants.length === 0) {
      this.products.set(product.id, { ...product, variants: existing.variants });
    } else {
      this.products.set(product.id, product);
    }

    for (const variant of product.variants) {
      this.variantOwners.set(variant.id, product.id);
    }
  }

  recordMany(products: readonly LedgerProduct[]): void {
    for (const product of products) this.record(product);
  }

  has(productId: string): boolean {
    return this.products.has(productId);
  }

  /**
   * Kimliği doğrular ve ürünü döner.
   * @throws HallucinatedProductError defterde yoksa — çağıran bunu araç
   *         hatasına çevirir, akışı durdurmaz.
   */
  require(productId: string): LedgerProduct {
    const product = this.products.get(productId);
    if (!product) {
      this.hallucinations += 1;
      throw new HallucinatedProductError('product', productId);
    }
    this.referenced.add(productId);
    return product;
  }

  requireAll(productIds: readonly string[]): LedgerProduct[] {
    return productIds.map((id) => this.require(id));
  }

  requireVariant(variantId: string): { product: LedgerProduct; color: string; size: string } {
    const productId = this.variantOwners.get(variantId);
    const product = productId ? this.products.get(productId) : undefined;
    if (!product) {
      this.hallucinations += 1;
      throw new HallucinatedProductError('variant', variantId);
    }
    const variant = product.variants.find((v) => v.id === variantId);
    if (!variant) {
      this.hallucinations += 1;
      throw new HallucinatedProductError('variant', variantId);
    }
    this.referenced.add(product.id);
    return { product, color: variant.color, size: variant.size };
  }

  get hallucinationCount(): number {
    return this.hallucinations;
  }

  /** StylistMessage.suggestedProductIds — denetim izinin kaynağı. */
  suggestedProductIds(): string[] {
    return [...this.referenced];
  }

  /** Deftere girmiş tüm ürünler — metin denetimi için. */
  knownIds(): string[] {
    return [...this.products.keys()];
  }

  /**
   * Defteri JSON'a çevirir (StylistMessage.toolCalls içinde saklanır).
   *
   * ⚠️ Defter TURLAR ARASINDA yaşamalı. Kullanıcı "birincisini sepete ekle"
   *    dediğinde ürün önceki turda bulunmuştu; defter sıfırlansaydı geçerli
   *    bir kimlik "uydurma" sayılır ve akış kilitlenirdi.
   *
   * ⚠️ bigint JSON'da serileşmez; kuruş tutarı STRING olarak yazılır,
   *    Number'a çevrilmez.
   */
  toSnapshot(): LedgerSnapshot {
    return {
      version: 1,
      products: [...this.products.values()].map((product) => ({
        ...product,
        priceMinor: product.priceMinor.toString(),
      })),
    };
  }

  /**
   * Kalıcı kayıtlardan defteri geri kurar.
   *
   * Girdi veritabanından gelen ham JSON'dur; şeması garanti DEĞİLDİR (eski
   * sürüm, elle düzeltme, kısmi yazma). Bu yüzden alan alan doğrulanır ve
   * bozuk kayıt atlanır — tek bozuk satır yüzünden konuşmanın açılamaması
   * kabul edilemez.
   */
  static hydrate(snapshots: ReadonlyArray<unknown>): ProductLedger {
    const ledger = new ProductLedger();

    for (const raw of snapshots) {
      if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.products)) continue;

      for (const entry of raw.products) {
        if (!isRecord(entry)) continue;
        const { id, slug } = entry;
        if (typeof id !== 'string' || typeof slug !== 'string') continue;

        ledger.record({
          id,
          slug,
          title: typeof entry.title === 'string' ? entry.title : '',
          brandName: typeof entry.brandName === 'string' ? entry.brandName : '',
          priceMinor: parseMinor(entry.priceMinor),
          colors: Array.isArray(entry.colors)
            ? entry.colors.filter((color): color is string => typeof color === 'string')
            : [],
          variants: Array.isArray(entry.variants) ? entry.variants.filter(isVariant) : [],
          purchasable: entry.purchasable === true,
        });
      }
    }

    return ledger;
  }
}

/** Kalıcı biçim — bigint yerine string. */
export interface LedgerSnapshot {
  version: 1;
  products: Array<Omit<LedgerProduct, 'priceMinor'> & { priceMinor: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isVariant(value: unknown): value is LedgerProduct['variants'][number] {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.color === 'string' &&
    typeof value.size === 'string' &&
    typeof value.available === 'boolean'
  );
}

/** Kuruş tutarı string olarak saklanır; bozuk değer 0 sayılır, patlamaz. */
function parseMinor(value: unknown): bigint {
  if (typeof value !== 'string' || !/^\d{1,18}$/.test(value)) return 0n;
  return BigInt(value);
}

/** uuid v4/v7 — katalog kimlikleri bu biçimde. */
const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

/**
 * Asistan metnindeki uydurma kimlikleri yakalar.
 *
 * Araç katmanı ürün kimliğini doğruluyor ama model kimliği araç çağırmadan
 * DÜZ METİNDE de yazabilir ("ürün 3f2a...-... sana uyar"). Bu, arayüzde
 * tıklanamayan ölü bir öneriye dönüşür. Metinde geçen ve defterde olmayan
 * her kimlik kayda geçer.
 */
export function findUnknownIdsInText(text: string, ledger: ProductLedger): string[] {
  const matches = text.match(UUID_PATTERN);
  if (!matches) return [];
  const unknown = matches.filter((id) => !ledger.has(id.toLowerCase()));
  return [...new Set(unknown)];
}
