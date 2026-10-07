import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ServiceError, type ServiceContext } from "@/server/context";
import { getSettings } from "@/server/settings";
import { encrypt } from "@/server/auth/encryption";
import { generateToken, hashToken } from "@/server/auth/tokens";
import { hit, isLimited } from "@/server/auth/rate-limit";
import { activeReservation } from "@/server/stock/reservations";
import { imageUrl } from "@/server/media/product-images";
import { queueMail } from "@/server/mail/queue";
import { parseInput } from "@/server/catalog/errors";
import { addToCart, type AddToCartResult, type ShopViewer } from "@/server/cart";
import { Prisma } from "@/generated/prisma/client";
import type { OfferStatus } from "@/generated/prisma/enums";
import {
  OFFER_CHECKOUT_TTL_HOURS,
  OFFER_COUNTER_TTL_HOURS,
  OFFER_PENDING_TTL_HOURS,
  minimumOffer,
  offerPriceApplies,
  offersAllowed,
  percentOfPrice,
} from "./rules";

export * from "./rules";
export { OFFER_PATHS } from "./paths";

/*
 * "Make an offer" (phase 5).
 *
 * Lifecycle:  PENDING ──accept──▶ ACCEPTED ──order placed──▶ CONVERTED
 *                │   └─counter─▶ COUNTERED ──customer accepts──▶ ACCEPTED
 *                │                   └──customer declines──▶ WITHDRAWN
 *                ├─reject──▶ REJECTED (also from COUNTERED / ACCEPTED-not-yet-used)
 *                └─72 h no answer──▶ EXPIRED (cron offers.expire; also COUNTERED/ACCEPTED past their link expiry)
 *
 *  - One random token per offer (only its SHA-256 is stored in checkoutTokenHash): while COUNTERED it
 *    opens the counter page (/offer/counter/<t>, 72 h), while ACCEPTED the personal checkout link
 *    (/offer/<t>, 48 h). Every transition that issues a link rotates the token.
 *  - "Buy now" puts the product in the visitor's cart with CartItem.offerId and reserves it like any
 *    add-to-cart. Cart and checkout price the line at agreedAmount only while offerPriceApplies()
 *    (ACCEPTED, link valid, not used); otherwise the list price is shown AND charged.
 *  - placeOrder marks the offer CONVERTED (+ orderId) in the order transaction. If that order is then
 *    canceled / fails / expires unpaid, the cron reverts the offer to ACCEPTED (or EXPIRED when the
 *    link has run out) so the customer can still buy; a later PAID order re-links it.
 *  - Coupons never apply to an offer-priced line (see coupons/evaluate.ts).
 */

type Tx = Prisma.TransactionClient;

const idSchema = z.string().trim().min(1).max(64);
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{20,100}$/);

const SUBMIT_PER_IP = { limit: 10, windowMs: 60 * 60 * 1000 };
const SUBMIT_PER_EMAIL = { limit: 5, windowMs: 24 * 60 * 60 * 1000 };

const hours = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000);

// ─── Public: submit ─────────────────────────────────────────────────────────

const submitSchema = z.object({
  productId: idSchema,
  email: z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address")),
  name: z.string().trim().min(1, "Enter your name").max(120, "Use at most 120 characters"),
  amount: z.coerce.number({ error: "Enter an amount" }).int("Enter an amount in cents").min(1, "Enter an amount"),
  message: z
    .string()
    .trim()
    .max(1000, "Use at most 1000 characters")
    .optional()
    .transform((v) => v || null),
  customerId: idSchema.nullish(),
  /** Honeypot: must stay empty (hidden field bots fill in). */
  website: z.string().max(500).optional(),
});
export type SubmitOfferInput = z.input<typeof submitSchema>;

export type SubmitOfferResult =
  | { ok: true; offerId: string | null }
  | { ok: false; code: "INVALID" | "NOT_ALLOWED" | "UNAVAILABLE" | "DUPLICATE" | "RATE_LIMITED" | "NOT_FOUND"; message: string; errors?: Record<string, string> };

