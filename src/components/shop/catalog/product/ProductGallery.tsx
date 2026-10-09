"use client";

import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";
import { preload } from "react-dom";
import { cn } from "@/components/shop/ui/cn";
import { pickSources, srcSets, type ImageSource } from "@/lib/media/variants";
import { useShopCopy } from "@/components/shop/i18n/ShopLocale";
import { catalogCopies } from "../_copy";
import { IDENTITY, MAX_SCALE, panBy, zoomAt, type ZoomState } from "./zoom";

export type GalleryImage = {
  id: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  thumb: string;
  card: string;
  large: string;
  blurDataUrl: string | null;
  /** WebP/AVIF widths (null for unprocessed images: card/large WebP only). */
  sources?: ImageSource[] | null;
  /** AVIF of the smallest (320 px) variant, for the thumbnail strip. */
  thumbAvif?: string | null;
};

/**
 * Rendered width of the main image (measured: 358 css px at 390, 720 at 768, 699 at 1440): the page
 * column minus padding on phones/tablets, the 1.35fr grid column next to the details on desktop.
 */
const MAIN_SIZES = "(min-width: 1360px) 700px, (min-width: 1024px) calc(57vw - 70px), (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)";

/**
 * Product gallery: main image (large variant via srcSet), thumbnail strip, arrow-key navigation and a
 * lightbox (<dialog>) with "deep zoom" on the 2000w variant — wheel, pinch, double-click/tap, buttons
 * and keyboard (+ / − / 0), drag to pan, swipe to change photo when not zoomed. No library: CSS
 * transforms driven by pointer events.
 */
