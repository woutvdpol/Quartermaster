import { getDictionary } from "@/lib/i18n";
import { cx } from "./cx";

const t = getDictionary().ui.thumb;

const sizes = {
  xs: "size-7",
  sm: "size-[38px]",
  md: "size-14",
  lg: "size-24",
  xl: "size-40",
  fill: "aspect-square w-full",
} as const;

export type ThumbSize = keyof typeof sizes;

type ThumbProps = {
  src?: string | null;
  /** Describe the image; pass "" when the thumbnail is decorative (e.g. next to the product title). */
  alt: string;
  size?: ThumbSize;
  /** Short mono text on the placeholder, e.g. "NO IMG" or a count. */
  placeholderLabel?: string;
  className?: string;
};

/** Square product image, or the design's striped placeholder when there is none. */
export function Thumb({ src, alt, size = "sm", placeholderLabel, className }: ThumbProps) {
  const box = cx("shrink-0 overflow-hidden rounded-[4px]", sizes[size], className);
  if (src) {
    return (
      // Plain <img>: media URLs come from tenant storage/CDN with their own sizes.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={alt} loading="lazy" decoding="async" className={cx(box, "bg-panel-3 object-cover")} />
    );
  }
  return (
    <span
      role={alt ? "img" : undefined}
      aria-label={alt ? `${alt} (${t.noImage})` : undefined}
      aria-hidden={alt ? undefined : true}
      className={cx(
        box,
        "grid place-items-center font-mono text-[10px] font-medium text-muted",
        "[background:repeating-linear-gradient(135deg,var(--qm-img-a)_0_6px,var(--qm-img-b)_6px_12px)]",
      )}
    >
      {placeholderLabel}
    </span>
  );
}
