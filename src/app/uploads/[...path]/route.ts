import { connection } from "next/server";
import { getStorage, isValidKey } from "@/server/media/storage";

// Product image keys are immutable (a new upload always gets a new image id), so they can be cached forever.
const IMMUTABLE_KEY = /^[A-Za-z0-9_-]+\/products\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+(\.[a-z0-9]+|\/[a-z]+\.webp)$/;
const SERVABLE_EXT = /\.(webp|jpe?g|png|avif|gif)$/i;

function notFound() {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}

/**
 * Serves stored uploads: `/uploads/{storageKey}` (see src/server/media/product-images.ts).
 * Works for any StorageDriver; with a public S3/R2 bucket this could redirect instead.
 */
export async function GET(request: Request, ctx: RouteContext<"/uploads/[...path]">) {
  await connection();
  const { path } = await ctx.params;
  const key = path.join("/");
  if (!isValidKey(key) || !SERVABLE_EXT.test(key)) return notFound();

  // TODO(phase 3, shop): products with `blurred = true` must not expose sharp images to guests.
  // Hook here: resolve the product from the key (`{tenantId}/products/{productId}/…`) and, for
  // non-authenticated visitors, serve only the `blur` variant (or 403). Admin previews are unaffected.

  const storage = getStorage();
  const info = await storage.head(key);
  if (!info) return notFound();

  const headers = new Headers({
    "Content-Type": info.contentType,
    ETag: info.etag,
    "Last-Modified": info.lastModified.toUTCString(),
    "Cache-Control": IMMUTABLE_KEY.test(key) ? "public, max-age=31536000, immutable" : "public, max-age=300",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  });

  if (etagMatches(request.headers.get("if-none-match"), info.etag)) {
    return new Response(null, { status: 304, headers });
  }

  const object = await storage.get(key);
  if (!object) return notFound();
  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}

function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === "*") return true;
  return header.split(",").some((tag) => tag.trim().replace(/^W\//, "") === etag);
}
