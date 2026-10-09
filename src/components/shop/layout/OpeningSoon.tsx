import Link from "@/components/shop/ui/Link";
import { pickCopy } from "@/lib/i18n/shop-copy";
import type { ShopContext } from "@/server/storefront/context";
import { NewsletterForm } from "./NewsletterForm";
import { layoutCopies } from "./_copy";

/**
 * Shown instead of every shop page while the shop is still being set up (src/server/storefront/launch.ts).
 * Themed with the shop's own tokens; the shop name (or logo), a short note, the contact email and — when
 * the shop has the newsletter feature — a sign-up so visitors hear when it opens.
 */
export function OpeningSoon({ shop }: { shop: ShopContext }) {
  const t = pickCopy(layoutCopies, shop.locale).openingSoon;
  const { appearance, general, features } = shop.settings;
  return (
    <main id="main" className="grid min-h-dvh place-items-center bg-shop-bg px-6 py-16 text-shop-ink">
      <div className="grid max-w-xl justify-items-center gap-6 text-center">
        {appearance.logoPath ? (
          // eslint-disable-next-line @next/next/no-img-element -- tenant upload, sized by CSS
          <img src={appearance.logoPath} alt="" className="h-16 w-auto object-contain" />
        ) : null}
        <p className="font-shop-mono text-xs tracking-[0.3em] text-shop-muted uppercase">{t.eyebrow}</p>
        <h1 className="font-shop-heading text-4xl leading-tight sm:text-5xl">{shop.shopName}</h1>
        <p className="text-lg text-shop-muted">{t.body}</p>
        {features.newsletter ? (
          <div className="grid w-full gap-2">
            <p className="text-sm text-shop-muted">{t.notify}</p>
            <NewsletterForm source="block" className="w-full" />
          </div>
        ) : null}
        {general.contactEmail ? (
          <p className="text-sm text-shop-muted">
            {t.questions}{" "}
            <a href={`mailto:${general.contactEmail}`} className="text-shop-ink underline underline-offset-2">
              {general.contactEmail}
            </a>
          </p>
        ) : null}
      </div>
    </main>
  );
}

/** Staff-only notice on a shop that is not live yet (English, like the admin). Same bar as the theme-preview ribbon (never both). */
export function NotLiveRibbon() {
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-[60] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-[#1c1a16] px-4 py-1.5 text-center text-xs font-medium text-white"
      style={{ fontFamily: "system-ui, sans-serif" }}
    >
      <span>
        <strong className="font-semibold">Not live yet</strong> · only you can see this shop — visitors see “Opening soon”
      </span>
      <Link href="/admin/setup" prefetch={false} className="underline underline-offset-2">
        Finish setup
      </Link>
    </div>
  );
}
