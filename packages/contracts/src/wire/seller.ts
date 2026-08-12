import type { MinorString } from './money.js';
import type { ImageAngleWire } from './catalog.js';
import type { PackageStatusWire, ReturnReasonWire, ReturnStatusWire } from './account.js';

/**
 * SATICI PANELİ — TELDEKİ ŞEKİLLER.
 *
 * ⚠️ BU DOSYA DÖRT AYRI GEÇİCİ EVİN BİRLEŞİMİDİR. Satıcı panelini üç ajan
 *    paralel yazdı ve her biri kendi klasöründe bir `_lib/tel.ts` tuttu; sonuç
 *    ölçülebilir bir ayrışmaydı: AYNI uç için İKİ tip
 *    (`SellerPackageSummaryWire` ↔ `SaticiPaketOzetiWire`,
 *    `SellerBalanceWire` ↔ `SaticiBakiyeWire`) ve daha kötüsü, FARKLI uçlar için
 *    AYNI ad (`PayoutTalebiWire` hem satıcının talep yanıtı hem yönetimin
 *    payout satırıydı). Dördü burada birleşti, kopyalar silindi.
 *
 * ⚠️ Alanlar ÇALIŞAN API'den ölçülerek ya da `apps/api` kaynağından okunarak
 *    yazıldı, `*View` arayüzlerinden TÜRETİLMEDİ. Fark önemli: view tipi
 *    `bigint`/`Date` taşır, tel `string` taşır (`serializeBigInts`). İkisini
 *    aynı sanmak paranın `Number`a düşmesi ve tarihin `Date` sanılması demektir.
 *
 * ⚠️ KAYNAK ETİKETİ SÜS DEĞİL:
 *      "ÖLÇÜLDÜ"   → çalışan API'ye istek atıldı, gövde okundu.
 *      "KAYNAKTAN" → `apps/api` içindeki `select`/`return` okundu; telde
 *                    doğrulanamamıştı. Bu alanlar bir gün sessizce sapabilir;
 *                    iki tarafı birbirine bağlayan bir test YOK
 *                    (bkz. `wire/index.ts` başlığı).
 *
 *    ⚠️ "KAYNAKTAN"IN SEBEBİ ORTADAN KALKTI: o veriyi görebilen bir satıcı
 *       oturumu AÇILAMIYORDU, çünkü `SELLER_USER` rolü atayan hiçbir kod yolu
 *       yoktu. Kapı artık kod: `packages/db/scripts/rol-ata.ts` (rolü
 *       yükseltir, APPROVED mağaza + üyelik kurar).
 *       ÖLÇÜLDÜ — gerçek bir SELLER_USER jetonuyla `200` dönen uçlar:
 *       `/seller/me`, `/seller/products`, `/seller/orders`, `/seller/returns`,
 *       `/seller/finance/balance`, `/seller/finance/ledger`,
 *       `/seller/finance/payouts`, `/seller/coupons`. Alan adları buradaki
 *       tiplerle tuttu.
 *       ⚠️ `/seller/analytics/funnel` **500** dönüyor (`seller.bridges.ts`
 *       `::uuid`); o uç ölçülemedi ve panel onu OKUMUYOR — okusaydı tek bozuk
 *       uç yüzünden satıcı panosunun tamamı düşerdi.
 *
 * ⚠️ Para alanının adı DEĞİŞTİRİLMEZ (`itemsTotalMinor` → `total` yapmak
 *    eslint'in `Number(*Minor)` korumasını o alan için sessizce kapatır).
 *
 * ⚠️ Sayfalı uçlarda `data` ÇIPLAK DİZİDİR, `nextCursor` `meta` içindedir —
 *    `list()` (apps/web `lib/api/core.ts`) ikisini de açar, `data.items` elle
 *    okunmaz.
 */

// ═══════════════════════════════ ORTAK ══════════════════════════════════════

