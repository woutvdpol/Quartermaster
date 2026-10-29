-- Sign-up modes: apply / waitlist / free trial (docs/signup-modes.md)

-- AlterEnum
ALTER TYPE "DealerApplicationStatus" ADD VALUE 'WAITLISTED';

-- CreateEnum
CREATE TYPE "SignupMode" AS ENUM ('APPLY', 'WAITLIST', 'TRIAL');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "trialEndsAt" TIMESTAMP(3),
ADD COLUMN "trialNotices" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "dealer_applications" ADD COLUMN "signupMode" "SignupMode" NOT NULL DEFAULT 'APPLY';

-- CreateTable
CREATE TABLE "platform_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "signupMode" "SignupMode" NOT NULL DEFAULT 'APPLY',
    "trialDays" INTEGER NOT NULL DEFAULT 30,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_config_pkey" PRIMARY KEY ("id")
);
