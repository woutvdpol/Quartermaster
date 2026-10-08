import { db } from "@/server/db";
import { requireStaffContext } from "@/server/context";
import { headers } from "next/headers";
import { requireTenantDisplay } from "@/server/tenant-display";
import { getThemeState } from "@/server/theme";
import { themePreviewHostInfo } from "@/server/theme/preview";
import { ThemeBuilder, type ThemeBuilderProps } from "./ThemeBuilder";

/**
 * Server wrapper that loads everything the ThemeBuilder needs for the current staff tenant.
 * Reusable: the onboarding wizard's "Look & feel" step can render
 * `<ThemeBuilderSection variant="embedded" />` (see ThemeBuilderProps for the client props).
 */
export async function ThemeBuilderSection({ variant = "page" }: { variant?: ThemeBuilderProps["variant"] }) {
  const ctx = await requireStaffContext();
  const host = (await headers()).get("host");
  const [state, previewHost, tenant, product] = await Promise.all([
    getThemeState(ctx),
    themePreviewHostInfo(ctx.tenantId, host),
    requireTenantDisplay(ctx.tenantId),
    db.product.findFirst({
      where: { tenantId: ctx.tenantId, status: "ACTIVE", blurred: false },
      orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      select: { stockCode: true, slug: true },
    }),
  ]);
  // The preview iframe loads the shop of *this* host (same origin). Works on any of the tenant's own
  // domains; a superadmin working on another tenant from a different host gets a link instead.
  return (
    <ThemeBuilder
      variant={variant}
      initialState={state}
      shopName={tenant.name}
      productPath={product ? `/product/${product.stockCode}/${product.slug}` : null}
      previewHostMismatch={previewHost.available ? null : { primaryHost: previewHost.primaryHost ?? tenant.primaryHost }}
    />
  );
}
