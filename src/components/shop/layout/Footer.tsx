import Link from "next/link";
import type { PublicMenuItem } from "@/server/content/menus";
import type { LegalLink } from "@/server/storefront/content";
import type { ShopContext } from "@/server/storefront/context";
import { Container } from "@/components/shop/ui/Container";
import { ARCHIVE_PATH } from "@/server/storefront-catalog/urls";
import { MenuLink } from "./MenuLink";
import { NewsletterForm } from "./NewsletterForm";
import { layoutCopy } from "./_copy";

const t = layoutCopy.footer;

/**
 * Footer ("gallery"): thin top rule, optional newsletter strip, then columns: brand + business
 * details, one column per FOOTER menu root, legal links. Below: the footer disclaimer and credits.
 */
export function Footer({ shop, menu, legalLinks }: { shop: ShopContext; menu: PublicMenuItem[]; legalLinks: LegalLink[] }) {
  const { general, legal, features } = shop.settings;
  const addressLines = [general.address.line1, general.address.line2, [general.address.postalCode, general.address.city].filter(Boolean).join(" ")].filter(Boolean);
  const year = new Date().getFullYear();
  // Footer roots are column headings; a root with a link but no children becomes a one-link column.
  const columns = menu.map((item) => ({ item, links: item.children.length ? item.children : item.href ? [item] : [] }));
  const link = "text-shop-muted transition-colors hover:text-shop-ink";
  // Sold archive (docs/sold-archive.md): a default link unless the dealer's footer menu already has one.
  const hasArchiveLink = (items: PublicMenuItem[]): boolean => items.some((i) => i.href === ARCHIVE_PATH || hasArchiveLink(i.children));
  const archiveLink = shop.settings.catalog.publicArchive && !hasArchiveLink(menu);
  const heading = "mb-3 text-sm font-semibold text-shop-ink";

  return (
    <footer className="mt-16 border-t border-shop-line text-sm text-shop-muted lg:mt-20">
      {features.newsletter ? (
        // One sign-up per page: a NEWSLETTER_SIGNUP block in the page content hides this strip.
        <Container className="border-b border-shop-line py-8 sm:py-10 [.shop-root:has([data-newsletter-block])_&]:hidden">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between md:gap-10">
            <div className="max-w-md">
              <p className="font-shop-heading text-lg font-semibold tracking-[-0.01em] text-shop-ink">{t.newsletterTitle}</p>
              <p className="mt-1">{t.newsletterText}</p>
            </div>
            <NewsletterForm source="footer" className="w-full md:max-w-[520px]" />
          </div>
        </Container>
      ) : null}

      <Container className="grid gap-x-8 gap-y-10 pt-10 pb-12 sm:grid-cols-[minmax(0,3fr)_minmax(0,1fr)] sm:pb-14 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,3fr)_minmax(0,1fr)]">
        <div className="sm:col-span-2 lg:col-span-1">
          <p className="font-shop-heading text-[1.05rem] font-bold tracking-[-0.02em] text-shop-ink">{shop.shopName}</p>
          {addressLines.length || general.contactEmail || general.phone ? (
            <address className="mt-3 space-y-0.5 not-italic">
              {addressLines.map((l) => (
                <p key={l}>{l}</p>
              ))}
              {general.contactEmail ? (
                <p className="pt-2">
                  <a href={`mailto:${general.contactEmail}`} className={link}>
                    {general.contactEmail}
                  </a>
                </p>
              ) : null}
              {general.phone ? (
                <p>
                  <a href={`tel:${general.phone.replace(/[^\d+]/g, "")}`} className={link}>
                    {general.phone}
                  </a>
                </p>
              ) : null}
            </address>
          ) : null}
          {archiveLink ? (
            <p className="mt-4">
              <Link href={ARCHIVE_PATH} className={link}>
                {t.soldArchive}
              </Link>
            </p>
          ) : null}
        </div>

        {columns.length ? (
          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-3">
            {columns.map(({ item, links }) => (
              <div key={item.id}>
                <p className={heading}>{item.label}</p>
                <ul className="space-y-2">
                  {links.map((l) => (
                    <li key={l.id}>
                      <MenuLink item={l} className={link} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        ) : (
          <div aria-hidden="true" className="hidden sm:block" />
        )}

        {legalLinks.length ? (
          <nav aria-label={t.legal}>
            <p className={heading}>{t.legal}</p>
            <ul className="space-y-2">
              {legalLinks.map((l) => (
                <li key={l.key}>
                  <Link href={l.href} className={link}>
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </Container>

      {legal.disclaimers.footer ? (
        <Container>
          <p className="border-t border-shop-line py-6 text-xs leading-relaxed whitespace-pre-line">{legal.disclaimers.footer}</p>
        </Container>
      ) : null}

      <Container>
        <div className="flex flex-col gap-2 border-t border-shop-line py-6 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {shop.shopName}. {t.rights}
          </p>
          <p>
            {t.poweredBy} <span className="font-semibold text-shop-ink-2">Quartermaster</span>
          </p>
        </div>
      </Container>
    </footer>
  );
}
