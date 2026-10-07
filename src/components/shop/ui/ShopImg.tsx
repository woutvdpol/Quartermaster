import type { CSSProperties } from "react";
import { cn } from "./cn";
import type { ShopImage } from "./types";

/**
 * Plain <img> for stored images (`/uploads/...`). The upload pipeline already produces WebP width
 * variants (thumb 320w · card 800w · large 2000w), so we use `srcSet` instead of next/image's
 * optimizer (which would re-encode them). The blur LQIP is painted as background until the image
 * covers it — no JS needed.
 *
 * `fill` makes it cover its (relatively positioned) parent; otherwise it is `w-full h-auto`.
 */
export function ShopImg({
  image,
  sizes = "(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw",
  priority = false,
  fill = false,
  fit = "cover",
  className,
}: {
  image: ShopImage;
  sizes?: string;
  priority?: boolean;
  fill?: boolean;
  fit?: "cover" | "contain";
  className?: string;
}) {
  const style: CSSProperties | undefined = image.blurDataUrl
    ? { backgroundImage: `url("${image.blurDataUrl}")`, backgroundSize: "cover", backgroundPosition: "center" }
    : undefined;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- variants are pre-generated; see comment above
    <img
      src={image.src}
      srcSet={image.srcSet}
      sizes={image.srcSet ? sizes : undefined}
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
