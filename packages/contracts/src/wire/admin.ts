import type { MinorString } from './money.js';
import type { OrderStatusWire, PackageStatusWire, ReturnStatusWire } from './account.js';
import type { PayoutStatusWire, ProductStatusWire, SellerStatusWire } from './seller.js';

/**
 * YÖNETİM PANELİ — TELDEKİ ŞEKİLLER.
 *
 * ⚠️ İKİ GEÇİCİ EVİN BİRLEŞİMİ (`yonetim/_lib/tipler.ts` + `yonetim/_finans/tel.ts`).
 *    Ayrı dururken iki ölçülmüş çakışma üretmişlerdi: `GET /admin/payouts`
 *    satırının İKİ tipi (`AdminPayoutWire` ↔ `PayoutTalebiWire`) ve
 *    `GET /admin/categories` ağacının İKİ tipi (`AdminCategoryWire` ↔
 *    `YonetimKategoriWire`). Birinde `tryOnCategory` daraltılmış tipti,
 *    diğerinde çıplak `string`; yani aynı alan iki ekranda iki farklı güvence
 *    veriyordu.
 *
 * ⚠️ Ürün/satıcı/payout durumları `wire/seller.ts`ten geliyor. İki panel AYNI
 *    enum'ları okuyor; ikinci bir birlik yazmak, sunucuya yeni bir değer
 *    eklendiğinde yalnız birinin derlemeyi kırması demekti.
 *
 * ⚠️ Alanlar TAHMİN DEĞİL: `localhost:3001` üzerindeki çalışan API'ye ADMIN
 *    jetonuyla atılmış isteklerden ("ÖLÇÜLDÜ") ya da `apps/api` kaynağındaki
 *    `select`ten ("KAYNAKTAN") okundu.
 *
 *    ⚠️ BU İBARE BİR DÖNEM DAYANAKSIZDI, ve dayanaksız bir KANIT iddiası
 *       sonraki ajanı yanlış bir güvenle yürütür. Depoda `ADMIN` rolü atayan
 *       hiçbir kod yolu yoktu (rol yükseltme yalnızca bir ADMIN'in onayıyla
 *       tetikleniyor; ilk yöneticiyi doğuracak uç yok), yani o jeton hiç var
 *       olmamıştı. Kapı artık kod: `packages/db/scripts/rol-ata.ts`.
 *       ÖLÇÜM YAPILDI — gerçek bir ADMIN jetonuyla `200` dönen uçlar:
 *       `/admin/sellers`, `/admin/products/moderation`, `/admin/payouts`,
 *       `/admin/orders`, `/admin/commission-rules`, `/admin/categories`,
 *       `/admin/fraud/alerts`, `/admin/reports/gmv`, `/admin/ai/usage`.
 *       Alan adları buradaki tiplerle birebir tuttu; zarf davranışı da
 *       (aşağıdaki dizi/nesne ayrımı) doğrulandı.
 *       ⚠️ `/admin/audit-logs` **404** döndü — denetim izi bu adreste değil;
 *       o bölümün tipleri hâlâ yalnız KAYNAKTAN.
 *
 * ⚠️ `bigint` ve `Date` TELDE YOKTUR: zarf `serializeBigInts`ten geçtiği için
 *    tutarlar `string` (`MinorString`), tarihler ISO `string`. Sunucudaki
 *    `*Record` arayüzlerine bakıp `Date` yazmak, `tarih()` çağrısının sessizce
 *    `Invalid Date` üretmesi demektir.
 *
 * ⚠️ ZARF DAVRANIŞI İKİ TÜRLÜ ve karıştırılırsa `undefined.map` olur
 *    (`envelope.interceptor.ts`):
 *      • Denetleyici SADECE `{items}` / `{items,nextCursor}` döndürüyorsa
 *        `data` ÇIPLAK DİZİ olur, `nextCursor` `meta`ya taşınır.
 *        → `/admin/sellers`, `/admin/commission-rules`, `/admin/payouts`,
 *          `/admin/orders`
 *      • Kardeş alan varsa (`totals`, `buckets`, `versions`, `counts`) `data`
 *        NESNE kalır. → `/admin/reports/gmv`, `/admin/ai/usage`,
 *          `/admin/fraud/alerts`, `.../versions`
 */

