import type { MinorString } from './money.js';

/** Kalemin neden alınamadığı. Toplamdan düşen sorunlar da bu listede. */
export type CartItemIssueWire =
  'UNAVAILABLE' | 'SELLER_ON_VACATION' | 'OUT_OF_STOCK' | 'INSUFFICIENT_STOCK';

export interface CartItemWire {
  id: string;
  variantId: string;
  outfitId: string | null;
  quantity: number;
  productTitle: string;
  productSlug: string;
  color: string;
  size: string;
  imageKey: string | null;
  unitPriceMinor: MinorString;
  lineTotalMinor: MinorString;
  /** Sepete atıldığı andaki fiyat değiştiyse güncel fiyat burada. */
  currentUnitPriceMinor: MinorString;
  priceChanged: boolean;
  priceDiffMinor: MinorString;
  issue: CartItemIssueWire | null;
  /**
   * ⚠️ `INSUFFICIENT_STOCK` hatasının `details`i YOK — adet yalnızca hata
   * METNİNDE geçer ve metinden sayı ayıklamak yasak. Yapılandırılmış bilgi
   * burada: adet seçici bu değerle sınırlanır.
   */
  maxAvailable: number | null;
}

/** Sepet satıcı bazında paketlenir; kargo ve komisyon paket bazında işler. */
export interface CartPackageWire {
  sellerId: string;
  sellerName: string;
  storeSlug: string;
  items: CartItemWire[];
  subtotalMinor: MinorString;
  discountMinor: MinorString;
  totalMinor: MinorString;
}

/**
 * Kuponun sepetteki NEDEN'i taşıyan alanı `rejection`dır, tutar değil.
 *
 * ⚠️ ÖLÇÜM (GET /v1/cart, çalışan API): bu arayüz daha önce
 *    `{ code, discountMinor }` yazıyordu ve sunucuda ÖYLE BİR ŞEKİL YOK.
 *    `cart.service.ts` → `buildView()` `{ code, sellerId, discountType,
 *    rejection }` gönderiyor; indirim tutarı sepetin KÖKÜNDEKİ
 *    `discountMinor` alanında. Yanlış alanı okuyan ekran `undefined`
 *    biçimlendirir ve `formatMinor(undefined)` `BigInt(undefined)` ile
 *    patlar — sepet ekranı kupon uygulanır uygulanmaz beyaz ekrana düşerdi.
 *
 * ⚠️ `rejection` DOLU olduğu hâlde kupon sepette DURUR: sunucu kuponu
 *    düşürmez, yalnızca uygulamaz. `rejection !== null` iken indirim 0'dır ve
 *    kullanıcıya SEBEP söylenmelidir; aksi hâlde "kuponu girdim ama tutar
 *    değişmedi" diye bakar.
 *
 * ⚠️ Sepette dururken süresi dolan kupon `{ code: '', sellerId: null,
 *    discountType: '', rejection: 'EXPIRED' }` olarak gelir — `code` BOŞ
 *    STRING'tir. Kod alanını doğrudan basan ekran boş bir rozet çizer.
 */
export interface CartCouponWire {
  code: string;
  /** null = platform kuponu, dolu = tek mağazaya kısıtlı. */
  sellerId: string | null;
  discountType: string;
  rejection: 'NOT_APPLICABLE' | 'MIN_AMOUNT' | 'EXPIRED' | null;
}

export interface CartWire {
  /** Hiç kalem eklenmemiş misafir sepetinde `null` — sepet henüz yaratılmadı. */
  id: string | null;
  packages: CartPackageWire[];
  unavailableItems: CartItemWire[];
  coupon: CartCouponWire | null;
  subtotalMinor: MinorString;
  discountMinor: MinorString;
  /**
   * ⚠️ Frontend bu değeri YENİDEN HESAPLAMAZ. `cart-totals.ts` indirimi
   * `Money.allocate()` ile kuruş kaybı olmadan paylaştırıyor; ikinci bir
   * toplama half-up yuvarlamayı ve kalan dağıtımını farklı yapardı.
   */
  totalMinor: MinorString;
  itemCount: number;
  distinctItemCount: number;
  hasPriceChange: boolean;
  freeShipping: boolean;
  expiresAt: string | null;
}

export interface SkippedCartItemWire {
  variantId: string;
  reason: CartItemIssueWire | 'CART_FULL';
}

/**
 * `POST /v1/cart/merge` yanıtı.
 *
 * ⚠️ `skipped` sessizce yutulmaz: kullanıcı misafirken sepete attığı ürünün
 * kaybolduğunu ancak ödeme ekranında fark ederse güveni gider.
 */
export interface CartMergeResultWire extends CartWire {
  skipped: SkippedCartItemWire[];
}
