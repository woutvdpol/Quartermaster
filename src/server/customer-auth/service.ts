import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { Prisma } from "@/generated/prisma/client";
import { anonymizeCustomer, ANONYMIZED_EMAIL_DOMAIN } from "@/server/customers";
import { claimVerifiedEmail, ensureAccountCustomer, isPendingCustomerEmail, pendingCustomerEmail } from "./link";
import { subscribe } from "@/server/newsletter";
import { changePassword, login, newPasswordSchema, verifyCurrentPassword, type LoginResult } from "@/server/auth/service";
import { getDummyHash, hashPassword, verifyPassword } from "@/server/auth/password";
import { createSession, destroyAllSessions, destroySession, type SessionUser } from "@/server/auth/session";
import * as rateLimit from "@/server/auth/rate-limit";
import { sendCustomerVerification } from "@/server/email-verification";

/*
 * Shop customer accounts — thin wrappers around the shared auth service (src/server/auth/service.ts).
 *
 * - A customer account is a `User` with role CUSTOMER bound to ONE tenant; the same email in two
 *   shops is two independent accounts (User is unique on (tenantId, email)).
 * - Every CUSTOMER user has exactly one `Customer` row in its tenant. Guest data of the account's
 *   address (guest Customer, its orders, addresses, …) is linked ONLY after the address is proven:
 *   email verification, password reset, or a verified ETL import — see ./link.ts (review R1).
 *   Unverified accounts have their own Customer with a placeholder address until then.
 * - Staff (OWNER) accounts live on the same host but may NOT sign in through the shop login; they
 *   get the same generic error as a wrong password, without their password ever being checked.
 * - Email verification: registration signs the customer in immediately (`emailVerifiedAt` null)
 *   and queues a verification mail; an email change does the same for the new address.
 */

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email("Enter a valid email address"))
  // RFC 2606 ".invalid" is used for internal placeholders (anonymized / unverified accounts).
  .refine((e) => !e.endsWith(".invalid"), "Enter a valid email address");
const nameSchema = z.string().trim().min(1, "Enter your name").max(200, "Name is too long");

/** Per IP: at most 10 registrations per hour. */
export const REGISTER_RULE = { limit: 10, windowMs: 60 * 60 * 1000 };

const keys = {
  registerIp: (ip: string) => `register:ip:${ip}`,
};

export type CustomerUser = Pick<SessionUser, "id" | "tenantId" | "email" | "role">;

function splitName(name: string | null | undefined) {
  const n = name?.trim().replace(/\s+/g, " ");
  if (!n) return { firstName: null, lastName: null };
  const i = n.indexOf(" ");
  return i === -1 ? { firstName: n, lastName: null } : { firstName: n.slice(0, i), lastName: n.slice(i + 1) };
}

function isUniqueViolation(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

// ─── Register ───────────────────────────────────────────────────────────────

const registerSchema = z.object({
  tenantId: z.string().min(1),
  email: emailSchema,
  name: nameSchema,
  password: newPasswordSchema,
  newsletter: z.boolean().default(false),
});
export type RegisterInput = z.input<typeof registerSchema> & { ip?: string | null };

export type RegisterResult =
  | { ok: true; userId: string; customerId: string; linkedOrders: number }
  | {
      ok: false;
      error: "invalid" | "email_taken" | "rate_limited";
      fieldErrors?: Partial<Record<"email" | "name" | "password", string>>;
    };

/**
 * Creates a CUSTOMER account in the tenant and signs it in (session cookie). Newsletter opt-in
 * starts the normal double opt-in (a confirmation mail), never an immediate subscription.
 */
export async function registerCustomer(input: RegisterInput): Promise<RegisterResult> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<"email" | "name" | "password", string>> = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path[0];
      if ((k === "email" || k === "name" || k === "password") && !fieldErrors[k]) fieldErrors[k] = issue.message;
    }
    return { ok: false, error: "invalid", fieldErrors };
  }
  const { tenantId, email, name, password, newsletter } = parsed.data;

  const ipKey = input.ip ? keys.registerIp(input.ip) : null;
  if (ipKey && !(await rateLimit.take(ipKey, REGISTER_RULE))) return { ok: false, error: "rate_limited" };

  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { status: true } });
  if (!tenant || tenant.status !== "ACTIVE") return { ok: false, error: "invalid" };

  // Any existing account with this email in the shop (customer or staff) blocks registration.
  if (await db.user.findUnique({ where: { tenantId_email: { tenantId, email } }, select: { id: true } })) {
    return { ok: false, error: "email_taken" };
  }

  const passwordHash = await hashPassword(password);
  let created: { userId: string; customerId: string; linkedOrders: number };
  try {
    created = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { tenantId, role: "CUSTOMER", email, name, passwordHash, emailVerifiedAt: null },
      });
      // Own Customer with a placeholder address: guest orders of `email` are NOT linked until the
      // address is verified (verifyCustomerEmail → claimVerifiedEmail).
      const customer = await tx.customer.create({
        data: { tenantId, userId: user.id, email: pendingCustomerEmail(user.id), ...splitName(name) },
      });
      return { userId: user.id, customerId: customer.id, linkedOrders: 0 };
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: "email_taken" };
    throw e;
  }

  await audit({
    action: "customer.registered",
    tenantId,
    actorId: created.userId,
    entity: "Customer",
    entityId: created.customerId,
    data: { linkedOrders: created.linkedOrders, newsletter },
  });

  if (newsletter) {
    // Newsletter may be disabled for the shop or rate limited — never fail the registration for it.
    await subscribe(tenantId, email, { source: "register", customerId: created.customerId }).catch(() => null);
  }

  await destroySession();
  await createSession(created.userId, "CUSTOMER");
  await db.user.update({ where: { id: created.userId }, data: { lastLoginAt: new Date() } });
  // Never fail the registration over the verification mail (rate limit / mail problems).
  await sendCustomerVerification(tenantId, created.userId).catch(() => null);
  return { ok: true, ...created };
}