// ══════════════════════ PARA OLMAYAN SAYILAR ═══════════════════════════════

/**
 * MİKRO-USD — **KURUŞ DEĞİL**, ve bu ayrım bir dizgi hatası değil bir PARA
 * hatasıdır.
 *
 * ⚠️ `costMicroUsd` alanları `<Fiyat>` ile BASILAMAZ: `<Fiyat>` `MinorString`
 *    ister ve çıktıyı `₺` ile biçimler. `1.234.567` mikro-USD ekrana
 *    `12.345,67 ₺` diye çıkardı — doğru görünen, tamamen yanlış bir rakam.
 *    Marka BİLEREK `MinorString` değil; tip sistemi karışmayı engelliyor.
 *    Biçimleme `lib/sayi-bicim.ts` → `mikroUsd()`.
 */
export type MikroUsdString = string;

/** Basis point. 1250 = %12,50. Para DEĞİL — `<Fiyat>`e sokulmaz. */
export type Bps = number;

// ═══════════════════════════ SATICI İNCELEME ════════════════════════════════

/** `GET /v1/admin/sellers` · `GET /v1/admin/sellers/:id` — ÖLÇÜLDÜ. */
export interface AdminSellerWire {
  id: string;
  legalName: string;
  displayName: string;
  contactEmail: string;
  contactPhone: string;
  taxOffice: string;
  status: SellerStatusWire;
  /** Onay notu ya da red/askı gerekçesi — kararın TEK açıklaması. */
  statusReason: string | null;
  qualityScore: number;
  vacationMode: boolean;
  /**
   * Ödeme sağlayıcısındaki alt üye işyeri açıldı mı.
   * ⚠️ Onay bunu AÇMAZ; onay olayını dinleyen finans işçisi açar
   *    (`admin-seller.service.ts` → `approve`). Yani yeni onaylanmış bir
   *    satıcıda `false` görmek NORMALDİR, arıza değildir.
   */
  submerchantKeyPresent: boolean;
  storeSlug: string | null;
  approvedAt: string | null;
  createdAt: string;
  productCount: number;
  /**
   * ⚠️ YALNIZCA ÜST VERİ. `storageKey` bilerek dışarı verilmiyor
   *    (`admin.bridges.ts:213`) ve belgeyi indirecek/imzalı URL üretecek bir uç
   *    BUGÜN YOK. Bu yüzden belge satırı tıklanabilir DEĞİLDİR.
   */
  documents: AdminSellerDocumentWire[];
}

export interface AdminSellerDocumentWire {
  id: string;
  /** `SellerDocumentType` enum'ı — telde çıplak string. */
  type: string;
  fileName: string;
  /** `null` = henüz incelenmedi. `false` = reddedildi. İkisi AYNI ŞEY DEĞİL. */
  approved: boolean | null;
  reviewedAt: string | null;
}

/** Karar uçlarının yanıtı — ekran bunu göstermez, yalnız başarıyı okur. */
export interface SellerDecisionWire {
  sellerId: string;
  status: SellerStatusWire;
}

// ═════════════════════════ ÜRÜN MODERASYONU ═════════════════════════════════

/** `GET /v1/admin/products/moderation` — ÖLÇÜLDÜ. */
export interface AdminModerationWire {
  id: string;
  slug: string;
  title: string;
  brandName: string;
  status: ProductStatusWire;
  statusReason: string | null;
  sellerId: string;
  sellerName: string;
  categoryName: string;
  /** Yayın ön koşulu — `false` iken onay 400 döner. */
  aiTagsApproved: boolean;
  /** `null` = hiç hesaplanmamış (görsel yok), `0` DEĞİL. */
  tryOnScore: number | null;
  /** Yayın ön koşulu — `0` iken onay 400 döner. */
  imageCount: number;
  variantCount: number;
  createdAt: string;
}

export interface ProductDecisionWire {
  productId: string;
  status: ProductStatusWire;
  reason: string | null;
}

