import type { MinorString } from './money.js';

/**
 * HESAP BÖLGESİNİN TEL TİPLERİ — sipariş, gardırop, KVKK.
 *
 * ⚠️ HER TİPİN YANINDA KAYNAĞI YAZILI ve ikisi AYNI ŞEY DEĞİL:
 *      "ÖLÇÜLDÜ"      → çalışan API'ye istek atıldı, gelen gövde okundu.
 *      "KAYNAKTAN"     → `apps/api` içindeki `select`/`return` okundu, telde
 *                        doğrulanamadı (o veriyi üretecek kayıt yerelde yok).
 *    Ayrım süs değil: "KAYNAKTAN" olanlar bir gün sessizce sapabilir, çünkü
 *    hiçbir test iki tarafı birbirine bağlamıyor (bkz. wire/index.ts başlığı).
 *
 * ⚠️ Para alanlarının adı DEĞİŞTİRİLMEZ. `grandTotalMinor` → `total` yapmak
 *    eslint'in `Number(*Minor)` korumasını o alan için sessizce kapatır.
 */

// ══════════════════════════ KİMLİK / OTURUM ═══════════════════════════════

/**
 * `GET /v1/auth/sessions` — ÖLÇÜLDÜ.
 * `{"id":"25906acf-…","deviceLabel":"Bilinmeyen cihaz","ipAddress":"203.0.113.77",
 *   "createdAt":"2026-08-12T14:00:53.011Z","lastUsedAt":"…","current":true}`
 *
 * Tip `@vt/contracts`teki `SessionSummary` ile birebir aynı; burada yeniden
 * yazılmadı, oradan import edilir.
 */

/**
 * `POST /api/auth/login` (vekil) — ÖLÇÜLDÜ.
 * Vekil `authenticate()` sonucunu zarflar: `{ user, skipped }`.
 * `AuthenticateResult` `lib/session/authenticate.ts` içinde; oradan import edilir.
 */

// ══════════════════════════════ SİPARİŞ ═══════════════════════════════════

/** Prisma `OrderStatus` — veritabanı enum'ından okundu (`enum_range`). */
export type OrderStatusWire =
  | 'PENDING_PAYMENT'
  | 'PAYMENT_FAILED'
  | 'EXPIRED'
  | 'PAID'
  | 'PARTIALLY_SHIPPED'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REFUNDED';

/** Prisma `PackageStatus` — veritabanı enum'ından okundu. */
export type PackageStatusWire =
  | 'AWAITING_APPROVAL'
  | 'PREPARING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'RETURN_REQUESTED'
  | 'RETURNED';

/** Prisma `ReturnStatus` — veritabanı enum'ından okundu. */
export type ReturnStatusWire =
  'REQUESTED' | 'APPROVED' | 'REJECTED' | 'IN_TRANSIT' | 'RECEIVED' | 'REFUNDED' | 'CANCELLED';

/** Prisma `ReturnReason` — `order.schema.ts` `returnReasonSchema` ile aynı sıra. */
export type ReturnReasonWire =
  | 'SIZE_TOO_SMALL'
  | 'SIZE_TOO_LARGE'
  | 'NOT_AS_DESCRIBED'
  | 'DAMAGED'
  | 'WRONG_ITEM'
  | 'CHANGED_MIND'
  | 'QUALITY'
  | 'OTHER';

/**
 * `GET /v1/orders` — ÖLÇÜLDÜ (boş liste: `{"data":[],"meta":{…,"nextCursor":null}}`).
 *
 * ⚠️ Zarf `data`yı ÇIPLAK DİZİ yapıyor, `{items,nextCursor}` nesnesi DEĞİL —
 *    denetleyici yalnızca o iki alanı döndürdüğü için. `nextCursor` `meta`ya
 *    taşınmış durumda. `list()` ikisini de açar; elle `data.items` okunmaz.
 *
 * Kalem şekli `order.service.ts` → `listForUser` `select`inden okundu.
 */
export interface OrderListItemWire {
  id: string;
  orderNumber: string;
  /** ⚠️ Kolondan değil, paketlerden TÜRETİLİR (`statusOf`). */
  status: OrderStatusWire;
  grandTotalMinor: MinorString;
  currency: string;
  createdAt: string;
  packageCount: number;
  itemCount: number;
  /** İlk 4 kalem — liste kartında küçük görsel şeridi için. */
  previewItems: {
    id: string;
    productTitle: string;
    variantLabel: string;
    imageKey: string;
    quantity: number;
  }[];
}

