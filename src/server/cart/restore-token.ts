import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

/**
 * Signed "Back to your cart" link of the abandoned-cart mail: `<cartId>.<expiry base36>.<HMAC>`.
 * Stateless (no column needed); the key is derived from APP_ENCRYPTION_KEY with HKDF and its own
 * `info`, like the newsletter unsubscribe links. Restoring rotates the cart's token, so the raw cart
 * cookie value never appears in a mail.
 */
export const RESTORE_TOKEN_TTL_DAYS = 7;
const SIG_BYTES = 16;

let cached: { raw: string; key: Buffer } | null = null;

function restoreKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error("APP_ENCRYPTION_KEY is not set");
  if (cached?.raw === raw) return cached.key;
  const ikm = Buffer.from(raw, "base64");
  if (ikm.length !== 32) throw new Error("APP_ENCRYPTION_KEY must be 32 bytes (base64)");
  const key = Buffer.from(hkdfSync("sha256", ikm, "quartermaster", "cart-restore-v1", 32));
  cached = { raw, key };
  return key;
}

function mac(cartId: string, exp: string): Buffer {
  return createHmac("sha256", restoreKey()).update(`v1\n${cartId}\n${exp}`).digest().subarray(0, SIG_BYTES);
}

export function signCartRestore(cartId: string, now: Date = new Date()): string {
  const exp = Math.floor(now.getTime() / 1000 + RESTORE_TOKEN_TTL_DAYS * 86400).toString(36);
  return `${cartId}.${exp}.${mac(cartId, exp).toString("base64url")}`;
}

/** The cart id of a valid, unexpired restore token, else null. */
export function verifyCartRestore(token: unknown, now: Date = new Date()): string | null {
  if (typeof token !== "string" || token.length > 200) return null;
  const m = /^([a-z0-9]{10,64})\.([a-z0-9]{1,12})\.([A-Za-z0-9_-]{10,64})$/.exec(token);
  if (!m) return null;
  const [, cartId, exp, sig] = m;
  const given = Buffer.from(sig, "base64url");
  const expected = mac(cartId, exp);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (parseInt(exp, 36) * 1000 <= now.getTime()) return null;
  return cartId;
}
