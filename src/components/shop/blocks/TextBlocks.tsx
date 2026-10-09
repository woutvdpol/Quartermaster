import type { BlockData } from "@/server/content/blocks";
import { Container } from "@/components/shop/ui/Container";
import { Markdown } from "@/components/shop/ui/Markdown";
import { ShopImg } from "@/components/shop/ui/ShopImg";
import { cn } from "@/components/shop/ui/cn";
import { CtaLink } from "./CtaLink";
import { emphasis, stripEmphasis } from "./Emphasis";
import { contentImage } from "./images";
import { localizePath, type ShopLocale } from "@/lib/i18n/shop-locales";
import { pickCopy } from "@/lib/i18n/shop-copy";
import { blocksCopies } from "./_copy";

/** Block heading size shared by the text blocks (h2; `*word*` renders in the accent serif). */
const H2 = "text-[1.75rem] leading-[1.08] tracking-[-0.025em] text-shop-ink sm:text-[2.25rem]";

/**
 * HERO: a large rounded image filling the column, with a surface card overlaid bottom-left that
 * holds title, subtitle and button. Without an image the frame is a sunken panel. (`shopName` is
 * kept in the props for callers; the gallery card shows no eyebrow.)
 */
export async function HeroBlock({ data, fallbackImage, isFirst }: { data: BlockData<"HERO">; fallbackImage: string | null; shopName: string; isFirst: boolean }) {
  const img = data.imageKey ? await contentImage(data.imageKey) : fallbackImage ? { src: fallbackImage, blurDataUrl: null, alt: "" } : null;
  const H = isFirst ? "h1" : "h2";
  return (
    <section className="pt-4 sm:pt-6">
      <Container>
        <div
          className={cn(
            "relative isolate flex items-end overflow-hidden rounded-shop bg-shop-sunken",
            img ? "min-h-[440px] sm:min-h-[560px]" : "min-h-[340px] sm:min-h-[460px]",
          )}
        >
          {img ? <ShopImg image={img} profile="wide" fill priority={isFirst} sizes="(min-width: 1360px) 1296px, (min-width: 1024px) calc(100vw - 64px), (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)" className="-z-10" /> : null}
          <div className="m-3 flex max-w-[520px] flex-col gap-3.5 rounded-shop bg-shop-surface p-6 text-shop-ink sm:m-6 sm:px-8 sm:py-7">
            <H className="text-[clamp(2.1rem,4.2vw,3.5rem)] leading-[1.02] tracking-[-0.03em]">{emphasis(data.title)}</H>
            {data.subtitle ? <p className="text-base text-shop-muted sm:text-[1.0625rem]">{data.subtitle}</p> : null}
            {data.cta ? (
              <div className="mt-1 flex flex-wrap gap-2.5">
                <CtaLink link={data.cta} variant="primary" />
              </div>
            ) : null}
          </div>
        </div>
      </Container>
    </section>
  );
}

export function TextBlock({ data }: { data: BlockData<"TEXT"> }) {
  return (
    <Container size="narrow">
      {data.title ? <h2 className={cn(H2, "mb-5")}>{emphasis(data.title)}</h2> : null}
      <Markdown source={data.markdown} />
      {data.cta ? <CtaLink link={data.cta} className="mt-7" /> : null}
    </Container>
  );
}

export function TextHorizontalBlock({ data }: { data: BlockData<"TEXT_HORIZONTAL"> }) {
  return (
    <Container className="grid gap-6 md:grid-cols-12 md:gap-12">
      <div className="md:col-span-4">{data.title ? <h2 className={cn(H2, "md:sticky md:top-32")}>{emphasis(data.title)}</h2> : null}</div>
      <Markdown source={data.markdown} className="md:col-span-8 md:pt-1.5" />
    </Container>
  );
}