// ─── Login ──────────────────────────────────────────────────────────────────

/**
 * Shop login: only CUSTOMER accounts of this tenant. A staff email gets the generic
 * "invalid_credentials" (its password is not checked here, so the shop form is no oracle for it).
 */
export async function customerLogin(input: {
  tenantId: string;
  email: string;
  password: string;
  ip?: string | null;
}): Promise<LoginResult> {
  const email = emailSchema.safeParse(input.email);
  if (email.success) {
    const existing = await db.user.findUnique({
      where: { tenantId_email: { tenantId: input.tenantId, email: email.data } },
      select: { role: true },
    });
    if (existing && existing.role !== "CUSTOMER") {
      await verifyPassword(String(input.password ?? ""), await getDummyHash()); // equal timing
      await audit({ action: "auth.login_failed", tenantId: input.tenantId, data: { email: email.data, reason: "staff_on_shop" } });
      return { ok: false, error: "invalid_credentials" };
    }
  }
  const result = await login({ email: input.email, password: input.password, tenantId: input.tenantId, ip: input.ip });
  if (result.ok && email.success) {
    // Make sure the account has its Customer row (accounts created by import/admin may lack one).
    // Verified accounts also pick up guest orders placed with their address since the last login.
    const user = await db.user.findUnique({ where: { tenantId_email: { tenantId: input.tenantId, email: email.data } } });
    if (user && user.role === "CUSTOMER") {
      const sync = user.emailVerifiedAt
        ? db.$transaction((tx) => claimVerifiedEmail(tx, input.tenantId, user.id))
        : ensureAccountCustomer({ id: user.id, tenantId: input.tenantId });
      await sync.catch((e) => console.error("customerLogin: could not link customer", e));
    }
  }
  return result;
}

// ─── Current customer ───────────────────────────────────────────────────────

/**
 * The Customer row of a CUSTOMER user, created if missing (linked to the guest data of its address
 * only when the address is verified — see ./link.ts).
 */
export async function ensureCustomer(user: CustomerUser & { name?: string | null }) {
  if (user.role !== "CUSTOMER" || !user.tenantId) throw new Error("Not a customer account");
  return ensureAccountCustomer({ id: user.id, tenantId: user.tenantId });
}

// ─── Profile ────────────────────────────────────────────────────────────────

const profileSchema = z.object({
  name: nameSchema,
  phone: z.string().trim().max(40, "Phone number is too long").optional().nullable(),
});

export type ProfileResult = { ok: true } | { ok: false; error: "invalid"; fieldErrors?: Partial<Record<"name" | "phone", string>> };

export async function updateCustomerProfile(user: CustomerUser, input: z.input<typeof profileSchema>): Promise<ProfileResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<"name" | "phone", string>> = {};
    for (const i of parsed.error.issues) {
      const k = i.path[0];
      if ((k === "name" || k === "phone") && !fieldErrors[k]) fieldErrors[k] = i.message;
    }
    return { ok: false, error: "invalid", fieldErrors };
  }
  const customer = await ensureCustomer(user);
  const { firstName, lastName } = splitName(parsed.data.name);
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { name: parsed.data.name } }),
    db.customer.update({
      where: { id: customer.id },
      data: { firstName, lastName, ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone || null } : {}) },
    }),
  ]);
  await audit({ action: "customer.profile_updated", tenantId: user.tenantId, actorId: user.id, entity: "Customer", entityId: customer.id });
  return { ok: true };
}

