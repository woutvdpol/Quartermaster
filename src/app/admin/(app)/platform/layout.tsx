import { notFound } from "next/navigation";
import { requireAdminPage } from "@/server/auth/guards";

/** Platform screens exist only for SUPERADMINs; shop owners get a 404 (not a "forbidden" hint). */
export default async function PlatformLayout({ children }: LayoutProps<"/admin/platform">) {
  const user = await requireAdminPage();
  if (user.role !== "SUPERADMIN" || user.tenantId !== null) notFound();
  return children;
}
