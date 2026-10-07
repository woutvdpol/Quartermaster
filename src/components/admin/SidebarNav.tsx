"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_NAV, adminHref } from "@/lib/admin-nav";
import type { Role } from "@/generated/prisma/enums";
import { getDictionary } from "@/lib/i18n";
import { WipBadge } from "./StatusPill";

const t = getDictionary().nav;

export function SidebarNav({ role }: { role: Role }) {
  const pathname = usePathname();
  return (
    <nav aria-label={t.label} className="flex flex-col gap-0.5">
      {ADMIN_NAV.map(({ group, items }) => (
        <div key={group}>
          <h2 className="type-label mx-2 mt-3 mb-1 text-[11px] text-rail-muted">{t.groups[group]}</h2>
          <ul className="flex flex-col gap-0.5">
            {items.filter((item) => !item.superadminOnly || role === "SUPERADMIN").map((item) => {
              const href = adminHref(item);
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={item.key}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={
                      "flex items-center justify-between gap-2 rounded-[4px] px-2 py-1.5 text-[13px] text-rail-ink " +
                      (active
                        ? "bg-rail-active shadow-[inset_2px_0_0_var(--qm-accent)]"
                        : "hover:bg-rail-raised")
                    }
                  >
                    <span>{t.items[item.key]}</span>
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
