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
import { toCartLineData } from "@/components/shop/cart/lines";
import { cartCopy } from "@/components/shop/cart/_copy";
import { requireShop } from "@/server/storefront/context";
import { getCart, getShopViewer } from "@/server/cart";
import { readCartToken } from "@/server/cart/cookie";
import { getCheckoutContext, quoteCheckout } from "@/server/checkout";
import { countryName } from "@/server/shipping/countries";

const t = cartCopy.cart;

export const metadata: Metadata = { title: t.metaTitle, robots: { index: false, follow: false } };

export default function CartPage() {
  return (
    <Container className="py-8 sm:py-12">
      <h1 className="mb-6 text-3xl sm:text-4xl">{t.title}</h1>
      <Suspense fallback={<CartSkeleton />}>
        <CartContent />
      </Suspense>
    </Container>
  );
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
      </>
    );
  }

  const ctx = await getCheckoutContext(tenantId, token, viewer);
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
            <CartLineItem key={line.productId} line={line} />
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
          subtotal={cart.subtotal}
          currency={cart.currency}
          countries={ctx.countries.map((c) => ({ code: c, name: countryName(c) })).sort((a, b) => a.name.localeCompare(b.name, "en"))}
          initialCountry={country}
          initialQuote={quote}
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