/** Whether (and from what amount) the product page may show the offer button. */
export async function getOfferEligibility(tenantId: string, productId: string) {
  const [product, catalog, tenant] = await Promise.all([
    db.product.findFirst({ where: { id: productId, tenantId }, select: { id: true, price: true, status: true, quantity: true, acceptsOffers: true } }),
    getSettings(tenantId, "catalog"),
    db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { currency: true } }),
  ]);
  if (!product || product.status !== "ACTIVE" || product.quantity <= 0 || product.price <= 1 || !offersAllowed(product, catalog)) return null;
  return { productId: product.id, price: product.price, minimum: minimumOffer(product.price), currency: tenant.currency };
}

/**
 * Public "make an offer". Refusals are returned (not thrown). The honeypot silently "succeeds".
 * Rate limited per IP and per email; one open (PENDING/COUNTERED) offer per email per product.
 * Queues the owner notification (OfferReceived) and the customer confirmation (OfferSubmitted).
 */
export async function submitOffer(tenantId: string, raw: SubmitOfferInput, meta: { ip?: string | null } = {}): Promise<SubmitOfferResult> {
  const parsed = submitSchema.safeParse(raw);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) errors[i.path.join(".") || "_form"] ??= i.message;
    return { ok: false, code: "INVALID", message: "Please check the highlighted fields", errors };
  }
  const input = parsed.data;
  if (input.website && input.website.trim()) return { ok: true, offerId: null };

  const ipKey = `offer.submit:${tenantId}:${meta.ip ?? "unknown"}`;
  const emailKey = `offer.submit.email:${tenantId}:${input.email}`;
  if ((await isLimited(ipKey, SUBMIT_PER_IP)) || (await isLimited(emailKey, SUBMIT_PER_EMAIL))) {
    return { ok: false, code: "RATE_LIMITED", message: "You have made several offers recently. Please try again later." };
  }
  await hit(ipKey);
  await hit(emailKey);

  const [product, catalog, tenant] = await Promise.all([
    db.product.findFirst({ where: { id: input.productId, tenantId }, select: { id: true, price: true, status: true, quantity: true, acceptsOffers: true } }),
    getSettings(tenantId, "catalog"),
    db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { currency: true } }),
  ]);
  if (!product) return { ok: false, code: "NOT_FOUND", message: "This item could not be found" };
  if (product.status !== "ACTIVE" || product.quantity <= 0) return { ok: false, code: "UNAVAILABLE", message: "This item is no longer available" };
  if (!offersAllowed(product, catalog)) return { ok: false, code: "NOT_ALLOWED", message: "This item doesn't accept offers" };
  if (await activeReservation(tenantId, product.id)) {
    return { ok: false, code: "UNAVAILABLE", message: "Someone has this item in their cart right now. Please try again later." };
  }
  if (input.amount >= product.price) {
    const msg = "Your offer is at or above the price — you can simply buy it";
    return { ok: false, code: "INVALID", message: msg, errors: { amount: msg } };
  }
  const min = minimumOffer(product.price);
  if (input.amount < min) {
    const msg = `The lowest offer we can consider is ${(min / 100).toFixed(2)} ${tenant.currency}`;
    return { ok: false, code: "INVALID", message: msg, errors: { amount: msg } };
  }

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`qm:offer:${tenantId}:${product.id}:${input.email}`}))`;
    const open = await tx.offer.findFirst({ where: { tenantId, productId: product.id, email: input.email, status: { in: ["PENDING", "COUNTERED"] } }, select: { id: true } });
    if (open) return { ok: false as const, code: "DUPLICATE" as const, message: "You already have an open offer for this item. We'll get back to you soon." };

    let customerId: string | null = null;
    if (input.customerId) customerId = (await tx.customer.findFirst({ where: { id: input.customerId, tenantId }, select: { id: true } }))?.id ?? null;
    customerId ??= (await tx.customer.findUnique({ where: { tenantId_email: { tenantId, email: input.email } }, select: { id: true } }))?.id ?? null;

    const offer = await tx.offer.create({
      data: {
        tenantId,
        productId: product.id,
        customerId,
        email: input.email,
        name: input.name,
        amount: input.amount,
        currency: tenant.currency,
        message: input.message,
      },
      select: { id: true },
    });
    await queueMail({ tenantId, template: "offer-received", props: { offerId: offer.id } }, { tx });
    await queueMail({ tenantId, template: "offer-submitted", props: { offerId: offer.id } }, { tx });
    return { ok: true as const, offerId: offer.id };
  });
}

// ─── Admin ──────────────────────────────────────────────────────────────────

export const OFFER_VIEWS = {
  pending: ["PENDING"],
  countered: ["COUNTERED"],
  accepted: ["ACCEPTED"],
  converted: ["CONVERTED"],
  closed: ["REJECTED", "EXPIRED", "WITHDRAWN"],
  all: ["PENDING", "COUNTERED", "ACCEPTED", "CONVERTED", "REJECTED", "EXPIRED", "WITHDRAWN"],
} as const satisfies Record<string, readonly OfferStatus[]>;
export type OfferView = keyof typeof OFFER_VIEWS;

const listSchema = z.object({
  view: z.enum(Object.keys(OFFER_VIEWS) as [OfferView, ...OfferView[]]).default("pending"),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export type OfferRow = {
  id: string;
  status: OfferStatus;
  email: string;
  name: string;
  amount: number;
  counterAmount: number | null;
  agreedAmount: number | null;
  currency: string;
  createdAt: Date;
  respondedAt: Date | null;
  /** amount as % of the current list price. */
  percent: number | null;
  product: { id: string; title: string; stockCode: number; price: number; status: string; thumb: string | null };
};

const productSelect = {
  id: true,
  title: true,
  stockCode: true,
  slug: true,
  price: true,
  purchasePrice: true,
  status: true,
  quantity: true,
  images: { orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }], take: 1, select: { storageKey: true } },
};

export async function listOffers(ctx: ServiceContext, query: z.input<typeof listSchema> = {}) {
  const q = listSchema.parse(query);
  const where: Prisma.OfferWhereInput = { tenantId: ctx.tenantId, status: { in: [...OFFER_VIEWS[q.view]] } };
  if (q.q) {
    const asNumber = /^\d{1,9}$/.test(q.q) ? Number(q.q) : null;
    where.OR = [
      { email: { contains: q.q, mode: "insensitive" } },
      { name: { contains: q.q, mode: "insensitive" } },
      { product: { title: { contains: q.q, mode: "insensitive" } } },
      ...(asNumber !== null ? [{ product: { stockCode: asNumber } }] : []),
    ];
  }
  const [rows, total, grouped] = await Promise.all([
    db.offer.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: { product: { select: productSelect } },
    }),
    db.offer.count({ where }),
    db.offer.groupBy({ by: ["status"], where: { tenantId: ctx.tenantId }, _count: { _all: true } }),
  ]);
  const byStatus = new Map(grouped.map((g) => [g.status, g._count._all]));
  const counts = Object.fromEntries(
    (Object.keys(OFFER_VIEWS) as OfferView[]).map((v) => [v, OFFER_VIEWS[v].reduce((s, st) => s + (byStatus.get(st) ?? 0), 0)]),
  ) as Record<OfferView, number>;
  return {
    view: q.view,
    page: q.page,
    pageSize: q.pageSize,
    total,
    counts,
    rows: rows.map(
      (o): OfferRow => ({
        id: o.id,
        status: o.status,
        email: o.email,
        name: o.name,
        amount: o.amount,
        counterAmount: o.counterAmount,
        agreedAmount: o.agreedAmount,
        currency: o.currency,
        createdAt: o.createdAt,
        respondedAt: o.respondedAt,
        percent: percentOfPrice(o.amount, o.product.price),
        product: {
          id: o.product.id,
          title: o.product.title,
          stockCode: o.product.stockCode,
          price: o.product.price,
          status: o.product.status,
          thumb: o.product.images[0] ? imageUrl(o.product.images[0].storageKey, "thumb") : null,
        },
      }),
    ),
  };
}

export async function getOfferDetail(ctx: ServiceContext, id: string) {
  const offer = await db.offer.findFirst({
    where: { id: idSchema.parse(id), tenantId: ctx.tenantId },
    include: { product: { select: productSelect }, customer: { select: { id: true, email: true, firstName: true, lastName: true } } },
  });
  if (!offer) throw new ServiceError("NOT_FOUND", "Offer not found");
  const [events, others, order, responder] = await Promise.all([
    db.auditLog.findMany({
      where: { tenantId: ctx.tenantId, entity: "offer", entityId: offer.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, action: true, createdAt: true, data: true, actor: { select: { email: true, name: true } } },
    }),
    db.offer.findMany({
      where: { tenantId: ctx.tenantId, productId: offer.productId, id: { not: offer.id } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, name: true, email: true, amount: true, status: true, createdAt: true },
    }),
    offer.orderId ? db.order.findFirst({ where: { id: offer.orderId, tenantId: ctx.tenantId }, select: { id: true, number: true, paymentStatus: true } }) : null,
    offer.respondedById ? db.user.findUnique({ where: { id: offer.respondedById }, select: { email: true, name: true } }) : null,
  ]);
  const p = offer.product;
  return {
    id: offer.id,
    status: offer.status,
    email: offer.email,
    name: offer.name,
    message: offer.message,
    amount: offer.amount,
    counterAmount: offer.counterAmount,
    agreedAmount: offer.agreedAmount,
    responseNote: offer.responseNote,
    currency: offer.currency,
    createdAt: offer.createdAt,
    respondedAt: offer.respondedAt,
    respondedBy: responder ? (responder.name ?? responder.email) : null,
    checkoutExpiresAt: offer.checkoutExpiresAt,
    customer: offer.customer,
    order,
    percent: percentOfPrice(offer.amount, p.price),
    minimum: minimumOffer(p.price),
    product: {
      id: p.id,
      title: p.title,
      stockCode: p.stockCode,
      slug: p.slug,
      price: p.price,
      purchasePrice: p.purchasePrice,
      status: p.status,
      available: p.status === "ACTIVE" && p.quantity > 0,
      thumb: p.images[0] ? imageUrl(p.images[0].storageKey, "card") : null,
    },
    events: events.map((e) => ({ id: String(e.id), action: e.action, createdAt: e.createdAt, data: e.data, actor: e.actor ? (e.actor.name ?? e.actor.email) : null })),
    otherOffers: others,
  };
}
export type OfferDetail = Awaited<ReturnType<typeof getOfferDetail>>;

async function lockOffer(tx: Tx, tenantId: string, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM offers WHERE id = ${idSchema.parse(id)} AND "tenantId" = ${tenantId} FOR UPDATE`;
  if (!rows.length) throw new ServiceError("NOT_FOUND", "Offer not found");
  return tx.offer.findUniqueOrThrow({ where: { id: rows[0].id }, include: { product: { select: { price: true, status: true, quantity: true } } } });
}

