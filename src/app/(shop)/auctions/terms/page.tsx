import type { Metadata } from "next";
import { Breadcrumbs, Container } from "@/components/shop/ui";
import { AUCTIONS_PATH, BUILTIN_TERMS_PATH, auctionTermsHref } from "@/components/shop/auctions/server";
import { auctionCopies } from "@/components/shop/auctions/_copy";
import { auctionTermsCopies } from "@/components/shop/auctions/_copy.terms";
import { requireShop } from "@/server/storefront/context";
import { localeRedirect } from "@/server/i18n/locale";
import { shopAlternates } from "@/lib/seo/metadata";
import { pickCopy } from "@/lib/i18n/shop-copy";

/*
 * /auctions/terms — the auction terms bidders accept before their first bid. When the shop publishes a
 * CMS page with slug `auction-terms`, that page is the terms (this route redirects there). Otherwise a
 * built-in summary of the auction rules is shown, clearly marked as a placeholder: the dealer must
 * replace it with their own, legally checked text (docs/auctions-plan.md § Juridisch). Not indexed.
 */

export async function generateMetadata(): Promise<Metadata> {
  const shop = await requireShop();
  const t = pickCopy(auctionTermsCopies, shop.locale);
  return {
    title: t.title,
    description: t.metaDescription(shop.shopName),
    alternates: shopAlternates(shop, BUILTIN_TERMS_PATH),
    robots: { index: false, follow: true },
  };
}

export default async function AuctionTermsPage() {
  const shop = await requireShop();
  const href = await auctionTermsHref(shop.tenant.id);
  if (href !== BUILTIN_TERMS_PATH) await localeRedirect(href);
  const t = { ...pickCopy(auctionCopies, shop.locale), termsPage: pickCopy(auctionTermsCopies, shop.locale) };
  return (
    <Container size="narrow" className="flex flex-col gap-6 py-6 sm:py-10">
      <Breadcrumbs items={[{ label: t.index.title, href: AUCTIONS_PATH }, { label: t.termsPage.title }]} locale={shop.locale} />
      <h1 className="text-[2.25rem] leading-[1.05] tracking-[-0.03em] text-shop-ink sm:text-[2.75rem]">{t.termsPage.title}</h1>
      <p role="note" className="rounded-shop bg-shop-warn-soft px-4 py-3 text-sm text-shop-warn">
        {t.termsPage.placeholder}
      </p>
      <ol className="flex flex-col gap-6">
        {t.termsPage.sections.map((s, i) => (
          <li key={s.title}>
            <h2 className="text-xl text-shop-ink">
              {i + 1}. {s.title}
            </h2>
            <p className="mt-1.5 text-shop-ink-2">{s.body}</p>
          </li>
        ))}
      </ol>
    </Container>
  );
}
