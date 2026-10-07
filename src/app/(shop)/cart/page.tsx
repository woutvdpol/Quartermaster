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
import { cartCopy } from "@/components/shop/cart/_copy";
import { requireShop } from "@/server/storefront/context";
import { getCart, getShopViewer } from "@/server/cart";
import { readCartToken } from "@/server/cart/cookie";
import { getCheckoutContext, quoteCheckout } from "@/server/checkout";
import { countryName } from "@/server/shipping/countries";
import { getVisitorDisplayCurrency } from "@/server/rates/display";
import { RecentlyViewed } from "@/components/shop/recent";

const t = cartCopy.cart;

export const metadata: Metadata = { title: t.metaTitle, robots: { index: false, follow: false } };

export default function CartPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Container className="py-8 sm:py-12">
      <h1 className="mb-6 text-3xl sm:text-4xl">{t.title}</h1>
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
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-4">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

async function CartContent() {
  const shop = await requireShop();
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

  const [ctx, display] = await Promise.all([getCheckoutContext(tenantId, token, viewer), getVisitorDisplayCurrency(tenantId)]);
  const country = ctx.defaultCountry;
  const quote = country ? await quoteCheckout(tenantId, token, { countryCode: country }) : null;
  const lines = toCartLineData(cart, { guest: !viewer, blurSensitiveForGuests: shop.settings.legal.blurSensitiveForGuests });
  const hasUnavailable = lines.some((l) => l.state === "unavailable");
  const canCheckout = cart.buyableCount > 0 && (!quote || quote.minimumShortfall === 0);

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[1fr_360px]">
      <SyncHeaderCounts cart={cart.lines.length} />
      <section aria-labelledby="cart-items">
        <h2 id="cart-items" className="sr-only">
          {t.itemCount(cart.lines.length)}
        </h2>
        <p className="mb-2 text-sm text-shop-muted">{t.uniqueNote}</p>
        <ul className="divide-y divide-shop-line border-y border-shop-line">
          {lines.map((line) => (
            <CartLineItem key={line.productId} line={line} display={display} />
          ))}
        </ul>
        {hasUnavailable ? (
          <form action={removeUnavailableAction} className="mt-3">
            <PendingButton variant="outline" size="sm">
              {t.removeUnavailable}
            </PendingButton>
          </form>
        ) : null}
      </section>

      <aside aria-label={cartCopy.checkout.summary} className="flex flex-col gap-5 rounded-shop border border-shop-line bg-shop-surface p-5 shadow-shop lg:sticky lg:top-24">
        <CartSummary
          key={`${cart.couponCode ?? ""}:${cart.subtotal}`}
          subtotal={cart.subtotal}
          currency={cart.currency}
          countries={ctx.countries.map((c) => ({ code: c, name: countryName(c) })).sort((a, b) => a.name.localeCompare(b.name, "en"))}
          initialCountry={country}
          initialQuote={quote}
        />
        <CouponForm
          code={cart.couponCode}
          problem={quote?.coupon && !quote.coupon.ok ? quote.coupon.message : null}
          hasOfferLines={cart.lines.some((l) => l.offerApplied)}
        />
        <CheckoutButton disabled={!canCheckout} />
        <p className="text-xs text-shop-muted">{t.totalNote}</p>
        <ButtonLink href="/shop" variant="link" size="sm" className="self-center">
          {t.continueShopping}
        </ButtonLink>
      </aside>
    </div>
  );
}