function requireStatus(status: OfferStatus, allowed: OfferStatus[], verb: string) {
  if (!allowed.includes(status)) throw new ServiceError("CONFLICT", `This offer is ${status.toLowerCase()} and can't be ${verb} anymore`);
}

const noteSchema = z
  .string()
  .trim()
  .max(1000, "Use at most 1000 characters")
  .nullish()
  .transform((v) => v || null);

/** Accept the customer's amount: issues the 48 h personal checkout link (OfferAccepted mail). */
export async function acceptOffer(ctx: ServiceContext, id: string, input: { note?: string | null } = {}) {
  const { note } = parseInput(z.object({ note: noteSchema }), input);
  const token = generateToken();
  await db.$transaction(async (tx) => {
    const offer = await lockOffer(tx, ctx.tenantId, id);
    requireStatus(offer.status, ["PENDING", "COUNTERED"], "accepted");
    if (offer.product.status !== "ACTIVE" || offer.product.quantity <= 0) throw new ServiceError("CONFLICT", "The item is no longer for sale");
    await tx.offer.update({
      where: { id: offer.id },
      data: {
        status: "ACCEPTED",
        agreedAmount: offer.amount,
        responseNote: note,
        respondedAt: new Date(),
        respondedById: ctx.actor.id,
        checkoutTokenHash: hashToken(token),
        checkoutExpiresAt: hours(OFFER_CHECKOUT_TTL_HOURS),
      },
    });
    await queueMail({ tenantId: ctx.tenantId, template: "offer-accepted", props: { offerId: offer.id, tokenEnc: encrypt(token) } }, { tx });
  });
  await audit({ action: "offer.accept", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "offer", entityId: id, data: { note } });
}

