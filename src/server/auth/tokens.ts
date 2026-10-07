import { createHash, randomBytes } from "node:crypto";

/** URL-safe random token with 256 bits of entropy. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Tokens are stored hashed so a database leak does not leak usable sessions or reset links. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Recovery codes: 10 chars from an alphabet without look-alikes, shown as xxxxx-xxxxx.
const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function generateRecoveryCode(): string {
  const bytes = randomBytes(10);
  let code = "";
  for (const b of bytes) code += RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length];
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

export function normalizeRecoveryCode(input: string): string {
  const clean = input.toLowerCase().replace(/[^a-z0-9]/g, "");
  return clean.length === 10 ? `${clean.slice(0, 5)}-${clean.slice(5)}` : clean;
}
