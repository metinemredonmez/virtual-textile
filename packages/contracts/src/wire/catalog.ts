import type { MinorString } from './money.js';

/**
 * KATALOG — telde görünen şekil.
 *
 * Bu dosyadaki her alan ÇALIŞAN API'ye atılmış gerçek bir istekten okundu
 * (`GET /v1/products?limit=2`, `GET /v1/products/keten-gomlek-oversize`),
 * `ProductListItem` arayüzünden değil. Fark önemli: view tipi `bigint` ve `Date`
 * taşır, tel string taşır; ikisini aynı sanmak paranın `Number`'a düşmesi
 * demektir.
 */

export type GenderWire = 'WOMAN' | 'MAN' | 'UNISEX' | 'KIDS';
export type ImageAngleWire = 'FRONT' | 'BACK' | 'SIDE' | 'DETAIL' | 'MODEL' | 'FLATLAY';

export interface ProductListItemWire {
  id: string;
  slug: string;
  title: string;
  brandName: string;
  storeSlug: string;
  /** R2 nesne anahtarı — tam adres DEĞİL. `lib/media.ts` genel CDN kökünü ekler. */
  imageKey: string | null;
  blurhash: string | null;
  priceMinor: MinorString;
  listPriceMinor: MinorString | null;
  colors: string[];
  tryOnScore: number | null;
  tryOnable: boolean;
}

export interface FacetBucketWire {
  value: string;
  label: string;
  count: number;
}

export interface ProductFacetsWire {
  colors: FacetBucketWire[];
  sizes: FacetBucketWire[];
  brands: FacetBucketWire[];
  priceRange: { minMinor: MinorString; maxMinor: MinorString } | null;
}

/**
 * ⚠️ `nextCursor` ve `total` BURADA DEĞİL — zarfın `meta`sındadır.
 * `EnvelopeInterceptor` sayfalama alanlarını `data`dan çıkarıp `meta`ya taşıyor.
 * Denetleyici `facets`/`didYouMean` gibi kardeş alanlar da döndürdüğü için `data`
 * çıplak dizi değil, nesne olarak kalıyor. İki şekli de karşılayan liste
 * yardımcısı için bkz. `apps/web/src/lib/api/core.ts` → `list()`.
 */
export interface ProductListPayloadWire {
  items: ProductListItemWire[];
  facets: ProductFacetsWire;
  didYouMean: string | null;
}

export interface ProductVariantWire {
  id: string;
  sku: string;
  color: string;
  colorHex: string | null;
  size: string;
  priceMinor: MinorString;
  listPriceMinor: MinorString | null;
  /** Ham stok adedi dışarı verilmiyor; yalnızca satılabilirlik sinyali var. */
  available: boolean;
  lowStock: boolean;
}

export interface ProductImageWire {
  id: string;
  productId: string;
  storageKey: string;
  angle: ImageAngleWire;
  isPrimary: boolean;
  bgRemovedKey: string | null;
  blurhash: string | null;
  widthPx: number;
  heightPx: number;
  sortOrder: number;
  createdAt: string;
}

export interface ProductDetailWire {
  id: string;
  sellerId: string;
  categoryId: string;
  slug: string;
  title: string;
  description: string;
  brandName: string;
  gender: GenderWire;
  season: string | null;
  collection: string | null;
  status: string;
  statusReason: string | null;
  aiTags: Record<string, string> | null;
  aiTagsApproved: boolean;
  tryOnScore: number | null;
  tryOnIssues: unknown;
  /** Beden → ölçü haritası; kategoriye göre anahtarları değişir. */
  sizeChart: Record<string, Record<string, number>> | null;
  viewCount: number;
  tryOnCount: number;
  popularityScore: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  images: ProductImageWire[];
  category: { slug: string; name: string; tryOnCategory: TryOnCategoryWire | null };
  seller: {
    id: string;
    displayName: string;
    qualityScore: number | null;
    vacationMode: boolean;
    store: { slug: string } | null;
  };
  variants: ProductVariantWire[];
  /** Kategori bazlı; deneme düğmesinin görünürlük kapısı. */
  tryOnable: boolean;
}

/**
 * ⚠️ Bu union `@vt/config` → `TryOnCategoryName` ile AYNI olmak zorunda.
 * Ayrıştıkları gün `isTryOnSupported()` çağrısı derlenmez — istenen budur;
 * sessizce yanlış kategoriye deneme düğmesi çıkmasındansa derleme kırılsın.
 */
export type TryOnCategoryWire =
  'UPPER_BODY' | 'LOWER_BODY' | 'DRESS' | 'OUTERWEAR' | 'SHOES' | 'JEWELRY' | 'BAG' | 'ACCESSORY';

export interface CategoryNodeWire {
  id: string;
  slug: string;
  name: string;
  parentId: string | null;
  tryOnCategory: TryOnCategoryWire | null;
  children: CategoryNodeWire[];
}