// ══════════════════════════════ KATEGORİ ════════════════════════════════════

/**
 * `GET /v1/admin/categories` — sayfalanmış DEĞİL, ağacın tamamı tek yanıtta.
 *
 * ⚠️ `tryOnCategory` DARALTILMIŞ TİP, çıplak `string` değil. Bir dönem finans
 *    ekranı bunu `string | null` diye tutuyordu ve o ekranda desteklenmeyen bir
 *    kategori adı sessizce geçerdi. `TryOnCategoryName` `@vt/config`te ve bu
 *    paket ona bağımlı değil; bu yüzden birlik BURADA yazılı ve `@vt/config`
 *    matrisiyle ELLE senkron (sapma testi `tryon-category.drift.test.ts`).
 */
export type TryOnCategoryNameWire =
  'UPPER_BODY' | 'LOWER_BODY' | 'DRESS' | 'OUTERWEAR' | 'SHOES' | 'JEWELRY' | 'BAG' | 'ACCESSORY';

export interface AdminCategoryWire {
  id: string;
  parentId: string | null;
  slug: string;
  name: string;
  /** `null` → bu kategoride sanal deneme düğmesi HİÇ gösterilmez. */
  tryOnCategory: TryOnCategoryNameWire | null;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
}

// ═════════════════════════════ DENETİM İZİ ══════════════════════════════════

/** `GET /v1/admin/audit-log` — ÖLÇÜLDÜ. */
export interface AdminAuditLogWire {
  id: string;
  actorId: string;
  actorRole: string;
  /** Noktalı eylem adı: `seller.approved`, `product.moderation.rejected`… */
  action: string;
  entityType: string;
  entityId: string;
  /** ⚠️ Serbest JSON. Şekli eyleme göre değişir; `unknown` bilinçli. */
  before: unknown;
  after: unknown;
  reason: string | null;
  ipAddress: string;
  createdAt: string;
}

// ══════════════════════════ DOLANDIRICILIK ══════════════════════════════════

/** `GET /v1/admin/fraud/alerts` — ⚠️ `data` NESNE, çıplak dizi DEĞİL. */
export interface FraudPayloadWire {
  items: FraudAlertWire[];
  range: { from: string; to: string };
  /** Her zaman `true`: kalıcı bir uyarı tablosu yok, uyarılar türetiliyor. */
  derived: boolean;
  counts: { high: number; medium: number; low: number };
}

export interface FraudAlertWire {
  type: 'CARD_TESTING' | 'HIGH_RETURN_RATE' | 'UNUSUAL_ORDER_VALUE' | 'RAPID_ORDER_CANCELLATION';
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  subjectType: 'USER' | 'ORDER';
  subjectId: string;
  /** Uyarının sayısal dayanağı; anahtarlar türe göre değişir. */
  metrics: Record<string, number | string>;
  observedAt: string;
}

// ══════════════════════════════ KOMİSYON ════════════════════════════════════

export type CommissionScopeWire = 'PLATFORM' | 'CATEGORY' | 'SELLER' | 'SELLER_CATEGORY';

/** `GET /v1/admin/commission-rules` — KAYNAKTAN (`AdminCommissionService.listRules`). */
export interface CommissionRuleWire {
  id: string;
  label: string;
  categoryId: string | null;
  categoryName: string | null;
  sellerId: string | null;
  sellerName: string | null;
  scope: CommissionScopeWire;
  createdAt: string;
  /**
   * ⚠️ NULL OLABİLİR ve bu bir hata değil: kuralın tek versiyonu ileri
   *    tarihliyse BUGÜN yürürlükte oran yoktur. `currentVersion.rateBps`
   *    doğrudan okunursa liste beyaz ekrana düşer.
   */
  currentVersion: {
    id: string;
    rateBps: Bps;
    fixedFeeMinor: MinorString;
    validFrom: string;
  } | null;
  versionCount: number;
}

/** `GET /v1/admin/commission-rules/:id/versions` — KAYNAKTAN. `data` NESNE. */
export interface CommissionVersionsWire {
  id: string;
  label: string;
  scope: CommissionScopeWire;
  versions: CommissionVersionWire[];
}

