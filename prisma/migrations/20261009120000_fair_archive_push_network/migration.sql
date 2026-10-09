-- CreateEnum
CREATE TYPE "OrderChannel" AS ENUM ('WEB', 'FAIR', 'MANUAL');

-- CreateEnum
CREATE TYPE "FairStatus" AS ENUM ('PREPARING', 'LIVE', 'ENDED');

-- AlterEnum
ALTER TYPE "AlertKind" ADD VALUE 'RESERVATION_ENDING';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "networkJoinedAt" TIMESTAMP(3),
ADD COLUMN     "networkOptIn" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "archiveHidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fairHoldId" TEXT,
ADD COLUMN     "showSoldPrice" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "pushMaxPerDay" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "pushQuietEnd" INTEGER,
ADD COLUMN     "pushQuietStart" INTEGER,
ADD COLUMN     "pushReservation" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "pushWishlist" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "channel" "OrderChannel" NOT NULL DEFAULT 'WEB',
ADD COLUMN     "clientRef" TEXT,
ADD COLUMN     "fairId" TEXT;

-- AlterTable
ALTER TABLE "saved_searches" ADD COLUMN     "push" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "fairs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "status" "FairStatus" NOT NULL DEFAULT 'PREPARING',
    "hideFromShop" BOOLEAN NOT NULL DEFAULT true,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fairs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fair_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fairId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "floorPrice" INTEGER,
    "soldPrice" INTEGER,
    "soldAt" TIMESTAMP(3),
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fair_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_messages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "kind" "AlertKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "queuedFor" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fairs_tenantId_status_idx" ON "fairs"("tenantId", "status");

-- CreateIndex
CREATE INDEX "fairs_tenantId_startsOn_idx" ON "fairs"("tenantId", "startsOn" DESC);

-- CreateIndex
CREATE INDEX "fair_items_productId_idx" ON "fair_items"("productId");

-- CreateIndex
CREATE INDEX "fair_items_tenantId_idx" ON "fair_items"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "fair_items_fairId_productId_key" ON "fair_items"("fairId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_customerId_idx" ON "push_subscriptions"("customerId");

-- CreateIndex
CREATE INDEX "push_subscriptions_tenantId_idx" ON "push_subscriptions"("tenantId");

-- CreateIndex
CREATE INDEX "push_messages_tenantId_sentAt_idx" ON "push_messages"("tenantId", "sentAt");

-- CreateIndex
CREATE INDEX "push_messages_customerId_createdAt_idx" ON "push_messages"("customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "push_messages_customerId_dedupeKey_key" ON "push_messages"("customerId", "dedupeKey");

-- CreateIndex
CREATE INDEX "products_fairHoldId_idx" ON "products"("fairHoldId");

-- CreateIndex
CREATE INDEX "orders_fairId_idx" ON "orders"("fairId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tenantId_clientRef_key" ON "orders"("tenantId", "clientRef");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_fairHoldId_fkey" FOREIGN KEY ("fairHoldId") REFERENCES "fairs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_fairId_fkey" FOREIGN KEY ("fairId") REFERENCES "fairs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fairs" ADD CONSTRAINT "fairs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fair_items" ADD CONSTRAINT "fair_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fair_items" ADD CONSTRAINT "fair_items_fairId_fkey" FOREIGN KEY ("fairId") REFERENCES "fairs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fair_items" ADD CONSTRAINT "fair_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fair_items" ADD CONSTRAINT "fair_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_messages" ADD CONSTRAINT "push_messages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_messages" ADD CONSTRAINT "push_messages_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

