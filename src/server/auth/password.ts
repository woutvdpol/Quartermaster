import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { isLegacyBcrypt, verifyLegacyBcrypt } from "./legacy-bcrypt";

// Format: scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>
// Parameters are stored per hash so they can be raised later without breaking old hashes.
// Legacy: `bcrypt$<$2y$… hash>` (Concept500/Laravel import) is verify-only; needsRehash() is always
// true for it, so every login path replaces it with scrypt after the first successful sign-in.
const DEFAULTS = { N: 2 ** 15, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 256;

function derive(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // maxmem must cover 128 * N * r bytes.
    const maxmem = 256 * (opts.N ?? DEFAULTS.N) * (opts.r ?? DEFAULTS.r);
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, { ...opts, maxmem }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length > MAX_PASSWORD_LENGTH) throw new Error("Password too long");
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, DEFAULTS);
  return ["scrypt", DEFAULTS.N, DEFAULTS.r, DEFAULTS.p, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (password.length > MAX_PASSWORD_LENGTH) return false;
  // Legacy hashes: raw UTF-8 bytes, no NFKC (Laravel hashed exactly what the user typed).
  if (isLegacyBcrypt(stored)) return verifyLegacyBcrypt(password, stored);
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, "base64");
  const key = await derive(password, Buffer.from(saltB64, "base64"), { N: Number(n), r: Number(r), p: Number(p) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** True when a stored hash uses weaker parameters than the current defaults. */
export function needsRehash(stored: string): boolean {
  const [scheme, n, r, p] = stored.split("$");
  return scheme !== "scrypt" || Number(n) < DEFAULTS.N || Number(r) < DEFAULTS.r || Number(p) < DEFAULTS.p;
}

// A real hash of a random password, used to keep timing equal when a user does not exist.
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  return dummyHash;
}
