import { createHash, createHmac, randomBytes } from "node:crypto";
import { deriveKey } from "./encryption";

/** URL-safe random token with 256 bits of entropy. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Tokens are stored hashed so a database leak does not leak usable sessions or reset links. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ─── Recovery codes ─────────────────────────────────────────────────────────
//
// 18 characters from a 31-symbol alphabet without look-alikes = 18 · log2(31) ≈ 89 bits, shown as
// xxxxxx-xxxxxx-xxxxxx. Symbols are drawn by rejection sampling (bytes ≥ 248 = 8 · 31 are
// discarded), so every symbol is exactly uniform — no modulo bias.
//
// Storage: "h1:" + HMAC-SHA256(key, compact code) with a key derived from APP_ENCRYPTION_KEY
// (encryption.ts deriveKey). A database dump alone is then useless for brute-forcing codes.
// Codes issued before this change (10 chars, ~49 bits, stored as plain SHA-256 of "xxxxx-xxxxx")
// keep working until they are used or regenerated: lookups also try that legacy form. Users get
// new-style codes the next time they enable 2FA.

const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const RECOVERY_CODE_LENGTH = 18;
const RECOVERY_GROUP = 6;
const LEGACY_RECOVERY_LENGTH = 10;

/** `count` uniform symbols from `alphabet` (rejection sampling over random bytes). */
export function randomSymbols(count: number, alphabet: string, random: (n: number) => Uint8Array = randomBytes): string {
  const limit = 256 - (256 % alphabet.length); // 248 for 31 symbols
  let out = "";
  while (out.length < count) {
    for (const b of random(count * 2)) {
      if (b >= limit) continue;
      out += alphabet[b % alphabet.length];
      if (out.length === count) break;
    }
  }
  return out;
}

function group(compact: string, size: number): string {
  return compact.match(new RegExp(`.{1,${size}}`, "g"))!.join("-");
}

export function generateRecoveryCode(): string {
  return group(randomSymbols(RECOVERY_CODE_LENGTH, RECOVERY_ALPHABET), RECOVERY_GROUP);
}

/** Lower-case, only letters/digits (spaces, dashes and other separators dropped). */
export function compactRecoveryCode(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Normalized display form of user input: grouped when it has a known length, else compact. */
export function normalizeRecoveryCode(input: string): string {
  const clean = compactRecoveryCode(input);
  if (clean.length === RECOVERY_CODE_LENGTH) return group(clean, RECOVERY_GROUP);
  if (clean.length === LEGACY_RECOVERY_LENGTH) return group(clean, 5);
  return clean;
}

/** Stored form of a recovery code. */
export function hashRecoveryCode(code: string): string {
  return `h1:${createHmac("sha256", deriveKey("recovery-codes")).update(compactRecoveryCode(code)).digest("hex")}`;
}

/** Every stored form a submitted code may have (current HMAC; legacy SHA-256 for 10-char codes). */
export function recoveryCodeLookupHashes(input: string): string[] {
  const clean = compactRecoveryCode(input);
  if (clean.length === RECOVERY_CODE_LENGTH) return [hashRecoveryCode(clean)];
  if (clean.length === LEGACY_RECOVERY_LENGTH) return [hashToken(group(clean, 5))];
  return [];
}
