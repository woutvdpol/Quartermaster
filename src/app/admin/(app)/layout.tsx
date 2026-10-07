import { cookies } from "next/headers";
import { AdminShell } from "@/components/admin/AdminShell";
import { Sidebar } from "@/components/admin/Sidebar";
import { Toaster } from "@/components/admin/ui";
import { ADMIN_THEME_COOKIE, parseAdminThemeCookie } from "@/lib/admin-theme";
import { getAdminTenantContext } from "@/lib/admin-tenant";
import { requireAdminPage } from "@/server/auth/guards";

/** Authenticated admin shell. Everything under this group requires a fully signed-in staff user. */
export default async function AdminAppLayout({ children }: LayoutProps<"/admin">) {
  const user = await requireAdminPage();
  const [tenants, cookieStore] = await Promise.all([getAdminTenantContext(user), cookies()]);
  const theme = parseAdminThemeCookie(cookieStore.get(ADMIN_THEME_COOKIE)?.value);

  return (
    <AdminShell sidebar={<Sidebar user={user} tenants={tenants} theme={theme} />}>
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      <Toaster />
    </AdminShell>
  );
}
