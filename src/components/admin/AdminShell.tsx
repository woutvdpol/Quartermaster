"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { getDictionary } from "@/lib/i18n";

const t = getDictionary();

/*
 * Layout frame: sidebar rail + work area (design A "Depot").
 * Future layout variants: design B uses a top bar (tenant switcher + main nav, secondary tabs below)
 * and design C a collapsible icon rail. Today all three themes share this sidebar layout and differ
 * at the token level (colours, fonts, radius) only.
 *
 * Below the md breakpoint the rail collapses behind a menu button.
 */
export function AdminShell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  // The mobile menu is open for the path it was opened on, so navigating closes it.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const open = openedAt === pathname;
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[216px_minmax(0,1fr)]">
      <div className="flex items-center justify-between bg-rail px-4 py-2.5 text-rail-ink md:hidden">
        <span className="flex items-center gap-2.5">
          <LogoMark />
          <span className="type-display text-lg">{t.app.name}</span>
        </span>
        <button
          type="button"
          onClick={() => setOpenedAt(open ? null : pathname)}
          aria-expanded={open}
          aria-controls="qm-rail"
          className="rounded-control border border-rail-line px-2.5 py-1 text-sm"
        >
          {open ? t.nav.closeMenu : t.nav.openMenu}
        </button>
      </div>
      <aside
        id="qm-rail"
        className={
          (open ? "flex" : "hidden") +
          " flex-col gap-0.5 bg-rail px-2.5 py-4 text-rail-ink md:sticky md:top-0 md:flex md:h-dvh md:overflow-y-auto"
        }
      >
        {sidebar}
      </aside>
      <div className="flex min-w-0 flex-col bg-panel-2">{children}</div>
    </div>
  );
}

export function LogoMark({ size = "sm" }: { size?: "sm" | "lg" }) {
  return (
    <span
      aria-hidden="true"
      className={
        "type-display grid place-items-center border-accent text-accent " +
        (size === "lg"
          ? "size-11 rounded-[4px] border-2 text-[22px]"
          : "size-[26px] rounded-[3px] border-[1.5px] text-[13px]")
      }
    >
      QM
    </span>
  );
}
