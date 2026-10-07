import type { BlockData } from "@/server/content/blocks";
import { Container } from "@/components/shop/ui/Container";
import { Markdown } from "@/components/shop/ui/Markdown";
import { ShopImg } from "@/components/shop/ui/ShopImg";
import { cn } from "@/components/shop/ui/cn";
import { CtaLink } from "./CtaLink";
import { contentImage } from "./images";
import { blocksCopy } from "./_copy";

export function HeroBlock({ data, fallbackImage, shopName, isFirst }: { data: BlockData<"HERO">; fallbackImage: string | null; shopName: string; isFirst: boolean }) {
  const img = data.imageKey ? contentImage(data.imageKey) : fallbackImage ? { src: fallbackImage, blurDataUrl: null, alt: "" } : null;
  const H = isFirst ? "h1" : "h2";
  return (
    <section className={cn("relative isolate overflow-hidden", img ? "bg-shop-ink text-white" : "bg-shop-primary text-shop-on-primary")}>
      {img ? (
        <>
          <ShopImg image={img} fill priority={isFirst} sizes="100vw" className="-z-10" />
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-t from-black/75 via-black/35 to-black/10" />
        </>
      ) : (
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_80%_20%,var(--shop-secondary)_0,transparent_45%)] opacity-25" />
      )}
      <Container size="wide" className="flex min-h-[min(72vh,620px)] flex-col justify-end py-14 sm:py-20">
        <div className="max-w-2xl">
          <p className="mb-3 text-xs font-semibold tracking-[0.2em] uppercase opacity-80">{shopName}</p>
          <H className="text-4xl leading-[1.05] sm:text-5xl lg:text-6xl">{data.title}</H>
          {data.subtitle ? <p className="mt-5 max-w-xl text-lg opacity-90 sm:text-xl">{data.subtitle}</p> : null}
          {data.cta ? <CtaLink link={data.cta} variant="secondary" size="lg" className="mt-8" /> : null}
        </div>
      </Container>
    </section>
  );
}

export function TextBlock({ data }: { data: BlockData<"TEXT"> }) {
  return (
    <Container size="narrow">
      {data.title ? <h2 className="mb-5 text-3xl text-shop-ink">{data.title}</h2> : null}
      <Markdown source={data.markdown} />
      {data.cta ? <CtaLink link={data.cta} className="mt-7" /> : null}
    </Container>
  );
}

export function TextHorizontalBlock({ data }: { data: BlockData<"TEXT_HORIZONTAL"> }) {
  return (
    <Container className="grid gap-6 md:grid-cols-12 md:gap-10">
      <div className="md:col-span-4">
        {data.title ? <h2 className="text-3xl text-shop-ink md:sticky md:top-32">{data.title}</h2> : null}
        <div aria-hidden="true" className="mt-4 h-0.5 w-12 bg-shop-secondary" />
      </div>
      <Markdown source={data.markdown} className="md:col-span-8" />
    </Container>
  );
}

export function TextImageBlock({ data }: { data: BlockData<"TEXT_IMAGE"> }) {
  const right = data.imagePosition === "right";
  return (
    <Container className="grid items-center gap-8 md:grid-cols-2 md:gap-14">
      <div className={cn("relative aspect-[4/3] overflow-hidden rounded-shop bg-shop-sunken", right && "md:order-2")}>
        {data.imageKey ? <ShopImg image={contentImage(data.imageKey, data.title)} fill sizes="(min-width: 768px) 50vw, 100vw" /> : null}
      </div>
      <div>
        {data.title ? <h2 className="mb-5 text-3xl text-shop-ink">{data.title}</h2> : null}
        <Markdown source={data.markdown} />
        {data.cta ? <CtaLink link={data.cta} className="mt-7" /> : null}
      </div>
    </Container>
  );
}

export function TextCarouselBlock({ data, blockId }: { data: BlockData<"TEXT_CAROUSEL">; blockId: string }) {
  const n = data.imageKeys.length;
  return (
    <Container className="grid items-center gap-8 md:grid-cols-12 md:gap-12">
      <div className="md:col-span-5">
        {data.title ? <h2 className="mb-5 text-3xl text-shop-ink">{data.title}</h2> : null}
        <Markdown source={data.markdown} />
      </div>
      {n ? (
        <div className="md:col-span-7">
          <ul
            id={`carousel-${blockId}`}
            aria-label={blocksCopy.carouselLabel}
            tabIndex={0}
            className="shop-rail auto-cols-[85%] gap-3 rounded-shop pb-3 sm:auto-cols-[70%]"
          >
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

export function QuoteBlock({ data }: { data: BlockData<"QUOTE"> }) {
  return (
    <Container size="narrow" className="text-center">
      <figure>
        <span aria-hidden="true" className="block font-shop-heading text-7xl leading-none text-shop-secondary">
          “
        </span>
        <blockquote className="-mt-4 font-shop-heading text-2xl leading-snug text-shop-ink sm:text-3xl">{data.quote}</blockquote>
        {data.author ? <figcaption className="mt-5 text-sm font-medium tracking-[0.12em] text-shop-muted uppercase">— {data.author}</figcaption> : null}
      </figure>
    </Container>
  );
}

export function CtaBlock({ data }: { data: BlockData<"CTA"> }) {
  const img = data.imageKey ? contentImage(data.imageKey) : null;
  return (
    <Container size="wide">
      <div className={cn("relative isolate overflow-hidden rounded-shop px-6 py-14 text-center sm:px-12 sm:py-20", img ? "bg-shop-ink text-white" : "bg-shop-secondary-soft text-shop-ink")}>
        {img ? (
          <>
            <ShopImg image={img} fill sizes="100vw" className="-z-10" />
            <div aria-hidden="true" className="absolute inset-0 -z-10 bg-black/55" />
          </>
        ) : null}
        <h2 className="mx-auto max-w-2xl text-3xl sm:text-4xl">{data.title}</h2>
        {data.text ? <p className={cn("mx-auto mt-4 max-w-xl text-lg", img ? "opacity-90" : "text-shop-ink-2")}>{data.text}</p> : null}
        <CtaLink link={{ label: data.buttonLabel, href: data.href }} variant={img ? "secondary" : "primary"} size="lg" className="mt-8" />
      </div>
    </Container>
  );
}

export function GalleryBlock({ data }: { data: BlockData<"GALLERY"> }) {
  if (!data.imageKeys.length) return null;
  return (
    <Container size="wide">
      {data.title ? <h2 className="mb-6 text-3xl text-shop-ink">{data.title}</h2> : null}
      <ul aria-label={data.title || blocksCopy.galleryLabel} className="columns-2 gap-3 sm:columns-3 lg:columns-4 [&>li]:mb-3">
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
              <blockquote className="flex-1 text-lg leading-relaxed text-shop-ink-2">“{t.quote}”</blockquote>
              <figcaption className="mt-5 text-sm font-semibold text-shop-ink">
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
