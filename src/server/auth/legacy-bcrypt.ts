import { timingSafeEqual } from "node:crypto";

/*
 * bcrypt VERIFICATION for passwords migrated from Concept500 (Laravel, `password_hash()`).
 * Owner decision: no package — implemented here on top of plain JS, verify-only. New hashes are
 * always scrypt (password.ts); a successful legacy verify is followed by a rehash at every login path.
 *
 * Algorithm (Provos & Mazières, "A Future-Adaptable Password Scheme", USENIX 1999; OpenBSD
 * bcrypt.c; OpenWall crypt_blowfish 1.3, which is what PHP uses):
 *
 *   state  = Blowfish initial P-array (18 words) + 4 S-boxes (4×256 words) = hex digits of π
 *   state  = EksExpandKey(state, salt, key)            // salted key schedule
 *   repeat 2^cost: state = ExpandKey(state, key); state = ExpandKey(state, salt)
 *   ctext  = "OrpheanBeholderScryDoubt" (6 big-endian words), Blowfish-ECB encrypted 64×
 *   hash   = "$2y$" + cost + "$" + base64bcrypt(salt 16 bytes → 22 chars) + base64bcrypt(ctext[0..23] → 31 chars)
 *
 * Key: the password's UTF-8 bytes plus a terminating NUL, cycled to 72 bytes (18 words). Anything
 * after byte 72 is ignored — the classic bcrypt truncation; Laravel had the same limit.
 *
 * Prefix semantics
 * - `$2b$` (OpenBSD ≥ 5.5) and `$2y$` (crypt_blowfish/PHP) are identical: correct handling of
 *   bytes ≥ 0x80. Laravel writes `$2y$`.
 * - `$2a$`: in crypt_blowfish ≥ 1.1 (PHP ≥ 5.3.7) "2a" means correct handling PLUS a safety
 *   countermeasure: when the password contains a byte ≥ 0x80 at a position where the old
 *   sign-extension bug (`$2x$`) would have produced a *different* key, bit 16 of P[0] is flipped so
 *   such hashes can never collide with buggy ones. For ASCII passwords $2a$ == $2b$ == $2y$. We
 *   implement exactly that (verified against PHP 8.4, see the tests). Note: OpenBSD before 5.5
 *   also had a length-wraparound bug for passwords ≥ 256 bytes; passwords that long are rejected
 *   by MAX_PASSWORD_LENGTH anyway.
 * - `$2x$` (deliberately buggy) and `$2$` are rejected: Laravel never produced them.
 *
 * Costs outside 4..15 are rejected (cost 15 is already ~32× the Laravel default of 10; a hostile
 * hash in the DB must not be able to pin a CPU for minutes).
 *
 * Performance (Node 24, Apple M-series, see legacy-bcrypt.test.ts "timing"): cost 10 ≈ 60–80 ms,
 * the π tables are computed once per process (~20 ms). The cost loop yields to the event loop
 * every few rounds so one verification never blocks other requests for its full duration.
 */

export const LEGACY_BCRYPT_PREFIX = "bcrypt$";
export const BCRYPT_MIN_COST = 4;
export const BCRYPT_MAX_COST = 15;

const BCRYPT_ALPHABET = "./ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const HASH_RE = /^\$2([aby])\$(\d\d)\$([./A-Za-z0-9]{22})([./A-Za-z0-9]{31})$/;
const ROUNDS_PER_YIELD = 16;

// ─── Blowfish initial state: the fractional hex digits of π ─────────────────

let piWords: Uint32Array | undefined;

/**
 * The first `count` 32-bit words of π's fractional part in hex (0x243F6A88, 0x85A308D3, …), i.e.
 * Blowfish's P-array followed by S-boxes 0..3. Computed with Machin's formula in BigInt fixed point
 * instead of pasting a 1042-word table; the test suite checks the well-known first/last words.
 */
export function piHexWords(count = 18 + 4 * 256): Uint32Array {
  if (piWords && piWords.length >= count) return piWords.subarray(0, count);
  // BigInt() calls instead of literals: the project's TS target predates BigInt literals.
  const [n0, n1, n2, n3, n4, n5, n16, n32, n64, n239] = [0, 1, 2, 3, 4, 5, 16, 32, 64, 239].map(BigInt);
  const mask32 = BigInt(0xffffffff);
  const one = n1 << BigInt(count * 32 + 64); // 64 guard bits
  const arctanInv = (x: bigint) => {
    // arctan(1/x) = Σ (-1)^k / ((2k+1) x^(2k+1))
    const x2 = x * x;
    let term = one / x;
    let sum = term;
    for (let k = n1; term !== n0; k++) {
      term /= x2;
      const t = term / (n2 * k + n1);
      sum = k & n1 ? sum - t : sum + t;
    }
    return sum;
  };
  const pi = n16 * arctanInv(n5) - n4 * arctanInv(n239); // π · 2^bits
  let frac = (pi - n3 * one) >> n64; // fractional part, count*32 bits
  const words = new Uint32Array(count);
  for (let i = count - 1; i >= 0; i--) {
    words[i] = Number(frac & mask32);
    frac >>= n32;
  }
  piWords = words;
  return words;
}

