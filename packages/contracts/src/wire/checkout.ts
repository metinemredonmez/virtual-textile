import type { MinorString } from './money.js';

/**
 * ÖDEME TELİ — hepsi çalışan API'ye atılmış gerçek isteklerden okundu.
 *
 * Ölçüm komutları ve çıktıları bu dosyayı ekleyen ajanın raporunda; alan adları
 * tahmin EDİLMEDİ.
 */

/**
 * ⚠️ `sellerName` YOK — yalnızca `sellerId` geliyor. Özet ekranında satıcı adı
 *    göstermek isteyen taraf onu SEPETTEN taşımak zorunda (`CartPackageWire`).
 *    Buradan okumaya çalışmak `undefined` bir başlık çizer.
 */
export interface CheckoutInitPackageWire {
  sellerId: string;
  itemsTotalMinor: MinorString;
  /** Paket bazında kargo; eşiği aşan pakette "0". */
  shippingMinor: MinorString;
}

/**
 * `POST /v1/checkout/init` yanıtı.
 *
 * ⚠️ BU UÇ IDEMPOTENT DEĞİL — ne `@Idempotent()` taşıyor ne de `IdempotentPath`
 *    listesinde. ÖLÇÜLDÜ: aynı sepetle iki kez çağrıldığında İKİ AYRI sipariş
 *    doğdu (VT-260812-0040 ve VT-260812-0041) ve stok İKİ KEZ rezerve edildi.
 *    Yani çift tıklama = çift sipariş. Koruma tamamen istemcide: bir kez
 *    başarılı olduktan sonra `orderId` elde tutulur ve init BİR DAHA çağrılmaz.
 */
export interface CheckoutInitResultWire {
  orderId: string;
  /** VT-260812-0039 — kullanıcıya gösterilen numara; `orderId` değil. */
  orderNumber: string;
  itemsTotalMinor: MinorString;
  shippingTotalMinor: MinorString;
  discountMinor: MinorString;
  /** Tahsil edilecek tutar. Ekranda gösterilen toplam BUDUR. */
  grandTotalMinor: MinorString;
  /** ISO 8601. Rezervasyon `INVENTORY.reservationTtlMinutes` (15 dk) sonra düşer. */
  reservationExpiresAt: string;
  packages: CheckoutInitPackageWire[];
}

/**
 * `POST /v1/checkout/pay` yanıtı.
 *
 * ⚠️ `threeDsHtml` sağlayıcının ürettiği TAM bir HTML belgesidir (kendi kendine
 *    post eden form). Sayfaya `dangerouslySetInnerHTML` ile GÖMÜLMEZ — kendi
 *    kökenimizde üçüncü taraf betiği çalıştırmak olurdu. Ayrı bir çerçevede
 *    açılır.
 */
export interface CheckoutPayResultWire {
  orderId: string;
  providerRef: string;
  threeDsHtml: string;
}

/**
 * `POST /v1/payments/3ds/callback` yanıtı.
 *
 * ⚠️ Bu ucu BİZİM istemcimiz çağırmaz — bankanın yönlendirdiği tarayıcı
 *    çağırır. Tip burada, çağıran taraf için değil, `redirectUrl` sözleşmesini
 *    tek yerde yazılı tutmak için duruyor: sonuç sayfası o adresin
 *    parametrelerini (`siparis`, `durum`) okuyor.
 *
 * ⚠️ ÖLÇÜLDÜ: uç 200 + JSON zarf döndürüyor, 303 DEĞİL. Yani `redirectUrl`
 *    otomatik izlenmiyor; tarayıcı API kökeninde ham JSON'da kalıyor.
 *    Ayrıntı ve gerekçe: ödeme akışındaki `uc-d-s.tsx`.
 */
export interface ThreeDsCallbackResultWire {
  orderId: string;
  orderNumber: string;
  status: 'PAID' | 'FAILED' | 'PENDING';
  /** Katalog metni. Ham banka kodu ASLA içermez. */
  message?: string;
  redirectUrl: string;
}

/**
 * `redirectUrl` üzerindeki `durum` parametresi — küçük harfli statü.
 *
 * ⚠️ Sunucu `status.toLowerCase()` yazıyor; bu birlik `checkout.service.ts`
 *    `callbackResult()` ile aynı ifadeden türemiyor, o yüzden sonuç sayfası
 *    tanımadığı değeri "bilinmiyor" dalına düşürür — sessizce "ödendi"
 *    varsaymaz.
 */
export type ThreeDsSonucDurumu = 'paid' | 'failed' | 'pending';
