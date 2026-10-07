import Link from "next/link";
import type { ReactNode } from "react";
import { Container } from "@/components/shop/ui/Container";
import { cn } from "@/components/shop/ui/cn";
import { accountCopy } from "./_copy";
import { logoutCustomerAction } from "./actions";

export type AccountSection = "overview" | "orders" | "addresses" | "wishlist" | "alerts" | "profile" | "privacy";

const t = accountCopy.account.nav;

const NAV: Array<{ key: AccountSection; href: string; label: string }> = [
  { key: "overview", href: "/account", label: t.overview },
  { key: "orders", href: "/account/orders", label: t.orders },
  { key: "wishlist", href: "/wishlist", label: t.wishlist },
  { key: "alerts", href: "/account/alerts", label: t.alerts },
  { key: "addresses", href: "/account/addresses", label: t.addresses },
  { key: "profile", href: "/account/profile", label: t.profile },
  { key: "privacy", href: "/account/privacy", label: t.privacy },
];

/** Account page frame: sidebar navigation on desktop, horizontal tabs on phones. Static (no session read). */
export function AccountShell({ active, title, children }: { active: AccountSection; title: string; children: ReactNode }) {
  return (
    <Container className="py-8 sm:py-12">
      <div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)] md:gap-10">
        <aside>
          <nav aria-label={t.label}>
            <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-col md:overflow-visible md:px-0">
              {NAV.map((n) => (
                <li key={n.key}>
                  <Link
                    href={n.href}
                    aria-current={n.key === active ? "page" : undefined}
                    className={cn(
                      "block rounded-shop-sm px-3 py-2 text-sm whitespace-nowrap",
                      n.key === active ? "bg-shop-primary-soft font-semibold text-shop-primary" : "text-shop-ink-2 hover:bg-shop-sunken",
                    )}
                  >
                    {n.label}
                  </Link>
                </li>
              ))}
              <li className="md:mt-2 md:border-t md:border-shop-line md:pt-2">
                <form action={logoutCustomerAction}>
                  <button type="submit" className="block w-full rounded-shop-sm px-3 py-2 text-left text-sm whitespace-nowrap text-shop-muted hover:bg-shop-sunken">
                    {t.logout}
                  </button>
                </form>
              </li>
            </ul>
          </nav>
        </aside>
        <div className="min-w-0">
          <h1 className="mb-6 text-3xl text-shop-ink sm:text-4xl">{title}</h1>
          {children}
        </div>
      </div>
    </Container>
  );
}

/** Bordered panel used for account sections. */
export function Panel({ title, children, className, action }: { title?: string; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <section className={cn("rounded-shop border border-shop-line bg-shop-surface p-5 sm:p-6", className)}>
      {title || action ? (
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          {title ? <h2 className="text-xl text-shop-ink">{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}
