import { imageUrl } from "@/server/media/product-images";
import type { ShopImage } from "@/components/shop/ui/types";

/**
 * CMS block image (storage key `{tenantId}/content/...`). Content uploads use the same variant
 * layout as product images (`{base}/{thumb|card|large}.webp`); no inline blur is stored for them.
 */
export function contentImage(key: string, alt = ""): ShopImage {
  return {
    src: imageUrl(key, "card"),
    srcSet: `${imageUrl(key, "thumb")} 320w, ${imageUrl(key, "card")} 800w, ${imageUrl(key, "large")} 2000w`,
    blurDataUrl: null,
    alt,
  };
}
