"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/*
 * Header badge counts (cart / wishlist) — the stable interface between the shop chrome and the
 * cart/account areas.
 *
 *  Server side: `getHeaderCounts(tenantId)` in src/server/storefront/header-counts.ts feeds
 *               <ServerHeaderCounts> (rendered by the layout inside Suspense).
 *  Client side: `useHeaderCounts()` → { counts, setCounts } to update instantly after a mutation,
 *               e.g. `setCounts({ cart: result.count })` in an add-to-cart form; or render
 *               `<SyncHeaderCounts cart={n} />` from a server component (cart page) to sync.
 */
export type HeaderCountsValue = { cart: number; wishlist: number };

type Ctx = { counts: HeaderCountsValue; setCounts: (patch: Partial<HeaderCountsValue>) => void };

const HeaderCountsContext = createContext<Ctx | null>(null);

export function HeaderCountsProvider({ children }: { children: ReactNode }) {
  const [counts, set] = useState<HeaderCountsValue>({ cart: 0, wishlist: 0 });
  const setCounts = useCallback((patch: Partial<HeaderCountsValue>) => {
    set((prev) => {
      const next = { ...prev, ...patch };
      return next.cart === prev.cart && next.wishlist === prev.wishlist ? prev : next;
    });
  }, []);
  const value = useMemo(() => ({ counts, setCounts }), [counts, setCounts]);
  return <HeaderCountsContext.Provider value={value}>{children}</HeaderCountsContext.Provider>;
}

/** Current header counts + setter. Outside the shop layout it is a harmless no-op. */
export function useHeaderCounts(): Ctx {
  return useContext(HeaderCountsContext) ?? { counts: { cart: 0, wishlist: 0 }, setCounts: () => {} };
}

/** Pushes counts into the header (renders nothing). Re-syncs whenever the props change. */
export function SyncHeaderCounts({ cart, wishlist }: { cart?: number; wishlist?: number }) {
  const { setCounts } = useHeaderCounts();
  useEffect(() => {
    const patch: Partial<HeaderCountsValue> = {};
    if (cart !== undefined) patch.cart = cart;
    if (wishlist !== undefined) patch.wishlist = wishlist;
    setCounts(patch);
  }, [cart, wishlist, setCounts]);
  return null;
}
