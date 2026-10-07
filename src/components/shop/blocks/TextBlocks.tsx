import type { BlockData } from "@/server/content/blocks";
import { Container } from "@/components/shop/ui/Container";
import { Markdown } from "@/components/shop/ui/Markdown";
import { ShopImg } from "@/components/shop/ui/ShopImg";
import { cn } from "@/components/shop/ui/cn";
import { CtaLink } from "./CtaLink";
import { emphasis, stripEmphasis } from "./Emphasis";
import { contentImage } from "./images";
import { blocksCopy } from "./_copy";

/** Block heading size shared by the text blocks (h2; `*word*` renders in the accent serif). */
const H2 = "text-[1.75rem] leading-[1.08] tracking-[-0.025em] text-shop-ink sm:text-[2.25rem]";

/**
 * HERO: a large rounded image filling the column, with a surface card overlaid bottom-left that
 * holds title, subtitle and button. Without an image the frame is a sunken panel. (`shopName` is
 * kept in the props for callers; the gallery card shows no eyebrow.)
 */
export function HeroBlock({ data, fallbackImage, isFirst }: { data: BlockData<"HERO">; fallbackImage: string | null; shopName: string; isFirst: boolean }) {
  const img = data.imageKey ? contentImage(data.imageKey) : fallbackImage ? { src: fallbackImage, blurDataUrl: null, alt: "" } : null;
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
          {img ? <ShopImg image={img} fill priority={isFirst} sizes="(min-width: 1360px) 1300px, 100vw" className="-z-10" /> : null}
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
export function TextImageBlock({ data }: { data: BlockData<"TEXT_IMAGE"> }) {
  const right = data.imagePosition === "right";
  return (
    <Container className="grid items-center gap-8 md:grid-cols-2 md:gap-12">
      <div className={cn("relative aspect-[3/2] overflow-hidden rounded-shop bg-shop-line", right && "md:order-2")}>
        {data.imageKey ? <ShopImg image={contentImage(data.imageKey, stripEmphasis(data.title ?? ""))} fill sizes="(min-width: 1360px) 650px, (min-width: 768px) 50vw, 100vw" /> : null}
      </div>
      <div className="flex flex-col gap-4">
        {data.title ? <h2 className="text-[2rem] leading-[1.05] tracking-[-0.03em] text-shop-ink sm:text-[clamp(2rem,3.4vw,2.875rem)]">{emphasis(data.title)}</h2> : null}
        <Markdown source={data.markdown} className="text-[1.0625rem]" />
        {data.cta ? <CtaLink link={data.cta} variant="primary" className="mt-2 self-start" /> : null}
      </div>
    </Container>
  );
}

export function TextCarouselBlock({ data, blockId }: { data: BlockData<"TEXT_CAROUSEL">; blockId: string }) {
  const n = data.imageKeys.length;
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
                <ShopImg image={contentImage(k)} fill sizes="(min-width: 768px) 40vw, 85vw" />
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

export function CtaBlock({ data }: { data: BlockData<"CTA"> }) {
  const img = data.imageKey ? contentImage(data.imageKey) : null;
  return (
    <Container>
      <div className={cn("relative isolate overflow-hidden rounded-shop bg-shop-sunken", img ? "flex min-h-[380px] items-end sm:min-h-[460px]" : "px-6 py-14 text-center sm:px-12 sm:py-18")}>
        {img ? <ShopImg image={img} fill sizes="(min-width: 1360px) 1300px, 100vw" className="-z-10" /> : null}
        <div className={cn(img && "m-3 max-w-[520px] rounded-shop bg-shop-surface p-6 sm:m-6 sm:px-8 sm:py-7")}>
          <h2 className={cn(H2, !img && "mx-auto max-w-2xl")}>{emphasis(data.title)}</h2>
          {data.text ? <p className={cn("mt-3 text-[1.0625rem] text-shop-muted", !img && "mx-auto max-w-xl")}>{data.text}</p> : null}
          <CtaLink link={{ label: data.buttonLabel, href: data.href }} variant="primary" className="mt-6" />
        </div>
      </div>
    </Container>
  );
}

export function GalleryBlock({ data }: { data: BlockData<"GALLERY"> }) {
  if (!data.imageKeys.length) return null;
  return (
    <Container>
      {data.title ? <h2 className={cn(H2, "mb-6 sm:mb-8")}>{emphasis(data.title)}</h2> : null}
      <ul aria-label={data.title ? stripEmphasis(data.title) : blocksCopy.galleryLabel} className="columns-2 gap-3 sm:columns-3 lg:columns-4 [&>li]:mb-3">
        {data.imageKeys.map((k) => (
          <li key={k} className="break-inside-avoid overflow-hidden rounded-shop bg-shop-sunken">
            <a href={`/uploads/${k}`} className="block" target="_blank" rel="noopener">
              <ShopImg image={contentImage(k)} sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw" className="transition-transform duration-500 hover:scale-[1.02]" />
            </a>
          </li>
        ))}
      </ul>
    </Container>
  );
}

/** One or more consecutive TESTIMONIAL blocks, shown together as a scroll-snap slider. */
export function TestimonialsBlock({ items }: { items: BlockData<"TESTIMONIAL">[] }) {
  return (
    <Container>
      <ul aria-label={blocksCopy.testimonialsLabel} tabIndex={items.length > 1 ? 0 : undefined} className={cn("gap-4", items.length > 1 ? "shop-rail auto-cols-[88%] pb-3 sm:auto-cols-[46%] lg:auto-cols-[32%]" : "grid")}>
        {items.map((t, i) => (
          <li key={i} className="flex">
            <figure className={cn("flex w-full flex-col rounded-shop border border-shop-line bg-shop-surface p-6 sm:p-8", items.length === 1 && "mx-auto max-w-2xl text-center")}>
              <blockquote className="flex-1 font-shop-accent text-xl leading-snug text-shop-ink italic sm:text-[1.4rem]">“{t.quote}”</blockquote>
              <figcaption className="mt-5 text-sm font-semibold text-shop-ink-2">
                {t.link ? (
                  <a href={t.link.href} rel={/^https?:/i.test(t.link.href) ? "noopener noreferrer" : undefined} className="underline-offset-4 hover:underline">
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