/** Propose another price (between the offer and the list price). The customer accepts/declines via a 72 h link. */
export async function counterOffer(ctx: ServiceContext, id: string, input: { counterAmount: number; note?: string | null }) {
  const data = parseInput(z.object({ counterAmount: z.coerce.number().int().min(1, "Enter an amount"), note: noteSchema }), input);
  const token = generateToken();
  await db.$transaction(async (tx) => {
    const offer = await lockOffer(tx, ctx.tenantId, id);
    requireStatus(offer.status, ["PENDING", "COUNTERED"], "countered");
    if (offer.product.status !== "ACTIVE" || offer.product.quantity <= 0) throw new ServiceError("CONFLICT", "The item is no longer for sale");
    if (data.counterAmount <= offer.amount) {
      throw new ServiceError("INVALID", "counterAmount: The counter offer must be higher than the customer's offer — accept it instead", [
        { path: "counterAmount", message: "Must be higher than the customer's offer — accept it instead" },
      ]);
    }
    if (data.counterAmount > offer.product.price) {
      throw new ServiceError("INVALID", "counterAmount: The counter offer can't be above the list price", [{ path: "counterAmount", message: "Can't be above the list price" }]);
    }
    await tx.offer.update({
      where: { id: offer.id },
      data: {
        status: "COUNTERED",
        counterAmount: data.counterAmount,
        responseNote: data.note,
        respondedAt: new Date(),
        respondedById: ctx.actor.id,
        checkoutTokenHash: hashToken(token),
        checkoutExpiresAt: hours(OFFER_COUNTER_TTL_HOURS),
      },
    });
    await queueMail({ tenantId: ctx.tenantId, template: "offer-countered", props: { offerId: offer.id, tokenEnc: encrypt(token) } }, { tx });
  });
  await audit({ action: "offer.counter", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "offer", entityId: id, data: { counterAmount: data.counterAmount, note: data.note } });
}

