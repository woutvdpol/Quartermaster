import type { Metadata } from "next";
import { ButtonLink, Container, EmptyState } from "@/components/shop/ui";
import { formatMoney } from "@/components/shop/ui/money";
import { AuctionPayForm } from "@/components/shop/auctions/AuctionPayForm";
import { AUCTIONS_PATH } from "@/components/shop/auctions/server";
import { auctionCopies } from "@/components/shop/auctions/_copy";
import { countryOptions } from "@/components/shop/cart/countries";
import { getAuctionPayView, quoteAuctionPayment } from "@/server/auctions/pay";
import { orderStatusPath } from "@/server/checkout/urls";
import { getLegalLinks } from "@/server/storefront/content";
import { requireShop } from "@/server/storefront/context";
import { getShopViewer } from "@/server/storefront/viewer";
import { shopCopy } from "@/server/i18n/locale";
import { formatShopDate, pickCopy } from "@/lib/i18n/shop-copy";
import { auctionPayQuoteAction, payAuctionAction } from "./actions";
import { payAccess } from "../_owner";

/*
 * /auctions/pay/<token> — the winner's personal payment page (link in the "you won" mail; contract:
 * src/server/auctions/pay.ts). The token is the credential, like the offers' checkout link; a signed-in
 * customer must be the winner (../_owner.ts). Hammer price fixed; delivery and payment as in checkout.
 * Never indexed, no referrer (the token is in the URL).
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = (await shopCopy(auctionCopies)).pay;
  return { title: t.metaTitle, robots: { index: false, follow: false }, referrer: "no-referrer" };
}

export default async function AuctionPayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const shop = await requireShop();
  const tenantId = shop.tenant.id;
  const locale = shop.locale;
  const t = pickCopy(auctionCopies, locale).pay;
  const view = /^[A-Za-z0-9._-]{10,120}$/.test(token) ? await getAuctionPayView(tenantId, token) : null;

  const notice = (title: string, body: string, action: { href: string; label: string }) => (
    <Container size="narrow" className="py-14 sm:py-24">
      <EmptyState title={title} action={<ButtonLink href={action.href}>{action.label}</ButtonLink>}>
        {body}
      </EmptyState>
    </Container>
  );

  if (!view) return notice(t.invalidTitle, t.invalidBody, { href: AUCTIONS_PATH, label: t.toAuctions });
  if ((await payAccess(tenantId, view.lot.id)) !== "ok") return notice(t.wrongAccountTitle, t.wrongAccountBody, { href: "/account", label: t.toAccount });
  const orderHref = orderStatusPath(view.order.uuid);
  if (view.state === "paid") return notice(t.paidTitle, t.paidBody, { href: orderHref, label: t.viewOrder });
  if (view.state === "processing") return notice(t.processingTitle, t.processingBody, { href: orderHref, label: t.viewOrder });
  if (view.state === "cancelled") return notice(t.cancelledTitle, t.cancelledBody, { href: AUCTIONS_PATH, label: t.toAuctions });

  const [quote, legalLinks, viewer] = await Promise.all([
    view.defaultCountry
      ? quoteAuctionPayment(tenantId, token, { countryCode: view.defaultCountry, paymentMethod: view.payment.methods[0]?.id ?? null }).catch(() => null)
      : Promise.resolve(null),
    getLegalLinks(tenantId),
    getShopViewer(tenantId),
  ]);
  const termsHref = legalLinks.find((l) => l.key === "TERMS")?.href ?? (view.termsPageSlug ? `/${view.termsPageSlug}` : null);
  const saved = view.addresses.find((a) => a.type === "SHIPPING") ?? view.addresses[0] ?? null;
  const names = (view.customer.name ?? "").trim().split(/\s+/).filter(Boolean);
  const initialValues: Record<string, unknown> = {
    phone: view.customer.phone ?? "",
    shipping: saved
      ? { firstName: saved.firstName, lastName: saved.lastName, company: saved.company ?? "", street: saved.street, houseNumber: saved.houseNumber ?? "", line2: saved.line2 ?? "", postalCode: saved.postalCode ?? "", city: saved.city, region: saved.region ?? "", countryCode: view.defaultCountry ?? "" }
      : { firstName: names[0] ?? "", lastName: names.slice(1).join(" "), countryCode: view.defaultCountry ?? "" },
  };
  const payBy = view.payBy ? formatShopDate(view.payBy, locale, { weekday: "short", day: "numeric", month: "short", year: "numeric" }, shop.tenant.timezone) : null;
  // Sensitive pieces stay blurred for guests, like everywhere in the shop.
  const showImage = view.product.imageUrl && !(view.product.blurred && !viewer && shop.settings.legal.blurSensitiveForGuests);
  const quoteAction = auctionPayQuoteAction.bind(null, token);

  return (
    <Container className="py-8 sm:py-14">
      <h1 className="mb-2 text-[2.1rem] leading-[1.05] tracking-[-0.03em] text-shop-ink sm:text-5xl">{t.title}</h1>
      {payBy ? (
        <p className={view.overdue ? "mb-6 rounded-shop bg-shop-warn-soft px-4 py-3 text-sm text-shop-warn sm:mb-10" : "mb-6 text-shop-ink-2 sm:mb-10"}>
          {view.overdue ? t.overdue(payBy) : t.payBy(payBy)}
        </p>
      ) : (
        <div className="mb-6 sm:mb-10" />
      )}
      <AuctionPayForm
        action={payAuctionAction.bind(null, token)}
        quoteAction={quoteAction}
        currency={view.currency}
        countries={countryOptions(view.countries, locale)}
        defaultCountry={view.defaultCountry}
        initialQuote={quote}
        payment={view.payment}
        termsHref={termsHref}
        email={view.customer.email}
        initialValues={initialValues}
        summary={
          <div className="flex items-center gap-4">
            <span className="relative size-20 shrink-0 overflow-hidden rounded-shop-sm bg-shop-line">
              {showImage ? (
                // eslint-disable-next-line @next/next/no-img-element -- stored card variant
                <img src={view.product.imageUrl!} alt="" className="size-full object-cover" />
              ) : null}
            </span>
            <span className="min-w-0">
              <span className="block font-shop-mono text-xs text-shop-accent">{t.lotLine(view.lot.lotNumber, view.lot.auctionTitle)}</span>
              <span className="line-clamp-2 font-medium text-shop-ink">{view.product.title}</span>
              <span className="text-sm text-shop-ink-2">
                {t.hammer}: <b className="tabular-nums">{formatMoney(view.hammer, view.currency, locale)}</b>
              </span>
            </span>
          </div>
        }
      />
    </Container>
  );
}
