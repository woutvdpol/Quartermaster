"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  getMiniCartAction,
  type MiniCartData,
} from "@/components/shop/cart/mini-cart-action";
import { useHeaderCounts } from "./HeaderCounts";

const loadPanel = () => import("./MiniCartPanel");
// Code-split (performance): the panel markup loads on the first hover/focus, never on touch devices.
const MiniCartPanel = dynamic(() => loadPanel().then((m) => m.MiniCartPanel), { ssr: false });
/** Grace period so the pointer can travel from the button into the panel. */
const CLOSE_DELAY_MS = 180;

/**
 * Hover/focus preview of the cart under the header's cart button (desktop pointers only — on touch
 * the button simply opens /cart). The cart link itself stays a normal link; the panel is extra.
 * Data comes from a read-only server action, loaded on first open and refreshed when the header
 * cart count changes.
 */
export function MiniCart({ children }: { children: ReactNode }) {
  const { counts } = useHeaderCounts();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<MiniCartData | null>(null);
  const [loading, setLoading] = useState(false);
  // Clock for "reserved for N min", captured when the panel opens (render must stay pure).
  const [openedAt, setOpenedAt] = useState(0);
  const loadedFor = useRef<number | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelId = useId();

  const load = useCallback(async () => {
    loadedFor.current = counts.cart;
    setLoading(true);
    try {
      setData(await getMiniCartAction());
    } catch {
      loadedFor.current = null;
    } finally {
      setLoading(false);
    }
  }, [counts.cart]);

  // (Re)load when the panel opens and the cart count changed since the last load.
  useEffect(() => {
    if (open && loadedFor.current !== counts.cart) void load();
  }, [open, counts.cart, load]);

  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    // Only for real hover devices; touch taps go straight to the cart page.
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      void loadPanel();
      setOpenedAt(Date.now());
      setOpen(true);
    }
  };
  const hide = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };
  useEffect(
    () => () => void (closeTimer.current && clearTimeout(closeTimer.current)),
    [],
  );

  return (
    <div
      className="relative"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hide();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      {children}
      {open ? <MiniCartPanel panelId={panelId} data={data} loading={loading} openedAt={openedAt} /> : null}
    </div>
  );
}