/**
 * ⚠️ TEK ÜRÜN DURUMU TİPİ. Satıcı paneli `SellerProductStatusWire`, yönetim
 *    moderasyonu `ProductStatusWire` diye iki ad yazmıştı; birlik AYNIYDI, yani
 *    iki ad tek bir şeyi anlatıyordu ve biri değiştiğinde diğeri sessizce eski
 *    kalırdı. Ad tek, iki panel de bunu okuyor.
 */
export type ProductStatusWire = 'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED' | 'REJECTED' | 'ARCHIVED';

/** ⚠️ Sıra `SellerStatus` enum'ıyla aynı; iki panel de bu tipi kullanır. */
export type SellerStatusWire = 'PENDING' | 'APPROVED' | 'SUSPENDED' | 'REJECTED';

export type SellerGenderWire = 'WOMAN' | 'MAN' | 'UNISEX' | 'KIDS';

// ══════════════════════════════ KATALOG ═════════════════════════════════════

/** `GET /v1/seller/products` satırı — ÖLÇÜLDÜ. */
export interface SellerProductSummaryWire {
  id: string;
  slug: string;
  title: string;
  brandName: string;
  status: ProductStatusWire;
  gender: SellerGenderWire;
  categoryId: string;
  /** 0-100. `null` = hiç görsel yok, skor HİÇ hesaplanmadı ("0" değil). */
  tryOnScore: number | null;
  /**
   * ⚠️ Tipi `unknown` ve gerçekten öyle: JSON kolonu, `null` da olabilir dizi
   *    de. `.map()` çağırmadan önce dizi olduğu doğrulanır
   *    (`components/tryon/tryon-oneriler.ts` → `sorunlariCoz`).
   */
  tryOnIssues: unknown;
  aiTagsApproved: boolean;
  variantCount: number;
  /** ⚠️ Sunucuda `Σ max(0, onHand − reserved)`. Frontend'de yeniden toplanmaz. */
  availableStock: number;
  /** Aktif varyant yoksa `null`. */
  minPriceMinor: MinorString | null;
  imageKey: string | null;
  publishedAt: string | null;
  updatedAt: string;
}

export interface SellerVariantWire {
  id: string;
  sku: string;
  color: string;
  /** `#RRGGBB`, zorunlu. ⚠️ ÜRÜN VERİSİ — durum değil, `<Badge>` ile basılmaz. */
  colorHex: string;
  size: string;
  priceMinor: MinorString;
  listPriceMinor: MinorString | null;
  barcode: string | null;
  isActive: boolean;
  sortOrder: number;
  onHand: number;
  /** Müşteri sepetlerinde tutulan adet. Satılabilir = `onHand − reserved`. */
  reserved: number;
}

export interface SellerProductImageWire {
  id: string;
  storageKey: string;
  angle: string;
  isPrimary: boolean;
}

/** `GET /v1/seller/products/:id` — varyant matrisinin TEK kaynağı. ÖLÇÜLDÜ. */
export interface SellerProductDetailWire extends SellerProductSummaryWire {
  description: string;
  season: string | null;
  collection: string | null;
  /** Admin reddinin Türkçe gerekçesi. `REJECTED` durumunda ekranda GÖSTERİLİR. */
  statusReason: string | null;
  aiTags: unknown;
  sizeChart: unknown;
  /** ⚠️ Sıralama sunucudan: color asc, sortOrder asc. Matris bu diziden kurulur. */
  variants: SellerVariantWire[];
  images: SellerProductImageWire[];
}

/** `PATCH /v1/seller/variants/bulk` — ⚠️ güncellenmiş satırlar DÖNMEZ. ÖLÇÜLDÜ. */
export interface BulkVariantUpdateResultWire {
  updated: number;
}

/** `POST /v1/seller/products/bulk-upload` başarı yanıtı — KAYNAKTAN. */
export interface BulkUploadResultWire {
  createdProducts: number;
  updatedProducts: number;
  createdVariants: number;
  updatedVariants: number;
  rowCount: number;
  fileName: string;
}

