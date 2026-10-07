import Link from "next/link";
import type { PublicMenuItem } from "@/server/content/menus";
import type { LegalLink } from "@/server/storefront/content";
import type { ShopContext } from "@/server/storefront/context";
import { Container } from "@/components/shop/ui/Container";
import { MenuLink } from "./MenuLink";
import { NewsletterForm } from "./NewsletterForm";
import { layoutCopy } from "./_copy";

const t = layoutCopy.footer;

/** Footer: menu columns, newsletter, contact, legal links, footer disclaimer, credits. */
export function Footer({ shop, menu, legalLinks }: { shop: ShopContext; menu: PublicMenuItem[]; legalLinks: LegalLink[] }) {
  const { general, legal, features } = shop.settings;
  const addressLines = [general.address.line1, general.address.line2, [general.address.postalCode, general.address.city].filter(Boolean).join(" ")].filter(Boolean);
  const year = new Date().getFullYear();
  // Footer roots are column headings; a root with a link but no children becomes a one-link column.
  const columns = menu.map((item) => ({ item, links: item.children.length ? item.children : item.href ? [item] : [] }));

  return (
    <footer className="mt-20 bg-shop-primary-strong text-shop-on-primary">
      <Container size="wide" className="grid gap-10 py-14 md:grid-cols-12">
        <div className="md:col-span-4">
          <p className="font-shop-heading text-2xl">{shop.shopName}</p>
          {addressLines.length || general.contactEmail || general.phone ? (
            <address className="mt-4 space-y-0.5 text-sm not-italic opacity-80">
              {addressLines.map((l) => (
                <p key={l}>{l}</p>
              ))}
              {general.contactEmail ? (
                <p className="pt-2">
                  <a href={`mailto:${general.contactEmail}`} className="underline-offset-4 hover:underline">
                    {general.contactEmail}
                  </a>
                </p>
              ) : null}
              {general.phone ? (
                <p>
                  <a href={`tel:${general.phone.replace(/[^\d+]/g, "")}`} className="underline-offset-4 hover:underline">
                    {general.phone}
                  </a>
                </p>
              ) : null}
            </address>
          ) : null}
        </div>

        {columns.length ? (
          <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-3 md:col-span-5">
            {columns.map(({ item, links }) => (
              <div key={item.id}>
                <p className="text-xs font-semibold tracking-[0.14em] uppercase opacity-70">{item.label}</p>
                <ul className="mt-3 space-y-2 text-sm">
                  {links.map((l) => (
                    <li key={l.id}>
                      <MenuLink item={l} className="opacity-90 underline-offset-4 hover:underline hover:opacity-100" />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        ) : (
          <div className="md:col-span-5" />
        )}

        {features.newsletter ? (
          <div className="md:col-span-3">
            <p className="text-xs font-semibold tracking-[0.14em] uppercase opacity-70">{t.newsletterTitle}</p>
            <p className="mt-3 mb-4 text-sm opacity-80">{t.newsletterText}</p>
            <NewsletterForm tone="dark" source="footer" />
          </div>
        ) : null}
      </Container>

      {legal.disclaimers.footer ? (
        <Container size="wide">
          <p className="border-t border-shop-on-primary/15 py-6 text-xs leading-relaxed whitespace-pre-line opacity-70">{legal.disclaimers.footer}</p>
        </Container>
      ) : null}

      <div className="border-t border-shop-on-primary/15">
        <Container size="wide" className="flex flex-col gap-3 py-5 text-xs opacity-75 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {shop.shopName}. {t.rights}
          </p>
          {legalLinks.length ? (
            <nav aria-label={t.legal}>
              <ul className="flex flex-wrap gap-x-5 gap-y-1">
                {legalLinks.map((l) => (
                  <li key={l.key}>
                    <Link href={l.href} className="underline-offset-4 hover:underline">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
          <p>
            {t.poweredBy}{" "}
            <span className="font-semibold">Quartermaster</span>
          </p>
        </Container>
      </div>
    </footer>
  );
}
