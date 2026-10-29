import { Suspense } from "react";
import { cookies } from "next/headers";
import { AdminShell } from "@/components/admin/AdminShell";
import { TrialBanner } from "@/components/admin/TrialBanner";
import { AdminTour } from "@/components/admin/tour/AdminTour";
import { Sidebar } from "@/components/admin/Sidebar";
import { Toaster } from "@/components/admin/ui";
import { ADMIN_THEME_COOKIE, parseAdminThemeCookie } from "@/lib/admin-theme";
import { getAdminTenantContext } from "@/lib/admin-tenant";
import { requireAdminPage } from "@/server/auth/guards";
import { ADMIN_NAV, type NavItemKey } from "@/lib/admin-nav";
import { getEntitlements } from "@/server/modules";
import { moduleForNavKey } from "@/server/modules/catalog";
import { markAdminTourSeenAction } from "./actions";

/** Authenticated admin shell. Everything under this group requires a fully signed-in staff user. */
export default async function AdminAppLayout({ children }: LayoutProps<"/admin">) {
  const user = await requireAdminPage();
  const [tenants, cookieStore] = await Promise.all([getAdminTenantContext(user), cookies()]);
  const theme = parseAdminThemeCookie(cookieStore.get(ADMIN_THEME_COOKIE)?.value);
  const lockedNav = tenants.active ? await lockedNavKeys(tenants.active.id) : [];

  return (
    <AdminShell sidebar={<Sidebar user={user} tenants={tenants} theme={theme} lockedNav={lockedNav} />}>
      <main className="flex min-w-0 flex-1 flex-col">
        {tenants.active ? <TrialBanner tenant={tenants.active} timeZone={tenants.active.timezone} superadmin={user.role === "SUPERADMIN"} /> : null}
        {children}
      </main>
      <Toaster />
      {tenants.active ? (
        // useSearchParams (?tour=1) needs a Suspense boundary.
        <Suspense fallback={null}>
          <AdminTour shopName={tenants.active.name} autoStart={user.role === "OWNER" && !user.adminTourSeen} markSeen={markAdminTourSeenAction} />
        </Suspense>
      ) : null}
    </AdminShell>
  );
}

/** Nav items of paid modules the shop does not have (docs/modules.md). */
async function lockedNavKeys(tenantId: string): Promise<NavItemKey[]> {
  const { modules } = await getEntitlements(tenantId);
  return ADMIN_NAV.flatMap((g) => g.items)
    .map((item) => item.key)
    .filter((key) => {
      const id = moduleForNavKey(key);
      return id !== undefined && !modules.has(id);
    });
}
