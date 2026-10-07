import type { Role } from "../../../src/generated/prisma/enums";
import type { EtlContext } from "../context";
import { UNKNOWN_COUNTRY, normalizeEmail, splitName, splitStreet, toCountryCode } from "../transforms/people";

/** Prefix of migrated Laravel bcrypt hashes; verified + rehashed to scrypt on first login (src/server/auth). */
export const LEGACY_HASH_PREFIX = "bcrypt$";
const BCRYPT = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Legacy password column → stored passwordHash ("bcrypt$" + original), or null when unusable. */
export function legacyPasswordHash(hash: string | null | undefined): string | null {
  const h = (hash ?? "").trim();
  return BCRYPT.test(h) ? `${LEGACY_HASH_PREFIX}${h}` : null;
}

/** spatie roles → Quartermaster role: owner/admin → OWNER (staff of this shop), else CUSTOMER. */
export function roleFor(roles: readonly string[]): Extract<Role, "OWNER" | "CUSTOMER"> {
  return roles.some((r) => ["owner", "admin", "super-admin", "superadmin"].includes(r.toLowerCase())) ? "OWNER" : "CUSTOMER";
}

/**
 * Legacy `users` (+ spatie roles) → User (OWNER or CUSTOMER) and, for customers, Customer + Address
 * (+ wishlist). Upsert on (tenantId, lower-case email). Not migrated: birth_date (AVG; age checks are
 * done per order now), remember tokens, password reset tokens.
 */
