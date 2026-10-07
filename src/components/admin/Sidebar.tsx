import Link from "next/link";
import { logoutAction } from "@/app/admin/login/actions";
import type { AdminThemePreference } from "@/lib/admin-theme";
import type { AdminTenantContext } from "@/lib/admin-tenant";
import { getDictionary } from "@/lib/i18n";
import type { SessionUser } from "@/server/auth/session";
import { LogoMark } from "./AdminShell";
import { CommandPalette } from "./command/CommandPalette";
import { SidebarNav } from "./SidebarNav";
import { TenantSwitcher } from "./TenantSwitcher";
import { ThemeSwitcher } from "./ThemeSwitcher";

const t = getDictionary();

type SidebarProps = {
  user: Pick<SessionUser, "role" | "name" | "email">;
  tenants: AdminTenantContext;
  theme: AdminThemePreference;
};

/** Design A rail: logo, shop switcher, search, grouped navigation, user block. */
export function Sidebar({ user, tenants, theme }: SidebarProps) {
  const roleLabel = user.role === "SUPERADMIN" ? t.user.roleSuperadmin : t.user.roleOwner;
  return (
    <>
      <div className="hidden items-center gap-2.5 px-2 pt-1 pb-4 md:flex">
        <LogoMark />
        <span className="type-display text-lg tracking-[0.08em]">{t.app.name}</span>
      </div>

      <TenantSwitcher
        tenants={user.role === "SUPERADMIN" ? tenants.switchable : []}
        activeId={tenants.active?.id ?? null}
        activeName={tenants.active?.name ?? null}
      />

      <CommandPalette
        superadmin={user.role === "SUPERADMIN"}
        tenants={user.role === "SUPERADMIN" ? tenants.switchable : []}
        activeTenantId={tenants.active?.id ?? null}
        label={t.nav.search}
      />

      <SidebarNav role={user.role} />

      <div className="mt-auto grid gap-3 border-t border-rail-line px-2 pt-3">
        <Link href="/admin/account" className="-mx-1 block rounded-control px-1 py-0.5 text-xs hover:bg-rail-raised">
          <p className="truncate text-rail-ink">{user.name ?? user.email}</p>
          <p className="text-rail-muted">{roleLabel} · Account</p>
        </Link>
        <ThemeSwitcher current={theme} />
        <form action={logoutAction}>
          <button
            type="submit"
            className="w-full rounded-control border border-rail-line px-2 py-1 text-left text-xs text-rail-ink hover:bg-rail-raised"
          >
            {t.user.signOut}
          </button>
        </form>
      </div>
    </>
  );
}
