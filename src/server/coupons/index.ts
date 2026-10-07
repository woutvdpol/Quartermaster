import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ServiceError, type ServiceContext } from "@/server/context";
import { isUniqueViolation, parseInput } from "@/server/catalog/errors";
import { Prisma } from "@/generated/prisma/client";
import { COUPON_CODE_PATTERN, evaluateCouponRule, normalizeCouponCode, type CouponOutcome, type CouponRule, type CouponUsage } from "./evaluate";

export * from "./evaluate";

/*
 * Coupons (phase 5). Admin CRUD + evaluation for cart/checkout.
 *
 * Usage counting (maxRedemptions / perEmailLimit): one CouponRedemption per order, written by
 * placeOrder in the order's transaction while the coupon row is locked (FOR UPDATE), so concurrent
 * checkouts can never exceed maxRedemptions. A redemption stops counting when its order is dead:
 * canceled by the shop, or unpaid (FAILED/CANCELED/EXPIRED at Mollie) and older than the 72 h retry
 * window (until then the customer can still pay it, so the slot stays taken).
 */

type Tx = Prisma.TransactionClient;
type Client = Tx | typeof db;

const idSchema = z.string().trim().min(1).max(64);

/** Must match RETRY_WINDOW_MS in checkout/payment.ts (an unpaid order can be retried this long). */
const DEAD_ORDER_AFTER_HOURS = 72;

function deadOrderSql(alias: string) {
  const o = Prisma.raw(alias);
  return Prisma.sql`(${o}."canceledAt" IS NOT NULL OR (${o}."paymentStatus" IN ('FAILED', 'CANCELED', 'EXPIRED')
    AND ${o}."placedAt" < (now() - make_interval(hours => ${DEAD_ORDER_AFTER_HOURS}::int)) AT TIME ZONE 'UTC'))`;
}

/** Redemptions that count for a coupon (total, and for `email` when given). */
export async function countCouponUsage(client: Client, couponId: string, email: string | null): Promise<CouponUsage> {
  const [row] = await client.$queryRaw<{ total: number; by_email: number }[]>`
    SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE r.email = ${email ?? ""})::int AS by_email
    FROM coupon_redemptions r
    LEFT JOIN orders o ON o.id = r."orderId"
    WHERE r."couponId" = ${couponId} AND (o.id IS NULL OR NOT ${deadOrderSql("o")})`;
  return { total: row?.total ?? 0, byEmail: email ? (row?.by_email ?? 0) : null };
}

const ruleSelect = {
  id: true,
  code: true,
  type: true,
  value: true,
  minSubtotal: true,
  startsAt: true,
  endsAt: true,
  maxRedemptions: true,
  perEmailLimit: true,
  isActive: true,
} as const;

export async function findCouponByCode(client: Client, tenantId: string, code: string) {
  const normalized = normalizeCouponCode(code);
  if (!COUPON_CODE_PATTERN.test(normalized)) return null;
  return client.coupon.findUnique({ where: { tenantId_code: { tenantId, code: normalized } }, select: ruleSelect });
}

export type EvaluateInput = {
  /** Subtotal the coupon applies to (lines at an agreed offer price excluded). */
  subtotal: number;
  /** Price of the chosen shipping option (0 when unknown). */
  shippingPrice: number;
  /** Customer email; null skips the per-email check (checked again at placement). */
  email: string | null;
};

/** Read-only evaluation (cart, quote). placeOrder re-evaluates under a row lock (evaluateCouponForOrderTx). */
export async function evaluateCoupon(tenantId: string, code: string, input: EvaluateInput, formatMoney?: (n: number) => string): Promise<CouponOutcome> {
  const coupon = await findCouponByCode(db, tenantId, code);
  const usage = coupon ? await countCouponUsage(db, coupon.id, input.email?.toLowerCase() ?? null) : { total: 0, byEmail: null };
  return evaluateCouponRule(coupon as CouponRule | null, { code, eligibleSubtotal: input.subtotal, shippingPrice: input.shippingPrice, usage }, formatMoney);
}

/**
 * Inside the placeOrder transaction: locks the coupon row (serialises concurrent redemptions of the
 * same code), recounts usage and evaluates. Returns the coupon id with the outcome.
 */