export async function usersStep(ctx: EtlContext) {
  const { tx, report, tenantId } = ctx;
  const users = await ctx.legacy.read("users");
  const roleRows = await ctx.legacy.read("user_roles");
  const addresses = await ctx.legacy.read("addresses");
  const wishlist = await ctx.legacy.read("wishlist");
  report.legacy("users", users.length);
  report.legacy("addresses", addresses.length);
  report.legacy("wishlist items", wishlist.length);

  const roles = new Map<number, string[]>();
  for (const r of roleRows) roles.set(r.model_id, [...(roles.get(r.model_id) ?? []), r.role]);

  const seen = new Set<string>();
  const customerByLegacyUser = new Map<number, string>();
  for (const u of users) {
    const email = normalizeEmail(u.email);
    if (!EMAIL.test(email)) {
      report.skip("users", "ongeldig e-mailadres");
      continue;
    }
    if (seen.has(email)) {
      report.skip("users", "dubbel e-mailadres (hoofdletterverschil)");
      report.warn(`user legacy #${u.id}: duplicate e-mail (case-insensitive) → skipped`);
      continue;
    }
    seen.add(email);
    const role = roleFor(roles.get(u.id) ?? []);
    const passwordHash = legacyPasswordHash(u.password);
    if (!passwordHash) report.note("Gebruikers zonder bruikbare wachtwoordhash (reset nodig)", `user legacy #${u.id}`);
    const name = u.name?.trim() || null;

    const existing = await tx.user.findUnique({ where: { tenantId_email: { tenantId, email } } });
    let userId: string;
    if (existing) {
      // Never overwrite a password that was already rehashed (scrypt) after a login in Quartermaster.
      const keepPassword = existing.passwordHash !== null && !existing.passwordHash.startsWith(LEGACY_HASH_PREFIX);
      const data = {
        name: existing.name ?? name,
        ...(keepPassword ? {} : { passwordHash }),
        emailVerifiedAt: existing.emailVerifiedAt ?? u.email_verified_at,
      };
      const changed = data.name !== existing.name || (!keepPassword && passwordHash !== existing.passwordHash) || data.emailVerifiedAt?.getTime() !== existing.emailVerifiedAt?.getTime();
      if (changed) {
        await tx.user.update({ where: { id: existing.id }, data });
        report.updated(role === "OWNER" ? "users (staff)" : "users (customers)");
      } else report.unchanged(role === "OWNER" ? "users (staff)" : "users (customers)");
      if (existing.role !== role) report.warn(`user legacy #${u.id}: exists as ${existing.role}, legacy role ${role} → role not changed`);
      userId = existing.id;
    } else {
      const row = await tx.user.create({
        data: { tenantId, role, email, name, passwordHash, emailVerifiedAt: u.email_verified_at, ...(u.created_at ? { createdAt: u.created_at } : {}) },
      });
      userId = row.id;
      report.created(role === "OWNER" ? "users (staff)" : "users (customers)");
    }
    if (role === "OWNER") {
      report.note("Staff-accounts (OWNER)", `user legacy #${u.id} (rollen: ${(roles.get(u.id) ?? []).join(", ") || "geen"})`);
      continue;
    }

    const { firstName, lastName } = splitName(name);
    const customer = await tx.customer.findUnique({ where: { tenantId_email: { tenantId, email } } });
    if (customer) {
      if (customer.userId && customer.userId !== userId) report.warn(`customer for user legacy #${u.id} is linked to another user → left as is`);
      else if (!customer.userId) await tx.customer.update({ where: { id: customer.id }, data: { userId } });
      customerByLegacyUser.set(u.id, customer.id);
      report.unchanged("customers");
    } else {
      const row = await tx.customer.create({
        data: { tenantId, userId, email, firstName: firstName || null, lastName: lastName || null, ...(u.created_at ? { createdAt: u.created_at } : {}) },
      });
      customerByLegacyUser.set(u.id, row.id);
      report.created("customers");
    }
  }

  // Address book.
  const unknownCountry: number[] = [];
  const firstPerCustomer = new Set<string>();
  for (const a of addresses) {
    const customerId = customerByLegacyUser.get(a.user_id);
    if (!customerId) {
      report.skip("addresses", "gebruiker niet als klant geïmporteerd");
      continue;
    }
    const street = splitStreet(a.address);
    const cc = toCountryCode(a.country);
    if (!cc) unknownCountry.push(a.id);
    const data = {
      firstName: a.firstname?.trim() ?? "",
      lastName: a.lastname?.trim() ?? "",
      street: street.street,
      houseNumber: street.houseNumber,
      line2: street.line2,
      postalCode: a.zip?.trim() || null,
      city: a.city?.trim() ?? "",
      region: a.state?.trim() || null,
      countryCode: cc ?? UNKNOWN_COUNTRY,
    };
    const existing = await tx.address.findFirst({ where: { tenantId, customerId, ...data } });
    if (existing) report.unchanged("addresses");
    else {
      const hasDefault = (await tx.address.count({ where: { customerId, isDefault: true } })) > 0;
      await tx.address.create({ data: { tenantId, customerId, type: "SHIPPING", isDefault: !hasDefault && !firstPerCustomer.has(customerId), ...data } });
      report.created("addresses");
    }
    firstPerCustomer.add(customerId);
  }
  if (unknownCountry.length) report.note("Adressen met onbekend land (countryCode ZZ)", `address legacy #${unknownCountry.join(", #")}`);

  // Wishlist.
  const products = new Map(
    (await tx.product.findMany({ where: { tenantId, stockCode: { in: wishlist.map((w) => w.product_id) } }, select: { id: true, stockCode: true } })).map((p) => [p.stockCode, p.id]),
  );
  for (const w of wishlist) {
    const customerId = customerByLegacyUser.get(w.user_id);
    const productId = products.get(w.product_id);
    if (!customerId || !productId) {
      report.skip("wishlist items", !customerId ? "klant ontbreekt" : "product ontbreekt");
      continue;
    }
    const res = await tx.wishlistItem.createMany({
      data: [{ tenantId, customerId, productId, ...(w.created_at ? { createdAt: w.created_at } : {}) }],
      skipDuplicates: true,
    });
    if (res.count) report.created("wishlist items");
    else report.unchanged("wishlist items");
  }
}
