import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

/**
 * Stateless unsubscribe links: `?t=<tenantId>&s=<subscriberId>&sig=<HMAC>`.
 * The key is derived from APP_ENCRYPTION_KEY with HKDF (separate `info`, so it is never the same key
 * that encrypts secrets). Links never expire — unsubscribing must keep working for old mails.
 * Rotating APP_ENCRYPTION_KEY invalidates old links (they then show the "invalid link" page).
 */
const SIG_BYTES = 16; // 128-bit tag

let cached: { raw: string; key: Buffer } | null = null;

function unsubscribeKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error("APP_ENCRYPTION_KEY is not set");
  if (cached?.raw === raw) return cached.key;
  const ikm = Buffer.from(raw, "base64");
  if (ikm.length !== 32) throw new Error("APP_ENCRYPTION_KEY must be 32 bytes (base64)");
  const key = Buffer.from(hkdfSync("sha256", ikm, "quartermaster", "newsletter-unsubscribe-v1", 32));
  cached = { raw, key };
  return key;
}

function mac(tenantId: string, subscriberId: string): Buffer {
  return createHmac("sha256", unsubscribeKey()).update(`v1\n${tenantId}\n${subscriberId}`).digest().subarray(0, SIG_BYTES);
}

export function signUnsubscribe(tenantId: string, subscriberId: string): string {
  return mac(tenantId, subscriberId).toString("base64url");
}

export function verifyUnsubscribe(tenantId: string, subscriberId: string, signature: string): boolean {
  if (!tenantId || !subscriberId || typeof signature !== "string" || signature.length > 64) return false;
  const given = Buffer.from(signature, "base64url");
  const expected = mac(tenantId, subscriberId);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function unsubscribeQuery(tenantId: string, subscriberId: string): Record<string, string> {
  return { t: tenantId, s: subscriberId, sig: signUnsubscribe(tenantId, subscriberId) };
}