/**
 * `BULK_UPLOAD_INVALID` (422) hatasının `details`i.
 * ⚠️ `row` 1 tabanlı DOSYA satırıdır: başlık 1, ilk veri satırı 2.
 */
export interface BulkUploadErrorDetailWire {
  errorCount: number;
  truncated: boolean;
  errors: Array<{ row: number; column: string; message: string }>;
}

/** `POST /v1/seller/products/:id/images/:imageId/confirm` yanıtı — ÖLÇÜLDÜ. */
export interface ProductImageConfirmWire {
  image: {
    id: string;
    productId: string;
    storageKey: string;
    url: string;
    angle: ImageAngleWire;
    isPrimary: boolean;
    blurhash: string | null;
    widthPx: number;
    heightPx: number;
    variants: Array<{ width: number; url: string }>;
  };
  tryOnScore: number;
  tryOnIssues: string[];
  /**
   * ⚠️ Yalnız skor `TRYON.minProductReadinessScore` altındayken dolu gelir.
   *    Metinler BACKEND'İN metnidir ve yeniden yazılmaz.
   */
  suggestions: Array<{ issue: string; message: string; gain: number }>;
}

// ══════════════════════════════ MAĞAZA ══════════════════════════════════════

/** `GET /v1/seller/me` — ÖLÇÜLDÜ. */
export interface SellerProfileWire {
  id: string;
  legalName: string;
  displayName: string;
  status: SellerStatusWire;
  statusReason: string | null;
  /** ⚠️ `"••••"` — şifreli metin çözülmüyor, son 4 hane YOK. */
  ibanMasked: string;
  taxNumberMasked: string;
  taxOffice: string;
  contactEmail: string;
  contactPhone: string;
  qualityScore: number;
  vacationMode: boolean;
  submerchantConnected: boolean;
  approvedAt: string | null;
  createdAt: string;
  store: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    logoKey: string | null;
    bannerKey: string | null;
  } | null;
  documents: Array<{
    id: string;
    type: string;
    fileName: string;
    approved: boolean | null;
    reviewedAt: string | null;
  }>;
}

// ═════════════════════════════ SİPARİŞ / PAKET ══════════════════════════════

/**
 * `GET /v1/seller/orders` satırı — KAYNAKTAN
 * (`seller.ports.ts` → `SellerPackageSummary`, `seller.bridges.ts:838`).
 */
export interface SellerPackageSummaryWire {
  id: string;
  orderId: string;
  orderNumber: string;
  status: PackageStatusWire;
  /** Paketteki ürünlerin MÜŞTERİ tutarı — satıcının hakedişi DEĞİL. */
  itemsTotalMinor: MinorString;
  shippingMinor: MinorString;
  discountShareMinor: MinorString;
  carrier: string | null;
  trackingNo: string | null;
  /** Hazırlık SLA son tarihi (ISO). */
  slaDeadline: string;
  shippedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  itemCount: number;
  /**
   * ⚠️ SUNUCUDAN GELİR, frontend'de yeniden hesaplanmaz. Sunucu üç şartı
   *    BİRLİKTE arıyor: `shippedAt === null` + son tarih geçmiş + durum
   *    AWAITING_APPROVAL/PREPARING (`seller.bridges.ts:853`). Yalnız tarihe
   *    bakan bir arayüz kargolanmış paketi de "gecikmiş" gösterirdi.
   */
  slaBreached: boolean;
}

/** `GET /v1/seller/packages/:id` — KAYNAKTAN (`SellerPackageDetail`). */
export interface SellerPackageDetailWire extends SellerPackageSummaryWire {
  /**
   * ⚠️ ADRES KASTEN DAR (KVKK m.4, veri minimizasyonu): müşterinin e-postası,
   *    fatura bilgisi ve vergi numarası YOK. Ekrana "müşteri e-postası" alanı
   *    konulamaz — veri gelmiyor.
   */
  shipping: {
    contactName: string;
    phone: string;
    city: string;
    district: string;
    neighbourhood: string | null;
    line1: string;
    postalCode: string | null;
  };
  items: Array<{
    id: string;
    productTitle: string;
    variantLabel: string;
    sku: string;
    imageKey: string;
    quantity: number;
    unitPriceMinor: MinorString;
    lineTotalMinor: MinorString;
    /** Satıcının bu kalemden hakedişi — kalem başına SUNUCUDAN gelir. */
    sellerNetMinor: MinorString;
    commissionAmountMinor: MinorString;
    /** 1250 = %12,50. PARA DEĞİL, `<Fiyat>` ile basılmaz. */
    commissionRateBps: number;
  }>;
}

