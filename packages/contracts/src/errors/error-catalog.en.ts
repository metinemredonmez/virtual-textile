import { ERROR_CATALOG, type ErrorCode } from './error-catalog.js';

/**
 * HATA KATALOĞUNUN İNGİLİZCESİ — yalnızca METİN.
 *
 * ⚠️ Burada `status`/`family`/`retryable` YOKTUR ve olmamalı. Davranış dile
 *    göre değişmez: `AUTH_ACCOUNT_LOCKED` İngilizce konuşan kullanıcıda da
 *    423'tür. Davranışı kopyalayan ikinci bir tablo, iki dosyanın sessizce
 *    ayrışabileceği tek yer olurdu — ve bu depoda "iki kopya zamanla ayrışır"
 *    teorik değil, ölçülmüş bir olay.
 *
 * ⚠️ `satisfies Record<ErrorCode, string>` ile KAPALI: kataloğa yeni bir kod
 *    eklendiği gün BU DOSYA DERLENMEZ. Bir Türkçe cümle ekleyip İngilizcesini
 *    unutmak mümkün değil — çünkü unutmak derlemeyi kırıyor. Eksik çeviri
 *    ölü bağlantıdan daha sinsidir: ölü bağlantı 404 verir, eksik çeviri
 *    BAŞARILI bir sayfa üretip kullanıcıya yanlış dilde cümle gösterir.
 *
 * ⚠️ ÇOĞUL. Türkçede sayıdan sonra çoğul eki yoktur ("3 adet"), İngilizcede
 *    vardır. Düz bir çeviri "1 items" yazar. Bu yüzden sayıya bağlı cümleler
 *    ICU `plural` ile yazılır (`i18n/icu.ts`) ve `#` sayının locale'e göre
 *    biçimlenmiş hâlidir. Yer tutucu ADLARI Türkçesiyle AYNI kalmak zorunda —
 *    testi geçmenin başka yolu yok.
 */
