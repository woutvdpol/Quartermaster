-- CreateEnum
CREATE TYPE "TranslationEntity" AS ENUM ('PRODUCT', 'CATEGORY', 'FACET', 'FACET_VALUE', 'CONTENT_PAGE', 'MENU_ITEM');

-- CreateEnum
CREATE TYPE "TranslationStatus" AS ENUM ('QUEUED', 'MACHINE', 'APPROVED');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "previousProductId" TEXT;

-- CreateTable
CREATE TABLE "translations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entity" "TranslationEntity" NOT NULL,
    "entityId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "value" TEXT,
    "status" "TranslationStatus" NOT NULL DEFAULT 'QUEUED',
    "sourceHash" TEXT NOT NULL,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "translation_terms" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "target" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "translation_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_query_stats" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "query" TEXT NOT NULL,
    "searches" INTEGER NOT NULL DEFAULT 0,
    "zeroResults" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "search_query_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "translations_tenantId_locale_status_idx" ON "translations"("tenantId", "locale", "status");

-- CreateIndex
CREATE INDEX "translations_tenantId_entity_entityId_idx" ON "translations"("tenantId", "entity", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "translations_tenantId_entity_entityId_field_locale_key" ON "translations"("tenantId", "entity", "entityId", "field", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "translation_terms_tenantId_locale_source_key" ON "translation_terms"("tenantId", "locale", "source");

-- CreateIndex
CREATE INDEX "search_query_stats_tenantId_day_idx" ON "search_query_stats"("tenantId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "search_query_stats_tenantId_day_query_key" ON "search_query_stats"("tenantId", "day", "query");

-- CreateIndex
CREATE INDEX "products_previousProductId_idx" ON "products"("previousProductId");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_previousProductId_fkey" FOREIGN KEY ("previousProductId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translations" ADD CONSTRAINT "translations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translation_terms" ADD CONSTRAINT "translation_terms_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_query_stats" ADD CONSTRAINT "search_query_stats_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