/**
 * Satıcının YAZABİLDİĞİ hedef durumlar (`seller.schema.ts:220`).
 *
 * ⚠️ `DELIVERED` ve `RETURNED` LİSTEDE YOK ve olmamalı: teslim bilgisi kargo
 *    entegrasyonundan, iade kapanışı iade akışından gelir. Satıcıya verilseydi
 *    satıcı paketi "teslim edildi" işaretleyip hakediş penceresini (teslim +
 *    14 gün) kendi eliyle erken açardı.
 */
export type SellerPackageTargetWire = 'PREPARING' | 'SHIPPED' | 'CANCELLED';

/**
 * `PATCH /v1/seller/packages/:id/status` ve `POST .../shipment` yanıtı —
 * KAYNAKTAN (`OrderService.transitionPackage`).
 *
 * ⚠️ PAKETİN TAMAMI DÖNMEZ. Ekran bu yanıtla kendini güncelleyemez;
 *    `router.refresh()` ile detay yeniden çekilir.
 */
export interface SellerPackageTransitionWire {
  orderStatus: string;
  packageStatus: PackageStatusWire;
}

// ═══════════════════════════════ İADE ═══════════════════════════════════════

/**
 * `GET /v1/seller/returns` ve `/returns/:id` — aynı şekil. KAYNAKTAN.
 *
 * ⚠️ LİSTE İLE DETAY AYNI TİPİ DÖNDÜRÜR; detayda fazladan alan YOKTUR. Yani
 *    "detayda daha fazlası var" varsayımıyla ikinci bir istek atmak boşuna
 *    olurdu — detay ekranının varlık sebebi ek veri değil, KARAR EKRANI olması.
 */
export interface SellerReturnWire {
  id: string;
  returnNumber: string;
  orderId: string;
  orderNumber: string;
  status: ReturnStatusWire;
  /**
   * Sunucu portu bu alanı `string` olarak genişletmiş ama sütun Prisma
   * `ReturnReason` enum'ı; telde her zaman enum değeri gelir.
   */
  reason: ReturnReasonWire;
  note: string | null;
  /** Müşteriye ödenecek tutar. Satıcı defter etkisiyle AYNI DEĞİL (aşağı bak). */
  refundAmountMinor: MinorString;
  createdAt: string;
  decidedAt: string | null;
  items: Array<{
    orderItemId: string;
    productTitle: string;
    variantLabel: string;
    quantity: number;
    refundMinor: MinorString;
  }>;
  /**
   * ⚠️ HAM DEPOLAMA ANAHTARI — imzalı URL YOK ve `mediaUrl()` bunları GENEL
   *    kovadan servis edilen ürün görselleri sanar. Müşterinin yüklediği kanıt
   *    fotoğrafı genel kovada DEĞİL; bu anahtarlardan bugün görüntülenebilir
   *    bir adres üretilemez. Ekran sayıyı söyler, kırık görsel çizmez.
   */
  photoKeys: string[];
}

/**
 * `PATCH /v1/seller/returns/:id` — `action: 'APPROVE'` yanıtı. KAYNAKTAN.
 *
 * ⚠️ İKİ TUTAR FARKLI ŞEYDİR ve aynı sanılırsa satıcı yanlış rakama bakar:
 *      • `refundAmountMinor`     → MÜŞTERİYE ödenen (indirim payı düşülmüş).
 *      • `sellerNetImpactMinor`  → SATICININ defterine düşen net etki.
 *    İndirim müşteriden kesilir, satıcı defterine brüt yansır; bu yüzden iki
 *    rakam birbirini tutmaz ve tutmaması doğrudur.
 */
