import Link from "next/link";
import { cx } from "@/components/admin/ui";
import { copy } from "../_copy";

const TABS = [
  { key: "records", href: "/admin/sourcing", label: copy.tabs.records },
  { key: "suppliers", href: "/admin/sourcing/suppliers", label: copy.tabs.suppliers },
  { key: "margin", href: "/admin/sourcing/margin", label: copy.tabs.margin },
] as const;

export type SourcingTab = (typeof TABS)[number]["key"];

/** Section navigation for the sourcing screens (links, so every tab has its own URL). */
export function SourcingTabs({ active }: { active: SourcingTab }) {
  return (
    <nav aria-label={copy.tabs.label} className="flex gap-1 overflow-x-auto border-b border-line bg-panel px-4 md:px-[22px]">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={cx(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px]",
            t.key === active ? "border-accent font-medium text-ink" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