export interface CommissionVersionWire {
  id: string;
  rateBps: Bps;
  fixedFeeMinor: MinorString;
  /** Yarı açık aralık `[validFrom, validTo)` — bitiş günü DÂHİL DEĞİL. */
  validFrom: string;
  /** `null` = hâlâ yürürlükte. */
  validTo: string | null;
  createdBy: string;
  createdAt: string;
  /**
   * Bu versiyonla komisyonu kesilmiş sipariş kalemi sayısı.
   * ⚠️ Sıfırdan büyükse versiyon fiilen SİLİNEMEZ: `OrderItem` o anki oranı
   *    snapshot almış durumda. Ekranın "geçmiş değişmez" cümlesinin KANITI bu
   *    sayıdır, cümlenin kendisi değil.
   */
  appliedOrderItemCount: number;
}

/** `POST /v1/admin/commission-rules` yanıtı — KAYNAKTAN. */
export interface CommissionRuleCreatedWire {
  id: string;
  label: string;
  scope: CommissionScopeWire;
  createdAt: string;
  currentVersion: { id: string; rateBps: Bps; fixedFeeMinor: MinorString; validFrom: string };
}

/** `POST /v1/admin/commission-rules/:id/versions` yanıtı — KAYNAKTAN. */
export interface CommissionVersionCreatedWire {
  ruleId: string;
  label: string;
  scope: CommissionScopeWire;
  version: {
    id: string;
    rateBps: Bps;
    fixedFeeMinor: MinorString;
    validFrom: string;
    validTo: string | null;
  };
  /** Kapatılan önceki versiyon; ilk versiyonda `null`. */
  closedVersionId: string | null;
}

/** `GET /v1/admin/sellers` — kural kapsamı seçiciyi besleyen DAR alt küme. */
export interface AdminSellerOptionWire {
  id: string;
  displayName: string;
  status: SellerStatusWire;
}

// ═══════════════════════════════ PAYOUT ═════════════════════════════════════

/**
 * `GET /v1/admin/payouts` — ÖLÇÜLDÜ.
 *
 * ⚠️ `ibanEnc` BİLEREK SEÇİLMİYOR ve maskeli IBAN de YOK. IBAN alan bazlı
 *    şifreli saklanıyor; yalnızca satıcının kendi talep yanıtında bir kez
 *    maskeli dönüyor (`SellerPayoutRequestWire`). Yani bu ekranda "…TR34"
 *    gösteren bir satır YAZILAMAZ.
 */
export interface AdminPayoutWire {
  id: string;
  sellerId: string;
  sellerName: string;
  amountMinor: MinorString;
  status: PayoutStatusWire;
  payoutRef: string;
  approvedBy: string | null;
  approvedAt: string | null;
  /** ⚠️ Bugün HİÇBİR kod bu alanı doldurmuyor (gönderim işçisi yazılmamış). */
  sentAt: string | null;
  failureReason: string | null;
  createdAt: string;
}

/** `POST /v1/admin/payouts/:id/approve` — KAYNAKTAN. */
export interface PayoutApprovalWire {
  payoutId: string;
  status: 'APPROVED';
  amountMinor: MinorString;
}

/** `POST /v1/admin/payouts/:id/reject` — KAYNAKTAN. */
export interface PayoutRejectionWire {
  payoutId: string;
  status: 'CANCELLED';
  reason: string;
}

// ══════════════════════════════ SİPARİŞ ═════════════════════════════════════

/** `GET /v1/admin/orders` — ÖLÇÜLDÜ. `data` çıplak dizi, `meta.nextCursor`. */
export interface AdminOrderRowWire {
  id: string;
  orderNumber: string;
  status: OrderStatusWire;
  email: string;
  itemsTotalMinor: MinorString;
  shippingTotalMinor: MinorString;
  discountMinor: MinorString;
  grandTotalMinor: MinorString;
  currency: string;
  createdAt: string;
  paidAt: string | null;
  packageCount: number;
  itemCount: number;
  sellerNames: string[];
}

