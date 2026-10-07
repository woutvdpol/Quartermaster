import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

/**
 * Stateless signed links for alert mails (same approach as src/server/newsletter/signing.ts, but a
 * separate HKDF key and a purpose in every MAC so a link of one kind can never be used as another):
 *
 *   unsubscribe   ?t=<tenantId>&s=<savedSearchId>&sig=…            stop one saved search
 *   manage        ?t=<tenantId>&s=<savedSearchId>&sig=…            list/stop every alert of that search's email
 *   wishlist      ?t=<tenantId>&c=<customerId>&p=<productId>&sig=… stop wishlist alerts for one item
 *
 * Links never expire (old mails must keep working); rotating APP_ENCRYPTION_KEY invalidates them.
 */
export type AlertLinkPurpose = "unsubscribe" | "manage" | "wishlist";

const SIG_BYTES = 16;
let cached: { raw: string; key: Buffer } | null = null;

function key(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error("APP_ENCRYPTION_KEY is not set");
  if (cached?.raw === raw) return cached.key;
  const ikm = Buffer.from(raw, "base64");
  if (ikm.length !== 32) throw new Error("APP_ENCRYPTION_KEY must be 32 bytes (base64)");
  const k = Buffer.from(hkdfSync("sha256", ikm, "quartermaster", "alerts-links-v1", 32));
  cached = { raw, key: k };
  return k;
}

function mac(purpose: AlertLinkPurpose, tenantId: string, subject: string): Buffer {
  return createHmac("sha256", key()).update(`v1\n${purpose}\n${tenantId}\n${subject}`).digest().subarray(0, SIG_BYTES);
}

export function signAlertLink(purpose: AlertLinkPurpose, tenantId: string, subject: string): string {
  return mac(purpose, tenantId, subject).toString("base64url");
}

export function verifyAlertLink(purpose: AlertLinkPurpose, tenantId: string, subject: string, sig: string): boolean {
  if (!tenantId || !subject || typeof sig !== "string" || sig.length > 64) return false;
  const given = Buffer.from(sig, "base64url");
  const expected = mac(purpose, tenantId, subject);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Query params for a saved-search link (unsubscribe / manage). */
export function searchLinkQuery(purpose: "unsubscribe" | "manage", tenantId: string, savedSearchId: string): Record<string, string> {
  return { t: tenantId, s: savedSearchId, sig: signAlertLink(purpose, tenantId, savedSearchId) };
}

/** Query params for a wishlist-alert stop link. */
export function wishlistLinkQuery(tenantId: string, customerId: string, productId: string): Record<string, string> {
  return { t: tenantId, c: customerId, p: productId, sig: signAlertLink("wishlist", tenantId, `${customerId}:${productId}`) };
}

export function verifyWishlistLink(tenantId: string, customerId: string, productId: string, sig: string): boolean {
  if (!customerId || !productId) return false;
  return verifyAlertLink("wishlist", tenantId, `${customerId}:${productId}`, sig);
}