// ─── Blowfish core ──────────────────────────────────────────────────────────

type State = { P: Uint32Array; S: Uint32Array };

function initState(): State {
  const pi = piHexWords();
  return { P: pi.slice(0, 18), S: pi.slice(18) };
}

/** Encrypts lr[off], lr[off+1] in place (16 rounds). */
function encipher(st: State, lr: Uint32Array, off: number) {
  const { P, S } = st;
  let l = lr[off];
  let r = lr[off + 1];
  l ^= P[0];
  for (let i = 1; i <= 16; i += 2) {
    r ^= (((S[l >>> 24] + S[0x100 | ((l >>> 16) & 0xff)]) ^ S[0x200 | ((l >>> 8) & 0xff)]) + S[0x300 | (l & 0xff)]) ^ P[i];
    l ^= (((S[r >>> 24] + S[0x100 | ((r >>> 16) & 0xff)]) ^ S[0x200 | ((r >>> 8) & 0xff)]) + S[0x300 | (r & 0xff)]) ^ P[i + 1];
  }
  lr[off] = r ^ P[17];
  lr[off + 1] = l;
}

/** Big-endian words from `bytes`, cycling through them (bcrypt's "stream to word"). */
function cycleWords(bytes: Uint8Array, count: number): Uint32Array {
  const out = new Uint32Array(count);
  let j = 0;
  for (let i = 0; i < count; i++) {
    let w = 0;
    for (let k = 0; k < 4; k++) {
      w = ((w << 8) | bytes[j]) >>> 0;
      j = (j + 1) % bytes.length;
    }
    out[i] = w;
  }
  return out;
}

/**
 * ExpandKey: P ^= key, then re-encrypt the whole state with a running block, optionally XOR-ing
 * the (cycled) salt words into the block before each encryption. `salt` null = the unsalted variant.
 */
function expand(st: State, keyWords: Uint32Array, salt: Uint32Array | null) {
  const { P, S } = st;
  for (let i = 0; i < 18; i++) P[i] ^= keyWords[i];
  const lr = new Uint32Array(2);
  let s = 0;
  const step = (target: Uint32Array, i: number) => {
    if (salt) {
      lr[0] ^= salt[s];
      lr[1] ^= salt[s + 1];
      s ^= 2; // salt is 4 words: pairs (0,1), (2,3), (0,1), …
    }
    encipher(st, lr, 0);
    target[i] = lr[0];
    target[i + 1] = lr[1];
  };
  for (let i = 0; i < 18; i += 2) step(P, i);
  for (let i = 0; i < 1024; i += 2) step(S, i);
}

/**
 * Key words: `initial` is XOR-ed into P by the salted first ExpandKey, `loop` by every round of the
 * cost loop. They only differ for "$2a$" with the crypt_blowfish safety countermeasure (see header),
 * which crypt_blowfish applies to the initial P[0] only.
 */
function keyWords(password: Uint8Array, variant: "a" | "b" | "y"): { initial: Uint32Array; loop: Uint32Array } {
  const key = new Uint8Array(password.length + 1); // + NUL terminator
  key.set(password);
  const correct = cycleWords(key, 18);
  if (variant !== "a") return { initial: correct, loop: correct };

  // Recompute what the sign-extension bug would have produced; if the bug changes the key in a
  // "non-benign" way (a high byte that was not the first of its word), flip bit 16 of word 0.
  let diff = 0;
  let sign = 0;
  let j = 0;
  for (let i = 0; i < 18; i++) {
    let buggy = 0;
    for (let k = 0; k < 4; k++) {
      const c = key[j];
      const signed = c & 0x80 ? c | 0xffffff00 : c;
      buggy = ((buggy << 8) | signed) >>> 0;
      if (k) sign |= buggy & 0x80;
      j = (j + 1) % key.length;
    }
    diff |= (correct[i] ^ buggy) >>> 0;
  }
  diff = ((diff | (diff >>> 16)) & 0xffff) + 0xffff; // bit 16 set iff the keys differ
  const flip = ((sign << 9) & ~diff & 0x10000) >>> 0;
  const initial = correct.slice();
  initial[0] = (initial[0] ^ flip) >>> 0;
  return { initial, loop: correct };
}

// ─── bcrypt base64 ──────────────────────────────────────────────────────────

function b64Encode(bytes: Uint8Array, length: number): string {
  let out = "";
  let i = 0;
  while (i < length) {
    let c1 = bytes[i++];
    out += BCRYPT_ALPHABET[c1 >> 2];
    c1 = (c1 & 0x03) << 4;
    if (i >= length) {
      out += BCRYPT_ALPHABET[c1];
      break;
    }
    let c2 = bytes[i++];
    c1 |= c2 >> 4;
    out += BCRYPT_ALPHABET[c1];
    c1 = (c2 & 0x0f) << 2;
    if (i >= length) {
      out += BCRYPT_ALPHABET[c1];
      break;
    }
    c2 = bytes[i++];
    c1 |= c2 >> 6;
    out += BCRYPT_ALPHABET[c1] + BCRYPT_ALPHABET[c2 & 0x3f];
  }
  return out;
}