export interface AdminOrderItemWire {
  id: string;
  productTitle: string;
  variantLabel: string;
  sku: string;
  quantity: number;
  unitPriceMinor: MinorString;
  lineTotalMinor: MinorString;
  /** ⚠️ O ANKİ oran — snapshot. Bugünkü komisyon kuralıyla aynı olmayabilir. */
  commissionRateBps: Bps;
  commissionAmountMinor: MinorString;
  sellerNetMinor: MinorString;
  commissionRuleVersionId: string | null;
}

export interface AdminOrderPackageWire {
  id: string;
  status: PackageStatusWire;
  carrier: string | null;
  trackingNo: string | null;
  slaDeadline: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelReason: string | null;
  itemsTotalMinor: MinorString;
  shippingMinor: MinorString;
  discountShareMinor: MinorString;
  seller: { id: string; displayName: string };
  items: AdminOrderItemWire[];
}

/**
 * ⚠️ `payment_refunds.status` şemada ENUM DEĞİL, düz `text`. Bu yüzden burada
 *    birlik tipi YAZILMADI: uydurulmuş bir birlik `satisfies Record<...>`
 *    kapısına güven verir ama sunucu başka bir değer yazdığı gün ekran sessizce
 *    boş rozet basar. Değer olduğu gibi gösteriliyor, renk taşımıyor.
 */
export interface AdminRefundRecordWire {
  id: string;
  amountMinor: MinorString;
  status: string;
  refundRef: string;
  createdAt: string;
}

export interface AdminPaymentWire {
  id: string;
  provider: string;
  status:
    | 'CREATED'
    | 'THREEDS_PENDING'
    | 'AUTHORIZED'
    | 'CAPTURED'
    | 'FAILED'
    | 'REFUNDED'
    | 'PARTIALLY_REFUNDED';
  amountMinor: MinorString;
  installment: number;
  cardMask: string | null;
  cardBrand: string | null;
  failureCode: string | null;
  capturedAt: string | null;
  refunds: AdminRefundRecordWire[];
}

