import { AppError } from '@vt/contracts';
import type { CartItemView, CartView, ItemIssue } from '../cart/index.js';

/**
 * CHECKOUT'A GİRİŞ KAPISI — "sepet boş" ile "sepettekiler alınamaz" AYRIMI
 *
 * ⚠️ NEDEN AYRI BİR KARAR: `CartService.view()` satın alınamaz kalemleri
 *    `packages`'tan ÇIKARIP `unavailableItems`'a taşır (toplam da onlarsız
 *    hesaplanır). Bu yüzden `packages.length === 0` "sepet boş" DEMEK
 *    DEĞİLDİR — son ürünü başka bir müşteriye kaptıran kullanıcının sepeti de
 *    tam olarak böyle görünür. İki durum aynı kodla (CART_EMPTY) reddedilince
 *    kullanıcı ekranda duran ürününe bakarken "Sepetiniz boş." okuyor ve
 *    yapacak bir şey bulamıyordu.
 *
 * ⚠️ GÜVENLİK TARAFI DEĞİŞMİYOR: her üç durumda da checkout REDDEDİLİR, stok
 *    rezervasyonu yine tek transaction içinde optimistik kilitle yapılır.
 *    Burada değişen yalnızca kullanıcının gördüğü hata kodu ve mesajı.
 *
 * Karar saf tutuldu: sepet görünümü girer, fırlatılacak hata çıkar. Servisin
 * içine gömülü olduğu sürece üç durum ancak uçtan uca sınanabiliyordu.
 */

/**
 * Hata `details`'ine giren alınamaz kalem.
 *
 * ⚠️ Yalnızca `variantId` dönmek yetmez: kullanıcı "sepetimden neyi
 *    çıkaracağım" sorusunu kimliğe bakarak yanıtlayamaz, ürün adını ve
 *    renk/beden bilgisini görmesi gerekir.
 * ⚠️ `maxAvailable` sepet görünümünden OLDUĞU GİBİ taşınır, yeniden
 *    hesaplanmaz: ham stok adedi bilinçli olarak yalnızca INSUFFICIENT_STOCK
 *    durumunda doldurulur (rakip envanter takibine karşı, bkz. cart.service).
 */
export interface UnavailableItemDetail {
  variantId: string;
  productTitle: string;
  color: string;
  size: string;
  quantity: number;
  /** Kalemin neden düştüğü — sepet görünümündeki `issue` değeri. */
  reason: ItemIssue | null;
  /** Stok yetersizse alınabilecek azami adet; aksi hâlde null. */
  maxAvailable: number | null;
}

export interface CheckoutRejectionDetails {
  items: UnavailableItemDetail[];
  /**
   * Alınamayan kalemler çıkarılırsa sipariş verilebilir mi?
   * İstemci "bu kalemi çıkar ve devam et" mi yoksa "sepette alınabilir hiçbir
   * şey kalmadı" mı diyeceğini buna göre seçer.
   */
  hasPurchasableItems: boolean;
}

/**
 * Stok kaynaklı sorunlar. Diğerleri (yayından kalkma, mağazanın tatili)
 * stokla ilgisizdir; "en fazla N adet alabilirsiniz" mesajı onlarda yanıltıcı
 * olur — kullanıcı adedi düşürerek çözmeye çalışır, oysa ürün satışta değil.
 */
const STOCK_ISSUES: ReadonlySet<ItemIssue> = new Set<ItemIssue>([
  'OUT_OF_STOCK',
  'INSUFFICIENT_STOCK',
]);

/**
 * Sepet siparişe çevrilebilir mi?
 *
 * @returns Fırlatılacak hata, ya da sepet uygunsa `null`.
 *
 * Karar tablosu:
 *   packages boş + unavailable boş   → CART_EMPTY (gerçekten boş)
 *   unavailable dolu, hepsi stok     → INSUFFICIENT_STOCK (+ details)
 *   unavailable dolu, en az biri     → VARIANT_UNAVAILABLE (+ details)
 *   stok dışı bir nedenle düşmüş
 *
 * `packages` dolu olsa bile alınamaz kalem varsa istek REDDEDİLİR: kullanıcı
 * sepetinde gördüğü ürünün siparişte olmadığını fark etmeden ödeme yapmamalı.
 */
export function checkoutRejection(view: CartView): AppError | null {
  const unavailable = view.unavailableItems;

  // Hiç sepet satırı yok ya da ne alınabilir ne alınamaz kalem var: gerçekten boş.
  if (!view.id || (view.packages.length === 0 && unavailable.length === 0)) {
    return new AppError('CART_EMPTY');
  }

  if (unavailable.length === 0) return null;

  const details: CheckoutRejectionDetails = {
    items: unavailable.map(toDetail),
    hasPurchasableItems: view.packages.length > 0,
  };

  // Tek bir kalem bile stok dışı bir nedenle düştüyse genel kod kullanılır:
  // "Yeterli stok kalmadı" başlığı o kalem için yanlış olurdu. Hangi kalemin
  // hangi nedenle düştüğü zaten `details.items[].reason` içinde.
  const stockOnly = unavailable.every(
    (item) => item.issue !== null && STOCK_ISSUES.has(item.issue),
  );

  if (stockOnly) {
    return new AppError('INSUFFICIENT_STOCK', {
      params: { available: minAvailable(unavailable) },
      details,
      internalMessage: `Checkout reddedildi: ${unavailable.length} kalemde stok yetersiz`,
    });
  }

  return new AppError('VARIANT_UNAVAILABLE', {
    details,
    internalMessage: `Checkout reddedildi: ${unavailable.length} kalem satın alınamaz durumda`,
  });
}

function toDetail(item: CartItemView): UnavailableItemDetail {
  return {
    variantId: item.variantId,
    productTitle: item.productTitle,
    color: item.color,
    size: item.size,
    quantity: item.quantity,
    reason: item.issue,
    maxAvailable: item.maxAvailable,
  };
}

/**
 * Mesajdaki `{available}` için en KISITLAYICI adet.
 *
 * ⚠️ `maxAvailable` yalnızca INSUFFICIENT_STOCK'ta dolu gelir; tükenen
 *    (OUT_OF_STOCK) kalemde null'dır ve 0 olarak okunur — mesajın "en fazla 0
 *    adet" demesi, stoğun bittiğinin dolaylı ama doğru ifadesidir.
 */
function minAvailable(items: ReadonlyArray<CartItemView>): number {
  return items.reduce(
    (least, item) => Math.min(least, item.maxAvailable ?? 0),
    Number.MAX_SAFE_INTEGER,
  );
}
