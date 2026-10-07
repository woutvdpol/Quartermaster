-- CreateEnum
CREATE TYPE "RedirectSource" AS ENUM ('LEGACY', 'MANUAL');

-- CreateTable
CREATE TABLE "redirects" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fromPath" TEXT NOT NULL,
    "toPath" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL DEFAULT 301,
    "source" "RedirectSource" NOT NULL DEFAULT 'MANUAL',
    "hits" INTEGER NOT NULL DEFAULT 0,
    "lastHitAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "redirects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "redirects_tenantId_fromPath_key" ON "redirects"("tenantId", "fromPath");

-- AddForeignKey
ALTER TABLE "redirects" ADD CONSTRAINT "redirects_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
