import type { Metadata } from "next";
import { Suspense } from "react";
import { Container } from "@/components/shop/ui/Container";
import { ButtonLink } from "@/components/shop/ui/Button";
import { EmptyState } from "@/components/shop/ui/EmptyState";
import { Skeleton } from "@/components/shop/ui/Skeleton";
import { SyncHeaderCounts } from "@/components/shop/layout/HeaderCounts";
import { CartLineItem } from "@/components/shop/cart/CartLineItem";
import { CartSummary } from "@/components/shop/cart/CartSummary";
import { PendingButton } from "@/components/shop/cart/PendingButton";
import { removeUnavailableAction } from "@/components/shop/cart/actions";
import { CheckoutButton } from "@/components/shop/cart/CheckoutButton";
import { CouponForm } from "@/components/shop/cart/CouponForm";
import { RestoreCartPrompt } from "@/components/shop/cart/RestoreCartPrompt";
import { toCartLineData } from "@/components/shop/cart/lines";
import { cartCopies } from "@/components/shop/cart/_copy";
import { countryOptions } from "@/components/shop/cart/countries";
import { localizeServerMessage } from "@/components/shop/cart/server-messages";
import { shopCopy } from "@/server/i18n/locale";
import { pickCopy } from "@/lib/i18n/shop-copy";
import { requireShop } from "@/server/storefront/context";
import { getCart, getShopViewer } from "@/server/cart";
import { readCartToken } from "@/server/cart/cookie";
import { getCheckoutContext, quoteCheckout } from "@/server/checkout";
import { getVisitorDisplayCurrency } from "@/server/rates/display";
import { RecentlyViewed } from "@/components/shop/recent";

export async function generateMetadata(): Promise<Metadata> {
  const t = (await shopCopy(cartCopies)).cart;
  return { title: t.metaTitle, robots: { index: false, follow: false } };
}

export default async function CartPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = (await shopCopy(cartCopies)).cart;
  return (
    <Container className="py-8 sm:py-14">
      <h1 className="mb-6 text-[2.25rem] tracking-tight sm:mb-10 sm:text-5xl">{t.title}</h1>
      <Suspense fallback={null}>
        <Restore searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<CartSkeleton />}>
        <CartContent />
      </Suspense>
    </Container>
  );
}

/** ?restore=<signed token> from the abandoned-cart mail → explicit "Restore my cart" button. */
async function Restore({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const token = (await searchParams).restore;
  if (typeof token !== "string" || token.length > 200) return null;
  return <RestoreCartPrompt token={token} />;
}

function CartSkeleton() {
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_400px] lg:gap-14">
      <div className="flex flex-col gap-6">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

async function CartContent() {
  const shop = await requireShop();
  const locale = shop.locale;
  const copy = pickCopy(cartCopies, locale);
  const t = copy.cart;
  const tenantId = shop.tenant.id;
  const token = await readCartToken();
  const [cart, viewer] = await Promise.all([getCart(tenantId, token), getShopViewer(tenantId)]);

  if (!cart || cart.lines.length === 0) {
    return (
      <>
        <SyncHeaderCounts cart={0} />
        <EmptyState
          title={t.emptyTitle}
          action={
            <ButtonLink href="/shop" variant="primary">
              {t.browse}
            </ButtonLink>
          }
        >
          {t.emptyText}
        </EmptyState>
        <RecentlyViewed
          limit={4}
          columns={shop.settings.catalog.gridColumns}
          display={await getVisitorDisplayCurrency(tenantId)}
          showStockCode={shop.settings.catalog.showStockCode}
          className="mt-12"
        />
      </>
    );
  }

  // The cart was just loaded: hand it on instead of letting both services read it again.
  const [ctx, display] = await Promise.all([getCheckoutContext(tenantId, token, viewer, { cart }), getVisitorDisplayCurrency(tenantId)]);
  const country = ctx.defaultCountry;
  const quote = country ? await quoteCheckout(tenantId, token, { countryCode: country }, { cart }) : null;
  const lines = toCartLineData(cart, { guest: !viewer, blurSensitiveForGuests: shop.settings.legal.blurSensitiveForGuests, showStockCode: shop.settings.catalog.showStockCode });
  const hasUnavailable = lines.some((l) => l.state === "unavailable");
  const canCheckout = cart.buyableCount > 0 && (!quote || quote.minimumShortfall === 0);

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[1fr_400px] lg:gap-14">
      <SyncHeaderCounts cart={cart.lines.length} />
      <section aria-labelledby="cart-items">
        <h2 id="cart-items" className="sr-only">
          {t.itemCount(cart.lines.length)}
        </h2>
        <p className="mb-1 text-sm text-shop-muted">{t.uniqueNote}</p>
        <ul className="divide-y divide-shop-line border-b border-shop-line">
          {lines.map((line) => (
            <CartLineItem key={line.productId} line={line} locale={locale} display={display} />
          ))}
        </ul>
        {hasUnavailable ? (
          <form action={removeUnavailableAction} className="mt-4">
            <PendingButton variant="outline" size="sm" className="h-11! sm:h-9!">
              {t.removeUnavailable}
            </PendingButton>
          </form>
        ) : null}
      </section>

      <aside aria-label={copy.checkout.summary} className="flex flex-col gap-5 rounded-shop bg-shop-sunken p-5 sm:p-7 lg:sticky lg:top-24">
        <h2 className="text-xl">{copy.checkout.summary}</h2>
        <CartSummary
          key={`${cart.couponCode ?? ""}:${cart.subtotal}`}
          subtotal={cart.subtotal}
          currency={cart.currency}
          countries={countryOptions(ctx.countries, locale)}
          initialCountry={country}
          initialQuote={quote}
        />
        <CouponForm
          code={cart.couponCode}
          problem={quote?.coupon && !quote.coupon.ok ? localizeServerMessage(quote.coupon.message, locale) : null}
          hasOfferLines={cart.lines.some((l) => l.offerApplied)}
        />
        <CheckoutButton disabled={!canCheckout} />
        <p className="-mt-1 text-center text-xs text-shop-muted">{t.totalNote}</p>
        <ButtonLink href="/shop" variant="link" size="sm" className="min-h-11 self-center text-shop-ink! no-underline hover:underline">
          {t.continueShopping}
        </ButtonLink>
      </aside>
    </div>
  );
}
