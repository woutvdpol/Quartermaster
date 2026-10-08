import type { CSSProperties } from "react";
import { pickSources, srcSets, type SrcsetProfile } from "@/lib/media/variants";
import { cn } from "./cn";
import { ImagePreload } from "./ImagePreload";
import type { ShopImage } from "./types";

/**
 * Plain <img> for stored images (`/uploads/...`). The upload pipeline produces WebP + AVIF width
 * variants (src/lib/media/variants.ts), so we use `srcset` instead of next/image's optimizer (which
 * would re-encode them). With AVIF variants the image is a `<picture>` (AVIF `<source>`, WebP `<img>`
 * fallback); `profile` limits the offered widths to what the context can use ("card" ≤ 800 px for
 * tiles/cards, "wide" 480–2000 px for hero/gallery/content), and `sizes` must describe the rendered
 * width as exactly as possible — together they decide how many bytes a phone downloads.
 *
 * `priority` = the likely LCP element: eager, `fetchpriority=high`, and a `<link rel=preload>` in the
 * document head (for a plain <img> React does this by itself; inside <picture> it does not, so
 * <ImagePreload> calls `preload()` with the AVIF srcset + type — browsers without AVIF skip that preload
 * and find the <img> as usual). No fade-in or opacity transition on any image: LCP counts the paint of the
 * final image, so an animation would only add render delay. The blur LQIP is painted as background
 * until the image covers it — no JS needed.
 *
 * `fill` makes it cover its (relatively positioned) parent; otherwise it is `w-full h-auto`.
 */
export function ShopImg({
  image,
  sizes = "(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw",
  profile = "card",
  priority = false,
  fill = false,
  fit = "cover",
  className,
}: {
  image: ShopImage;
  sizes?: string;
  profile?: SrcsetProfile;
  priority?: boolean;
  fill?: boolean;
  fit?: "cover" | "contain";
  className?: string;
}) {
  const style: CSSProperties | undefined = image.blurDataUrl
    ? { backgroundImage: `url("${image.blurDataUrl}")`, backgroundSize: "cover", backgroundPosition: "center" }
    : undefined;
  const sources = image.sources?.length ? pickSources(image.sources, profile) : null;
  const sets = sources ? srcSets(sources) : null;
  const srcSet = sets?.webp ?? image.srcSet;
  const img = (
    // eslint-disable-next-line @next/next/no-img-element -- variants are pre-generated; see comment above
    <img
      src={image.src}
      srcSet={srcSet}
      sizes={srcSet ? sizes : undefined}
      alt={image.alt}
      width={image.width ?? undefined}
      height={image.height ?? undefined}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      style={style}
      className={cn(fill ? "absolute inset-0 h-full w-full" : "h-auto w-full", fit === "cover" ? "object-cover" : "object-contain", className)}
    />
  );
  if (!sets?.avif) return img;
  return (
    <>
      {priority ? <ImagePreload href={image.src} srcSet={sets.avif} sizes={sizes} type="image/avif" /> : null}
      <picture className="contents">
        <source type="image/avif" srcSet={sets.avif} sizes={sizes} />
        {img}
      </picture>
    </>
  );
}

/** Blur-only rendering for locked (sensitive, guest) items: the 24px LQIP scaled up and blurred. */
export function LockedImg({ blurDataUrl, className }: { blurDataUrl: string | null; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("absolute inset-0 scale-110 bg-shop-sunken bg-cover bg-center blur-xl", className)}
      style={blurDataUrl ? { backgroundImage: `url("${blurDataUrl}")` } : undefined}
    />
  );
}