export interface SellerReturnApprovalWire {
  returnNumber: string;
  refundAmountMinor: MinorString;
  sellerNetImpactMinor: MinorString;
}

/** `action: 'REJECT'` yanıtı — KAYNAKTAN (`OrderService.rejectReturn`). */
export interface SellerReturnRejectionWire {
  returnNumber: string;
  status: ReturnStatusWire;
}

// ══════════════════════════════ FİNANS ══════════════════════════════════════

/** Defter satırı türü — Prisma `LedgerType` (`seller.schema.ts:281` sırası). */
export type LedgerTypeWire =
  | 'SALE'
  | 'COMMISSION'
  | 'SHIPPING_SHARE'
  | 'REFUND'
  | 'COMMISSION_REVERSAL'
  | 'SHIPPING_REVERSAL'
  | 'PAYOUT'
  | 'ADJUSTMENT';

/** Prisma `PayoutStatus` — satıcı ve yönetim panelleri AYNI tipi okur. */
export type PayoutStatusWire = 'REQUESTED' | 'APPROVED' | 'SENT' | 'FAILED' | 'CANCELLED';

/**
 * `GET /v1/seller/finance/balance` — ÖLÇÜLDÜ (boş defterli mağazada):
 * `{"totalMinor":"0","availableMinor":"0","pendingMinor":"0","withdrawableMinor":"0",
 *   "currency":"TRY","minPayoutMinor":"10000","nextAvailableAt":null,
 *   "hasPendingPayout":false,"canRequestPayout":false,"breakdown":{}}`
 *
 * ⚠️ `data` NESNEDİR (sayfalanmış değil) — `list()` ile açılmaz.
 */
export interface SellerBalanceWire {
  /** Defterin TAMAMI: geleceğe tarihli hakedişler dâhil. Bir "hesap bakiyesi" DEĞİL. */
  totalMinor: MinorString;
  /**
   * `total − pending`.
   * ⚠️ NEGATİF OLABİLİR: iade ters kayıtları olgunlaşmamış hakedişi aşarsa
   *    satıcı platforma borçlanır. `withdrawableMinor` bunu 0'a kırptığı için
   *    ekranda ikisi birden gösterilmezse satıcı borcunu HİÇ görmez.
   */
  availableMinor: MinorString;
  /** `availableAt` geleceğe tarihli satırların toplamı — olgunlaşmamış hakediş. */
  pendingMinor: MinorString;
  /** Talep tavanı: `availableMinor > 0 ? availableMinor : 0`. */
  withdrawableMinor: MinorString;
  currency: 'TRY';
  /**
   * Asgari ödeme tutarı.
   * ⚠️ Ekrana SABİT METİN olarak yazılmaz, bu alandan okunur; `FINANCE`
   *    sabitindeki değer değiştiğinde arayüz eski rakamı göstermeye devam
   *    ederdi.
   */
  minPayoutMinor: MinorString;
  /**
   * En yakın olgunlaşma tarihi — yalnız POZİTİF satırlardan.
   * ⚠️ Ekranda "14 gün sonra" gibi bir FORMÜL yazılmaz; teslimde yeniden
   *    hesaplanmadığı için gerçek tarih formülden farklıdır.
   */
  nextAvailableAt: string | null;
  /** `REQUESTED` veya `APPROVED` bir talep var mı? */
  hasPendingPayout: boolean;
  /**
   * ⚠️ DÜĞME KARARI BU ALANDAN OKUNUR, elde hesaplanmaz. Frontend
   *    `withdrawable >= minPayout` diye yeniden hesaplarsa "bekleyen talep
   *    varsa yeni talep açılamaz" şartı sessizce düşer ve satıcı aynı parayı
   *    iki kez talep eder.
   */
  canRequestPayout: boolean;
  /**
   * Tür bazında toplam.
   * ⚠️ SEKİZ TÜRÜN HEPSİNİ İÇERMEZ: o türde satır yoksa anahtar da yoktur.
   *    Sabit sekiz kart çizen bir ekran yarısında `undefined` gösterir.
   */
  breakdown: Partial<Record<LedgerTypeWire, MinorString>>;
}

