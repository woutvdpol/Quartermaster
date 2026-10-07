import Link from "next/link";
import { getShopCustomer } from "@/server/customer-auth";
import { accountCopy } from "./_copy";
import { AccountMenuDropdown } from "./AccountMenuDropdown";
import { WishlistSessionSync } from "./WishlistSessionSync";

/*
 * Header account control. Reads the session, so mount it inside <Suspense fallback={<AccountMenuFallback />}>
 * (it must not sit inside a "use cache" scope). Guests see "Log in"; customers get a dropdown with
 * account links and logout. A staff session on the shop host counts as a guest here.
 */

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20.5c1.4-3.8 4.4-5.5 8-5.5s6.6 1.7 8 5.5" strokeLinecap="round" />
    </svg>
  );
}

const linkClass =
  "inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-shop-control px-2.5 text-sm font-medium text-shop-ink hover:bg-shop-sunken";

export async function AccountMenu() {
  const c = await getShopCustomer();
  const t = accountCopy.menu;
  if (!c) {
    return (
      <>
        <WishlistSessionSync customerId={null} />
        <Link href="/login" className={linkClass} rel="nofollow">
          <PersonIcon />
          <span className="hidden sm:inline">{t.login}</span>
          <span className="sr-only sm:hidden">{t.login}</span>
        </Link>
      </>
    );
  }
  const name = c.user.name || c.customer.firstName || null;
  return (
    <>
      <WishlistSessionSync customerId={c.customer.id} />
      <AccountMenuDropdown name={name} email={c.user.email} />
    </>
  );
}

/** Static placeholder with the same footprint, for the Suspense fallback. */
export function AccountMenuFallback() {
  return (
    <span className={linkClass} aria-hidden="true">
      <PersonIcon />
    </span>
  );
}