export async function evaluateCouponForOrderTx(
  tx: Tx,
  tenantId: string,
  code: string,
  input: EvaluateInput & { email: string },
  formatMoney?: (n: number) => string,
): Promise<{ couponId: string | null; outcome: CouponOutcome }> {
  const normalized = normalizeCouponCode(code);
  const locked = COUPON_CODE_PATTERN.test(normalized)
    ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM coupons WHERE "tenantId" = ${tenantId} AND code = ${normalized} FOR UPDATE`
    : [];
  const coupon = locked.length ? await tx.coupon.findUniqueOrThrow({ where: { id: locked[0].id }, select: ruleSelect }) : null;
  const usage = coupon ? await countCouponUsage(tx, coupon.id, input.email.toLowerCase()) : { total: 0, byEmail: null };
  const outcome = evaluateCouponRule(coupon as CouponRule | null, { code, eligibleSubtotal: input.subtotal, shippingPrice: input.shippingPrice, usage }, formatMoney);
  return { couponId: coupon?.id ?? null, outcome };
}

// ─── Admin ──────────────────────────────────────────────────────────────────

const optionalDate = z.preprocess((v) => (v === "" || v === undefined ? null : v), z.coerce.date().nullable());
const optionalPositiveInt = z.preprocess((v) => (v === "" || v === undefined ? null : v), z.coerce.number().int().min(1).max(1_000_000).nullable());

export const couponInputSchema = z
  .object({
    code: z
      .string()
      .trim()
      .transform((c) => c.toUpperCase())
      .pipe(z.string().regex(COUPON_CODE_PATTERN, "Use 2–40 letters, digits, - or _ (start with a letter or digit)")),
    description: z
      .string()
      .trim()
      .max(200)
      .nullish()
      .transform((v) => v || null),
    type: z.enum(["PERCENT", "FIXED", "FREE_SHIPPING"]),
    /** PERCENT: basis points (1000 = 10 %); FIXED: minor units; FREE_SHIPPING: ignored (0). */
    value: z.coerce.number().int().min(0).max(100_000_00).default(0),
    minSubtotal: z.coerce.number().int().min(0).max(100_000_00).default(0),
    startsAt: optionalDate.default(null),
    endsAt: optionalDate.default(null),
    maxRedemptions: optionalPositiveInt.default(null),
    perEmailLimit: optionalPositiveInt.default(1),
    isActive: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.type === "PERCENT" && (v.value < 1 || v.value > 10000)) ctx.addIssue({ code: "custom", path: ["value"], message: "Enter a percentage between 0.01 and 100" });
    if (v.type === "FIXED" && v.value < 1) ctx.addIssue({ code: "custom", path: ["value"], message: "Enter an amount above 0" });
    if (v.startsAt && v.endsAt && v.endsAt.getTime() <= v.startsAt.getTime()) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "The end must be after the start" });
  })
  .transform((v) => ({ ...v, value: v.type === "FREE_SHIPPING" ? 0 : v.value }));
export type CouponInput = z.input<typeof couponInputSchema>;

const listSchema = z.object({
  view: z.enum(["all", "active", "scheduled", "ended", "inactive"]).default("all"),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export type CouponRow = {
  id: string;
  code: string;
  description: string | null;
  type: "PERCENT" | "FIXED" | "FREE_SHIPPING";
  value: number;
  minSubtotal: number;
  startsAt: Date | null;
  endsAt: Date | null;
  maxRedemptions: number | null;
  perEmailLimit: number | null;
  isActive: boolean;
  createdAt: Date;
  /** Redemptions that count (see module comment). */
  used: number;
  /** All redemptions incl. dead orders. */
  redemptions: number;
  /** Σ discount granted on counting redemptions. */
  discountGiven: number;
};

function viewWhere(view: z.output<typeof listSchema>["view"]) {
  switch (view) {
    case "active":
      return Prisma.sql`AND c."isActive" AND (c."startsAt" IS NULL OR c."startsAt" <= now() AT TIME ZONE 'UTC') AND (c."endsAt" IS NULL OR c."endsAt" > now() AT TIME ZONE 'UTC')`;
    case "scheduled":
      return Prisma.sql`AND c."isActive" AND c."startsAt" > now() AT TIME ZONE 'UTC'`;
    case "ended":
      return Prisma.sql`AND c."endsAt" <= now() AT TIME ZONE 'UTC'`;
    case "inactive":
      return Prisma.sql`AND NOT c."isActive"`;
    default:
      return Prisma.empty;
  }
}

export async function listCoupons(ctx: ServiceContext, query: z.input<typeof listSchema> = {}) {
  const q = listSchema.parse(query);
  const term = q.q ? `%${q.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
  const search = term ? Prisma.sql`AND (c.code ILIKE ${term} OR c.description ILIKE ${term})` : Prisma.empty;
  const rows = await db.$queryRaw<(Omit<CouponRow, "discountGiven"> & { discountGiven: bigint; total: number })[]>`
    SELECT c.id, c.code, c.description, c.type::text AS type, c.value, c."minSubtotal", c."startsAt", c."endsAt",
      c."maxRedemptions", c."perEmailLimit", c."isActive", c."createdAt",
      COALESCE(u.used, 0)::int AS used, COALESCE(u.redemptions, 0)::int AS redemptions,
      COALESCE(u.given, 0)::bigint AS "discountGiven",
      COUNT(*) OVER ()::int AS total
    FROM coupons c
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS redemptions,
             COUNT(*) FILTER (WHERE o.id IS NULL OR NOT ${deadOrderSql("o")}) AS used,
             SUM(r.amount) FILTER (WHERE o.id IS NULL OR NOT ${deadOrderSql("o")}) AS given
      FROM coupon_redemptions r LEFT JOIN orders o ON o.id = r."orderId"
      WHERE r."couponId" = c.id
    ) u ON true
    WHERE c."tenantId" = ${ctx.tenantId} ${viewWhere(q.view)} ${search}
    ORDER BY c."createdAt" DESC, c.id
    LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`;

  const [counts] = await db.$queryRaw<{ all: number; active: number; scheduled: number; ended: number; inactive: number }[]>`
    SELECT COUNT(*)::int AS all,
      COUNT(*) FILTER (WHERE c."isActive" AND (c."startsAt" IS NULL OR c."startsAt" <= now() AT TIME ZONE 'UTC') AND (c."endsAt" IS NULL OR c."endsAt" > now() AT TIME ZONE 'UTC'))::int AS active,
      COUNT(*) FILTER (WHERE c."isActive" AND c."startsAt" > now() AT TIME ZONE 'UTC')::int AS scheduled,
      COUNT(*) FILTER (WHERE c."endsAt" <= now() AT TIME ZONE 'UTC')::int AS ended,
      COUNT(*) FILTER (WHERE NOT c."isActive")::int AS inactive
    FROM coupons c WHERE c."tenantId" = ${ctx.tenantId}`;

  return {
    rows: rows.map((r): CouponRow => ({ ...r, discountGiven: Number(r.discountGiven) })),
    total: rows[0]?.total ?? 0,
    page: q.page,
    pageSize: q.pageSize,
    counts,
  };
}

export async function getCoupon(ctx: ServiceContext, id: string) {
  const coupon = await db.coupon.findFirst({ where: { id: idSchema.parse(id), tenantId: ctx.tenantId } });
  if (!coupon) throw new ServiceError("NOT_FOUND", "Coupon not found");
  const usage = await countCouponUsage(db, coupon.id, null);
  const redemptions = await db.couponRedemption.count({ where: { couponId: coupon.id } });
  return { ...coupon, used: usage.total, redemptions };
}

export async function createCoupon(ctx: ServiceContext, input: CouponInput) {
  const data = parseInput(couponInputSchema, input);
  try {
    const coupon = await db.coupon.create({ data: { tenantId: ctx.tenantId, ...data } });
    await audit({ action: "coupon.create", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "coupon", entityId: coupon.id, data: { code: coupon.code, type: coupon.type, value: coupon.value } });
    return coupon;
  } catch (err) {
    if (isUniqueViolation(err)) throw new ServiceError("INVALID", "code: A coupon with this code already exists", [{ path: "code", message: "A coupon with this code already exists" }]);
    throw err;
  }
}

/** Updates a coupon. The code (and type) can only change while nothing was redeemed yet. */
export async function updateCoupon(ctx: ServiceContext, id: string, input: CouponInput) {
  const data = parseInput(couponInputSchema, input);
  const existing = await db.coupon.findFirst({ where: { id: idSchema.parse(id), tenantId: ctx.tenantId }, include: { _count: { select: { redemptions: true } } } });
  if (!existing) throw new ServiceError("NOT_FOUND", "Coupon not found");
  if (existing._count.redemptions > 0 && (data.code !== existing.code || data.type !== existing.type)) {
    const path = data.code !== existing.code ? "code" : "type";
    throw new ServiceError("INVALID", `${path}: This coupon has been used; create a new coupon instead`, [{ path, message: "This coupon has been used; create a new coupon instead" }]);
  }
  try {
    const coupon = await db.coupon.update({ where: { id: existing.id }, data });
    await audit({ action: "coupon.update", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "coupon", entityId: coupon.id, data: { code: coupon.code } });
    return coupon;
  } catch (err) {
    if (isUniqueViolation(err)) throw new ServiceError("INVALID", "code: A coupon with this code already exists", [{ path: "code", message: "A coupon with this code already exists" }]);
    throw err;
  }
}

/** Activates / deactivates a coupon (coupons with redemptions are never deleted). */
export async function setCouponActive(ctx: ServiceContext, id: string, isActive: boolean) {
  const res = await db.coupon.updateMany({ where: { id: idSchema.parse(id), tenantId: ctx.tenantId }, data: { isActive } });
  if (res.count === 0) throw new ServiceError("NOT_FOUND", "Coupon not found");
  await audit({ action: isActive ? "coupon.activate" : "coupon.deactivate", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "coupon", entityId: id });
}

/** Deletes a coupon that was never redeemed. */
export async function deleteCoupon(ctx: ServiceContext, id: string) {
  const coupon = await db.coupon.findFirst({ where: { id: idSchema.parse(id), tenantId: ctx.tenantId }, include: { _count: { select: { redemptions: true } } } });
  if (!coupon) throw new ServiceError("NOT_FOUND", "Coupon not found");
  if (coupon._count.redemptions > 0) throw new ServiceError("CONFLICT", "This coupon has been used — deactivate it instead");
  await db.coupon.delete({ where: { id: coupon.id } });
  await audit({ action: "coupon.delete", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "coupon", entityId: coupon.id, data: { code: coupon.code } });
}

const redemptionsSchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) });

