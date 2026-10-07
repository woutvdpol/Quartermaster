"use client";

import Link from "next/link";
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
import { buttonClasses } from "@/components/shop/ui/Button";
import { cn } from "@/components/shop/ui/cn";
import { formatMoney } from "@/components/shop/ui/money";
import { uiCopy } from "@/components/shop/ui/_copy";
import { useHeaderCounts } from "./HeaderCounts";
import { layoutCopy } from "./_copy";

const t = layoutCopy.miniCart;
/** Lines shown in the panel; the rest is summarised as "+ N more". */
const MAX_LINES = 4;
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

  const lines = data?.lines ?? [];
  const shown = lines.slice(0, MAX_LINES);
  const more = lines.length - shown.length;
  const minutesLeft = data?.earliestExpiry
    ? Math.max(
        0,
        Math.ceil(
          (new Date(data.earliestExpiry).getTime() - openedAt) / 60_000,
        ),
      )
    : null;

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
      {open ? (
        <div
          id={panelId}
          role="region"
          aria-label={t.label}
          className="absolute top-full right-0 z-50 w-[22rem] pt-2"
        >
          <div className="overflow-hidden rounded-shop border border-shop-line bg-shop-surface text-shop-ink shadow-shop-pop">
            {loading && !data ? (
              <div className="space-y-3 p-4" aria-busy="true">
                {[0, 1].map((i) => (
                  <div key={i} className="flex gap-3">
                    <div className="h-16 w-13 animate-pulse rounded-shop bg-shop-sunken" />
                    <div className="flex-1 space-y-2 pt-1">
                      <div className="h-3 w-1/3 animate-pulse rounded bg-shop-sunken" />
                      <div className="h-3 w-3/4 animate-pulse rounded bg-shop-sunken" />
                    </div>
                  </div>
                ))}
              </div>
            ) : lines.length === 0 ? (
              <div className="p-5 text-center">
                <p className="font-semibold">{t.empty}</p>
                <p className="mt-1 text-sm text-shop-muted">{t.emptyHint}</p>
                <Link
                  href="/shop"
                  className={buttonClasses("secondary", "sm", "mt-4")}
                >
                  {t.browse}
                </Link>
              </div>
            ) : (
              <>
                <div className="flex items-baseline justify-between border-b border-shop-line px-4 py-3">
                  <p className="font-semibold">
                    {t.title(data?.count ?? lines.length)}
                  </p>
                  {minutesLeft !== null ? (
                    <p className="text-xs text-shop-muted">
                      {t.reserved(minutesLeft)}
                    </p>
                  ) : null}
                </div>
                <ul className="max-h-[22rem] divide-y divide-shop-line overflow-y-auto">
                  {shown.map((l) => (
                    <li key={l.productId}>
                      <Link
                        href={l.href}
                        className="flex gap-3 px-4 py-3 transition-colors hover:bg-shop-sunken"
                      >
                        <span
                          className="relative block h-16 w-13 shrink-0 overflow-hidden rounded-shop bg-shop-sunken bg-cover bg-center"
                          style={
                            l.blurDataUrl
                              ? { backgroundImage: `url("${l.blurDataUrl}")` }
                              : undefined
                          }
                        >
                          {l.imageUrl && !l.locked ? (
                            // eslint-disable-next-line @next/next/no-img-element -- pre-generated thumb variant
                            <img
                              src={l.imageUrl}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              className="absolute inset-0 h-full w-full object-cover"
                            />
                          ) : null}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          {l.stockCode !== null ? (
                            <span className="font-shop-mono text-xs text-shop-accent">
                              {uiCopy.product.stockCode} {l.stockCode}
                            </span>
                          ) : null}
                          <span className="line-clamp-2 text-sm leading-snug font-medium">
                            {l.title}
                          </span>
                          {l.state === "taken" || l.state === "unavailable" ? (
                            <span className="text-xs font-medium text-shop-crit">
                              {l.state === "taken" ? t.taken : t.unavailable}
                            </span>
                          ) : null}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 text-sm font-bold tabular-nums",
                            (l.state === "taken" ||
                              l.state === "unavailable") &&
                              "text-shop-muted line-through",
                          )}
                        >
                          {formatMoney(l.price, l.currency)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {more > 0 ? (
                  <p className="border-t border-shop-line px-4 py-2 text-xs text-shop-muted">
                    {t.more(more)}
                  </p>
                ) : null}
                <div className="space-y-3 border-t border-shop-line bg-shop-sunken px-4 py-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-shop-ink-2">{t.subtotal}</span>
                    <span className="font-bold tabular-nums">
                      {formatMoney(
                        data?.subtotal ?? 0,
                        data?.currency ?? lines[0].currency,
                      )}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Link
                      href="/cart"
                      className={buttonClasses("outline", "sm", "w-full")}
                    >
                      {t.viewCart}
                    </Link>
                    <Link
                      href="/checkout"
                      className={buttonClasses("primary", "sm", "w-full")}
                    >
                      {t.checkout}
                    </Link>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
