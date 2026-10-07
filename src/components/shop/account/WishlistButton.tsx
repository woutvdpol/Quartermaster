"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { useHeaderCounts } from "@/components/shop/layout/HeaderCounts";
import { cn } from "@/components/shop/ui/cn";
import { loginHref } from "@/server/customer-auth/redirect";
import { accountCopy } from "./_copy";
import { getWishlistStateAction, toggleWishlistAction } from "./actions";

/*
 * Heart toggle for product cards and product pages: <WishlistButton productId={p.id} />.
 *
 * Cache-friendly: it renders the same HTML for every visitor (so cached/prerendered product grids
 * stay shareable) and loads "logged in? which ids are saved?" once per page via a server action,
 * shared by all buttons on the page. Guests get a link to /login?next=<this page>.
 */

type Snapshot = { status: "idle" | "loading" | "ready"; loggedIn: boolean; ids: ReadonlySet<string> };

let snapshot: Snapshot = { status: "idle", loggedIn: false, ids: new Set() };
const listeners = new Set<() => void>();
const SERVER_SNAPSHOT: Snapshot = snapshot;

function emit(next: Snapshot) {
  snapshot = next;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function load(force = false) {
  if (!force && snapshot.status !== "idle") return;
  emit({ ...snapshot, status: "loading" });
  getWishlistStateAction()
    .then((s) => emit({ status: "ready", loggedIn: s.loggedIn, ids: new Set(s.productIds) }))
    .catch(() => emit({ status: "ready", loggedIn: false, ids: new Set() }));
}

function setSaved(productId: string, on: boolean) {
  const ids = new Set(snapshot.ids);
  if (on) ids.add(productId);
  else ids.delete(productId);
  emit({ ...snapshot, ids });
}

/** Refresh the shared wishlist state (e.g. after login/logout without a full reload). */
export function refreshWishlistState() {
  if (snapshot.status !== "idle") load(true);
}

function Heart({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" className="shrink-0">
      <path
        d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.5 4.5 7 4.5c2 0 3.5 1.1 5 3 1.5-1.9 3-3 5-3 3.5 0 5.6 3.5 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function WishlistButton({
  productId,
  variant = "icon",
  className,
}: {
  productId: string;
  /** "icon": round overlay button (cards). "outline": round bordered icon button next to other buttons. "full": button with label. */
  variant?: "icon" | "outline" | "full";
  className?: string;
}) {
  const t = accountCopy.wishlist;
  const state = useSyncExternalStore(subscribe, () => snapshot, () => SERVER_SNAPSHOT);
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);
  const { setCounts } = useHeaderCounts();

  useEffect(() => load(), []);

  const saved = state.ids.has(productId);
  const label = saved ? t.remove : t.add;
  const base =
    variant === "icon"
      ? "inline-flex size-11 items-center justify-center rounded-shop-control bg-shop-surface text-shop-ink shadow-shop transition-colors hover:text-shop-accent"
      : variant === "outline"
        ? "inline-flex size-13 shrink-0 items-center justify-center rounded-shop-control border border-shop-line-strong bg-shop-surface text-shop-ink transition-colors hover:border-shop-ink hover:text-shop-accent"
        : "inline-flex h-12 items-center justify-center gap-2 rounded-shop-control border border-shop-line-strong bg-shop-surface px-5 text-[0.95rem] font-semibold text-shop-ink transition-colors hover:border-shop-ink";

  if (state.status === "ready" && !state.loggedIn) {
    return (
      <Link href={loginHref(pathname)} className={cn(base, className)} aria-label={t.loginToSave} title={t.loginToSave} rel="nofollow">
        <Heart filled={false} />
        {variant === "full" ? <span>{t.save}</span> : null}
      </Link>
    );
  }

  const onClick = () => {
    if (state.status !== "ready") return;
    const next = !saved;
    setError(false);
    setSaved(productId, next); // optimistic
    startTransition(async () => {
      const res = await toggleWishlistAction(productId, next).catch(() => null);
      if (!res || !res.ok) {
        setSaved(productId, !next);
        setError(true);
        if (res && !res.ok && res.error === "unauthenticated") load(true);
        return;
      }
      setCounts({ wishlist: snapshot.ids.size });
      if (pathname === "/wishlist" || pathname.startsWith("/account")) router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={saved}
      aria-label={variant !== "full" ? label : undefined}
      title={error ? t.error : label}
      aria-disabled={state.status !== "ready" || pending || undefined}
      className={cn(base, saved && "text-shop-accent", state.status !== "ready" && "opacity-70", className)}
    >
      <Heart filled={saved} />
      {variant === "full" ? <span>{saved ? t.saved : t.save}</span> : null}
      {error ? (
        <span role="alert" className="sr-only">
          {t.error}
        </span>
      ) : null}
    </button>
  );
}
