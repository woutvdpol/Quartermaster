-- CreateEnum
CREATE TYPE "DealerApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ImportSource" AS ENUM ('WOOCOMMERCE', 'SHOPIFY');

-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('UPLOADED', 'RUNNING', 'IMAGES', 'DONE', 'FAILED', 'CANCELED');

-- AlterEnum
ALTER TYPE "AuthTokenType" ADD VALUE 'INVITE';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "setupCompletedAt" TIMESTAMP(3),
ADD COLUMN     "setupState" JSONB;

-- CreateTable
CREATE TABLE "dealer_applications" (
    "id" TEXT NOT NULL,
    "status" "DealerApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "applicantName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "shopName" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL,
    "cocNumber" TEXT,
    "currentPlatform" TEXT,
    "description" TEXT NOT NULL,
    "legalConsent" BOOLEAN NOT NULL DEFAULT false,
    "emailVerifiedAt" TIMESTAMP(3),
    "checks" JSONB,
    "internalNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "tenantId" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dealer_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "source" "ImportSource" NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'UPLOADED',
    "fileName" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "summary" JSONB,
    "createdById" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dealer_applications_tenantId_key" ON "dealer_applications"("tenantId");

-- CreateIndex
CREATE INDEX "dealer_applications_status_createdAt_idx" ON "dealer_applications"("status", "createdAt");

-- CreateIndex
CREATE INDEX "dealer_applications_email_idx" ON "dealer_applications"("email");

-- CreateIndex
CREATE INDEX "import_jobs_tenantId_createdAt_idx" ON "import_jobs"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "dealer_applications" ADD CONSTRAINT "dealer_applications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
