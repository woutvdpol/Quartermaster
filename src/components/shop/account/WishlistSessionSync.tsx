"use client";

import { useEffect } from "react";
import { refreshWishlistState } from "./WishlistButton";

let lastKnown: string | null | undefined;

/**
 * Rendered by AccountMenu with the current customer id (null = guest). When it changes (login,
 * logout, account switch) without a full page load, the shared WishlistButton state is reloaded.
 */
export function WishlistSessionSync({ customerId }: { customerId: string | null }) {
  useEffect(() => {
    if (lastKnown !== undefined && lastKnown !== customerId) refreshWishlistState();
    lastKnown = customerId;
  }, [customerId]);
  return null;
}
