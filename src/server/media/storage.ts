import "server-only";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";

/**
 * Blob storage abstraction. Keys are POSIX-style relative paths such as
 * `{tenantId}/products/{productId}/{imageId}.jpg`; the same key works for every driver,
 * so switching LocalDriver → S3/R2 needs no changes outside this file.
 */
export interface StorageDriver {
  /** Writes (or overwrites) a blob atomically: readers never see a partial file. */
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Metadata only; null when the key does not exist. */
  head(key: string): Promise<StoredObjectInfo | null>;
  /** Streams a blob; null when the key does not exist. */
  get(key: string): Promise<StoredObject | null>;
  exists(key: string): Promise<boolean>;
  /** Deletes one blob. Missing keys are not an error. */
  delete(key: string): Promise<void>;
  /** Deletes everything under a "directory" prefix (must end with `/`). */
  deletePrefix(prefix: string): Promise<void>;
}

export type StoredObjectInfo = {
  size: number;
  contentType: string;
  lastModified: Date;
  /** Strong validator for HTTP caching (quoted). */
  etag: string;
};

export type StoredObject = StoredObjectInfo & { body: ReadableStream<Uint8Array> };

export class StorageKeyError extends Error {
  constructor(key: string, reason: string) {
    super(`Invalid storage key ${JSON.stringify(key)}: ${reason}`);
  }
}

// ─── Keys ────────────────────────────────────────────────────────────────────

const MAX_KEY_LENGTH = 512;
// Each segment starts with an alphanumeric, so `.`, `..`, dotfiles and temp files are impossible.
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Throws StorageKeyError unless `key` is a safe relative path (no traversal, no absolute, strict charset). */
export function assertValidKey(key: string): void {
  if (typeof key !== "string" || key.length === 0) throw new StorageKeyError(String(key), "empty");
  if (key.length > MAX_KEY_LENGTH) throw new StorageKeyError(key, "too long");
  if (key.startsWith("/")) throw new StorageKeyError(key, "absolute path");
  for (const segment of key.split("/")) {
    if (!SEGMENT.test(segment)) throw new StorageKeyError(key, `bad segment ${JSON.stringify(segment)}`);
  }
}

export function isValidKey(key: string): boolean {
  try {
    assertValidKey(key);
    return true;
  } catch {
    return false;
  }
}

/** A prefix is a valid key followed by `/` (so `deletePrefix("")` can never wipe the bucket). */
export function assertValidPrefix(prefix: string): void {
  if (!prefix.endsWith("/")) throw new StorageKeyError(prefix, "prefix must end with '/'");
  assertValidKey(prefix.slice(0, -1));
}

const CONTENT_TYPES: Record<string, string> = {
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  avif: "image/avif",
  gif: "image/gif",
  pdf: "application/pdf",
};

/** Content type derived from the key's extension (never SVG/HTML: those are not served). */
export function contentTypeForKey(key: string): string {
  const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

// ─── Local filesystem driver ─────────────────────────────────────────────────

/**
 * Stores blobs under a root directory (a Docker volume / Kubernetes PVC in production).
 * The content type is derived from the key's extension, so `put`'s contentType is advisory here.
 */
export class LocalDriver implements StorageDriver {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /** Absolute path for a key, guaranteed to be inside `root`. */
  resolve(key: string): string {
    assertValidKey(key);
    const full = path.resolve(this.root, ...key.split("/"));
    if (!full.startsWith(this.root + path.sep)) throw new StorageKeyError(key, "escapes storage root");
    return full;
  }

  // contentType is derived from the extension on read, so the argument is not persisted here.
  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    void contentType;
    const target = this.resolve(key);
    const dir = path.dirname(target);
    await fs.mkdir(dir, { recursive: true });
    // Same directory → same filesystem → rename is atomic. The leading dot keeps it unservable.
    const tmp = path.join(dir, `.tmp-${randomBytes(8).toString("hex")}`);
    const handle = await fs.open(tmp, "wx", 0o644);
    try {
      await handle.writeFile(body);
      await handle.sync();
    } catch (error) {
      await handle.close().catch(() => {});
      await fs.rm(tmp, { force: true });
      throw error;
    }
    await handle.close();
    try {
      await fs.rename(tmp, target);
    } catch (error) {
      await fs.rm(tmp, { force: true });
      throw error;
    }
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    const full = this.resolve(key);
    try {
      const stat = await fs.stat(full);
      if (!stat.isFile()) return null;
      return {
        size: stat.size,
        contentType: contentTypeForKey(key),
        lastModified: stat.mtime,
        etag: `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async get(key: string): Promise<StoredObject | null> {
    const info = await this.head(key);
    if (!info) return null;
    const stream = createReadStream(this.resolve(key));
    return { ...info, body: Readable.toWeb(stream) as ReadableStream<Uint8Array> };
  }

  async exists(key: string): Promise<boolean> {
    return (await this.head(key)) !== null;
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }

  async deletePrefix(prefix: string): Promise<void> {
    assertValidPrefix(prefix);
    await fs.rm(this.resolve(prefix.slice(0, -1)), { recursive: true, force: true });
  }
}

function isNotFound(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/** Upload root: UPLOADS_DIR (as set in the Dockerfile), UPLOAD_DIR as alias, else `<cwd>/uploads`. */
export function uploadRoot(): string {
  return process.env.UPLOADS_DIR || process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
}

let instance: StorageDriver | null = null;

/**
 * The configured driver (STORAGE_DRIVER, default "local"). Process-wide singleton.
 *
 * Extension point: add `case "s3":` returning an `S3Driver` (S3/R2 via @aws-sdk/client-s3,
 * configured by S3_BUCKET / S3_ENDPOINT / S3_REGION / credentials) implementing StorageDriver.
 * Keys and `/uploads/...` URLs stay the same; the route handler streams from whichever driver
 * is active (or could redirect to a public bucket URL later).
 */
export function getStorage(): StorageDriver {
  if (instance) return instance;
  const driver = (process.env.STORAGE_DRIVER || "local").toLowerCase();
  switch (driver) {
    case "local":
      instance = new LocalDriver(uploadRoot());
      break;
    default:
      throw new Error(`Unsupported STORAGE_DRIVER "${driver}" (supported: local)`);
  }
  return instance;
}

/** Tests only: drop the cached driver (e.g. after changing UPLOADS_DIR) or inject one. */
export function setStorageForTests(driver: StorageDriver | null): void {
  instance = driver;
}