export interface AdminOrderReturnWire {
  id: string;
  returnNumber: string;
  status: ReturnStatusWire;
  reason: string;
  refundAmountMinor: MinorString;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

/** `GET /v1/admin/orders/:orderNumber` — KAYNAKTAN (`findByOrderNumber` select'i). */
export interface AdminOrderDetailWire {
  /** ⚠️ Manuel iade ucu KİMLİK ister, sipariş numarası DEĞİL. */
  id: string;
  orderNumber: string;
  status: OrderStatusWire;
  email: string;
  phone: string | null;
  itemsTotalMinor: MinorString;
  shippingTotalMinor: MinorString;
  discountMinor: MinorString;
  grandTotalMinor: MinorString;
  currency: string;
  /** Prisma `Json` — alanlar tek tek opsiyonel okunur. */
  shippingAddress: Record<string, string | null | undefined> | null;
  createdAt: string;
  paidAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  packages: AdminOrderPackageWire[];
  returns: AdminOrderReturnWire[];
  payment: AdminPaymentWire | null;
  events: Array<{
    type: string;
    actorType: 'SYSTEM' | 'CUSTOMER' | 'SELLER' | 'ADMIN';
    actorId: string | null;
    createdAt: string;
  }>;
}

/**
 * `POST /v1/admin/orders/:id/refund` — KAYNAKTAN.
 *
 * ⚠️ `status: 'REFUND_REQUESTED'` "PARA GİTTİ" DEMEK DEĞİLDİR. Servis yalnızca
 *    denetim kaydı + OutboxEvent yazıyor.
 */
export interface AdminManualRefundWire {
  orderId: string;
  orderNumber: string;
  refundRef: string;
  amountMinor: MinorString;
  currency: string;
  /** Bu iadeden SONRA kalan tutar — tek güvenilir "kalan" kaynağı. */
  remainingRefundableMinor: MinorString;
  status: 'REFUND_REQUESTED';
}

// ════════════════════════════════ GMV ═══════════════════════════════════════

export type GmvGranularityWire = 'day' | 'week' | 'month';

export interface GmvBucketWire {
  bucket: string;
  orderCount: number;
  itemCount: number;
  gmvMinor: MinorString;
  commissionMinor: MinorString;
  sellerNetMinor: MinorString;
  returnedMinor: MinorString;
  returnedItemCount: number;
  netGmvMinor: MinorString;
}

/** `GET /v1/admin/reports/gmv` — ÖLÇÜLDÜ. `data` NESNE (`buckets` kardeş alan). */
export interface GmvReportWire {
  range: { from: string; to: string };
  granularity: GmvGranularityWire;
  currency: string;
  totals: {
    orderCount: number;
    itemCount: number;
    gmvMinor: MinorString;
    commissionMinor: MinorString;
    sellerNetMinor: MinorString;
    returnedMinor: MinorString;
    netGmvMinor: MinorString;
    averageOrderValueMinor: MinorString;
    /** ⚠️ SAYI (bps), para DEĞİL. */
    effectiveCommissionBps: Bps;
    returnRateBps: Bps;
  };
  buckets: GmvBucketWire[];
}

// ═══════════════════════════ AI MALİYETİ ════════════════════════════════════

/**
 * ⚠️ YEDİ DEĞER — `AiFeature` veritabanı enum'ından okundu (`enum_range`).
 *    `admin.schema.ts` → `aiFeatureSchema` yalnızca ALTISINI kabul ediyor;
 *    `SEARCH_NL` orada YOK. Sonuç ÖLÇÜLDÜ: panel `byFeature` içinde `SEARCH_NL`
 *    satırı DÖNDÜRÜYOR ama `?feature=SEARCH_NL` filtresi 400 alıyor. Bu yüzden
 *    etiket tablosu yediyi de tanır, filtre listesi altısını sunar.
 */
export type AiFeatureWire =
  'TRYON' | 'STYLIST' | 'TAGGING' | 'DESCRIPTION' | 'EMBEDDING' | 'MODERATION' | 'SEARCH_NL';

/** Filtre olarak GÖNDERİLEBİLEN değerler — `aiFeatureSchema` ile birebir. */
export const AI_FILTERABLE_FEATURES = [
  'TRYON',
  'STYLIST',
  'TAGGING',
  'DESCRIPTION',
  'EMBEDDING',
  'MODERATION',
] as const satisfies readonly AiFeatureWire[];

/** `GET /v1/admin/ai/usage` — ÖLÇÜLDÜ. `data` NESNE. */
export interface AiUsageWire {
  range: { from: string; to: string };
  totals: {
    callCount: number;
    cacheHitCount: number;
    successCount: number;
    costMicroUsd: MikroUsdString;
    failureCount: number;
    /** ⚠️ 0–1 arası ORAN, yüzde DEĞİL ("Yüzde DEĞİL — arayüz biçimlendirir"). */
    cacheHitRate: number;
    avgCostPerCallMicroUsd: MikroUsdString;
  };
  tryOn: {
    callCount: number;
    cacheHitCount: number;
    generatedCount: number;
    cacheHitRate: number;
    costMicroUsd: MikroUsdString;
    /** Önbellek isabetleri DÂHİL — gerçek birim ekonomisi. */
    avgCostPerCallMicroUsd: MikroUsdString;
    /** Yalnızca üretilen işler — sağlayıcı fiyatının kendisi. */
    avgCostPerGeneratedMicroUsd: MikroUsdString;
  };
  byFeature: Array<{
    feature: AiFeatureWire;
    callCount: number;
    cacheHitCount: number;
    costMicroUsd: MikroUsdString;
    cacheHitRate: number;
    avgCostPerCallMicroUsd: MikroUsdString;
  }>;
  byDay: Array<{
    bucket: string;
    feature: AiFeatureWire;
    callCount: number;
    cacheHitCount: number;
    successCount: number;
    costMicroUsd: MikroUsdString;
    avgLatencyMs: number;
  }>;
  topUsers: Array<{
    /** ⚠️ `null` olabilir — misafir çağrısı. */
    userId: string | null;
    callCount: number;
    costMicroUsd: MikroUsdString;
    avgCostPerCallMicroUsd: MikroUsdString;
  }>;
}
