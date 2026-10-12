-- CreateEnum
CREATE TYPE "AuctionType" AS ENUM ('DAY', 'SINGLE');

-- CreateEnum
CREATE TYPE "AuctionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'LIVE', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AuctionLotStatus" AS ENUM ('OPEN', 'SOLD', 'UNSOLD', 'CANCELLED');

-- AlterEnum
ALTER TYPE "OrderChannel" ADD VALUE 'AUCTION';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AlertKind" ADD VALUE 'AUCTION_OUTBID';
ALTER TYPE "AlertKind" ADD VALUE 'AUCTION_ENDING';
ALTER TYPE "AlertKind" ADD VALUE 'AUCTION_WON';

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "auctionHoldId" TEXT;

-- CreateTable
CREATE TABLE "auctions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "AuctionType" NOT NULL DEFAULT 'DAY',
    "status" "AuctionStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "opensAt" TIMESTAMP(3) NOT NULL,
    "firstCloseAt" TIMESTAMP(3) NOT NULL,
    "gapSeconds" INTEGER NOT NULL DEFAULT 60,
    "extendSeconds" INTEGER NOT NULL DEFAULT 120,
    "payDays" INTEGER NOT NULL DEFAULT 5,
    "incrementTable" JSONB,
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auctions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auction_lots" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lotNumber" INTEGER NOT NULL,
    "startPrice" INTEGER NOT NULL,
    "reservePrice" INTEGER,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "extended" BOOLEAN NOT NULL DEFAULT false,
    "currentBid" INTEGER,
    "leadingBidderId" TEXT,
    "leadingMax" INTEGER,
    "bidCount" INTEGER NOT NULL DEFAULT 0,
    "status" "AuctionLotStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auction_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bids" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "maxAmount" INTEGER NOT NULL,
    "isAuto" BOOLEAN NOT NULL DEFAULT false,
    "requestId" TEXT,
    "ipHash" TEXT,
    "deviceHash" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auction_bidders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "termsAcceptedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auction_bidders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocked_bidders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "reason" TEXT,
    "blockedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocked_bidders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auctions_tenantId_status_firstCloseAt_idx" ON "auctions"("tenantId", "status", "firstCloseAt");

-- CreateIndex
CREATE UNIQUE INDEX "auctions_tenantId_slug_key" ON "auctions"("tenantId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "auction_lots_orderId_key" ON "auction_lots"("orderId");

-- CreateIndex
CREATE INDEX "auction_lots_tenantId_status_closesAt_idx" ON "auction_lots"("tenantId", "status", "closesAt");

-- CreateIndex
CREATE INDEX "auction_lots_productId_idx" ON "auction_lots"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "auction_lots_auctionId_lotNumber_key" ON "auction_lots"("auctionId", "lotNumber");

-- CreateIndex
CREATE UNIQUE INDEX "auction_lots_auctionId_productId_key" ON "auction_lots"("auctionId", "productId");

-- CreateIndex
CREATE INDEX "bids_lotId_createdAt_idx" ON "bids"("lotId", "createdAt");

-- CreateIndex
CREATE INDEX "bids_customerId_idx" ON "bids"("customerId");

-- CreateIndex
CREATE INDEX "bids_tenantId_deviceHash_idx" ON "bids"("tenantId", "deviceHash");

-- CreateIndex
CREATE UNIQUE INDEX "bids_lotId_requestId_key" ON "bids"("lotId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "auction_bidders_auctionId_customerId_key" ON "auction_bidders"("auctionId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "auction_bidders_auctionId_number_key" ON "auction_bidders"("auctionId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "blocked_bidders_customerId_key" ON "blocked_bidders"("customerId");

-- CreateIndex
CREATE INDEX "blocked_bidders_tenantId_idx" ON "blocked_bidders"("tenantId");

-- CreateIndex
CREATE INDEX "products_auctionHoldId_idx" ON "products"("auctionHoldId");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_auctionHoldId_fkey" FOREIGN KEY ("auctionHoldId") REFERENCES "auctions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_lots" ADD CONSTRAINT "auction_lots_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_lots" ADD CONSTRAINT "auction_lots_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "auctions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_lots" ADD CONSTRAINT "auction_lots_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_lots" ADD CONSTRAINT "auction_lots_leadingBidderId_fkey" FOREIGN KEY ("leadingBidderId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_lots" ADD CONSTRAINT "auction_lots_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "auction_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_bidders" ADD CONSTRAINT "auction_bidders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_bidders" ADD CONSTRAINT "auction_bidders_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "auctions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_bidders" ADD CONSTRAINT "auction_bidders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocked_bidders" ADD CONSTRAINT "blocked_bidders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocked_bidders" ADD CONSTRAINT "blocked_bidders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

