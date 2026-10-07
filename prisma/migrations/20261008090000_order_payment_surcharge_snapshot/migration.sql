-- Payment-method surcharge snapshot on orders (owner request "PayPal toeslag").
-- Order.surchargeTotal already existed; these keep the customer-facing label and the rule used at checkout.
ALTER TABLE "orders" ADD COLUMN "surchargeLabel" TEXT;
ALTER TABLE "orders" ADD COLUMN "surchargeDetail" JSONB;
