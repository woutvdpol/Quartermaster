import { createHmac, timingSafeEqual } from "node:crypto";
import { deriveKey } from "@/server/auth/encryption";

/*
 * Stateless e-mail verification tokens for dealer applications (no token column needed):
 *   <applicationId>.<expires (unix seconds, base36)>.<HMAC-SHA256 tag, 128 bit, base64url>
 * Key: HKDF subkey of APP_ENCRYPTION_KEY ("dealer-application-verify"). Verifying an application is
 * idempotent (emailVerifiedAt is set once), so a replayed link within its lifetime does no harm.
 */

export const APPLICATION_VERIFY_TTL_HOURS = 72;
const TAG_BYTES = 16;

function tag(applicationId: string, exp: string): Buffer {
  return createHmac("sha256", deriveKey("dealer-application-verify"))
    .update(`v1\n${applicationId}\n${exp}`)
    .digest()
    .subarray(0, TAG_BYTES);
}

export function signApplicationToken(applicationId: string, now = Date.now(), ttlHours = APPLICATION_VERIFY_TTL_HOURS): string {
  const exp = Math.floor(now / 1000 + ttlHours * 3600).toString(36);
  return `${applicationId}.${exp}.${tag(applicationId, exp).toString("base64url")}`;
}

/** The application id when the token is authentic and unexpired, else null. */
export function verifyApplicationToken(token: unknown, now = Date.now()): string | null {
  if (typeof token !== "string" || token.length > 200) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [id, exp, sig] = parts;
  if (!/^[a-z0-9]{10,64}$/i.test(id) || !/^[0-9a-z]{1,10}$/.test(exp)) return null;
  const given = Buffer.from(sig, "base64url");
  const expected = tag(id, exp);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (parseInt(exp, 36) * 1000 <= now) return null;
  return id;
}
