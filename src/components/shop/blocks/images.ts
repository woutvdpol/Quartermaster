import { imageUrl } from "@/server/media/product-images";
import { getStorage } from "@/server/media/storage";
import { readContentManifest } from "@/server/media/store";
import { sourcesFromManifest, type ManifestLike } from "@/lib/media/variants";
import type { ShopImage } from "@/components/shop/ui/types";

/**
 * CMS block image (storage key `{tenantId}/content/...`). Content uploads use the same variant layout
 * as product images (`{base}/{variant}.{webp,avif}`); their manifest (widths, AVIF, blur placeholder)
 * is `{base}/manifest.json`, read once per process (src/server/media/store.ts). Without a manifest
 * (uploads from before round 3 that were not reprocessed) the conventional thumb/card/large WebP are used.
 */
export async function contentImage(key: string, alt = ""): Promise<ShopImage> {
  const manifest = await readContentManifest(getStorage(), key);
  return {
    src: imageUrl(key, "card"),
    srcSet: `${imageUrl(key, "thumb")} 320w, ${imageUrl(key, "card")} 800w, ${imageUrl(key, "large")} 2000w`,
    sources: manifest ? sourcesFromManifest(manifest.variants as ManifestLike) : null,
    blurDataUrl: manifest?.variants.blur?.dataUrl ?? null,
    width: manifest?.width ?? null,
    height: manifest?.height ?? null,
    alt,
  };
}
