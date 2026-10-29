-- First-sign-in admin tour (docs/admin-tour.md)
ALTER TABLE "users" ADD COLUMN "adminTourSeenAt" TIMESTAMP(3);

-- Owners who already signed in before this release are not on their first sign-in.
UPDATE "users" SET "adminTourSeenAt" = CURRENT_TIMESTAMP WHERE "role" = 'OWNER' AND "lastLoginAt" IS NOT NULL;