export type RedemptionRow = {
  id: string;
  email: string;
  amount: number;
  createdAt: Date;
  order: { id: string; number: number; paymentStatus: string; total: number; currency: string } | null;
  counts: boolean;
};

export async function listRedemptions(ctx: ServiceContext, couponId: string, query: z.input<typeof redemptionsSchema> = {}) {
  const q = redemptionsSchema.parse(query);
  const coupon = await db.coupon.findFirst({ where: { id: idSchema.parse(couponId), tenantId: ctx.tenantId }, select: { id: true } });
  if (!coupon) throw new ServiceError("NOT_FOUND", "Coupon not found");
  const rows = await db.$queryRaw<
    { id: string; email: string; amount: number; createdAt: Date; order_id: string | null; number: number | null; payment_status: string | null; total: number | null; currency: string | null; counts: boolean; full_count: number }[]
  >`
    SELECT r.id, r.email, r.amount, r."createdAt", o.id AS order_id, o.number, o."paymentStatus"::text AS payment_status, o.total, o.currency,
      (o.id IS NULL OR NOT ${deadOrderSql("o")}) AS counts, COUNT(*) OVER ()::int AS full_count
    FROM coupon_redemptions r LEFT JOIN orders o ON o.id = r."orderId" AND o."tenantId" = ${ctx.tenantId}
    WHERE r."couponId" = ${coupon.id} AND r."tenantId" = ${ctx.tenantId}
    ORDER BY r."createdAt" DESC, r.id
    LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`;
  return {
    total: rows[0]?.full_count ?? 0,
    page: q.page,
    pageSize: q.pageSize,
    rows: rows.map(
      (r): RedemptionRow => ({
        id: r.id,
        email: r.email,
        amount: r.amount,
        createdAt: r.createdAt,
        counts: r.counts,
        order: r.order_id ? { id: r.order_id, number: r.number!, paymentStatus: r.payment_status!, total: r.total!, currency: r.currency! } : null,
      }),
    ),
  };
}