/** KAYNAKTAN — `order.service.ts` → `getByOrderNumber` `select` + `map`. */
export interface OrderItemWire {
  id: string;
  productId: string;
  productTitle: string;
  brandName: string;
  variantLabel: string;
  sku: string;
  imageKey: string;
  unitPriceMinor: MinorString;
  quantity: number;
  lineTotalMinor: MinorString;
}

/** KAYNAKTAN — aynı `select`. */
export interface OrderPackageWire {
  id: string;
  sellerId: string;
  status: PackageStatusWire;
  carrier: string | null;
  trackingNo: string | null;
  slaDeadline: string;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  shippingMinor: MinorString;
  itemsTotalMinor: MinorString;
  discountShareMinor: MinorString;
  seller: { id: string; displayName: string };
  items: OrderItemWire[];
  /** Sunucu HESAPLIYOR: `AWAITING_APPROVAL` veya `PREPARING`. */
  cancellable: boolean;
  /**
   * Teslim + `ORDER.returnWindowDays`. Teslim edilmemiş pakette `null`.
   * ⚠️ Bu pencere frontend'de HESAPLANMAZ; sunucu gönderiyor.
   */
  returnableUntil: string | null;
}

/** KAYNAKTAN — aynı `select`. */
export interface OrderReturnWire {
  id: string;
  returnNumber: string;
  status: ReturnStatusWire;
  reason: ReturnReasonWire;
  refundAmountMinor: MinorString;
  createdAt: string;
  items: { orderItemId: string; quantity: number; refundMinor: MinorString }[];
}

/**
 * Sipariş adresi — `Order.shippingAddress` JSON sütunu.
 *
 * ⚠️ SNAPSHOT'tır ve şeması sözleşmeyle sabitlenmiş DEĞİLDİR (Prisma `Json`).
 *    Bu yüzden alanların TAMAMI opsiyonel yazıldı ve ekran eksik alanı atlar.
 *    Zorunlu yazılsaydı eski bir siparişin farklı biçimli adresi tüm sipariş
 *    detayını beyaz ekrana düşürürdü.
 */
export interface OrderAddressWire {
  title?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  city?: string;
  district?: string;
  line1?: string;
  line2?: string;
  postalCode?: string;
}

/** KAYNAKTAN — `getByOrderNumber` dönüşünün tamamı. */
export interface OrderDetailWire {
  id: string;
  orderNumber: string;
  status: OrderStatusWire;
  email: string;
  phone: string;
  itemsTotalMinor: MinorString;
  shippingTotalMinor: MinorString;
  discountMinor: MinorString;
  grandTotalMinor: MinorString;
  currency: string;
  shippingAddress: OrderAddressWire;
  billingAddress: OrderAddressWire;
  createdAt: string;
  paidAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  reservationExpiresAt: string | null;
  packages: OrderPackageWire[];
  returns: OrderReturnWire[];
  events: { type: string; actorType: string; createdAt: string }[];
}

/** KAYNAKTAN — `POST /v1/orders/:id/returns` dönüşü. */
export interface ReturnCreatedWire {
  id: string;
  returnNumber: string;
  status: ReturnStatusWire;
  refundAmountMinor: MinorString;
}

// ══════════════════════════════ GARDIROP ══════════════════════════════════

/** `wardrobe.schema.ts` → `wardrobeCategorySchema` = `tryOnCategorySchema`. */
export type WardrobeCategoryWire =
  'UPPER_BODY' | 'LOWER_BODY' | 'DRESS' | 'OUTERWEAR' | 'SHOES' | 'JEWELRY' | 'BAG' | 'ACCESSORY';

/**
 * `GET /v1/wardrobe` — ÖLÇÜLDÜ (`{"data":[],…}`; kalem şekli
 * `wardrobe.service.ts` → `WardrobeItemView`).
 *
 * ⚠️ `imageUrl` İKİ FARKLI ŞEYDİR ve ayrımı `imageUrlExpires` taşır:
 *    MANUAL parçada private kovadan KISA ÖMÜRLÜ imzalı URL, PURCHASE parçada
 *    ürünün kalıcı public adresi. Bu yüzden `lib/media.ts` → `mediaUrl()`
 *    BURADA KULLANILMAZ: adres zaten tamdır, önüne kök eklemek imzayı bozar.
 */
export interface WardrobeItemWire {
  id: string;
  source: 'PURCHASE' | 'MANUAL';
  variantId: string | null;
  category: WardrobeCategoryWire;
  color: string;
  label: string | null;
  imageUrl: string | null;
  /** true ise `imageUrl` imzalı ve dakikalar içinde ölür. */
  imageUrlExpires: boolean;
  tryOnable: boolean;
  createdAt: string;
}

