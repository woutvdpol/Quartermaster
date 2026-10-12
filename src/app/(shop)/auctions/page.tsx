import type { Metadata } from "next";
import { formatBidMoney } from "@/components/shop/auctions/lib/money";
import { headers } from "next/headers";
import Link from "@/components/shop/ui/Link";
import { Breadcrumbs, ButtonLink, Container, EmptyState, JsonLd, LockedImg, ShopImg } from "@/components/shop/ui";
import { ServerClock } from "@/components/shop/auctions/AuctionLive";
import { Countdown } from "@/components/shop/auctions/Countdown";
import { displayPrice } from "@/components/shop/auctions/lib/bid-rules";
import { AUCTIONS_PATH, auctionCovers, auctionHref, auctionSlugs, lotCardImage, lotExtras, lotHref } from "@/components/shop/auctions/server";
import { auctionCopies } from "@/components/shop/auctions/_copy";
import { listPublicAuctions, type AuctionSummary } from "@/server/auctions/public";
import { resolveCompliance, visitorCountry } from "@/server/compliance";
import { requireAuctionShop } from "./_load";
import { getShopViewer } from "@/server/storefront/viewer";
import { collectionPageJsonLd } from "@/lib/seo/json-ld";
import { shopAlternates, shopOgDefaults } from "@/lib/seo/metadata";
import { formatShopDate, pickCopy } from "@/lib/i18n/shop-copy";
import { metaDescription } from "@/lib/seo/text";

/*
 * /auctions — overview (design "Catalogue", top level): live auction days, upcoming auctions and the
 * open single lots. Countdowns run on the server clock (one render-time sample; no stream here — each
 * auction page has its own).
 */

const DATE_OPTS: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };

export async function generateMetadata(): Promise<Metadata> {
  const shop = await requireAuctionShop();
  const t = pickCopy(auctionCopies, shop.locale);
  const description = metaDescription(t.index.metaDescription(shop.shopName));
  const alternates = shopAlternates(shop, AUCTIONS_PATH);
  return {
    title: t.index.title,
    description,
    alternates,
    openGraph: { ...shopOgDefaults(shop), url: alternates.canonical, title: t.index.title, description },
  };
}

