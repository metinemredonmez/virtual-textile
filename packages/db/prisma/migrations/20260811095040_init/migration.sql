-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CUSTOMER', 'SELLER_USER', 'SUPPORT', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'PENDING_DELETION', 'DELETED');

-- CreateEnum
CREATE TYPE "FitPref" AS ENUM ('SLIM', 'REGULAR', 'OVERSIZE');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('PHOTO_PROCESSING', 'CROSS_BORDER_TRANSFER', 'PHOTO_STORAGE', 'MODEL_TRAINING', 'MARKETING');

-- CreateEnum
CREATE TYPE "PhotoPurpose" AS ENUM ('ONE_TIME', 'SAVED_PROFILE');

-- CreateEnum
CREATE TYPE "SellerStatus" AS ENUM ('PENDING', 'APPROVED', 'SUSPENDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SellerDocumentType" AS ENUM ('TAX_CERTIFICATE', 'TRADE_REGISTRY', 'SIGNATURE_CIRCULAR', 'ID_CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "TryOnCategory" AS ENUM ('UPPER_BODY', 'LOWER_BODY', 'DRESS', 'OUTERWEAR');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('WOMAN', 'MAN', 'UNISEX', 'KIDS');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ImageAngle" AS ENUM ('FRONT', 'BACK', 'SIDE', 'DETAIL', 'MODEL', 'FLATLAY');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT', 'FREE_SHIPPING');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAYMENT_FAILED', 'EXPIRED', 'PAID', 'PARTIALLY_SHIPPED', 'SHIPPED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PackageStatus" AS ENUM ('AWAITING_APPROVAL', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURN_REQUESTED', 'RETURNED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('SYSTEM', 'CUSTOMER', 'SELLER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'IN_TRANSIT', 'RECEIVED', 'REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReturnReason" AS ENUM ('SIZE_TOO_SMALL', 'SIZE_TOO_LARGE', 'NOT_AS_DESCRIBED', 'DAMAGED', 'WRONG_ITEM', 'CHANGED_MIND', 'QUALITY', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'THREEDS_PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('SALE', 'COMMISSION', 'SHIPPING_SHARE', 'REFUND', 'COMMISSION_REVERSAL', 'SHIPPING_REVERSAL', 'PAYOUT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('REQUESTED', 'APPROVED', 'SENT', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TryOnMode" AS ENUM ('FAST', 'QUALITY');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'FAILED_PERMANENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AiFeature" AS ENUM ('TRYON', 'STYLIST', 'TAGGING', 'DESCRIPTION', 'EMBEDDING', 'MODERATION');

-- CreateTable
CREATE TABLE "user_users" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "passwordHash" TEXT,
    "role" "Role" NOT NULL DEFAULT 'CUSTOMER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "firstName" TEXT,
    "lastName" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'tr-TR',
    "emailVerifiedAt" TIMESTAMP(3),
    "phoneVerifiedAt" TIMESTAMP(3),
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "deletionRequestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "replacedBySessionId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "reusedAt" TIMESTAMP(3),
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "deviceLabel" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_social_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_social_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_addresses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "neighbourhood" TEXT,
    "line1" TEXT NOT NULL,
    "postalCode" TEXT,
    "companyName" TEXT,
    "taxOffice" TEXT,
    "taxNumberEnc" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_body_profiles" (
    "userId" TEXT NOT NULL,
    "heightCm" INTEGER,
    "weightKg" INTEGER,
    "chestCm" INTEGER,
    "waistCm" INTEGER,
    "hipCm" INTEGER,
    "usualSize" TEXT,
    "fitPref" "FitPref",
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_body_profiles_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "ConsentType" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "documentVersion" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_user_photos" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "purpose" "PhotoPurpose" NOT NULL,
    "qualityScore" INTEGER,
    "qualityIssues" JSONB,
    "contentHash" TEXT NOT NULL,
    "widthPx" INTEGER NOT NULL,
    "heightPx" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_user_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_sellers" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "taxNumberEnc" TEXT NOT NULL,
    "taxOffice" TEXT NOT NULL,
    "ibanEnc" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "status" "SellerStatus" NOT NULL DEFAULT 'PENDING',
    "statusReason" TEXT,
    "submerchantKey" TEXT,
    "qualityScore" INTEGER NOT NULL DEFAULT 50,
    "vacationMode" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_sellers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_users" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeRole" TEXT NOT NULL DEFAULT 'staff',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_documents" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "type" "SellerDocumentType" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "approved" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_stores" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "logoKey" TEXT,
    "bannerKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_categories" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tryOnCategory" "TryOnCategory",
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "catalog_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_products" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "gender" "Gender" NOT NULL,
    "season" TEXT,
    "collection" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "statusReason" TEXT,
    "aiTags" JSONB,
    "aiTagsApproved" BOOLEAN NOT NULL DEFAULT false,
    "tryOnScore" INTEGER,
    "tryOnIssues" JSONB,
    "sizeChart" JSONB,
    "embedding" vector(768),
    "searchVector" tsvector,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "tryOnCount" INTEGER NOT NULL DEFAULT 0,
    "popularityScore" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_variants" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "colorHex" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "priceMinor" BIGINT NOT NULL,
    "listPriceMinor" BIGINT,
    "barcode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_inventory" (
    "variantId" TEXT NOT NULL,
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_inventory_pkey" PRIMARY KEY ("variantId")
);

-- CreateTable
CREATE TABLE "catalog_price_history" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "priceMinor" BIGINT NOT NULL,
    "listPriceMinor" BIGINT,
    "changedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_product_images" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "angle" "ImageAngle" NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "bgRemovedKey" TEXT,
    "blurhash" TEXT,
    "widthPx" INTEGER NOT NULL,
    "heightPx" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_reviews" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderItemId" TEXT,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "fitFeedback" TEXT,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_favorites" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_favorites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_carts" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT,
    "couponId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cart_carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "outfitId" TEXT,
    "quantity" INTEGER NOT NULL,
    "addedPriceMinor" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_outfits" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "cartId" TEXT,
    "name" TEXT NOT NULL,
    "tryOnJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cart_outfits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_coupons" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sellerId" TEXT,
    "discountType" "DiscountType" NOT NULL,
    "discountValue" BIGINT NOT NULL,
    "maxDiscountMinor" BIGINT,
    "minCartMinor" BIGINT NOT NULL DEFAULT 0,
    "usageLimit" INTEGER,
    "usageLimitPerUser" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_coupon_redemptions" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_orders" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "itemsTotalMinor" BIGINT NOT NULL,
    "shippingTotalMinor" BIGINT NOT NULL DEFAULT 0,
    "discountMinor" BIGINT NOT NULL DEFAULT 0,
    "grandTotalMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "shippingAddress" JSONB NOT NULL,
    "billingAddress" JSONB NOT NULL,
    "reservationExpiresAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_packages" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "status" "PackageStatus" NOT NULL DEFAULT 'AWAITING_APPROVAL',
    "itemsTotalMinor" BIGINT NOT NULL,
    "shippingMinor" BIGINT NOT NULL DEFAULT 0,
    "discountShareMinor" BIGINT NOT NULL DEFAULT 0,
    "carrier" TEXT,
    "trackingNo" TEXT,
    "slaDeadline" TIMESTAMP(3) NOT NULL,
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "variantLabel" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "imageKey" TEXT NOT NULL,
    "unitPriceMinor" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lineTotalMinor" BIGINT NOT NULL,
    "commissionRuleVersionId" TEXT NOT NULL,
    "commissionRateBps" INTEGER NOT NULL,
    "commissionAmountMinor" BIGINT NOT NULL,
    "sellerNetMinor" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_requests" (
    "id" TEXT NOT NULL,
    "returnNumber" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" "ReturnReason" NOT NULL,
    "note" TEXT,
    "photoKeys" TEXT[],
    "refundAmountMinor" BIGINT NOT NULL DEFAULT 0,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "return_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_items" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "refundMinor" BIGINT NOT NULL,

    CONSTRAINT "return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_intents" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'iyzico',
    "providerRef" TEXT,
    "conversationId" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "installment" INTEGER NOT NULL DEFAULT 1,
    "cardMask" TEXT,
    "cardBrand" TEXT,
    "cardToken" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "rawResponse" JSONB,
    "authorizedAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "providerCode" TEXT,
    "providerMessage" TEXT,
    "mappedErrorCode" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_refunds" (
    "id" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "returnId" TEXT,
    "amountMinor" BIGINT NOT NULL,
    "providerRef" TEXT,
    "refundRef" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_commission_rules" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT,
    "sellerId" TEXT,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_commission_rule_versions" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "rateBps" INTEGER NOT NULL,
    "fixedFeeMinor" BIGINT NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_commission_rule_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_ledger_entries" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "type" "LedgerType" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "orderItemId" TEXT,
    "payoutId" TEXT,
    "description" TEXT NOT NULL,
    "availableAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_payout_requests" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'REQUESTED',
    "ibanEnc" TEXT NOT NULL,
    "payoutRef" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "providerRef" TEXT,
    "sentAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_payout_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_tryon_jobs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT,
    "userPhotoId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "mode" "TryOnMode" NOT NULL DEFAULT 'FAST',
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "cacheKey" TEXT NOT NULL,
    "provider" TEXT,
    "providerJobId" TEXT,
    "resultKey" TEXT,
    "visualConfidence" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "costMicroUsd" BIGINT,
    "latencyMs" INTEGER,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ai_tryon_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "sellerId" TEXT,
    "feature" "AiFeature" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "imageCount" INTEGER,
    "costMicroUsd" BIGINT NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "errorCode" TEXT,
    "cacheHit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_stylist_conversations" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_stylist_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_stylist_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" JSONB,
    "suggestedProductIds" TEXT[],
    "costMicroUsd" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_stylist_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "infra_outbox_events" (
    "id" TEXT NOT NULL,
    "aggregate" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "infra_outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "infra_idempotency_keys" (
    "key" TEXT NOT NULL,
    "userId" TEXT,
    "endpoint" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "statusCode" INTEGER,
    "response" JSONB,
    "lockedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "infra_idempotency_keys_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "infra_webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signatureOk" BOOLEAN NOT NULL,
    "processedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "infra_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "infra_audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" "Role" NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ipAddress" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "infra_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_synonyms" (
    "id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "synonyms" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_synonyms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_users_email_key" ON "user_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_users_phone_key" ON "user_users"("phone");

-- CreateIndex
CREATE INDEX "user_users_status_createdAt_idx" ON "user_users"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_refreshTokenHash_key" ON "user_sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "user_sessions_userId_revokedAt_idx" ON "user_sessions"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "user_sessions_expiresAt_idx" ON "user_sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_social_accounts_provider_providerUserId_key" ON "user_social_accounts"("provider", "providerUserId");

-- CreateIndex
CREATE INDEX "user_addresses_userId_archivedAt_idx" ON "user_addresses"("userId", "archivedAt");

-- CreateIndex
CREATE INDEX "consent_records_userId_type_createdAt_idx" ON "consent_records"("userId", "type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_user_photos_storageKey_key" ON "ai_user_photos"("storageKey");

-- CreateIndex
CREATE INDEX "ai_user_photos_expiresAt_deletedAt_idx" ON "ai_user_photos"("expiresAt", "deletedAt");

-- CreateIndex
CREATE INDEX "ai_user_photos_userId_createdAt_idx" ON "ai_user_photos"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "seller_sellers_status_idx" ON "seller_sellers"("status");

-- CreateIndex
CREATE UNIQUE INDEX "seller_users_sellerId_userId_key" ON "seller_users"("sellerId", "userId");

-- CreateIndex
CREATE INDEX "seller_documents_sellerId_idx" ON "seller_documents"("sellerId");

-- CreateIndex
CREATE UNIQUE INDEX "seller_stores_sellerId_key" ON "seller_stores"("sellerId");

-- CreateIndex
CREATE UNIQUE INDEX "seller_stores_slug_key" ON "seller_stores"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_categories_slug_key" ON "catalog_categories"("slug");

-- CreateIndex
CREATE INDEX "catalog_categories_parentId_sortOrder_idx" ON "catalog_categories"("parentId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_products_slug_key" ON "catalog_products"("slug");

-- CreateIndex
CREATE INDEX "catalog_products_sellerId_status_idx" ON "catalog_products"("sellerId", "status");

-- CreateIndex
CREATE INDEX "catalog_products_categoryId_status_publishedAt_idx" ON "catalog_products"("categoryId", "status", "publishedAt");

-- CreateIndex
CREATE INDEX "catalog_products_status_popularityScore_idx" ON "catalog_products"("status", "popularityScore");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_variants_sku_key" ON "catalog_variants"("sku");

-- CreateIndex
CREATE INDEX "catalog_variants_productId_isActive_idx" ON "catalog_variants"("productId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_variants_productId_color_size_key" ON "catalog_variants"("productId", "color", "size");

-- CreateIndex
CREATE INDEX "catalog_price_history_variantId_createdAt_idx" ON "catalog_price_history"("variantId", "createdAt");

-- CreateIndex
CREATE INDEX "catalog_product_images_productId_sortOrder_idx" ON "catalog_product_images"("productId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_reviews_orderItemId_key" ON "catalog_reviews"("orderItemId");

-- CreateIndex
CREATE INDEX "catalog_reviews_productId_isApproved_createdAt_idx" ON "catalog_reviews"("productId", "isApproved", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_reviews_productId_userId_key" ON "catalog_reviews"("productId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_favorites_userId_productId_key" ON "catalog_favorites"("userId", "productId");

-- CreateIndex
CREATE INDEX "cart_carts_expiresAt_idx" ON "cart_carts"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "cart_carts_userId_key" ON "cart_carts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "cart_carts_sessionId_key" ON "cart_carts"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cartId_variantId_key" ON "cart_items"("cartId", "variantId");

-- CreateIndex
CREATE INDEX "cart_outfits_userId_createdAt_idx" ON "cart_outfits"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "promo_coupons_code_key" ON "promo_coupons"("code");

-- CreateIndex
CREATE INDEX "promo_coupons_code_isActive_idx" ON "promo_coupons"("code", "isActive");

-- CreateIndex
CREATE INDEX "promo_coupons_sellerId_isActive_idx" ON "promo_coupons"("sellerId", "isActive");

-- CreateIndex
CREATE INDEX "promo_coupon_redemptions_couponId_userId_idx" ON "promo_coupon_redemptions"("couponId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "promo_coupon_redemptions_couponId_orderId_key" ON "promo_coupon_redemptions"("couponId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "order_orders_orderNumber_key" ON "order_orders"("orderNumber");

-- CreateIndex
CREATE INDEX "order_orders_userId_createdAt_idx" ON "order_orders"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "order_orders_status_createdAt_idx" ON "order_orders"("status", "createdAt");

-- CreateIndex
CREATE INDEX "order_orders_reservationExpiresAt_idx" ON "order_orders"("reservationExpiresAt");

-- CreateIndex
CREATE INDEX "order_packages_sellerId_status_idx" ON "order_packages"("sellerId", "status");

-- CreateIndex
CREATE INDEX "order_packages_status_slaDeadline_idx" ON "order_packages"("status", "slaDeadline");

-- CreateIndex
CREATE UNIQUE INDEX "order_packages_orderId_sellerId_key" ON "order_packages"("orderId", "sellerId");

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE INDEX "order_items_packageId_idx" ON "order_items"("packageId");

-- CreateIndex
CREATE INDEX "order_events_orderId_createdAt_idx" ON "order_events"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "return_requests_returnNumber_key" ON "return_requests"("returnNumber");

-- CreateIndex
CREATE INDEX "return_requests_orderId_idx" ON "return_requests"("orderId");

-- CreateIndex
CREATE INDEX "return_requests_status_createdAt_idx" ON "return_requests"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "return_items_returnId_orderItemId_key" ON "return_items"("returnId", "orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_orderId_key" ON "payment_intents"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_conversationId_key" ON "payment_intents"("conversationId");

-- CreateIndex
CREATE INDEX "payment_intents_status_createdAt_idx" ON "payment_intents"("status", "createdAt");

-- CreateIndex
CREATE INDEX "payment_intents_providerRef_idx" ON "payment_intents"("providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_intentId_attemptNo_key" ON "payment_attempts"("intentId", "attemptNo");

-- CreateIndex
CREATE UNIQUE INDEX "payment_refunds_refundRef_key" ON "payment_refunds"("refundRef");

-- CreateIndex
CREATE INDEX "payment_refunds_intentId_idx" ON "payment_refunds"("intentId");

-- CreateIndex
CREATE UNIQUE INDEX "finance_commission_rules_categoryId_sellerId_key" ON "finance_commission_rules"("categoryId", "sellerId");

-- CreateIndex
CREATE INDEX "finance_commission_rule_versions_ruleId_validFrom_idx" ON "finance_commission_rule_versions"("ruleId", "validFrom");

-- CreateIndex
CREATE INDEX "finance_ledger_entries_sellerId_createdAt_idx" ON "finance_ledger_entries"("sellerId", "createdAt");

-- CreateIndex
CREATE INDEX "finance_ledger_entries_sellerId_availableAt_idx" ON "finance_ledger_entries"("sellerId", "availableAt");

-- CreateIndex
CREATE INDEX "finance_ledger_entries_orderItemId_idx" ON "finance_ledger_entries"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "finance_payout_requests_payoutRef_key" ON "finance_payout_requests"("payoutRef");

-- CreateIndex
CREATE INDEX "finance_payout_requests_sellerId_status_idx" ON "finance_payout_requests"("sellerId", "status");

-- CreateIndex
CREATE INDEX "finance_payout_requests_status_createdAt_idx" ON "finance_payout_requests"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_tryon_jobs_cacheKey_key" ON "ai_tryon_jobs"("cacheKey");

-- CreateIndex
CREATE INDEX "ai_tryon_jobs_userId_queuedAt_idx" ON "ai_tryon_jobs"("userId", "queuedAt");

-- CreateIndex
CREATE INDEX "ai_tryon_jobs_status_queuedAt_idx" ON "ai_tryon_jobs"("status", "queuedAt");

-- CreateIndex
CREATE INDEX "ai_usage_logs_createdAt_idx" ON "ai_usage_logs"("createdAt");

-- CreateIndex
CREATE INDEX "ai_usage_logs_userId_createdAt_idx" ON "ai_usage_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_usage_logs_feature_createdAt_idx" ON "ai_usage_logs"("feature", "createdAt");

-- CreateIndex
CREATE INDEX "ai_stylist_conversations_userId_updatedAt_idx" ON "ai_stylist_conversations"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ai_stylist_messages_conversationId_createdAt_idx" ON "ai_stylist_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "infra_outbox_events_publishedAt_id_idx" ON "infra_outbox_events"("publishedAt", "id");

-- CreateIndex
CREATE INDEX "infra_outbox_events_aggregate_aggregateId_idx" ON "infra_outbox_events"("aggregate", "aggregateId");

-- CreateIndex
CREATE INDEX "infra_idempotency_keys_expiresAt_idx" ON "infra_idempotency_keys"("expiresAt");

-- CreateIndex
CREATE INDEX "infra_webhook_events_provider_processedAt_idx" ON "infra_webhook_events"("provider", "processedAt");

-- CreateIndex
CREATE INDEX "infra_audit_logs_entityType_entityId_createdAt_idx" ON "infra_audit_logs"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "infra_audit_logs_actorId_createdAt_idx" ON "infra_audit_logs"("actorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "search_synonyms_term_key" ON "search_synonyms"("term");

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_social_accounts" ADD CONSTRAINT "user_social_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_addresses" ADD CONSTRAINT "user_addresses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_body_profiles" ADD CONSTRAINT "user_body_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_user_photos" ADD CONSTRAINT "ai_user_photos_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_users" ADD CONSTRAINT "seller_users_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "seller_sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_users" ADD CONSTRAINT "seller_users_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_documents" ADD CONSTRAINT "seller_documents_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "seller_sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_stores" ADD CONSTRAINT "seller_stores_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "seller_sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_categories" ADD CONSTRAINT "catalog_categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "catalog_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_products" ADD CONSTRAINT "catalog_products_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "seller_sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_products" ADD CONSTRAINT "catalog_products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "catalog_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_variants" ADD CONSTRAINT "catalog_variants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "catalog_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_inventory" ADD CONSTRAINT "catalog_inventory_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "catalog_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_price_history" ADD CONSTRAINT "catalog_price_history_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "catalog_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_product_images" ADD CONSTRAINT "catalog_product_images_productId_fkey" FOREIGN KEY ("productId") REFERENCES "catalog_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_reviews" ADD CONSTRAINT "catalog_reviews_productId_fkey" FOREIGN KEY ("productId") REFERENCES "catalog_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_reviews" ADD CONSTRAINT "catalog_reviews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_favorites" ADD CONSTRAINT "catalog_favorites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_favorites" ADD CONSTRAINT "catalog_favorites_productId_fkey" FOREIGN KEY ("productId") REFERENCES "catalog_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_carts" ADD CONSTRAINT "cart_carts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_carts" ADD CONSTRAINT "cart_carts_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "promo_coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "cart_carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "catalog_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_outfitId_fkey" FOREIGN KEY ("outfitId") REFERENCES "cart_outfits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_outfits" ADD CONSTRAINT "cart_outfits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_outfits" ADD CONSTRAINT "cart_outfits_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "cart_carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_coupons" ADD CONSTRAINT "promo_coupons_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "seller_sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_coupon_redemptions" ADD CONSTRAINT "promo_coupon_redemptions_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "promo_coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_orders" ADD CONSTRAINT "order_orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_packages" ADD CONSTRAINT "order_packages_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_packages" ADD CONSTRAINT "order_packages_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "seller_sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "order_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "catalog_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_commissionRuleVersionId_fkey" FOREIGN KEY ("commissionRuleVersionId") REFERENCES "finance_commission_rule_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "return_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "payment_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "payment_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_commission_rules" ADD CONSTRAINT "finance_commission_rules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "catalog_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_commission_rules" ADD CONSTRAINT "finance_commission_rules_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "seller_sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_commission_rule_versions" ADD CONSTRAINT "finance_commission_rule_versions_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "finance_commission_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_ledger_entries" ADD CONSTRAINT "finance_ledger_entries_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "seller_sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_ledger_entries" ADD CONSTRAINT "finance_ledger_entries_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_ledger_entries" ADD CONSTRAINT "finance_ledger_entries_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "finance_payout_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_payout_requests" ADD CONSTRAINT "finance_payout_requests_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "seller_sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_tryon_jobs" ADD CONSTRAINT "ai_tryon_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_tryon_jobs" ADD CONSTRAINT "ai_tryon_jobs_userPhotoId_fkey" FOREIGN KEY ("userPhotoId") REFERENCES "ai_user_photos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_tryon_jobs" ADD CONSTRAINT "ai_tryon_jobs_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "catalog_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_stylist_conversations" ADD CONSTRAINT "ai_stylist_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_stylist_messages" ADD CONSTRAINT "ai_stylist_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai_stylist_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