/**
 * `POST /v1/wardrobe` — ÖLÇÜLDÜ (202):
 * `{"itemId":"232a5b98-…","uploadUrl":"https://…r2.cloudflarestorage.com/wardrobe/…","expiresInSeconds":300}`
 *
 * ⚠️ `uploadUrl` VEKİLDEN GEÇMEZ: tarayıcı doğrudan özel kovaya PUT eder.
 *    Dosyayı vekilden geçirmek her yüklemede tam dosyayı Next sunucusunun
 *    belleğine alırdı.
 */
export interface WardrobeUploadTicketWire {
  itemId: string;
  uploadUrl: string;
  expiresInSeconds: number;
}

/**
 * `GET /v1/wardrobe/outfit-suggestions` — ÖLÇÜLDÜ (`{"data":[],…}`; kalem şekli
 * `wardrobe.ports.ts` → `WardrobeOutfitSuggestion`).
 */
export interface OutfitSuggestionWire {
  itemIds: string[];
  title: string;
  rationale: string;
  harmony: 'HARMONIOUS' | 'ACCEPTABLE' | 'CLASHING' | 'UNKNOWN';
}

// ════════════════════════════════ KVKK ════════════════════════════════════

/** `consentTypeSchema` — beş tür. */
export type ConsentTypeWire =
  'PHOTO_PROCESSING' | 'CROSS_BORDER_TRANSFER' | 'PHOTO_STORAGE' | 'MODEL_TRAINING' | 'MARKETING';

/**
 * `GET /v1/me/consents` — ÖLÇÜLDÜ:
 * `{"consents":[{"type":"MARKETING","granted":false,"since":"2026-08-12T14:00:53.002Z",
 *   "documentVersion":"v1.0","lastGrantedAt":null,"lastRevokedAt":"…","history":[…]}],
 *   "documentVersion":"kvkk-2026-01"}`
 *
 * ⚠️ Kaydı HİÇ OLMAYAN tür de listede döner (`granted:false`, `since:null`).
 *    Listeden düşürmek, kullanıcıya rızayı VERME imkânını da göstermemek olurdu.
 *
 * ⚠️ `documentVersion` İKİ YERDE ve ikisi FARKLI şey: kökteki alan BUGÜN
 *    yürürlükte olan metin sürümü, tür içindeki alan kullanıcının O ZAMAN
 *    onayladığı sürüm. Ölçümde biri `kvkk-2026-01`, diğeri `v1.0` çıktı —
 *    yani sapma teorik değil, veritabanında zaten var.
 */
export interface ConsentStateWire {
  type: ConsentTypeWire;
  granted: boolean;
  since: string | null;
  documentVersion: string | null;
  lastGrantedAt: string | null;
  lastRevokedAt: string | null;
  history: { granted: boolean; at: string; documentVersion: string }[];
}

/** `GET /v1/me/consents` gövdesi — ÖLÇÜLDÜ. */
export interface ConsentListWire {
  consents: ConsentStateWire[];
  documentVersion: string;
}

/** `POST /v1/me/consents` — ÖLÇÜLDÜ (201). */
export interface ConsentWriteWire {
  type: ConsentTypeWire;
  granted: boolean;
  recordedAt: string;
  documentVersion: string;
  /** Geçerli durum gerçekten değişti mi, yoksa aynı beyan mı tekrarlandı. */
  changed: boolean;
  photosMarkedForDeletion: number;
}

/**
 * `GET /v1/me/data-export` — ÖLÇÜLDÜ:
 * `{"status":"NONE","requestedAt":null,"preparedAt":null,"linkExpiresAt":null,"linkValidHours":48}`
 *
 * ⚠️ Uç DOSYA DÖNDÜRMEZ, bağlantı da döndürmez: arşivi worker hazırlar ve
 *    kullanıcıya gönderir. Ekranın işi DURUMU dürüstçe göstermek.
 */
export interface DataExportWire {
  status: 'NONE' | 'PREPARING' | 'READY' | 'EXPIRED';
  requestedAt: string | null;
  preparedAt: string | null;
  linkExpiresAt: string | null;
  linkValidHours: number;
}

/** KAYNAKTAN — `DELETE /v1/me` (202), `me.service.ts` → `AccountDeletionView`. */
export interface AccountDeletionWire {
  status: 'PENDING_DELETION';
  requestedAt: string;
  purgeAt: string;
  graceDays: number;
  daysRemaining: number;
  /** Talep bu istekte mi açıldı, yoksa zaten açık mıydı. */
  alreadyRequested: boolean;
  sessionsRevoked: number;
}

/** KAYNAKTAN — `POST /v1/auth/password/change`. */
export interface PasswordChangedWire {
  revokedSessions: number;
}