/** Decline (also withdraws a counter or an accepted-but-unused link). Mails the customer (OfferRejected). */
export async function rejectOffer(ctx: ServiceContext, id: string, input: { note?: string | null } = {}) {
  const { note } = parseInput(z.object({ note: noteSchema }), input);
  await db.$transaction(async (tx) => {
    const offer = await lockOffer(tx, ctx.tenantId, id);
    requireStatus(offer.status, ["PENDING", "COUNTERED", "ACCEPTED"], "rejected");
    await tx.offer.update({
      where: { id: offer.id },
      data: { status: "REJECTED", responseNote: note, respondedAt: new Date(), respondedById: ctx.actor.id, checkoutTokenHash: null, checkoutExpiresAt: null },
    });
    await queueMail({ tenantId: ctx.tenantId, template: "offer-rejected", props: { offerId: offer.id } }, { tx });
  });
  await audit({ action: "offer.reject", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "offer", entityId: id, data: { note } });
}

/** Sidebar badge: offers waiting for an answer. */
export async function pendingOfferCount(ctx: ServiceContext): Promise<number> {
  return db.offer.count({ where: { tenantId: ctx.tenantId, status: "PENDING" } });
}

// ─── Customer: links ────────────────────────────────────────────────────────

async function findByToken(client: Tx | typeof db, tenantId: string, token: string) {
  if (!tokenSchema.safeParse(token).success) return null;
  const offer = await client.offer.findUnique({
    where: { checkoutTokenHash: hashToken(token) },
    include: {
      product: {
        select: {
          id: true,
          title: true,
          slug: true,
          stockCode: true,
          price: true,
          status: true,
          quantity: true,
          blurred: true,
          images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], take: 1, select: { storageKey: true, alt: true } },
        },
      },
    },
  });
  return offer && offer.tenantId === tenantId ? offer : null;
}

