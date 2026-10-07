import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM for small secrets at rest (e.g. TOTP secrets).
// Format: v1.<iv b64url>.<tag b64url>.<ciphertext b64url>
const VERSION = "v1";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function key(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error("APP_ENCRYPTION_KEY is not set");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("APP_ENCRYPTION_KEY must be 32 bytes (base64)");
  return buf;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key(), iv, { authTagLength: TAG_LENGTH });
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decrypt(payload: string): string {
  const parts = payload.split(".");
  // `data` may be "" for an empty plaintext, so check the part count rather than truthiness.
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error("Unsupported ciphertext");
  const [, ivB64, tagB64, data] = parts;
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  // Without a fixed authTagLength, GCM accepts truncated tags (down to 4 bytes), which makes forgery feasible.
  if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) throw new Error("Unsupported ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key(), iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
