-- CreateEnum
CREATE TYPE "FacetKind" AS ENUM ('PERIOD', 'COUNTRY', 'BRANCH', 'UNIT', 'TYPE', 'MAKER', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AlertFrequency" AS ENUM ('INSTANT', 'DAILY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "AlertKind" AS ENUM ('SAVED_SEARCH', 'BACK_AVAILABLE', 'PRICE_DROP');

-- CreateEnum
CREATE TYPE "ProductDocumentKind" AS ENUM ('PROVENANCE', 'DEACTIVATION_CERT', 'INVOICE_HISTORIC', 'OTHER');

-- CreateEnum
CREATE TYPE "ComplianceMatch" AS ENUM ('CATEGORY', 'RESTRICTED_SYMBOLS', 'AGE_RESTRICTED', 'DEACTIVATED_WEAPON');

-- CreateEnum
CREATE TYPE "ComplianceAction" AS ENUM ('BLUR_IMAGES', 'HIDE_PRODUCT', 'NO_SHIPPING');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'COUNTERED', 'REJECTED', 'EXPIRED', 'WITHDRAWN', 'CONVERTED');

-- CreateEnum
CREATE TYPE "CouponType" AS ENUM ('PERCENT', 'FIXED', 'FREE_SHIPPING');

-- AlterTable
ALTER TABLE "cart_items" ADD COLUMN     "offerId" TEXT;

-- AlterTable
ALTER TABLE "carts" ADD COLUMN     "abandonedMailSentAt" TIMESTAMP(3),
ADD COLUMN     "couponCode" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "reminderConsent" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "couponCode" TEXT,
ADD COLUMN     "discountTotal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "offerId" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "authenticityGuaranteed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "provenance" TEXT,
ADD COLUMN     "requiresDeactivationCert" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "facets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "FacetKind" NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isFilterable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "facets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facet_values" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "facetId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "legacyTagId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "facet_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_facet_values" (
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "facetValueId" TEXT NOT NULL,

    CONSTRAINT "product_facet_values_pkey" PRIMARY KEY ("productId","facetValueId")
);

-- CreateTable
CREATE TABLE "saved_searches" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "frequency" "AlertFrequency" NOT NULL DEFAULT 'DAILY',
    "confirmedAt" TIMESTAMP(3),
    "confirmTokenHash" TEXT,
    "unsubscribedAt" TIMESTAMP(3),
    "lastNotifiedAt" TIMESTAMP(3),
    "lastMatchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_searches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_deliveries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "AlertKind" NOT NULL,
    "savedSearchId" TEXT,
    "customerId" TEXT,
    "productId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "kind" "ProductDocumentKind" NOT NULL,
    "title" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "reason" TEXT,
    "snapshot" JSONB NOT NULL,
    "storageKey" TEXT,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "match" "ComplianceMatch" NOT NULL,
    "categoryId" TEXT,
    "countries" TEXT[],
    "action" "ComplianceAction" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "customerId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "message" TEXT,
    "status" "OfferStatus" NOT NULL DEFAULT 'PENDING',
    "counterAmount" INTEGER,
    "agreedAmount" INTEGER,
    "responseNote" TEXT,
    "respondedAt" TIMESTAMP(3),
    "respondedById" TEXT,
    "checkoutTokenHash" TEXT,
    "checkoutExpiresAt" TIMESTAMP(3),
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "type" "CouponType" NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "minSubtotal" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "maxRedemptions" INTEGER,
    "perEmailLimit" INTEGER DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" TEXT NOT NULL,
    "base" CHAR(3) NOT NULL,
    "quote" CHAR(3) NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "rateDate" DATE NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ECB',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "facets_tenantId_sortOrder_idx" ON "facets"("tenantId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "facets_tenantId_slug_key" ON "facets"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "facet_values_tenantId_facetId_sortOrder_idx" ON "facet_values"("tenantId", "facetId", "sortOrder");

-- CreateIndex
CREATE INDEX "facet_values_parentId_idx" ON "facet_values"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "facet_values_facetId_slug_key" ON "facet_values"("facetId", "slug");

-- CreateIndex
CREATE INDEX "product_facet_values_tenantId_facetValueId_idx" ON "product_facet_values"("tenantId", "facetValueId");

-- CreateIndex
CREATE UNIQUE INDEX "saved_searches_confirmTokenHash_key" ON "saved_searches"("confirmTokenHash");

-- CreateIndex
CREATE INDEX "saved_searches_tenantId_confirmedAt_idx" ON "saved_searches"("tenantId", "confirmedAt");

-- CreateIndex
CREATE INDEX "saved_searches_customerId_idx" ON "saved_searches"("customerId");

-- CreateIndex
CREATE INDEX "saved_searches_tenantId_email_idx" ON "saved_searches"("tenantId", "email");