export const ERROR_CATALOG_EN = {
  // ── KİMLİK & YETKİ ────────────────────────────────────────────────────
  AUTH_INVALID_CREDENTIALS: 'Incorrect e-mail address or password.',
  AUTH_TOKEN_MISSING: 'You need to sign in to continue.',
  AUTH_TOKEN_INVALID: 'Your session is no longer valid. Please sign in again.',
  AUTH_TOKEN_EXPIRED: 'Your session has expired. Please sign in again.',
  AUTH_REFRESH_REUSED: 'For your security, all of your sessions were closed. Please sign in again.',
  AUTH_OTP_INVALID: 'That verification code is incorrect.',
  AUTH_OTP_EXPIRED: 'The code has expired. Request a new one.',
  AUTH_ACCOUNT_LOCKED:
    'Too many failed attempts. Try again in {minutes, plural, one {# minute} other {# minutes}}.',
  AUTH_ACCOUNT_SUSPENDED: 'Your account has been suspended. Please contact support.',
  AUTH_EMAIL_NOT_VERIFIED: 'Verify your e-mail address to continue.',
  AUTH_FORBIDDEN: 'You are not allowed to perform this action.',
  AUTH_EMAIL_TAKEN: 'That e-mail address is already registered.',
  AUTH_PHONE_TAKEN: 'That phone number is already registered.',

  // ── KATALOG ───────────────────────────────────────────────────────────
  PRODUCT_NOT_FOUND: 'This product was not found or is no longer published.',
  VARIANT_NOT_FOUND: 'The colour/size you selected was not found.',
  VARIANT_UNAVAILABLE: 'The colour/size you selected is not on sale right now.',
  CATEGORY_NOT_FOUND: 'Category not found.',
  SELLER_ON_VACATION: 'This store is temporarily not accepting orders.',

  // ── SEPET ─────────────────────────────────────────────────────────────
  CART_NOT_FOUND: 'Cart not found.',
  CART_EMPTY: 'Your cart is empty.',
  CART_EXPIRED: 'Your cart has expired. Please add the items again.',
  CART_PRICE_CHANGED:
    'The price of an item in your cart has changed. Please confirm the new total.',
  INSUFFICIENT_STOCK:
    'Not enough stock left. You can order at most {available, plural, one {# unit} other {# units}} of this product.',
  MAX_QUANTITY_EXCEEDED:
    'You can order at most {max, plural, one {# unit} other {# units}} of this product per order.',
  CART_TOO_MANY_ITEMS:
    'Your cart can hold at most {max, plural, one {# different product} other {# different products}}. Remove one item and try again.',
  COUPON_INVALID: 'That coupon code is not valid.',
  COUPON_EXPIRED: 'That coupon has expired.',
  COUPON_MIN_AMOUNT: 'This coupon requires a minimum order of {minAmount}.',
  COUPON_ALREADY_USED: 'You have already used this coupon.',
  COUPON_USAGE_LIMIT_REACHED:
    'This coupon has reached its usage limit. You can try a different coupon.',
  COUPON_NOT_APPLICABLE: 'This coupon does not apply to the items in your cart.',
  SHIPPING_UNAVAILABLE: 'We cannot ship to this address.',
  ADDRESS_NOT_FOUND: 'Address not found.',

  // ── ÖDEME ─────────────────────────────────────────────────────────────
  PAYMENT_DECLINED: 'The payment could not be completed. Please check your card details.',
  PAYMENT_INSUFFICIENT_FUNDS: 'Your card has insufficient funds.',
  PAYMENT_LIMIT_EXCEEDED: 'Your card limit is insufficient. You can try paying in instalments.',
  PAYMENT_CARD_INVALID: 'The card details are invalid or the card has expired.',
  PAYMENT_3DS_FAILED: '3D Secure verification could not be completed.',
  PAYMENT_3DS_CANCELLED: '3D Secure verification was cancelled.',
  PAYMENT_BANK_REJECTED:
    'Your bank did not approve the transaction. Contact your bank or try a different card.',
  PAYMENT_TIMEOUT:
    'No response was received from the payment provider. Check your orders — if the amount was charged, your order has been created.',
  PAYMENT_ALREADY_CAPTURED: 'This order has already been paid.',
  PAYMENT_PROVIDER_DOWN: 'The payment system is temporarily unavailable. Please try again shortly.',
  PAYMENT_AMOUNT_MISMATCH:
    'There is a mismatch in the payment amount. The transaction was stopped for your security.',
  REFUND_EXCEEDS_PAYMENT: 'The refund amount cannot exceed the amount paid.',
  REFUND_NO_CAPTURED_PAYMENT:
    'No payment has been captured for this order. Cancel the order instead of refunding it.',
  WEBHOOK_SIGNATURE_INVALID:
    'The notification signature could not be verified. Send it again with a valid signature.',
  REFUND_WINDOW_CLOSED:
    'The return window ({days, plural, one {# day} other {# days}}) has closed.',

  // ── SİPARİŞ ───────────────────────────────────────────────────────────
  ORDER_NOT_FOUND: 'Order not found.',
  ORDER_NOT_CANCELLABLE:
    'An order that has already shipped cannot be cancelled. You can open a return request instead.',
  ORDER_INVALID_TRANSITION: 'This status change is not allowed.',
  PACKAGE_NOT_FOUND: 'Package not found.',
  PACKAGE_ALREADY_SHIPPED: 'This package has already shipped.',
  RETURN_NOT_ALLOWED: 'A return request cannot be opened for this item.',
  RETURN_ALREADY_EXISTS: 'You already have an open return request for this item.',
  ORDER_RESERVATION_EXPIRED:
    'The stock reserved for your order has expired. Please order again from your cart.',
  LEDGER_INCONSISTENT:
    'There is an inconsistency in the order record and the transaction was stopped for your security. Please give this code to support: {requestId}',

  // ── RIZA & FOTOĞRAF ───────────────────────────────────────────────────
  CONSENT_REQUIRED: 'You need to grant photo processing consent to continue.',
  CONSENT_CROSS_BORDER_REQUIRED:
    'To use virtual try-on you must allow your photo to be transferred to a service provider abroad.',
  PHOTO_NOT_FOUND: 'The photo was not found or has expired.',
  PHOTO_TOO_LARGE: 'The photo cannot be larger than {maxMb} MB.',
  PHOTO_INVALID_FORMAT: 'You can only upload photos in JPG, PNG or WebP format.',
  PHOTO_QUALITY_LOW: 'The photo quality is not sufficient: {reason}',
  PHOTO_NO_PERSON: 'No person was detected in the photo. Try again with a full-body photo.',
  PHOTO_MULTIPLE_PERSONS:
    'There is more than one person in the photo. Upload a photo of yourself alone.',

  // ── SANAL DENEME ──────────────────────────────────────────────────────
  PRODUCT_NOT_TRYONABLE: 'Virtual try-on is not supported for this product.',
  OUTFIT_LAYER_CONFLICT:
    'Two pieces cannot be selected for the same body area. Keep only one piece each from tops, bottoms and outerwear; a dress covers both top and bottom, so no top or bottom can be added alongside it.',
  OUTFIT_PIECE_COUNT_INVALID:
    'An outfit try-on takes at least {min} and at most {max, plural, one {# piece} other {# pieces}}.',
  OUTFIT_DUPLICATE_PIECE:
    'You cannot add the same product to an outfit twice. Remove the repeated piece or replace it with a different product.',
  TRYON_QUOTA_EXCEEDED:
    'You have used up your daily virtual try-on allowance ({used}/{limit}). You can try again tomorrow.',
  TRYON_JOB_NOT_FOUND: 'Try-on record not found.',
  TRYON_PROVIDER_ERROR: 'The virtual try-on could not be created. Please try again shortly.',
  TRYON_TIMEOUT: 'The virtual try-on took too long. You can try again.',
  TRYON_CONTENT_BLOCKED: 'Your photo could not be processed. Please try a different photo.',

  // ── YAPAY ZEKÂ ────────────────────────────────────────────────────────
  AI_BUDGET_EXCEEDED: 'AI features are temporarily unavailable. Please try again shortly.',
  STYLIST_UNAVAILABLE: 'The style adviser cannot respond right now. Please try again shortly.',
  STYLIST_RATE_LIMITED: 'You are sending messages too quickly. Wait a moment and try again.',
  STYLIST_TIMEOUT: 'The style adviser took too long to respond. You can try again.',
  AI_PROVIDER_MISCONFIGURED:
    'The style adviser is unavailable right now. Our team has been notified.',
  TRYON_PROVIDER_MISCONFIGURED:
    'Virtual try-on is unavailable right now. Our team has been notified.',
  EMBEDDING_DIMENSION_MISMATCH:
    'Product search could not be updated. Please give this code to support: {requestId}',
  EMBEDDING_PROVIDER_ERROR:
    'Product search cannot be updated at the moment. Please try again shortly.',

  // ── SATICI ────────────────────────────────────────────────────────────
  SELLER_NOT_FOUND: 'Store not found.',
  SELLER_NOT_APPROVED: 'Your store has not been approved yet. You will be notified once it is.',
  SELLER_SUSPENDED: 'Your store has been suspended. Please contact support.',
  SELLER_APPLICATION_EXISTS: 'You already have a pending application.',
  SELLER_STORE_SLUG_TAKEN: 'That store address is taken. Please try a different one.',
  COUPON_CODE_TAKEN: 'That coupon code is already in use. Please try a different one.',
  STOCK_BELOW_RESERVED:
    '{reserved, plural, one {# unit} other {# units}} of this variant are reserved in customer carts. You cannot set the stock below that.',
  FIELD_DECRYPT_FAILED:
    'Your stored details could not be read, so the operation could not be completed. Please give this code to support: {requestId}',
  PAYOUT_INVALID_STATE:
    'This payout request has already been decided ({status}). Refresh the list and check again.',
  COMMISSION_RATE_ABOVE_CAP:
    'The commission rate can be at most {maxPercent}%. Enter a lower rate.',
  COMMISSION_VERSION_OVERLAP:
    'There is an overlap in the commission schedule and the operation was stopped. Please give this code to support: {requestId}',
  BULK_UPLOAD_INVALID:
    'The file you uploaded has errors on {count, plural, one {# row} other {# rows}}. Review the details and try again.',
  PAYOUT_INSUFFICIENT_BALANCE: 'Your withdrawable balance is not sufficient.',
  PAYOUT_PENDING_EXISTS: 'You have a pending payout request. Please wait for it to be resolved.',
  PAYOUT_BELOW_MINIMUM: 'A payout request must be at least {minAmount}.',
  COMMISSION_RULE_NOT_FOUND: 'Commission rule not found. The operation could not be completed.',

  // ── GENEL ─────────────────────────────────────────────────────────────
  VALIDATION_FAILED: 'There are errors in the information you submitted.',
  NOT_FOUND: 'Record not found.',
  DUPLICATE_RESOURCE: 'This record already exists.',
  INVALID_REFERENCE: 'An invalid record was referenced.',
  RATE_LIMITED:
    'You have sent too many requests. Try again in {retryAfter, plural, one {# second} other {# seconds}}.',
  IDEMPOTENCY_CONFLICT: 'The same operation key was used with a different request.',
  IDEMPOTENCY_IN_PROGRESS: 'Your request is being processed, please wait.',
  CONCURRENCY_CONFLICT: 'The record was updated by another operation. Please try again.',
  PAYLOAD_TOO_LARGE: 'The data you submitted is too large.',
  UPSTREAM_UNAVAILABLE: 'The service is temporarily unavailable. Please try again shortly.',
  UPSTREAM_TIMEOUT: 'The operation timed out. Please try again.',
  SERVICE_UNAVAILABLE: 'The system is under maintenance. Please try again shortly.',
  INTERNAL_ERROR:
    'Something went wrong. If the problem persists, please give this code to support: {requestId}',
} satisfies Record<ErrorCode, string>;

/**
 * DİL → METİN TABLOSU. `error-message.ts` dışında kimse doğrudan okumaz.
 *
 * ⚠️ Türkçe metin `ERROR_CATALOG`tan TÜRETİLİR, KOPYALANMAZ. Kopyalansaydı bir
 *    Türkçe cümle düzeltildiğinde iki dosyadan birinin güncellenmesi
 *    yetmez, ikisi de gerekirdi — ve unutulan kopya sessizce eski cümleyi
 *    göstermeye devam ederdi.
 */
export const ERROR_MESSAGES = {
  tr: Object.fromEntries(
    Object.entries(ERROR_CATALOG).map(([code, def]) => [code, def.message]),
  ) as Record<ErrorCode, string>,
  en: ERROR_CATALOG_EN,
} as const;