/**
 * `GET /v1/seller/finance/ledger` satırı — KAYNAKTAN
 * (`seller-finance.service.ts:122` `select`i birebir).
 *
 * ⚠️ SİPARİŞ NUMARASI ALANI YOK. Numara yalnızca `description` metninin
 *    içindedir ("Satış: VT-260811-0042 · Yumuşak Dokulu Triko Kazak").
 *    "Sipariş no" diye ayrı bir kolon açılırsa dolduracak veri yoktur.
 */
export interface SellerLedgerEntryWire {
  id: string;
  type: LedgerTypeWire;
  /** + alacak, − borç. Ters kayıtlar GÖRÜNÜR kalır; satır silinmez. */
  amountMinor: MinorString;
  currency: 'TRY';
  description: string;
  orderItemId: string | null;
  payoutId: string | null;
  /** `null` = beklemesi gerekmiyor, anında etki eder (iade ters kayıtları). */
  availableAt: string | null;
  createdAt: string;
}

/**
 * `GET /v1/seller/finance/payouts` satırı — KAYNAKTAN.
 *
 * ⚠️ MASKELİ IBAN LİSTEDE YOK ve `ibanEnc` bilerek seçilmiyor. Maskeli IBAN
 *    yalnızca talep oluşturma yanıtında BİR KEZ döner; `GET /seller/me` ise son
 *    dört haneyi bile vermiyor (`"••••"`). Yani "IBAN …TR34" gösteren bir payout
 *    ekranı bugün YAZILAMAZ; "kayıtlı hesabınıza" demek gerekiyor.
 */
export interface SellerPayoutWire {
  id: string;
  amountMinor: MinorString;
  status: PayoutStatusWire;
  payoutRef: string;
  approvedAt: string | null;
  sentAt: string | null;
  failureReason: string | null;
  createdAt: string;
}

/**
 * `POST /v1/seller/finance/payout` yanıtı — KAYNAKTAN.
 *
 * ⚠️ YÖNETİMİN `AdminPayoutWire`I İLE KARIŞTIRILMAZ. İkisinin adı bir dönem
 *    aynıydı (`PayoutTalebiWire`) ve şekilleri farklıydı: bu, satıcının kendi
 *    talebinin yanıtı (maskeli IBAN taşır, `sellerName` taşımaz); o, yönetim
 *    kuyruğunun satırı.
 */
export interface SellerPayoutRequestWire {
  id: string;
  amountMinor: MinorString;
  status: PayoutStatusWire;
  /** Talep anında BİR KEZ dönen maskeli IBAN; başka hiçbir uçta yok. */
  ibanMasked: string;
  createdAt: string;
}

// ══════════════════════════════ KUPON ═══════════════════════════════════════

export type CouponDiscountTypeWire = 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE_SHIPPING';

/** `GET /v1/seller/coupons` satırı — ÖLÇÜLDÜ. */
export interface SellerCouponWire {
  id: string;
  code: string;
  discountType: CouponDiscountTypeWire;
  /**
   * ⚠️ PERCENTAGE'ta BASIS POINT (`"1000"` = %10), FIXED_AMOUNT'ta kuruş.
   *    Yani bu alan KOŞULLU olarak para: yüzde dalında `<Fiyat>`e SOKULMAZ.
   */
  discountValue: MinorString;
  maxDiscountMinor: MinorString | null;
  minCartMinor: MinorString;
  usageLimit: number | null;
  usageLimitPerUser: number;
  usedCount: number;
  validFrom: string;
  validTo: string;
  isActive: boolean;
  createdAt: string;
}