type TokenOffer = NonNullable<Awaited<ReturnType<typeof findByToken>>>;

function publicProduct(offer: TokenOffer) {
  const p = offer.product;
  const img = p.images[0];
  return {
    title: p.title,
    href: `/product/${p.stockCode}/${p.slug}`,
    stockCode: p.stockCode,
    listPrice: p.price,
    imageUrl: img ? imageUrl(img.storageKey, "card") : null,
    imageAlt: img?.alt ?? p.title,
    blurred: p.blurred,
    available: p.status === "ACTIVE" && p.quantity > 0,
  };
}

export type CounterView = {
  state: "open" | "expired" | "accepted" | "closed";
  currency: string;
  name: string;
  amount: number;
  counterAmount: number;
  note: string | null;
  expiresAt: Date | null;
  product: ReturnType<typeof publicProduct>;
};

/** /offer/counter/<token>. Null for unknown tokens (other tenant, rotated, malformed). Read-only. */
export async function getCounterView(tenantId: string, token: string): Promise<CounterView | null> {
  const offer = await findByToken(db, tenantId, token);
  if (!offer || offer.counterAmount === null) return null;
  const expired = !offer.checkoutExpiresAt || offer.checkoutExpiresAt.getTime() <= Date.now();
  const state: CounterView["state"] = offer.status === "COUNTERED" ? (expired ? "expired" : "open") : offer.status === "ACCEPTED" || offer.status === "CONVERTED" ? "accepted" : "closed";
  return {
    state,
    currency: offer.currency,
    name: offer.name,
    amount: offer.amount,
    counterAmount: offer.counterAmount,
    note: offer.responseNote,
    expiresAt: offer.checkoutExpiresAt,
    product: publicProduct(offer),
  };
}

export type CounterResponse =
  | { ok: true; decision: "accept"; checkoutToken: string; offerId: string }
  | { ok: true; decision: "decline"; offerId: string }
  | { ok: false; message: string };