/** Rendered inside a full-bleed sunken band (see BlockRenderer): image and text side by side. */
export async function TextImageBlock({ data }: { data: BlockData<"TEXT_IMAGE"> }) {
  const right = data.imagePosition === "right";
  const img = data.imageKey ? await contentImage(data.imageKey, stripEmphasis(data.title ?? "")) : null;
  return (
    <Container className="grid items-center gap-8 md:grid-cols-2 md:gap-12">
      <div className={cn("relative aspect-[3/2] overflow-hidden rounded-shop bg-shop-line", right && "md:order-2")}>
        {img ? <ShopImg image={img} profile="wide" fill sizes="(min-width: 1360px) 616px, (min-width: 768px) calc(50vw - 48px), calc(100vw - 32px)" /> : null}
      </div>
      <div className="flex flex-col gap-4">
        {data.title ? <h2 className="text-[2rem] leading-[1.05] tracking-[-0.03em] text-shop-ink sm:text-[clamp(2rem,3.4vw,2.875rem)]">{emphasis(data.title)}</h2> : null}
        <Markdown source={data.markdown} className="text-[1.0625rem]" />
        {data.cta ? <CtaLink link={data.cta} variant="primary" className="mt-2 self-start" /> : null}
      </div>
    </Container>
  );
}

