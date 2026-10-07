import Link from "next/link";
import { cx } from "@/components/admin/ui";
import type { SettingsGroup } from "@/server/settings/schema";
import { SETTINGS_FORMS, SHOP_GROUPS } from "../_fields";

const itemClass = "block rounded-control border px-2.5 py-[7px] text-[13px] transition-colors";
const on = "border-line bg-panel text-ink shadow-card";
const off = "border-transparent text-muted hover:bg-panel hover:text-ink";

/** Left sub-navigation of settings groups (design A `.set nav`). Wraps above the form on small screens. */
export function SettingsNav({ active, showPlatform }: { active: SettingsGroup | "account"; showPlatform: boolean }) {
  const link = (href: string, label: string, isActive: boolean) => (
    <li key={href}>
      <Link href={href} aria-current={isActive ? "page" : undefined} className={cx(itemClass, isActive ? on : off)}>
        {label}
      </Link>
    </li>
  );
  return (
    <nav aria-label="Settings sections" className="grid content-start gap-3 md:sticky md:top-4">
      <ul className="flex flex-wrap gap-1 md:grid md:gap-0.5">
        {SHOP_GROUPS.map((g) => link(`/admin/settings/${g}`, SETTINGS_FORMS[g].label, active === g))}
      </ul>
      {showPlatform && (
        <div className="grid gap-1 border-t border-line pt-2.5">
          <p className="type-label flex items-center gap-1.5 px-2.5 text-[11px] text-muted">
            <LockIcon /> Superadmin only
          </p>
          <ul className="grid gap-0.5">{link("/admin/settings/platform", SETTINGS_FORMS.platform.label, active === "platform")}</ul>
        </div>
      )}
      <div className="grid gap-1 border-t border-line pt-2.5">
        <p className="type-label px-2.5 text-[11px] text-muted">You</p>
        <ul className="grid gap-0.5">{link("/admin/account", "Your account & security", active === "account")}</ul>
      </div>
    </nav>
  );
}

function LockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}