-- CreateIndex
CREATE INDEX "alert_deliveries_tenantId_sentAt_idx" ON "alert_deliveries"("tenantId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "alert_deliveries_savedSearchId_productId_key" ON "alert_deliveries"("savedSearchId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "alert_deliveries_kind_customerId_productId_key" ON "alert_deliveries"("kind", "customerId", "productId");

-- CreateIndex
CREATE INDEX "product_documents_tenantId_productId_idx" ON "product_documents"("tenantId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_code_key" ON "certificates"("code");

-- CreateIndex
CREATE INDEX "certificates_tenantId_productId_idx" ON "certificates"("tenantId", "productId");

-- CreateIndex
CREATE INDEX "compliance_rules_tenantId_isActive_idx" ON "compliance_rules"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "offers_checkoutTokenHash_key" ON "offers"("checkoutTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "offers_orderId_key" ON "offers"("orderId");

-- CreateIndex
CREATE INDEX "offers_tenantId_status_createdAt_idx" ON "offers"("tenantId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "offers_productId_idx" ON "offers"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_tenantId_code_key" ON "coupons"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_orderId_key" ON "coupon_redemptions"("orderId");

-- CreateIndex
CREATE INDEX "coupon_redemptions_couponId_idx" ON "coupon_redemptions"("couponId");

-- CreateIndex
CREATE INDEX "coupon_redemptions_tenantId_email_idx" ON "coupon_redemptions"("tenantId", "email");

-- CreateIndex
CREATE INDEX "exchange_rates_base_quote_rateDate_idx" ON "exchange_rates"("base", "quote", "rateDate" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_base_quote_rateDate_key" ON "exchange_rates"("base", "quote", "rateDate");

-- AddForeignKey
ALTER TABLE "facets" ADD CONSTRAINT "facets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facet_values" ADD CONSTRAINT "facet_values_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facet_values" ADD CONSTRAINT "facet_values_facetId_fkey" FOREIGN KEY ("facetId") REFERENCES "facets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facet_values" ADD CONSTRAINT "facet_values_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "facet_values"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_facet_values" ADD CONSTRAINT "product_facet_values_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_facet_values" ADD CONSTRAINT "product_facet_values_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_facet_values" ADD CONSTRAINT "product_facet_values_facetValueId_fkey" FOREIGN KEY ("facetValueId") REFERENCES "facet_values"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_savedSearchId_fkey" FOREIGN KEY ("savedSearchId") REFERENCES "saved_searches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_documents" ADD CONSTRAINT "product_documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_documents" ADD CONSTRAINT "product_documents_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_rules" ADD CONSTRAINT "compliance_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_rules" ADD CONSTRAINT "compliance_rules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Hand-written constraints (phase 5) ─────────────────────────────────────
ALTER TABLE "orders" DROP CONSTRAINT "orders_amounts_check";
ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts_check"
  CHECK ("number" > 0 AND "subtotal" >= 0 AND "shippingTotal" >= 0 AND "surchargeTotal" >= 0
         AND "discountTotal" >= 0 AND "discountTotal" <= "subtotal" AND "total" >= 0);

ALTER TABLE "coupons" ADD CONSTRAINT "coupons_check"
  CHECK ("code" = upper("code") AND "code" ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$' AND "value" >= 0 AND "minSubtotal" >= 0
         AND ("type" <> 'PERCENT' OR "value" BETWEEN 1 AND 10000)
         AND ("endsAt" IS NULL OR "startsAt" IS NULL OR "endsAt" > "startsAt"));
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_amount_check" CHECK ("amount" >= 0);

ALTER TABLE "offers" ADD CONSTRAINT "offers_amounts_check"
  CHECK ("amount" > 0 AND ("counterAmount" IS NULL OR "counterAmount" > 0) AND ("agreedAmount" IS NULL OR "agreedAmount" > 0)
         AND "currency" ~ '^[A-Z]{3}$');

ALTER TABLE "compliance_rules" ADD CONSTRAINT "compliance_rules_check"
  CHECK (("match" = 'CATEGORY') = ("categoryId" IS NOT NULL) AND cardinality("countries") > 0);

ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_check"
  CHECK ("rate" > 0 AND "base" ~ '^[A-Z]{3}$' AND "quote" ~ '^[A-Z]{3}$');

ALTER TABLE "product_documents" ADD CONSTRAINT "product_documents_size_check" CHECK ("byteSize" > 0);

-- One saved-search alert per product; wishlist alerts are keyed by customer (nullable unique pairs
-- would otherwise allow duplicates).
CREATE UNIQUE INDEX IF NOT EXISTS "alert_deliveries_wishlist_key"
  ON "alert_deliveries"("kind", "customerId", "productId") WHERE "savedSearchId" IS NULL;