export async function TextCarouselBlock({ data, blockId, locale }: { data: BlockData<"TEXT_CAROUSEL">; blockId: string; locale: ShopLocale }) {
  const blocksCopy = pickCopy(blocksCopies, locale);
  const n = data.imageKeys.length;
  const images = await Promise.all(data.imageKeys.map((k) => contentImage(k)));
  return (
    <Container className="grid items-center gap-8 md:grid-cols-12 md:gap-12">
      <div className="md:col-span-5">
        {data.title ? <h2 className={cn(H2, "mb-5")}>{emphasis(data.title)}</h2> : null}
        <Markdown source={data.markdown} />
      </div>
      {n ? (
        <div className="min-w-0 md:col-span-7">
          <ul id={`carousel-${blockId}`} aria-label={blocksCopy.carouselLabel} tabIndex={0} className="shop-rail auto-cols-[85%] gap-3 pb-3 sm:auto-cols-[70%]">
            {data.imageKeys.map((k, i) => (
              <li key={k} aria-label={blocksCopy.slide(i + 1, n)} className="relative aspect-[4/3] overflow-hidden rounded-shop bg-shop-sunken">
                <ShopImg image={images[i]} profile="wide" fill sizes="(min-width: 768px) 40vw, 85vw" />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Container>
  );
}

/** Rendered inside a sunken band (see BlockRenderer). */
export function QuoteBlock({ data }: { data: BlockData<"QUOTE"> }) {
  return (
    <Container size="narrow" className="text-center">
      <figure>
        <blockquote className="font-shop-accent text-[1.75rem] leading-[1.2] text-shop-ink italic sm:text-[2.4rem]">
          <span aria-hidden="true">“</span>
          {data.quote}
          <span aria-hidden="true">”</span>
        </blockquote>
        {data.author ? <figcaption className="mt-6 text-sm font-semibold text-shop-muted">— {data.author}</figcaption> : null}
      </figure>
    </Container>
  );
}

export async function CtaBlock({ data }: { data: BlockData<"CTA"> }) {
  const img = data.imageKey ? await contentImage(data.imageKey) : null;
  return (
    <Container>
      <div className={cn("relative isolate overflow-hidden rounded-shop bg-shop-sunken", img ? "flex min-h-[380px] items-end sm:min-h-[460px]" : "px-6 py-14 text-center sm:px-12 sm:py-18")}>
        {img ? <ShopImg image={img} profile="wide" fill sizes="(min-width: 1360px) 1296px, (min-width: 1024px) calc(100vw - 64px), (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)" className="-z-10" /> : null}
        <div className={cn(img && "m-3 max-w-[520px] rounded-shop bg-shop-surface p-6 sm:m-6 sm:px-8 sm:py-7")}>
          <h2 className={cn(H2, !img && "mx-auto max-w-2xl")}>{emphasis(data.title)}</h2>
          {data.text ? <p className={cn("mt-3 text-[1.0625rem] text-shop-muted", !img && "mx-auto max-w-xl")}>{data.text}</p> : null}
          <CtaLink link={{ label: data.buttonLabel, href: data.href }} variant="primary" className="mt-6" />
        </div>
      </div>
    </Container>
  );
}

export async function GalleryBlock({ data, locale }: { data: BlockData<"GALLERY">; locale: ShopLocale }) {
  const blocksCopy = pickCopy(blocksCopies, locale);
  if (!data.imageKeys.length) return null;
  const images = await Promise.all(data.imageKeys.map((k) => contentImage(k)));
  return (
    <Container>
      {data.title ? <h2 className={cn(H2, "mb-6 sm:mb-8")}>{emphasis(data.title)}</h2> : null}
      <ul aria-label={data.title ? stripEmphasis(data.title) : blocksCopy.galleryLabel} className="columns-2 gap-3 sm:columns-3 lg:columns-4 [&>li]:mb-3">
        {data.imageKeys.map((k, i) => (
          <li key={k} className="break-inside-avoid overflow-hidden rounded-shop bg-shop-sunken">
            <a href={`/uploads/${k}`} className="block" target="_blank" rel="noopener">
              <ShopImg image={images[i]} sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw" className="transition-transform duration-500 hover:scale-[1.02]" />
            </a>
          </li>
        ))}
      </ul>
    </Container>
  );
}

/** One or more consecutive TESTIMONIAL blocks, shown together as a scroll-snap slider. */
export function TestimonialsBlock({ items, locale }: { items: BlockData<"TESTIMONIAL">[]; locale: ShopLocale }) {
  const blocksCopy = pickCopy(blocksCopies, locale);
  return (
    <Container>
      <ul aria-label={blocksCopy.testimonialsLabel} tabIndex={items.length > 1 ? 0 : undefined} className={cn("gap-4", items.length > 1 ? "shop-rail auto-cols-[88%] pb-3 sm:auto-cols-[46%] lg:auto-cols-[32%]" : "grid")}>
        {items.map((t, i) => (
          <li key={i} className="flex">
            <figure className={cn("flex w-full flex-col rounded-shop border border-shop-line bg-shop-surface p-6 sm:p-8", items.length === 1 && "mx-auto max-w-2xl text-center")}>
              <blockquote className="flex-1 font-shop-accent text-xl leading-snug text-shop-ink italic sm:text-[1.4rem]">“{t.quote}”</blockquote>
              <figcaption className="mt-5 text-sm font-semibold text-shop-ink-2">
                {t.link ? (
                  <a href={localizePath(t.link.href, locale)} rel={/^https?:/i.test(t.link.href) ? "noopener noreferrer" : undefined} className="underline-offset-4 hover:underline">
                    {t.author}
                  </a>
                ) : (
                  t.author
                )}
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </Container>
  );
}

/**
 * FAQ: a native <details>/<summary> accordion — works without JavaScript, keyboard and screen-reader
 * accessible by default, and every answer is in the initial HTML (crawlers and AI fetchers read it
 * even while collapsed). Items open independently. Each item has an anchor (`#faq-{block}-{n}`).
 * The FAQPage JSON-LD for the whole page is emitted once by BlockRenderer.
 */
export function FaqBlock({ data, blockId }: { data: BlockData<"FAQ">; blockId: string }) {
  return (
    <Container size="narrow">
      {data.title ? <h2 className={cn(H2, "mb-6 sm:mb-8")}>{emphasis(data.title)}</h2> : null}
      <div className="border-t border-shop-line">
        {data.items.map((it, i) => (
          <details key={i} id={`faq-${blockId}-${i + 1}`} className="group scroll-mt-32 border-b border-shop-line">
            <summary className="flex cursor-pointer list-none items-start justify-between gap-4 py-5 text-[1.0625rem] font-semibold text-shop-ink transition-colors hover:text-shop-primary sm:text-lg [&::-webkit-details-marker]:hidden">
              <span>{it.question}</span>
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                className="mt-1 size-4 shrink-0 text-shop-muted transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              >
                <path d="M10 3v14M3 10h14" />
              </svg>
            </summary>
            <Markdown source={it.answer} className="pr-8 pb-6 text-shop-ink-2" />
          </details>
        ))}
      </div>
    </Container>
  );
}
