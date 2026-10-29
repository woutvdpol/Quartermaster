"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_NAV, adminHref, type NavItemKey } from "@/lib/admin-nav";
import type { Role } from "@/generated/prisma/enums";
import { getDictionary } from "@/lib/i18n";
import { WipBadge } from "./StatusPill";
import type { TourTarget } from "./tour/steps";

const t = getDictionary().nav;

/** Sidebar items the admin tour points at (docs/admin-tour.md). */
const TOUR_TARGETS: Partial<Record<NavItemKey, TourTarget>> = { orders: "orders", theme: "website", paymentMethods: "payments" };

/** Small padlock for nav items of a paid module the shop does not have (docs/modules.md). */
function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" className="shrink-0 text-rail-muted">
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function SidebarNav({ role, locked = [] }: { role: Role; locked?: readonly NavItemKey[] }) {
  const pathname = usePathname();
  // The most specific matching item is active ("/admin/platform/applications" ≠ "/admin/platform").
  const activeHref = ADMIN_NAV.flatMap((g) => g.items)
    .map(adminHref)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
  return (
    <nav aria-label={t.label} className="flex flex-col gap-0.5" data-tour="nav">
      {ADMIN_NAV.map(({ group, items }) => (
        <div key={group}>
          <h2 className="type-label mx-2 mt-3 mb-1 text-[11px] text-rail-muted">{t.groups[group]}</h2>
          <ul className="flex flex-col gap-0.5">
            {items.filter((item) => !item.superadminOnly || role === "SUPERADMIN").map((item) => {
              const href = adminHref(item);
              const active = href === activeHref;
              const isLocked = locked.includes(item.key);
              return (
                <li key={item.key}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    data-tour={isLocked ? "locked" : TOUR_TARGETS[item.key]}
                    className={
                      "flex items-center justify-between gap-2 rounded-[4px] px-2 py-1.5 text-[13px] text-rail-ink " +
                      (active
                        ? "bg-rail-active shadow-[inset_2px_0_0_var(--qm-accent)]"
                        : "hover:bg-rail-raised")
                    }
                  >
                    <span className={isLocked ? "text-rail-muted" : undefined}>{t.items[item.key]}</span>
                    {isLocked && (
                      <>
                        <span className="sr-only">(not in your package)</span>
                        <LockIcon />
                      </>
                    )}
                    {item.wip && <WipBadge onRail />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