export default async function AuctionsPage() {
  const shop = await requireAuctionShop();
  const tenantId = shop.tenant.id;
  const t = pickCopy(auctionCopies, shop.locale);
  const { live, upcoming, singles: allSingles } = await listPublicAuctions(tenantId);
  const country = visitorCountry(await headers());
  const [covers, viewer, verdicts, slugs, singleExtras] = await Promise.all([
    auctionCovers(tenantId, [...live, ...upcoming].map((a) => a.id)),
    getShopViewer(tenantId),
    country && allSingles.length ? resolveCompliance(tenantId, allSingles.map((l) => l.productId), country) : Promise.resolve({} as Awaited<ReturnType<typeof resolveCompliance>>),
    auctionSlugs(tenantId, allSingles.map((l) => l.auctionId)),
    lotExtras(tenantId, allSingles.map((l) => l.productId)),
  ]);
  const singles = allSingles.filter((l) => !verdicts[l.productId]?.hidden && slugs[l.auctionId]);
  const lockSensitive = shop.settings.legal.blurSensitiveForGuests && !viewer;
  const serverTime = new Date().toISOString();
  const renderedAt = Date.parse(serverTime);
  const date = (iso: string) => formatShopDate(iso, shop.locale, DATE_OPTS, shop.tenant.timezone);
  const currency = shop.tenant.currency;
  const empty = !live.length && !upcoming.length && !singles.length;

  const card = (a: AuctionSummary, kind: "live" | "upcoming") => {
    const img = lotCardImage(covers[a.id], a.title, { lockSensitive, geoBlurred: false });
    const beforeFirst = Date.parse(a.firstCloseAt) > renderedAt;
    const clock =
      kind === "upcoming"
        ? { label: t.index.opensIn, until: a.opensAt }
        : beforeFirst || !a.lastCloseAt
          ? { label: t.index.nextCloseIn, until: a.firstCloseAt }
          : { label: t.index.endsIn, until: a.lastCloseAt };
    return (
      <li key={a.id} className="min-w-0">
        <Link href={auctionHref(a.slug)} className="group flex h-full flex-col overflow-hidden rounded-shop border border-shop-line bg-shop-surface transition-colors hover:border-shop-line-strong">
          <span className="relative block aspect-[16/10] overflow-hidden bg-shop-sunken">
            {img.image && !img.locked ? <ShopImg image={img.image} fill sizes="(min-width: 1024px) 40rem, 100vw" /> : img.locked ? <LockedImg blurDataUrl={img.image?.blurDataUrl ?? null} /> : null}
          </span>
          <span className="flex flex-1 flex-col gap-2 p-5">
            <span className="font-shop-mono text-xs tracking-[0.12em] text-shop-accent uppercase">{kind === "live" ? t.index.liveNow : t.index.upcoming}</span>
            <span className="text-2xl leading-tight font-semibold tracking-[-0.02em] text-shop-ink group-hover:underline group-hover:underline-offset-4">{a.title}</span>
            <span className="text-sm text-shop-ink-2">
              {t.lots(a.lotCount)} · {kind === "upcoming" ? t.index.opensOn(date(a.opensAt)) : t.index.closeFrom(date(a.firstCloseAt))}
            </span>
            <span className="mt-auto flex items-end justify-between gap-3 pt-3">
              <span className="flex flex-col">
                <span className="text-xs text-shop-muted">{clock.label}</span>
                <Countdown until={clock.until} renderedAt={renderedAt} className="text-xl font-semibold" />
              </span>
              <span className="text-sm font-semibold text-shop-primary">{t.index.viewCatalogue} →</span>
            </span>
          </span>
        </Link>
      </li>
    );
  };

  return (
    <ServerClock serverTime={serverTime}>
      <JsonLd
        data={collectionPageJsonLd({
          origin: shop.origin,
          path: AUCTIONS_PATH,
          name: t.index.title,
          description: t.index.intro,
          locale: shop.locale,
          total: live.length + upcoming.length + singles.length,
          items: [
            ...[...live, ...upcoming].map((a) => ({ href: auctionHref(a.slug), name: a.title })),
            ...singles.map((l) => ({ href: lotHref(slugs[l.auctionId], l.lotNumber), name: l.title })),
          ],
        })}
      />
      <Container className="flex flex-col gap-10 py-6 sm:py-10">
        <div className="flex flex-col gap-4">
          <Breadcrumbs items={[{ label: t.index.title }]} jsonLdBase={shop.origin} locale={shop.locale} />
          <h1 className="text-[2.25rem] leading-[1.05] tracking-[-0.03em] text-shop-ink sm:text-[3rem]">{t.index.title}</h1>
          <p className="max-w-2xl text-shop-ink-2">{t.index.intro}</p>
        </div>

        {empty ? (
          <EmptyState
            title={t.index.emptyTitle}
            action={
              <ButtonLink href="/shop" variant="outline">
                {t.index.browseShop}
              </ButtonLink>
            }
          >
            {t.index.emptyBody}
          </EmptyState>
        ) : null}

        {live.length ? (
          <section aria-labelledby="auctions-live" className="flex flex-col gap-4">
            <h2 id="auctions-live" className="text-2xl text-shop-ink">
              {t.index.liveNow}
            </h2>
            <ul role="list" className="grid gap-5 md:grid-cols-2">
              {live.map((a) => card(a, "live"))}
            </ul>
          </section>
        ) : null}

        {upcoming.length ? (
          <section aria-labelledby="auctions-upcoming" className="flex flex-col gap-4">
            <h2 id="auctions-upcoming" className="text-2xl text-shop-ink">
              {t.index.upcoming}
            </h2>
            <ul role="list" className="grid gap-5 md:grid-cols-2">
              {upcoming.map((a) => card(a, "upcoming"))}
            </ul>
          </section>
        ) : null}

        {singles.length ? (
          <section aria-labelledby="auctions-singles" className="flex flex-col gap-4 border-t border-shop-line pt-8">
            <h2 id="auctions-singles" className="text-2xl text-shop-ink">
              {t.index.singles} <span className="text-base font-normal text-shop-muted">· {t.index.singlesNote}</span>
            </h2>
            <ul role="list" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {singles.map((l) => {
                const img = lotCardImage(singleExtras[l.productId], l.title, { lockSensitive, geoBlurred: verdicts[l.productId]?.blurred ?? false });
                return (
                  <li key={l.id} className="min-w-0">
                    <Link
                      href={lotHref(slugs[l.auctionId], l.lotNumber)}
                      className="group flex items-center gap-3 rounded-shop border border-shop-line p-2.5 pr-4 transition-colors hover:border-shop-line-strong"
                    >
                      <span className="relative size-16 shrink-0 overflow-hidden rounded-shop-sm bg-shop-sunken">
                        {img.image && !img.locked ? <ShopImg image={img.image} fill sizes="4rem" /> : img.locked ? <LockedImg blurDataUrl={img.image?.blurDataUrl ?? null} /> : null}
                      </span>
                      <span className="min-w-0">
                        <b className="line-clamp-2 leading-snug text-shop-ink group-hover:underline group-hover:underline-offset-4">{l.title}</b>
                        <span className="text-sm text-shop-muted">
                          {formatBidMoney(displayPrice(l), currency, shop.locale)} · {l.bidCount ? t.bids(l.bidCount) : t.noBids} ·{" "}
                          <span className="font-shop-mono">
                            <Countdown until={l.closesAt} renderedAt={renderedAt} urgent={false} />
                          </span>
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </Container>
    </ServerClock>
  );
}
