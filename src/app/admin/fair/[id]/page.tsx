import type { Metadata, Viewport } from "next";
import { notFound, redirect } from "next/navigation";
import { requireAdminPage } from "@/server/auth/guards";
import { ServiceError, requireStaffContext } from "@/server/context";
import { getFairSellData } from "@/server/fairs";
import { FairSell } from "./FairSell";

export const metadata: Metadata = { title: "Fair mode" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

/*
 * /admin/fair/<id> — fair mode on the phone or tablet (docs/fair-mode.md). Outside the (app) shell on
 * purpose: full-screen, no sidebar. Staff only (existing users; no helper logins — decision
 * "Innovatieronde 2"). The camera is allowed on this path only (Permissions-Policy in src/proxy.ts).
 */
export default async function FairModePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const [{ id }, ctx] = await Promise.all([params, requireStaffContext()]);
  const data = await getFairSellData(ctx, id).catch((err) => {
    if (err instanceof ServiceError && err.code === "NOT_FOUND") notFound();
    // Paid module "fairs" missing and the fair is not LIVE (a live fair may finish without it, see
    // getFairSellData): /admin/fairs (ModuleGate) explains what the module is and how to get it.
    if (err instanceof ServiceError && err.code === "UNAVAILABLE") redirect("/admin/fairs");
    throw err;
  });
  return <FairSell initial={data} />;
}
