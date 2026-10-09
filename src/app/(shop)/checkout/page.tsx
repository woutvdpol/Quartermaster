import type { Metadata } from "next";
import Link from "@/components/shop/ui/Link";
import { randomBytes } from "node:crypto";
import { Suspense } from "react";
import { Container } from "@/components/shop/ui/Container";
import { ButtonLink } from "@/components/shop/ui/Button";
import { EmptyState } from "@/components/shop/ui/EmptyState";
import { Skeleton } from "@/components/shop/ui/Skeleton";
import { CheckoutForm } from "@/components/shop/cart/CheckoutForm";
import { CartLineItem } from "@/components/shop/cart/CartLineItem";
import { toCartLineData } from "@/components/shop/cart/lines";
import { cartCopies } from "@/components/shop/cart/_copy";
import { countryOptions } from "@/components/shop/cart/countries";
import { localeHref, shopCopy } from "@/server/i18n/locale";
import { pickCopy } from "@/lib/i18n/shop-copy";
import { requireShop } from "@/server/storefront/context";
import { getLegalLinks } from "@/server/storefront/content";
import { getShopViewer } from "@/server/cart";
import { readCartToken } from "@/server/cart/cookie";
import { getCheckoutContext, quoteCheckout } from "@/server/checkout";
import { loginHref } from "@/server/customer-auth/redirect";

export async function generateMetadata(): Promise<Metadata> {
  const t = (await shopCopy(cartCopies)).checkout;
  return { title: t.metaTitle, robots: { index: false, follow: false } };
}

export default async function CheckoutPage() {
  const t = (await shopCopy(cartCopies)).checkout;
  return (
    <Container className="py-8 sm:py-14">
      <h1 className="mb-6 text-[2.25rem] tracking-tight sm:mb-10 sm:text-5xl">{t.title}</h1>
      <Suspense fallback={<CheckoutSkeleton />}>
        <CheckoutContent />
      </Suspense>
    </Container>
  );
}

function CheckoutSkeleton() {
  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_400px] lg:gap-14">
      <div className="flex flex-col gap-6">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-48 w-full" />
        ))}
      </div>
      <Skeleton className="h-80 w-full" />
    </div>
  );
}

async function CheckoutContent() {
  const shop = await requireShop();
  const locale = shop.locale;
  const t = pickCopy(cartCopies, locale).checkout;
  // Login/register return here in the visitor's language.
  const returnTo = await localeHref("/checkout");
  const tenantId = shop.tenant.id;
  const token = await readCartToken();
  const viewer = await getShopViewer(tenantId);
  const ctx = await getCheckoutContext(tenantId, token, viewer);
  const cart = ctx.cart;

  if (!cart || cart.buyableCount === 0) {
    return (
      <EmptyState
        title={t.emptyTitle}
        action={
          <ButtonLink href="/cart" variant="primary">
            {t.backToCart}
          </ButtonLink>
        }
      >
        {t.emptyText}
      </EmptyState>
    );
  }

  const lines = toCartLineData(cart, { guest: !viewer, blurSensitiveForGuests: shop.settings.legal.blurSensitiveForGuests, showStockCode: shop.settings.catalog.showStockCode });
  const blocked = lines.some((l) => l.state === "taken" || l.state === "unavailable");

  if (ctx.requirements.loginRequired) {
    return (
      <div className="grid items-start gap-10 lg:grid-cols-[1fr_400px] lg:gap-14">
        <section className="border-t border-shop-line pt-7">
          <p className="text-shop-ink-2">{ctx.requirements.loginReason === "sensitive" ? t.loginRequiredSensitive : t.loginRequiredGuestOff}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <ButtonLink href={loginHref(returnTo)} variant="primary">
              {t.login}
            </ButtonLink>
            <ButtonLink href={`/register?next=${encodeURIComponent(returnTo)}`} variant="outline">
              {t.register}
            </ButtonLink>
          </div>
        </section>
        <aside aria-label={t.summary} className="rounded-shop bg-shop-sunken p-5 sm:p-7">
          <h2 className="mb-2 text-xl">{t.summary}</h2>
          <ul className="divide-y divide-shop-line">
            {lines.map((l) => (
              <CartLineItem key={l.productId} line={l} locale={locale} compact />
            ))}
          </ul>
        </aside>
      </div>
    );
  }

  const [quote, legalLinks] = await Promise.all([
    ctx.defaultCountry
      ? quoteCheckout(tenantId, token, { countryCode: ctx.defaultCountry, paymentMethod: ctx.payment.methods[0]?.id ?? null }, { cart })
      : Promise.resolve(null),
    getLegalLinks(tenantId),
  ]);
  const termsHref = legalLinks.find((l) => l.key === "TERMS")?.href ?? (ctx.termsPageSlug ? `/${ctx.termsPageSlug}` : null);

  return (
    <>
      {blocked ? (
        <div role="alert" className="mb-6 rounded-shop border border-shop-warn/30 bg-shop-warn-soft px-4 py-3 text-sm text-shop-warn">
          {t.blocked}{" "}
          <Link href="/cart" className="font-medium underline">
            {t.backToCart}
          </Link>
        </div>
      ) : null}
      <CheckoutForm
        currency={ctx.currency}
        countries={countryOptions(ctx.countries, locale)}
        defaultCountry={ctx.defaultCountry}
        initialQuote={quote}
        payment={ctx.payment}
        ageConfirmation={{ required: ctx.requirements.ageConfirmation, minimumAge: ctx.requirements.minimumAge }}
        termsHref={termsHref}
        newsletterEnabled={ctx.newsletterEnabled}
        viewer={ctx.viewer}
        idempotencyKey={randomBytes(16).toString("base64url")}
        lines={lines}
        disclaimer={ctx.disclaimer}
        loginReturnTo={returnTo}
        contact={{ email: cart.email, reminderConsent: cart.reminderConsent }}
      />
    </>
  );
}
