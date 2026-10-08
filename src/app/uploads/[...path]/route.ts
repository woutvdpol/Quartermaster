import { connection } from "next/server";
import { getStorage, isValidKey } from "@/server/media/storage";
import { db } from "@/server/db";
import { canAccessTenant, currentUser } from "@/server/auth/guards";
import { shopCache } from "@/server/storefront/cache";

// Product image keys are immutable (a new upload always gets a new image id; variants are only ever
// added, never rewritten — src/server/media/reprocess.ts), so they can be cached forever. Variants are
// `{imageId}/{name}.webp|avif` (thumb, w480, card, …).
const IMMUTABLE_KEY = /^[A-Za-z0-9_-]+\/products\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+(\.[a-z0-9]+|\/[a-z0-9]+\.(?:webp|avif))$/;
// Content-block images and logos get a random or content-hash suffix on every upload
// (`{tenant}/content/{page}/c<24 hex>.jpg`, `…/hero-<12 hex>.jpg`, `{tenant}/branding/logo-<12 hex>.webp`,
// plus `{base}/{variant}.webp|avif`), so a key never changes content either. Keys without such a suffix keep
// the short cache.
const IMMUTABLE_HASHED_KEY = /^[A-Za-z0-9_-]+\/(content|branding)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]*[a-f0-9]{12}(\.[a-z0-9]+|\/[a-z0-9]+\.(?:webp|avif))$/;
const SERVABLE_EXT = /\.(webp|jpe?g|png|avif|gif)$/i;
// Served by their own access-checked routes (/api/documents, /api/certificates) — never here.
const PRIVATE_KEY = /^[A-Za-z0-9_-]+\/(products\/[A-Za-z0-9_-]+\/docs|certificates)\//;
// Lead photos ("sell your collection"): staff of that tenant only.
const LEAD_KEY = /^([A-Za-z0-9_-]+)\/leads\//;
// Product images: `{tenantId}/products/{productId}/…`; variant files live under `{imageId}/{variant}.webp`.
const PRODUCT_KEY = /^([A-Za-z0-9_-]+)\/products\/([A-Za-z0-9_-]+)\//;

/**
 * Is the product of an image key sensitive (blurred)? Asked for EVERY product image request, so it goes
 * through the data cache (per tenant + product, `catalog` area): product mutations are audited and
 * revalidate the tenant's catalog tag immediately (src/server/storefront/cache.ts), so a product that
 * becomes sensitive is protected at once. Unknown products count as not blurred (the file 404s anyway).
 */
const productIsBlurred = shopCache("image-product-blurred", "catalog", async (tenantId: string, productId: string) => {
  const row = await db.product.findFirst({ where: { id: productId, tenantId }, select: { blurred: true } });
  return row?.blurred ?? false;
});

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
  if (!isValidKey(key) || !SERVABLE_EXT.test(key) || PRIVATE_KEY.test(key)) return notFound();

  let privateCache = false;
  const lead = LEAD_KEY.exec(key);
  if (lead) {
    const user = await currentUser();
    if (!user || user.role === "CUSTOMER" || !canAccessTenant(user, lead[1])) return notFound();
    privateCache = true;
  }

  // Sensitive (blurred) products: visitors without a session of that shop only get the blur variant.
  const product = PRODUCT_KEY.exec(key);
  if (product && !key.endsWith("/blur.webp")) {
    if (await productIsBlurred(product[1], product[2])) {
      const user = await currentUser();
      const allowed = !!user && (user.tenantId === product[1] || canAccessTenant(user, product[1]));
      if (!allowed) return notFound();
      privateCache = true;
    }
  }

  const storage = getStorage();
  const info = await storage.head(key);
  if (!info) return notFound();

  const headers = new Headers({
    "Content-Type": info.contentType,
    ETag: info.etag,
    "Last-Modified": info.lastModified.toUTCString(),
    "Cache-Control": privateCache
      ? "private, no-store"
      : IMMUTABLE_KEY.test(key) || IMMUTABLE_HASHED_KEY.test(key)
        ? "public, max-age=31536000, immutable"
        : "public, max-age=300",
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
