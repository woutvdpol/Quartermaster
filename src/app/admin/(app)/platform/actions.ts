"use server";

import { revalidatePath } from "next/cache";
// Side effect: registers the owner-invite mail notifier (see src/server/mail/hooks.ts).
import "@/server/mail/hooks";
import { actionOk, DEFAULT_TIME_ZONE, formString, type ActionResult, type ActionState } from "@/components/admin/ui";
import { queryPlatformAuditLog } from "@/server/auditlog";
import {
  addDomain,
  createTenant,
  removeDomain,
  requirePlatformContext,
  setPrimaryDomain,
  setTenantStatus,
  updateTenant,
} from "@/server/platform";
import { fail, failFrom } from "../_system/errors";
import { inviteLink } from "../_system/tenant";
import { PAGE_SIZE, toRows } from "../audit-log/_data";
import { toAuditQuery, type AuditFilters, type AuditRow } from "../audit-log/_shared";
import type { TenantStatusValue } from "./_shared";

const BASE = "/admin/platform";

/** Field errors for "This slug/host is already in use" conflicts. */
function conflictField(message: string | undefined) {
  if (!message) return undefined;
  if (/slug/i.test(message)) return { slug: [message] };
  if (/host/i.test(message)) return { primaryHost: [message], host: [message] };
  if (/e-mail/i.test(message)) return { ownerEmail: [message] };
  if (/currency/i.test(message)) return { currency: [message] };
  return undefined;
}

export type CreatedTenant = { id: string; name: string; inviteLink: string; ownerEmail: string; expiresAt: string };

export async function createTenantAction(_prev: ActionState, formData: FormData): Promise<ActionResult<string, CreatedTenant>> {
  try {
    const ctx = await requirePlatformContext();
    const res = await createTenant(ctx, {
      slug: formString(formData, "slug"),
      name: formString(formData, "name"),
      currency: formString(formData, "currency") || "EUR",
      timezone: formString(formData, "timezone") || "Europe/Amsterdam",
      primaryHost: formString(formData, "primaryHost"),
      ownerEmail: formString(formData, "ownerEmail"),
      ownerName: formString(formData, "ownerName") || null,
    });
    revalidatePath(BASE, "layout");
    revalidatePath("/admin", "layout"); // tenant switcher
    return actionOk(`Shop “${res.tenant.name}” created.`, {
      id: res.tenant.id,
      name: res.tenant.name,
      inviteLink: inviteLink(res.domain.host, res.inviteToken),
      ownerEmail: res.owner.email,
      expiresAt: res.inviteExpiresAt.toISOString(),
    });
  } catch (err) {
    const failure = failFrom(err);
    return fail(failure.message, failure.fieldErrors ?? conflictField(failure.message));
  }
}

export async function updateTenantAction(tenantId: string, _prev: ActionState, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePlatformContext();
    await updateTenant(ctx, tenantId, {
      slug: formString(formData, "slug"),
      name: formString(formData, "name"),
      currency: formString(formData, "currency"),
      timezone: formString(formData, "timezone"),
    });
  } catch (err) {
    const failure = failFrom(err);
    return fail(failure.message, failure.fieldErrors ?? conflictField(failure.message));
  }
  revalidatePath(BASE, "layout");
  revalidatePath("/admin", "layout");
  return actionOk("Shop saved.");
}

export async function setTenantStatusAction(formData: FormData): Promise<ActionResult> {
  const status = formString(formData, "status") as TenantStatusValue;
  try {
    const ctx = await requirePlatformContext();
    await setTenantStatus(ctx, formString(formData, "tenantId"), status);
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(BASE, "layout");
  revalidatePath("/admin", "layout");
  return actionOk(status === "ACTIVE" ? "Shop reactivated." : `Shop ${status === "SUSPENDED" ? "suspended" : "archived"}. Its users were signed out.`);
}

export async function addDomainAction(tenantId: string, _prev: ActionState, formData: FormData): Promise<ActionResult> {
  const host = formString(formData, "host");
  if (!host) return fail("Check the highlighted fields.", { host: ["Enter a host name."] });
  try {
    const ctx = await requirePlatformContext();
    const domain = await addDomain(ctx, tenantId, { host, primary: formData.get("primary") === "on" });
    revalidatePath(BASE, "layout");
    return actionOk(`Domain ${domain.host} added.`);
  } catch (err) {
    const failure = failFrom(err);
    const fe = failure.fieldErrors ?? (failure.message ? { host: [failure.message] } : undefined);
    return fail(failure.message, fe);
  }
}

export async function removeDomainAction(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePlatformContext();
    await removeDomain(ctx, formString(formData, "domainId"));
  } catch (err) {
    return failFrom(err);
  }
  revalidatePath(BASE, "layout");
  return actionOk("Domain removed.");
}

export async function setPrimaryDomainAction(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePlatformContext();
    const d = await setPrimaryDomain(ctx, formString(formData, "domainId"));
    revalidatePath(BASE, "layout");
    return actionOk(`${d.host} is now the primary domain.`);
  } catch (err) {
    return failFrom(err);
  }
}

export type PlatformAuditScope = { scope: "platform" | "all"; tenantId?: string };

/** Next page of the platform audit log. */
export async function loadMorePlatformAuditAction(
  scope: PlatformAuditScope,
  filters: AuditFilters,
  cursor: string,
): Promise<ActionResult<string, { rows: AuditRow[]; nextCursor: string | null }>> {
  try {
    const ctx = await requirePlatformContext();
    const page = await queryPlatformAuditLog(ctx, {
      ...toAuditQuery(filters, DEFAULT_TIME_ZONE),
      scope: scope.scope,
      tenantId: scope.tenantId,
      cursor,
      limit: PAGE_SIZE,
    });
    return actionOk(undefined, { rows: toRows(page.items, true), nextCursor: page.nextCursor });
  } catch (err) {
    return failFrom(err);
  }
}
