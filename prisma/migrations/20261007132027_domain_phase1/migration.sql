-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RESERVED', 'SOLD', 'ARCHIVED', 'STOLEN');

-- CreateEnum
CREATE TYPE "StockMovementReason" AS ENUM ('PURCHASE', 'SALE', 'ADJUSTMENT', 'RESERVE', 'RELEASE', 'RETURN');

-- CreateEnum
CREATE TYPE "AddressType" AS ENUM ('BILLING', 'SHIPPING');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'CONVERTED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELED', 'EXPIRED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "FulfillmentStatus" AS ENUM ('UNFULFILLED', 'PACKED', 'SHIPPED', 'DELIVERED');

-- CreateEnum
CREATE TYPE "ShippingMethod" AS ENUM ('SHIP', 'PICKUP');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('MOLLIE', 'MANUAL');

-- CreateEnum
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('OPEN', 'PENDING', 'AUTHORIZED', 'PAID', 'FAILED', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ContentBlockType" AS ENUM ('HERO', 'TEXT', 'TEXT_HORIZONTAL', 'TEXT_IMAGE', 'TEXT_PRODUCT', 'TEXT_CAROUSEL', 'QUOTE', 'CTA', 'TESTIMONIAL', 'NEW_ITEMS', 'GALLERY', 'CATEGORIES', 'NEWSLETTER_SIGNUP');

-- CreateEnum
CREATE TYPE "MenuLocation" AS ENUM ('HEADER', 'FOOTER');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "tenant_sequences" (
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_sequences_pkey" PRIMARY KEY ("tenantId","name")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "parentId" TEXT,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "legacyId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "legacyId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "stockCode" INTEGER NOT NULL,
    "sku" TEXT,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "specifications" JSONB,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "price" INTEGER NOT NULL,
    "purchasePrice" INTEGER,
    "weightGrams" INTEGER NOT NULL DEFAULT 0,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "importance" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "soldAt" TIMESTAMP(3),
    "ageRestricted" BOOLEAN NOT NULL DEFAULT false,
    "blurred" BOOLEAN NOT NULL DEFAULT false,
    "acceptsOffers" BOOLEAN NOT NULL DEFAULT false,
    "restrictedSymbols" BOOLEAN NOT NULL DEFAULT false,
    "onSale" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "categoryId" TEXT,
    "purchaseRecordId" TEXT,
    "legacyData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT,
    "mimeType" TEXT,
    "byteSize" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "alt" TEXT,
    "variants" JSONB,
    "processedAt" TIMESTAMP(3),
    "legacyCloudflareId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_tags" (
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "product_tags_pkey" PRIMARY KEY ("productId","tagId")
);

-- CreateTable
CREATE TABLE "product_relations" (
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "relatedProductId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_relations_pkey" PRIMARY KEY ("productId","relatedProductId")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT,
    "notes" TEXT,
    "legacyId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierId" TEXT,
    "purchasedAt" DATE NOT NULL,
    "invoiceNumber" TEXT,
    "totalCost" INTEGER,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "notes" TEXT,
    "legacyId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" BIGSERIAL NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "quantityAfter" INTEGER NOT NULL,
    "reason" "StockMovementReason" NOT NULL,
    "orderId" TEXT,
    "reservationId" TEXT,
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "AddressType" NOT NULL DEFAULT 'SHIPPING',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "company" TEXT,
    "street" TEXT NOT NULL,
    "houseNumber" TEXT,
    "line2" TEXT,
    "postalCode" TEXT,
    "city" TEXT NOT NULL,
    "region" TEXT,
    "countryCode" CHAR(2) NOT NULL,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wishlist_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wishlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "customerId" TEXT,
    "countryCode" CHAR(2),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "cartId" TEXT,
    "orderId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "uuid" UUID NOT NULL,
    "customerId" TEXT,
    "email" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "phone" TEXT,
    "currency" CHAR(3) NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "shippingTotal" INTEGER NOT NULL DEFAULT 0,
    "surchargeTotal" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "fulfillmentStatus" "FulfillmentStatus" NOT NULL DEFAULT 'UNFULFILLED',
    "paymentMethod" TEXT,
    "shippingMethod" "ShippingMethod" NOT NULL DEFAULT 'SHIP',
    "shippingZoneId" TEXT,
    "shippingZoneName" TEXT,
    "shippingWeightGrams" INTEGER,
    "carrier" TEXT,
    "trackingNumber" TEXT,
    "trackingUrl" TEXT,
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "confirmationSentAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "customerNote" TEXT,
    "notes" TEXT,
    "legacyData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "title" TEXT NOT NULL,
    "stockCode" INTEGER,
    "sku" TEXT,
    "imagePath" TEXT,
    "unitPrice" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "lineTotal" INTEGER NOT NULL,
    "purchasePriceSnapshot" INTEGER,
    "priceReconstructed" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_addresses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "AddressType" NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "company" TEXT,
    "street" TEXT NOT NULL,
    "houseNumber" TEXT,
    "line2" TEXT,
    "postalCode" TEXT,
    "city" TEXT NOT NULL,
    "region" TEXT,
    "countryCode" CHAR(2) NOT NULL,
    "phone" TEXT,

    CONSTRAINT "order_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" BIGSERIAL NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'MOLLIE',
    "providerPaymentId" TEXT,
    "method" TEXT,
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'OPEN',
    "amount" INTEGER NOT NULL,
    "amountRefunded" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "checkoutUrl" TEXT,
    "raw" JSONB,
    "paidAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "vatScheme" TEXT,
    "storageKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_zones" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "countries" TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPickup" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_rates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "maxWeightGrams" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "insurancePrice" INTEGER,
    "maxInsuredValue" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_pages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "systemKey" TEXT,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "publishedAt" TIMESTAMP(3),
    "legacyId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_blocks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "type" "ContentBlockType" NOT NULL,
    "data" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "location" "MenuLocation" NOT NULL,
    "parentId" TEXT,
    "label" TEXT NOT NULL,
    "url" TEXT,
    "pageId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "newsletter_subscribers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "customerId" TEXT,
    "confirmTokenHash" TEXT,
    "confirmSentAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "newsletter_subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "newsletter_campaigns" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "newsletter_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_views" (
    "id" BIGSERIAL NOT NULL,
    "tenantId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "referrerHost" TEXT,
    "countryCode" CHAR(2),
    "visitorHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "categories_tenantId_parentId_sortOrder_idx" ON "categories"("tenantId", "parentId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "categories_tenantId_slug_key" ON "categories"("tenantId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "categories_tenantId_legacyId_key" ON "categories"("tenantId", "legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "tags_tenantId_slug_key" ON "tags"("tenantId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "tags_tenantId_name_key" ON "tags"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "tags_tenantId_legacyId_key" ON "tags"("tenantId", "legacyId");

-- CreateIndex
CREATE INDEX "products_tenantId_status_publishedAt_idx" ON "products"("tenantId", "status", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "products_tenantId_categoryId_status_idx" ON "products"("tenantId", "categoryId", "status");

-- CreateIndex
CREATE INDEX "products_tenantId_soldAt_idx" ON "products"("tenantId", "soldAt");

-- CreateIndex
CREATE INDEX "products_purchaseRecordId_idx" ON "products"("purchaseRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenantId_stockCode_key" ON "products"("tenantId", "stockCode");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenantId_slug_key" ON "products"("tenantId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenantId_sku_key" ON "products"("tenantId", "sku");

-- CreateIndex
CREATE INDEX "product_images_productId_sortOrder_idx" ON "product_images"("productId", "sortOrder");

-- CreateIndex
CREATE INDEX "product_images_tenantId_idx" ON "product_images"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "product_images_storageKey_key" ON "product_images"("storageKey");

-- CreateIndex
CREATE INDEX "product_tags_tagId_idx" ON "product_tags"("tagId");

-- CreateIndex
CREATE INDEX "product_tags_tenantId_idx" ON "product_tags"("tenantId");

-- CreateIndex
CREATE INDEX "product_relations_relatedProductId_idx" ON "product_relations"("relatedProductId");

-- CreateIndex
CREATE INDEX "product_relations_tenantId_idx" ON "product_relations"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_tenantId_name_key" ON "suppliers"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_tenantId_legacyId_key" ON "suppliers"("tenantId", "legacyId");

-- CreateIndex
CREATE INDEX "purchase_records_tenantId_purchasedAt_idx" ON "purchase_records"("tenantId", "purchasedAt");

-- CreateIndex
CREATE INDEX "purchase_records_supplierId_idx" ON "purchase_records"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_records_tenantId_legacyId_key" ON "purchase_records"("tenantId", "legacyId");

-- CreateIndex
CREATE INDEX "stock_movements_productId_createdAt_idx" ON "stock_movements"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "stock_movements_tenantId_createdAt_idx" ON "stock_movements"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "stock_movements_orderId_idx" ON "stock_movements"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "customers_userId_key" ON "customers"("userId");

-- CreateIndex
CREATE INDEX "customers_tenantId_createdAt_idx" ON "customers"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenantId_email_key" ON "customers"("tenantId", "email");

-- CreateIndex
CREATE INDEX "addresses_customerId_idx" ON "addresses"("customerId");

-- CreateIndex
CREATE INDEX "addresses_tenantId_idx" ON "addresses"("tenantId");

-- CreateIndex
CREATE INDEX "wishlist_items_productId_idx" ON "wishlist_items"("productId");

-- CreateIndex
CREATE INDEX "wishlist_items_tenantId_idx" ON "wishlist_items"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "wishlist_items_customerId_productId_key" ON "wishlist_items"("customerId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "carts_tokenHash_key" ON "carts"("tokenHash");

-- CreateIndex
CREATE INDEX "carts_tenantId_updatedAt_idx" ON "carts"("tenantId", "updatedAt");

-- CreateIndex
CREATE INDEX "carts_customerId_idx" ON "carts"("customerId");

-- CreateIndex
CREATE INDEX "carts_expiresAt_idx" ON "carts"("expiresAt");

-- CreateIndex
CREATE INDEX "cart_items_productId_idx" ON "cart_items"("productId");

-- CreateIndex
CREATE INDEX "cart_items_tenantId_idx" ON "cart_items"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cartId_productId_key" ON "cart_items"("cartId", "productId");

-- CreateIndex
CREATE INDEX "reservations_productId_status_idx" ON "reservations"("productId", "status");

-- CreateIndex
CREATE INDEX "reservations_status_expiresAt_idx" ON "reservations"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "reservations_cartId_idx" ON "reservations"("cartId");

-- CreateIndex
CREATE INDEX "reservations_orderId_idx" ON "reservations"("orderId");

-- CreateIndex
CREATE INDEX "reservations_tenantId_idx" ON "reservations"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_uuid_key" ON "orders"("uuid");

-- CreateIndex
CREATE INDEX "orders_tenantId_placedAt_idx" ON "orders"("tenantId", "placedAt" DESC);

-- CreateIndex
CREATE INDEX "orders_tenantId_paymentStatus_placedAt_idx" ON "orders"("tenantId", "paymentStatus", "placedAt" DESC);

-- CreateIndex
CREATE INDEX "orders_tenantId_fulfillmentStatus_idx" ON "orders"("tenantId", "fulfillmentStatus");

-- CreateIndex
CREATE INDEX "orders_tenantId_archivedAt_idx" ON "orders"("tenantId", "archivedAt");

-- CreateIndex
CREATE INDEX "orders_tenantId_email_idx" ON "orders"("tenantId", "email");

-- CreateIndex
CREATE INDEX "orders_customerId_idx" ON "orders"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tenantId_number_key" ON "orders"("tenantId", "number");

-- CreateIndex
CREATE INDEX "order_lines_orderId_idx" ON "order_lines"("orderId");

-- CreateIndex
CREATE INDEX "order_lines_productId_idx" ON "order_lines"("productId");

-- CreateIndex
CREATE INDEX "order_lines_tenantId_idx" ON "order_lines"("tenantId");

-- CreateIndex
CREATE INDEX "order_addresses_tenantId_idx" ON "order_addresses"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "order_addresses_orderId_type_key" ON "order_addresses"("orderId", "type");

-- CreateIndex
CREATE INDEX "order_events_orderId_createdAt_idx" ON "order_events"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "order_events_tenantId_createdAt_idx" ON "order_events"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payments_providerPaymentId_key" ON "payments"("providerPaymentId");

-- CreateIndex
CREATE INDEX "payments_orderId_idx" ON "payments"("orderId");

-- CreateIndex
CREATE INDEX "payments_tenantId_createdAt_idx" ON "payments"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_orderId_key" ON "invoices"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenantId_number_key" ON "invoices"("tenantId", "number");

-- CreateIndex
CREATE INDEX "shipping_zones_tenantId_sortOrder_idx" ON "shipping_zones"("tenantId", "sortOrder");

-- CreateIndex
CREATE INDEX "shipping_rates_tenantId_idx" ON "shipping_rates"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_rates_zoneId_maxWeightGrams_key" ON "shipping_rates"("zoneId", "maxWeightGrams");

-- CreateIndex
CREATE UNIQUE INDEX "content_pages_tenantId_slug_key" ON "content_pages"("tenantId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "content_pages_tenantId_systemKey_key" ON "content_pages"("tenantId", "systemKey");

-- CreateIndex
CREATE UNIQUE INDEX "content_pages_tenantId_legacyId_key" ON "content_pages"("tenantId", "legacyId");

-- CreateIndex
CREATE INDEX "content_blocks_pageId_sortOrder_idx" ON "content_blocks"("pageId", "sortOrder");

-- CreateIndex
CREATE INDEX "content_blocks_tenantId_idx" ON "content_blocks"("tenantId");

-- CreateIndex
CREATE INDEX "menu_items_tenantId_location_parentId_sortOrder_idx" ON "menu_items"("tenantId", "location", "parentId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_subscribers_confirmTokenHash_key" ON "newsletter_subscribers"("confirmTokenHash");

-- CreateIndex
CREATE INDEX "newsletter_subscribers_tenantId_confirmedAt_unsubscribedAt_idx" ON "newsletter_subscribers"("tenantId", "confirmedAt", "unsubscribedAt");

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_subscribers_tenantId_email_key" ON "newsletter_subscribers"("tenantId", "email");

-- CreateIndex
CREATE INDEX "newsletter_campaigns_tenantId_status_createdAt_idx" ON "newsletter_campaigns"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "page_views_tenantId_createdAt_idx" ON "page_views"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "page_views_tenantId_path_createdAt_idx" ON "page_views"("tenantId", "path", "createdAt");

-- CreateIndex
CREATE INDEX "page_views_tenantId_visitorHash_createdAt_idx" ON "page_views"("tenantId", "visitorHash", "createdAt");

-- AddForeignKey
ALTER TABLE "tenant_sequences" ADD CONSTRAINT "tenant_sequences_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_purchaseRecordId_fkey" FOREIGN KEY ("purchaseRecordId") REFERENCES "purchase_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_tags" ADD CONSTRAINT "product_tags_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_tags" ADD CONSTRAINT "product_tags_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_tags" ADD CONSTRAINT "product_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_relations" ADD CONSTRAINT "product_relations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_relations" ADD CONSTRAINT "product_relations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_relations" ADD CONSTRAINT "product_relations_relatedProductId_fkey" FOREIGN KEY ("relatedProductId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_records" ADD CONSTRAINT "purchase_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_records" ADD CONSTRAINT "purchase_records_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "carts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_shippingZoneId_fkey" FOREIGN KEY ("shippingZoneId") REFERENCES "shipping_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_addresses" ADD CONSTRAINT "order_addresses_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_addresses" ADD CONSTRAINT "order_addresses_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_zones" ADD CONSTRAINT "shipping_zones_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "shipping_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_pages" ADD CONSTRAINT "content_pages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_blocks" ADD CONSTRAINT "content_blocks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_blocks" ADD CONSTRAINT "content_blocks_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "content_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "content_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "newsletter_subscribers" ADD CONSTRAINT "newsletter_subscribers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "newsletter_subscribers" ADD CONSTRAINT "newsletter_subscribers_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "newsletter_campaigns" ADD CONSTRAINT "newsletter_campaigns_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "newsletter_campaigns" ADD CONSTRAINT "newsletter_campaigns_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_views" ADD CONSTRAINT "page_views_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Hand-written constraints (not expressible in Prisma schema) ───────────

-- At most one ACTIVE reservation per product (unique items; decision 18).
-- Reserve flow: in one transaction, flip expired ACTIVE rows to EXPIRED, then INSERT;
-- a unique violation (P2002) means "someone else holds it".
CREATE UNIQUE INDEX "reservations_active_product_key"
  ON "reservations"("productId") WHERE "status" = 'ACTIVE';

ALTER TABLE "reservations" ADD CONSTRAINT "reservations_quantity_check" CHECK ("quantity" > 0);

-- Catalog sanity
ALTER TABLE "products" ADD CONSTRAINT "products_amounts_check"
  CHECK ("price" >= 0 AND ("purchasePrice" IS NULL OR "purchasePrice" >= 0)
         AND "weightGrams" >= 0 AND "quantity" >= 0 AND "stockCode" > 0);

-- Ledger: only RESERVE/RELEASE audit rows may have delta 0.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_delta_check"
  CHECK ("delta" <> 0 OR "reason" IN ('RESERVE', 'RELEASE'));
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_quantity_after_check"
  CHECK ("quantityAfter" >= 0);

ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_quantity_check" CHECK ("quantity" > 0);

-- Orders / payments: non-negative money; order number positive.
ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts_check"
  CHECK ("number" > 0 AND "subtotal" >= 0 AND "shippingTotal" >= 0
         AND "surchargeTotal" >= 0 AND "total" >= 0);
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_amounts_check"
  CHECK ("quantity" > 0 AND "unitPrice" >= 0 AND "lineTotal" >= 0
         AND ("purchasePriceSnapshot" IS NULL OR "purchasePriceSnapshot" >= 0));
ALTER TABLE "payments" ADD CONSTRAINT "payments_amounts_check"
  CHECK ("amount" >= 0 AND "amountRefunded" >= 0 AND "amountRefunded" <= "amount");
ALTER TABLE "payments" ADD CONSTRAINT "payments_provider_id_check"
  CHECK ("provider" = 'MANUAL' OR "providerPaymentId" IS NOT NULL);

-- Shipping tiers
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_amounts_check"
  CHECK ("maxWeightGrams" > 0 AND "price" >= 0
         AND ("insurancePrice" IS NULL OR "insurancePrice" >= 0)
         AND ("maxInsuredValue" IS NULL OR "maxInsuredValue" >= 0));

-- ISO 3166-1 alpha-2, upper-case
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_country_code_check"
  CHECK ("countryCode" ~ '^[A-Z]{2}$');
ALTER TABLE "order_addresses" ADD CONSTRAINT "order_addresses_country_code_check"
  CHECK ("countryCode" ~ '^[A-Z]{2}$');

-- Upper-case 3-letter currency codes
ALTER TABLE "orders" ADD CONSTRAINT "orders_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "payments" ADD CONSTRAINT "payments_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');

-- Full-text search (later): generated tsvector on products(title, description, sku)
-- + GIN index, and pg_trgm GIN on products.title. Added in a separate migration.