export type ChangeEmailResult =
  | { ok: true; linkedOrders: number }
  | { ok: false; error: "invalid_email" | "invalid_password" | "rate_limited" | "email_taken" | "unchanged" };

/**
 * Changes the login email (= Customer email). Needs the current password. If a guest Customer with
 * the new email exists, it is merged into this account (its orders, addresses and wishlist move over).
 * The new address is unverified (`emailVerifiedAt` → null).
 */
export async function changeCustomerEmail(user: CustomerUser, newEmail: string, password: string): Promise<ChangeEmailResult> {
  const parsed = emailSchema.safeParse(newEmail);
  if (!parsed.success) return { ok: false, error: "invalid_email" };
  const email = parsed.data;
  if (email === user.email) return { ok: false, error: "unchanged" };
  if (email.endsWith(`@${ANONYMIZED_EMAIL_DOMAIN}`) || isPendingCustomerEmail(email)) return { ok: false, error: "invalid_email" };
  const check = await verifyCurrentPassword(user.id, password);
  if (check !== "ok") return { ok: false, error: check === "rate_limited" ? "rate_limited" : "invalid_password" };

  const tenantId = user.tenantId!;
  const customer = await ensureCustomer(user);
  try {
    await db.$transaction(async (tx) => {
      if (await tx.user.findUnique({ where: { tenantId_email: { tenantId, email } }, select: { id: true } })) {
        throw new Error("EMAIL_TAKEN");
      }
      const other = await tx.customer.findUnique({ where: { tenantId_email: { tenantId, email } }, select: { userId: true } });
      if (other?.userId) throw new Error("EMAIL_TAKEN");
      await tx.user.update({ where: { id: user.id }, data: { email, emailVerifiedAt: null } });
      // The new address is unproven: the account's Customer gets the placeholder address and NOTHING
      // of the new address's guest data is merged until it is verified (claimVerifiedEmail, review R1).
      await tx.customer.update({ where: { id: customer.id }, data: { email: pendingCustomerEmail(user.id) } });
    });
    await audit({
      action: "customer.email_changed",
      tenantId,
      actorId: user.id,
      entity: "Customer",
      entityId: customer.id,
      data: { linkedOrders: 0 },
    });
    await sendCustomerVerification(tenantId, user.id).catch(() => null);
    return { ok: true, linkedOrders: 0 };
  } catch (e) {
    if (isUniqueViolation(e) || (e instanceof Error && e.message === "EMAIL_TAKEN")) return { ok: false, error: "email_taken" };
    throw e;
  }
}

/** Password change for a signed-in customer; other sessions are signed out. */
export function changeCustomerPassword(user: CustomerUser, current: string, next: string, keepSessionId?: string) {
  return changePassword(user, current, next, keepSessionId);
}

// ─── Delete (anonymize) account ─────────────────────────────────────────────

export type DeleteAccountResult = { ok: true } | { ok: false; error: "invalid_password" | "rate_limited" };

/**
 * Account deletion request, handled immediately: the Customer is anonymized through the customers
 * service (orders are KEPT for bookkeeping, profile/addresses/wishlist/newsletter are erased) and
 * the login is scrubbed and disabled. All sessions end.
 */
export async function deleteCustomerAccount(user: CustomerUser, password: string): Promise<DeleteAccountResult> {
  const check = await verifyCurrentPassword(user.id, password);
  if (check !== "ok") return { ok: false, error: check === "rate_limited" ? "rate_limited" : "invalid_password" };
  const tenantId = user.tenantId!;
  const customer = await ensureCustomer(user);

  await anonymizeCustomer({ tenantId, actor: { id: user.id, role: user.role, tenantId, email: user.email } }, customer.id);
  await db.$transaction([
    db.recoveryCode.deleteMany({ where: { userId: user.id } }),
    db.authToken.deleteMany({ where: { userId: user.id } }),
    db.user.update({
      where: { id: user.id },
      data: {
        email: `deleted-${user.id}@${ANONYMIZED_EMAIL_DOMAIN}`,
        name: null,
        passwordHash: null,
        totpSecretEnc: null,
        totpEnabledAt: null,
        emailVerifiedAt: null,
        disabledAt: new Date(),
      },
    }),
  ]);
  await destroyAllSessions(user.id);
  await destroySession();
  await audit({ action: "customer.account_deleted", tenantId, actorId: user.id, entity: "Customer", entityId: customer.id });
  return { ok: true };
}
