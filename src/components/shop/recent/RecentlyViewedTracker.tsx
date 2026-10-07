"use client";

import { useEffect } from "react";
import { pushRecent } from "./storage";

/** Records a product view in this browser only (localStorage, per shop host). Renders nothing. */
export function RecentlyViewedTracker({ productId }: { productId: string }) {
  useEffect(() => {
    pushRecent(window.location.host, productId);
  }, [productId]);
  return null;
}
