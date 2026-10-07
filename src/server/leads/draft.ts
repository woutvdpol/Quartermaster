import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/*
 * Lead drafts. The /sell page issues a signed draft token `{leadId}.{issuedAt}.{sig}` bound to the
 * tenant. Photos are uploaded (before the form is submitted) straight into the lead's final folder
 * `{tenantId}/leads/{leadId}/`, and the lead row is created with that id on submit. The signature
 * stops visitors from choosing ids (e.g. an existing lead's folder); the issue time bounds how long a
 * draft accepts uploads/submission.
 */

export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const SIG_BYTES = 16;
const LEAD_ID = /^ld[A-Za-z0-9]{22}$/;

let cached: { raw: string; key: Buffer } | null = null;

function draftKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error("APP_ENCRYPTION_KEY is not set");
  if (cached?.raw === raw) return cached.key;
  const ikm = Buffer.from(raw, "base64");
  if (ikm.length !== 32) throw new Error("APP_ENCRYPTION_KEY must be 32 bytes (base64)");
  const key = Buffer.from(hkdfSync("sha256", ikm, "quartermaster", "lead-draft-v1", 32));
  cached = { raw, key };
  return key;
}

function mac(tenantId: string, leadId: string, issuedAt: number): Buffer {
  return createHmac("sha256", draftKey()).update(`v1\n${tenantId}\n${leadId}\n${issuedAt}`).digest().subarray(0, SIG_BYTES);
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Random alphanumeric string (rejection sampling, no modulo bias). */
export function randomAlnum(length: number): string {
  let out = "";
  while (out.length < length) {
    for (const b of randomBytes(length * 2)) {
      if (b < 248) out += ALPHABET[b % 62];
      if (out.length === length) break;
    }
  }
  return out;
}

export function newLeadId(): string {
  return `ld${randomAlnum(22)}`;
}

export function isLeadId(id: string): boolean {
  return LEAD_ID.test(id);
}

export function issueDraftToken(tenantId: string, now = Date.now()): string {
  const leadId = newLeadId();
  return `${leadId}.${now.toString(36)}.${mac(tenantId, leadId, now).toString("base64url")}`;
}

/** Returns the lead id of a valid, unexpired draft token for this tenant, else null. */
export function verifyDraftToken(tenantId: string, token: unknown, now = Date.now()): string | null {
  if (typeof token !== "string" || token.length > 120) return null;
  const [leadId, ts, sig, ...rest] = token.split(".");
  if (rest.length || !leadId || !ts || !sig || !isLeadId(leadId) || !/^[0-9a-z]{1,12}$/.test(ts)) return null;
  const issuedAt = parseInt(ts, 36);
  if (!Number.isFinite(issuedAt) || issuedAt > now + 60_000 || now - issuedAt > DRAFT_TTL_MS) return null;
  const given = Buffer.from(sig, "base64url");
  const expected = mac(tenantId, leadId, issuedAt);
  return given.length === expected.length && timingSafeEqual(given, expected) ? leadId : null;
}