function b64Decode(text: string, length: number): Uint8Array {
  const out = new Uint8Array(length);
  const v = (i: number) => BCRYPT_ALPHABET.indexOf(text[i]);
  let o = 0;
  let i = 0;
  while (o < length) {
    const c1 = v(i++);
    const c2 = v(i++);
    out[o++] = ((c1 << 2) | ((c2 & 0x30) >> 4)) & 0xff;
    if (o >= length) break;
    const c3 = v(i++);
    out[o++] = (((c2 & 0x0f) << 4) | ((c3 & 0x3c) >> 2)) & 0xff;
    if (o >= length) break;
    const c4 = v(i++);
    out[o++] = (((c3 & 0x03) << 6) | c4) & 0xff;
  }
  return out;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export type ParsedBcrypt = { variant: "a" | "b" | "y"; cost: number; salt: string; digest: string };

/** Parses a raw `$2y$10$…` hash (60 chars). Null for anything malformed or out of range. */
export function parseBcrypt(hash: string): ParsedBcrypt | null {
  const m = HASH_RE.exec(hash);
  if (!m) return null;
  const cost = Number(m[2]);
  if (cost < BCRYPT_MIN_COST || cost > BCRYPT_MAX_COST) return null;
  return { variant: m[1] as ParsedBcrypt["variant"], cost, salt: m[3], digest: m[4] };
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Computes the 31-char digest part for a password + parsed setting. */
async function digest(password: Uint8Array, p: ParsedBcrypt): Promise<string> {
  const saltBytes = b64Decode(p.salt, 16);
  const salt = cycleWords(saltBytes, 4);
  const saltKey = cycleWords(saltBytes, 18);
  const key = keyWords(password, p.variant);

  const st = initState();
  expand(st, key.initial, salt);
  const rounds = 2 ** p.cost;
  for (let i = 0; i < rounds; i++) {
    expand(st, key.loop, null);
    expand(st, saltKey, null);
    if ((i + 1) % ROUNDS_PER_YIELD === 0) await yieldToEventLoop();
  }

  // "OrpheanBeholderScryDoubt"
  const ctext = cycleWords(new TextEncoder().encode("OrpheanBeholderScryDoubt"), 6);
  for (let i = 0; i < 64; i++) for (let b = 0; b < 6; b += 2) encipher(st, ctext, b);
  const out = new Uint8Array(24);
  for (let i = 0; i < 6; i++) {
    out[4 * i] = ctext[i] >>> 24;
    out[4 * i + 1] = (ctext[i] >>> 16) & 0xff;
    out[4 * i + 2] = (ctext[i] >>> 8) & 0xff;
    out[4 * i + 3] = ctext[i] & 0xff;
  }
  return b64Encode(out, 23);
}

/** Full `$2y$…` string for a password and a 29-char setting (`$2y$10$` + 22 salt chars). Test helper. */
export async function bcryptWithSetting(password: string | Uint8Array, setting: string): Promise<string | null> {
  const p = parseBcrypt(setting + ".".repeat(31));
  if (!p) return null;
  const bytes = typeof password === "string" ? new TextEncoder().encode(password) : password;
  // The salt's last char only carries 2 bits; re-encode it canonically like crypt_blowfish does.
  const salt = b64Encode(b64Decode(p.salt, 16), 16);
  return `$2${p.variant}$${String(p.cost).padStart(2, "0")}$${salt}${await digest(bytes, p)}`;
}

/**
 * Verifies `password` against a raw bcrypt hash (`$2y$10$…`, also `$2a$`/`$2b$`). Returns false
 * for malformed hashes, unsupported variants/costs and passwords containing NUL (C strings end
 * there, so PHP never hashed such a password the way JS would see it).
 */
export async function verifyBcrypt(password: string | Uint8Array, hash: string): Promise<boolean> {
  const p = parseBcrypt(hash);
  if (!p) return false;
  const bytes = typeof password === "string" ? new TextEncoder().encode(password) : password;
  if (bytes.includes(0)) return false;
  const computed = Buffer.from(await digest(bytes, p), "latin1");
  const expected = Buffer.from(p.digest, "latin1");
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

/** Verifies against the stored form `bcrypt$<60-char hash>` written by the Concept500 ETL. */
export function verifyLegacyBcrypt(password: string, stored: string): Promise<boolean> {
  if (!stored.startsWith(LEGACY_BCRYPT_PREFIX)) return Promise.resolve(false);
  return verifyBcrypt(password, stored.slice(LEGACY_BCRYPT_PREFIX.length));
}

export function isLegacyBcrypt(stored: string): boolean {
  return stored.startsWith(LEGACY_BCRYPT_PREFIX);
}