/** Customer accepts (→ ACCEPTED at the counter price, new 48 h checkout link + mail) or declines (→ WITHDRAWN). */
export async function respondToCounter(tenantId: string, token: string, decision: "accept" | "decline"): Promise<CounterResponse> {
  if (decision !== "accept" && decision !== "decline") return { ok: false, message: "Unknown choice" };
  const next = generateToken();
  const result = await db.$transaction(async (tx): Promise<CounterResponse> => {
    const found = await findByToken(tx, tenantId, token);
    if (!found) return { ok: false, message: "This link is no longer valid" };
    const offer = await lockOffer(tx, tenantId, found.id);
    if (offer.status !== "COUNTERED" || offer.checkoutTokenHash !== hashToken(token)) return { ok: false, message: "This counter offer was already answered" };
    if (!offer.checkoutExpiresAt || offer.checkoutExpiresAt.getTime() <= Date.now()) return { ok: false, message: "This counter offer has expired" };
    if (decision === "decline") {
      await tx.offer.update({ where: { id: offer.id }, data: { status: "WITHDRAWN", checkoutTokenHash: null, checkoutExpiresAt: null } });
      return { ok: true, decision: "decline", offerId: offer.id };
    }
    if (offer.product.status !== "ACTIVE" || offer.product.quantity <= 0) return { ok: false, message: "Sorry — this item has been sold in the meantime" };
    await tx.offer.update({
      where: { id: offer.id },
      data: { status: "ACCEPTED", agreedAmount: offer.counterAmount, checkoutTokenHash: hashToken(next), checkoutExpiresAt: hours(OFFER_CHECKOUT_TTL_HOURS) },
    });
    await queueMail({ tenantId, template: "offer-accepted", props: { offerId: offer.id, tokenEnc: encrypt(next) } }, { tx });
    return { ok: true, decision: "accept", checkoutToken: next, offerId: offer.id };
  });
  if (result.ok) await audit({ action: result.decision === "accept" ? "offer.counter.accept" : "offer.counter.decline", tenantId, entity: "offer", entityId: result.offerId });
  return result;
}

export type OfferCheckoutView = {
  state: "ready" | "expired" | "used" | "sold" | "closed";
  currency: string;
  agreedAmount: number;
  expiresAt: Date | null;
  product: ReturnType<typeof publicProduct>;
};

/** /offer/<token>: the agreed price and whether "Buy now" is possible. Null for unknown tokens. */
export async function getOfferCheckoutView(tenantId: string, token: string): Promise<OfferCheckoutView | null> {
  let offer = await findByToken(db, tenantId, token);
  if (!offer || offer.agreedAmount === null) return null;
  if (offer.status === "CONVERTED" && (await reviveOffers({ offerId: offer.id })).reverted > 0) offer = await findByToken(db, tenantId, token);
  if (!offer || offer.agreedAmount === null) return null;
  const product = publicProduct(offer);
  const usable = offerPriceApplies(offer, { tenantId, productId: offer.productId });
  const state: OfferCheckoutView["state"] =
    offer.status === "CONVERTED" ? "used" : !product.available ? "sold" : usable ? "ready" : offer.status === "ACCEPTED" || offer.status === "EXPIRED" ? "expired" : "closed";
  return { state, currency: offer.currency, agreedAmount: offer.agreedAmount, expiresAt: offer.checkoutExpiresAt, product };
}

export type BuyOfferResult = { token: string | null; result: AddToCartResult | { ok: false; code: "OFFER_INVALID"; message: string } };

/**
 * "Buy now" on /offer/<token>: puts the product in the visitor's cart with CartItem.offerId and
 * reserves it (like add-to-cart). The caller stores a new cart token in the cookie when returned.
 */
export async function buyOffer(tenantId: string, token: string, cartToken: string | null | undefined, viewer: ShopViewer | null): Promise<BuyOfferResult> {
  const offer = await findByToken(db, tenantId, token);
  if (!offer || !offerPriceApplies(offer, { tenantId, productId: offer.productId })) {
    return { token: null, result: { ok: false, code: "OFFER_INVALID", message: "This offer link is no longer valid" } };
  }
  return addToCart(tenantId, cartToken, offer.productId, viewer, { offerId: offer.id });
}

// ─── Checkout hook ──────────────────────────────────────────────────────────

/**
 * Inside placeOrder: locks the offers behind the cart lines and returns those whose agreed price
 * applies (keyed by offer id). Lines with an invalid offer are priced at the list price by the caller.
 */
