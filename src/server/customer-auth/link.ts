import "server-only";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { Prisma } from "@/generated/prisma/client";
import { findOrCreateGuestCustomer } from "@/server/customers";

/*
 * Linking a customer account to the guest data of its email address (security review R1).
 *
 * Owner decision: a registered customer gets their earlier guest orders. But guest data (orders and
 * their order-status links, addresses, wishlist, newsletter rows, carts, saved searches, offers) may
 * only move to an account once the account has PROVEN it owns the address:
 *   - customer clicked the verification link (`verifyCustomerEmail`), or
 *   - completed a password reset (the link went to that mailbox), or
 *   - the account came verified from the ETL (legacy `email_verified_at`) / was linked by the ETL.
 *
 * Until then an account has its OWN Customer row with a placeholder address
 * `pending-<userId>@unverified.invalid` (Customer.email is unique per tenant, and the real address may
 * already belong to a guest Customer). Consequences while unverified:
 *   - guest checkouts with that address keep landing on the guest Customer, not on the account;
 *   - wishlist / alert mails are not sent (placeholder address);
 *   - orders the customer places while signed in are linked to the own Customer as usual.
 * `claimVerifiedEmail` runs on verification: the guest Customer of the address is merged into the
 * account's Customer and unlinked guest orders with that address are attached.
 */

export const PENDING_EMAIL_DOMAIN = "unverified.invalid";

export function pendingCustomerEmail(userId: string): string {
  return `pending-${userId}@${PENDING_EMAIL_DOMAIN}`;
}

export function isPendingCustomerEmail(email: string): boolean {
  return email.endsWith(`@${PENDING_EMAIL_DOMAIN}`);
}

type Tx = Prisma.TransactionClient;

function isUniqueViolation(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/** Moves everything of guest Customer `fromId` to `toId` and deletes the guest row. */
async function mergeCustomer(tx: Tx, tenantId: string, fromId: string, toId: string) {
  await tx.order.updateMany({ where: { tenantId, customerId: fromId }, data: { customerId: toId } });
  await tx.address.updateMany({ where: { tenantId, customerId: fromId }, data: { customerId: toId, isDefault: false } });
  const wished = await tx.wishlistItem.findMany({ where: { customerId: fromId }, select: { productId: true } });
  if (wished.length) {
    await tx.wishlistItem.createMany({
      data: wished.map((w) => ({ tenantId, customerId: toId, productId: w.productId })),
      skipDuplicates: true,
    });
  }
  await tx.newsletterSubscriber.updateMany({ where: { tenantId, customerId: fromId }, data: { customerId: toId } });
  await tx.cart.updateMany({ where: { tenantId, customerId: fromId }, data: { customerId: toId } });
  await tx.savedSearch.updateMany({ where: { tenantId, customerId: fromId }, data: { customerId: toId } });
  await tx.offer.updateMany({ where: { tenantId, customerId: fromId }, data: { customerId: toId } });
  await tx.customer.delete({ where: { id: fromId } });
}

/**
 * The account's Customer row, created if missing. Verified accounts get the Customer of their
 * address (linked, guest orders attached — the original behaviour); unverified accounts get an own
 * row with the placeholder address and nothing linked.
 */
export async function ensureAccountCustomer(user: { id: string; tenantId: string }) {
  const existing = await db.customer.findUnique({ where: { userId: user.id } });
  if (existing) return existing;
  const u = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { email: true, name: true, emailVerifiedAt: true } });
  if (u.emailVerifiedAt) {
    const { customerId } = await db.$transaction((tx) => claimVerifiedEmail(tx, user.tenantId, user.id));
    return db.customer.findUniqueOrThrow({ where: { id: customerId } });
  }
  try {
    return await db.customer.create({
      data: { tenantId: user.tenantId, userId: user.id, email: pendingCustomerEmail(user.id), ...splitName(u.name) },
    });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    return db.customer.findUniqueOrThrow({ where: { userId: user.id } }); // concurrent request created it
  }
}

/**
 * After the account proved it owns its (current) address: make the account's Customer carry that
 * address, merging the guest Customer of the address and attaching unlinked guest orders. Call
 * inside a transaction, only for a verified address. Returns the Customer id and attached orders.
 */
export async function claimVerifiedEmail(tx: Tx, tenantId: string, userId: string): Promise<{ customerId: string; linkedOrders: number }> {
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, name: true, tenantId: true, role: true } });
  if (user.tenantId !== tenantId || user.role !== "CUSTOMER") throw new Error("Not a customer of this tenant");
  const email = user.email;
  const own = await tx.customer.findUnique({ where: { userId } });
  const guest = await tx.customer.findUnique({ where: { tenantId_email: { tenantId, email } } });

  let customerId: string;
  let merged = 0;
  if (!own) {
    // No own row yet: take over the address's Customer (or create it).
    const c = guest ?? (await findOrCreateGuestCustomer(tx, tenantId, { email, name: user.name }));
    if (c.userId && c.userId !== userId) throw new Error("EMAIL_TAKEN");
    if (!c.userId) await tx.customer.update({ where: { id: c.id }, data: { userId } });
    customerId = c.id;
  } else {
    customerId = own.id;
    if (guest && guest.id !== own.id) {
      if (guest.userId && guest.userId !== userId) throw new Error("EMAIL_TAKEN");
      merged = await tx.order.count({ where: { tenantId, customerId: guest.id } });
      await mergeCustomer(tx, tenantId, guest.id, own.id);
    }
    if (own.email !== email) {
      await tx.customer.update({ where: { id: own.id }, data: { email } });
      await tx.savedSearch.updateMany({ where: { tenantId, customerId: own.id }, data: { email } });
    }
  }
  const attached = await tx.order.updateMany({ where: { tenantId, email, customerId: null }, data: { customerId } });
  return { customerId, linkedOrders: merged + attached.count };
}

/** Runs `claimVerifiedEmail` in its own transaction and audits it (verification / reset paths). */
export async function claimVerifiedEmailAndAudit(tenantId: string, userId: string) {
  const result = await db.$transaction((tx) => claimVerifiedEmail(tx, tenantId, userId));
  await audit({
    action: "customer.email_claimed",
    tenantId,
    actorId: userId,
    entity: "Customer",
    entityId: result.customerId,
    data: { linkedOrders: result.linkedOrders },
  });
  return result;
}

function splitName(name: string | null | undefined) {
  const n = name?.trim().replace(/\s+/g, " ");
  if (!n) return { firstName: null, lastName: null };
  const i = n.indexOf(" ");
  return i === -1 ? { firstName: n, lastName: null } : { firstName: n.slice(0, i), lastName: n.slice(i + 1) };
}
