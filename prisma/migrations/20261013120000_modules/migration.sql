-- CreateEnum
CREATE TYPE "PlanId" AS ENUM ('START', 'PRO', 'COMPLETE');

-- CreateEnum
CREATE TYPE "EntitlementSource" AS ENUM ('MANUAL', 'SUBSCRIPTION', 'LEGACY');

-- CreateEnum
CREATE TYPE "ModuleStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED');

-- CreateTable
CREATE TABLE "tenant_plans" (
    "tenantId" TEXT NOT NULL,
    "plan" "PlanId" NOT NULL DEFAULT 'START',
    "productLimit" INTEGER,
    "photoLimit" INTEGER,
    "storageGb" DOUBLE PRECISION,
    "newsletterQuota" INTEGER,
    "newsletterCredits" INTEGER NOT NULL DEFAULT 0,
    "source" "EntitlementSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_plans_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "tenant_modules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "status" "ModuleStatus" NOT NULL,
    "source" "EntitlementSource" NOT NULL DEFAULT 'MANUAL',
    "trialEndsAt" TIMESTAMP(3),
    "periodEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_modules_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "newsletter_campaigns" ADD COLUMN "creditsUsed" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "tenant_modules_tenantId_moduleId_key" ON "tenant_modules"("tenantId", "moduleId");

-- AddForeignKey
ALTER TABLE "tenant_plans" ADD CONSTRAINT "tenant_plans_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_modules" ADD CONSTRAINT "tenant_modules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Data: every existing shop keeps everything it had. Before this migration nothing was gated except the
-- newsletter, so all existing shops get COMPLETE (source LEGACY). Limits a superadmin set explicitly in the
-- old `platform` settings group (anything other than that group's defaults) carry over as overrides.
-- New shops get a START row from the application code; no row also resolves to START (fail closed).
INSERT INTO "tenant_plans" ("tenantId", "plan", "productLimit", "photoLimit", "storageGb", "newsletterQuota", "source", "updatedAt")
SELECT
  t."id",
  'COMPLETE',
  NULLIF(s."data"->>'productLimit', '')::int,
  NULLIF(s."data"->>'photoLimit', '')::int,
  CASE WHEN (s."data"->>'storageQuotaGb')::numeric IS DISTINCT FROM 5 THEN (s."data"->>'storageQuotaGb')::double precision END,
  CASE WHEN (s."data"->>'newsletterQuota')::int IS DISTINCT FROM 1000 THEN (s."data"->>'newsletterQuota')::int END,
  'LEGACY',
  CURRENT_TIMESTAMP
FROM "tenants" t
LEFT JOIN "settings" s ON s."tenantId" = t."id" AND s."group" = 'platform';