export function ProductGallery({ images, title }: { images: GalleryImage[]; title: string }) {
  const t = useShopCopy(catalogCopies).gallery;
  const [index, setIndex] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const count = images.length;
  const go = useCallback((delta: number) => setIndex((i) => (i + delta + count) % count), [count]);
  const current = images[index];

  if (!current) {
    return (
      <div className="grid aspect-[4/3] place-items-center rounded-shop bg-shop-sunken text-sm text-shop-muted">{t.noPhoto}</div>
    );
  }

  const onKey = (e: KeyboardEvent) => {
    if (count < 2) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      go(1);
    }
  };

  const alt = (img: GalleryImage, i: number) => img.alt || `${title} — ${t.counter(i + 1, count)}`;

  return (
    <section aria-roledescription="carousel" aria-label={t.label} onKeyDown={onKey} className="flex flex-col gap-3 sm:gap-4">
      <div className="relative overflow-hidden rounded-shop bg-shop-sunken">
        <button
          type="button"
          onClick={() => dialog.current?.showModal()}
          className="group block w-full cursor-zoom-in"
          aria-label={t.open(index + 1, count)}
          aria-haspopup="dialog"
        >
          <MainImage key={current.id} image={current} alt={alt(current, index)} first={index === 0} />
          <span className="pointer-events-none absolute right-4 bottom-4 grid size-10 place-items-center rounded-shop-control bg-shop-surface/90 text-shop-ink shadow-shop opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 max-lg:opacity-90">
            <ZoomIcon />
          </span>
        </button>
        {count > 1 ? (
          <>
            <ArrowButton side="left" label={t.prev} onClick={() => go(-1)} />
            <ArrowButton side="right" label={t.next} onClick={() => go(1)} />
            <p className="pointer-events-none absolute bottom-4 left-4 rounded-shop-control bg-shop-surface/90 px-3 py-1 font-shop-mono text-xs text-shop-ink tabular-nums" aria-live="polite">
              {t.counter(index + 1, count)}
            </p>
          </>
        ) : null}
      </div>

      {count > 1 ? (
        <ul className="grid grid-cols-5 gap-2 sm:grid-cols-6 sm:gap-3" role="list">
          {images.map((img, i) => (
            <li key={img.id}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-label={t.thumb(i + 1)}
                aria-current={i === index ? "true" : undefined}
                className={cn(
                  "block aspect-square w-full overflow-hidden rounded-shop bg-shop-sunken outline-offset-2 transition-opacity",
                  i === index ? "outline-2 outline-shop-ink" : "opacity-70 hover:opacity-100",
                )}
              >
                <Thumb image={img} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <Lightbox ref={dialog} images={images} index={index} onIndex={setIndex} alt={alt} />
    </section>
  );
}

/**
 * The visible photo. Server-rendered with the first image, so it is in the initial HTML (never hidden
 * until hydration). With AVIF variants it is a <picture>; the first photo is the LCP candidate:
 * `fetchpriority=high` plus a head preload of the AVIF srcset (React does not preload images inside
 * <picture> by itself). No fade-in: the image paints as soon as it is decoded.
 */
function MainImage({ image, alt, first }: { image: GalleryImage; alt: string; first: boolean }) {
  const sets = image.sources?.length ? srcSets(pickSources(image.sources, "wide")) : null;
  if (first && sets?.avif) {
    preload(image.card, { as: "image", imageSrcSet: sets.avif, imageSizes: MAIN_SIZES, type: "image/avif", fetchPriority: "high" });
  }
  const img = (
    // eslint-disable-next-line @next/next/no-img-element -- pre-generated WebP/AVIF variants
    <img
      src={image.card}
      srcSet={sets?.webp ?? `${image.card} 800w, ${image.large} 2000w`}
      sizes={MAIN_SIZES}
      alt={alt}
      width={image.width ?? undefined}
      height={image.height ?? undefined}
      fetchPriority={first ? "high" : undefined}
      decoding="async"
      style={image.blurDataUrl ? { backgroundImage: `url("${image.blurDataUrl}")`, backgroundSize: "cover" } : undefined}
      className="aspect-[4/3] w-full object-contain"
    />
  );
  if (!sets?.avif) return img;
  return (
    <picture className="contents">
      <source type="image/avif" srcSet={sets.avif} sizes={MAIN_SIZES} />
      {img}
    </picture>
  );
}

/** Strip thumbnail (rendered ≤ 110 css px): the 320 px variant, AVIF when available. */
function Thumb({ image }: { image: GalleryImage }) {
  const img = (
    // eslint-disable-next-line @next/next/no-img-element -- pre-generated variants
    <img src={image.thumb} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
  );
  if (!image.thumbAvif) return img;
  return (
    <picture className="contents">
      <source type="image/avif" srcSet={image.thumbAvif} />
      {img}
    </picture>
  );
}

function ArrowButton({ side, label, onClick }: { side: "left" | "right"; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "absolute top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-shop-control bg-shop-surface/90 text-shop-ink shadow-shop transition-colors hover:bg-shop-surface",
        side === "left" ? "left-3" : "right-3",
      )}
    >
      <Chevron dir={side} />
    </button>
  );
}

function Lightbox({
  ref,
  images,
  index,
  onIndex,
  alt,
}: {
  ref: React.RefObject<HTMLDialogElement | null>;
  images: GalleryImage[];
  index: number;
  onIndex: (i: number) => void;
  alt: (img: GalleryImage, i: number) => string;
}) {
  const t = useShopCopy(catalogCopies).gallery;
  const count = images.length;
  // Zoom belongs to one photo: switching photos starts from IDENTITY again.
  const [zoom, setZoom] = useState<{ i: number; z: ZoomState }>({ i: index, z: IDENTITY });
  const z = zoom.i === index ? zoom.z : IDENTITY;
  const setZ = (next: ZoomState | ((s: ZoomState) => ZoomState)) =>
    setZoom((cur) => {
      const base = cur.i === index ? cur.z : IDENTITY;
      return { i: index, z: typeof next === "function" ? next(base) : next };
    });
  const pane = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startX: number; startY: number; dist: number; moved: boolean; lastTap: number }>({ startX: 0, startY: 0, dist: 0, moved: false, lastTap: 0 });

  const box = () => {
    const r = pane.current?.getBoundingClientRect();
    return { width: r?.width ?? 1, height: r?.height ?? 1, left: r?.left ?? 0, top: r?.top ?? 0 };
  };
  const rel = (clientX: number, clientY: number) => {
    const b = box();
    return { x: clientX - b.left - b.width / 2, y: clientY - b.top - b.height / 2 };
  };
  const go = (delta: number) => onIndex((index + delta + count) % count);
  const zoomBy = (factor: number, at?: { x: number; y: number }) => setZ((s) => zoomAt(s, s.scale * factor, at ?? { x: 0, y: 0 }, box()));

  const onWheel = (e: WheelEvent) => {
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025));
    zoomBy(factor, rel(e.clientX, e.clientY));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (pointers.current.size === 1) {
      g.startX = e.clientX;
      g.startY = e.clientY;
      g.moved = false;
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      g.dist = Math.hypot(a.x - b.x, a.y - b.y);
      g.moved = true;
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, next);
    const g = gesture.current;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (g.dist > 0) {
        const mid = rel((a.x + b.x) / 2, (a.y + b.y) / 2);
        const factor = dist / g.dist;
        setZ((s) => zoomAt(s, s.scale * factor, mid, box()));
      }
      g.dist = dist;
      return;
    }
    if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > 6) g.moved = true;
    setZ((s) => (s.scale > 1 ? panBy(s, next.x - prev.x, next.y - prev.y, box()) : s));
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const had = pointers.current.size;
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (had === 2) {
      g.dist = 0;
      return;
    }
    if (had !== 1) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (z.scale === 1 && count > 1 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      go(dx < 0 ? 1 : -1); // swipe
      return;
    }
    if (!g.moved) {
      // Double tap / double click toggles zoom at the point.
      const now = e.timeStamp;
      if (now - g.lastTap < 320) {
        const p = rel(e.clientX, e.clientY);
        setZ((s) => (s.scale > 1 ? IDENTITY : zoomAt(s, 2.5, p, box())));
        g.lastTap = 0;
      } else g.lastTap = now;
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === "ArrowLeft" && count > 1 && z.scale === 1) go(-1);
    else if (e.key === "ArrowRight" && count > 1 && z.scale === 1) go(1);
    else if (e.key === "+" || e.key === "=") zoomBy(1.5);
    else if (e.key === "-" || e.key === "_") zoomBy(1 / 1.5);
    else if (e.key === "0") setZ(IDENTITY);
    else if (z.scale > 1 && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      const step = 60;
      const d = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key as "ArrowLeft"]!;
      setZ((s) => panBy(s, d[0], d[1], box()));
    } else return;
    e.preventDefault();
  };

  const img = images[index];
  return (
    <dialog
      ref={ref}
      aria-label={t.label}
      onKeyDown={onKeyDown}
      onClose={() => setZ(IDENTITY)}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-shop-lightbox p-0 text-shop-on-lightbox backdrop:bg-shop-scrim open:flex open:flex-col"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 sm:px-4">
        <p className="text-sm tabular-nums opacity-80" aria-live="polite">
          {t.counter(index + 1, count)}
        </p>
        <div className="flex items-center gap-1">
          <ToolButton label={t.zoomOut} onClick={() => zoomBy(1 / 1.5)} disabled={z.scale <= 1}>
            −
          </ToolButton>
          <ToolButton label={t.reset} onClick={() => setZ(IDENTITY)} disabled={z.scale <= 1}>
            <span className="text-xs tabular-nums">{Math.round(z.scale * 100)}%</span>
          </ToolButton>
          <ToolButton label={t.zoomIn} onClick={() => zoomBy(1.5)} disabled={z.scale >= MAX_SCALE}>
            +
          </ToolButton>
          <form method="dialog">
            <ToolButton label={t.close} type="submit" autoFocus>
              <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
              </svg>
            </ToolButton>
          </form>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          ref={pane}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className={cn("absolute inset-0 touch-none overflow-hidden select-none", z.scale > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in")}
        >
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element -- 2000w "deep zoom" variant
            <img
              key={img.id}
              src={img.large}
              alt={alt(img, index)}
              // Lazy: the dialog is closed (not rendered) until opened, so the 2000w file is only
              // fetched on open. Without it React preloaded it in <head> on every product page,
              // competing with the LCP photo.
              loading="lazy"
              draggable={false}
              decoding="async"
              style={{
                transform: `translate3d(${z.x}px, ${z.y}px, 0) scale(${z.scale})`,
                ...(img.blurDataUrl && z.scale === 1 ? { backgroundImage: `url("${img.blurDataUrl}")`, backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center" } : {}),
              }}
              className="h-full w-full origin-center object-contain will-change-transform"
            />
          ) : null}
        </div>
        {count > 1 ? (
          <>
            <button type="button" onClick={() => go(-1)} aria-label={t.prev} className="absolute top-1/2 left-2 grid size-11 -translate-y-1/2 place-items-center rounded-shop-control bg-shop-on-lightbox/10 hover:bg-shop-on-lightbox/20 sm:left-4">
              <Chevron dir="left" />
            </button>
            <button type="button" onClick={() => go(1)} aria-label={t.next} className="absolute top-1/2 right-2 grid size-11 -translate-y-1/2 place-items-center rounded-shop-control bg-shop-on-lightbox/10 hover:bg-shop-on-lightbox/20 sm:right-4">
              <Chevron dir="right" />
            </button>
          </>
        ) : null}
      </div>
      <p className="px-4 py-2 text-center text-xs opacity-60">{t.hint}</p>
    </dialog>
  );
}

function ToolButton({ label, children, className, ...rest }: React.ComponentPropsWithoutRef<"button"> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn("grid h-10 min-w-10 place-items-center rounded-shop-control px-2 text-lg hover:bg-shop-on-lightbox/15 disabled:opacity-35", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d={dir === "left" ? "M12.5 4.5L7 10l5.5 5.5" : "M7.5 4.5L13 10l-5.5 5.5"} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ZoomIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="8.5" cy="8.5" r="5" />
      <path d="M12.5 12.5L17 17M8.5 6.5v4M6.5 8.5h4" strokeLinecap="round" />
    </svg>
  );
}