export async function lockApplicableOffersTx(tx: Tx, tenantId: string, lines: { productId: string; offerId: string | null }[]) {
  const ids = [...new Set(lines.map((l) => l.offerId).filter((id): id is string => !!id))].sort();
  const out = new Map<string, { id: string; agreedAmount: number; productId: string }>();
  if (!ids.length) return out;
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM offers WHERE id = ANY(${ids}::text[]) AND "tenantId" = ${tenantId} ORDER BY id FOR UPDATE`;
  const offers = await tx.offer.findMany({
    where: { id: { in: rows.map((r) => r.id) } },
    select: { id: true, tenantId: true, productId: true, status: true, agreedAmount: true, checkoutExpiresAt: true, orderId: true },
  });
  for (const line of lines) {
    const offer = offers.find((o) => o.id === line.offerId);
    if (offer && offerPriceApplies(offer, { tenantId, productId: line.productId })) out.set(offer.id, { id: offer.id, agreedAmount: offer.agreedAmount!, productId: offer.productId });
  }
  return out;
}

/** Inside placeOrder: the offers are used by `orderId` (status CONVERTED). */
export async function convertOffersTx(tx: Tx, tenantId: string, offerIds: string[], orderId: string) {
  for (const id of offerIds) {
    const res = await tx.offer.updateMany({ where: { id, tenantId, status: "ACCEPTED", orderId: null }, data: { status: "CONVERTED", orderId } });
    if (res.count !== 1) throw new Error(`Offer ${id} could not be converted`);
  }
}

// ─── Cron ───────────────────────────────────────────────────────────────────

/**
 * CONVERTED offers whose order died unpaid (shop-canceled, or FAILED/CANCELED/EXPIRED at Mollie) go
 * back to ACCEPTED while the link is still valid (else EXPIRED); ACCEPTED offers whose order was
 * paid after all (retry of the old order) are re-linked as CONVERTED.
 */
export async function reviveOffers(opts: { offerId?: string } = {}): Promise<{ reverted: number; relinked: number }> {
  const only = opts.offerId ? Prisma.sql`AND f.id = ${opts.offerId}` : Prisma.empty;
  const reverted = await db.$executeRaw`
    UPDATE offers f
    SET status = (CASE WHEN f."checkoutExpiresAt" > now() AT TIME ZONE 'UTC' THEN 'ACCEPTED' ELSE 'EXPIRED' END)::"OfferStatus",
        "orderId" = NULL, "updatedAt" = now()
    FROM orders o
    WHERE f.status = 'CONVERTED' AND o.id = f."orderId" AND o."finalizedAt" IS NULL
      AND o."paymentStatus" NOT IN ('PAID', 'REFUNDED', 'PARTIALLY_REFUNDED')
      AND (o."canceledAt" IS NOT NULL OR o."paymentStatus" IN ('FAILED', 'CANCELED', 'EXPIRED')) ${only}`;
  const relinked = await db.$executeRaw`
    UPDATE offers f SET status = 'CONVERTED', "orderId" = o.id, "updatedAt" = now()
    FROM orders o
    WHERE f.status IN ('ACCEPTED', 'EXPIRED') AND f."orderId" IS NULL AND o."offerId" = f.id AND o."tenantId" = f."tenantId"
      AND o."paymentStatus" = 'PAID'
      AND NOT EXISTS (SELECT 1 FROM offers x WHERE x."orderId" = o.id) ${only}`;
  return { reverted, relinked };
}

/** Cron `offers.expire` (hourly): unanswered and run-out offers → EXPIRED, then reviveOffers(). */
export async function expireOffers(): Promise<{ expired: number; reverted: number; relinked: number }> {
  const now = new Date();
  const pendingCutoff = new Date(now.getTime() - OFFER_PENDING_TTL_HOURS * 60 * 60 * 1000);
  const a = await db.offer.updateMany({ where: { status: "PENDING", createdAt: { lte: pendingCutoff } }, data: { status: "EXPIRED" } });
  const b = await db.offer.updateMany({
    where: { status: { in: ["COUNTERED", "ACCEPTED"] }, checkoutExpiresAt: { lte: now } },
    data: { status: "EXPIRED" },
  });
  const revived = await reviveOffers();
  return { expired: a.count + b.count, ...revived };
}
