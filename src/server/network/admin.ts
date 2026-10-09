import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ServiceError, type ServiceContext } from "@/server/context";
import { parseInput } from "@/server/catalog/errors";
import { getSettings, updateSettings } from "@/server/settings";
import { assertPlatformActor, type PlatformContext } from "@/server/platform/context";
import { isSetupPending } from "@/server/onboarding/setup-rules";
import { NETWORK_PATH, networkMount, originOf, readNetworkHosts } from "@/lib/network";
import { revalidateNetwork } from "./service";

/*
 * Network membership (docs/network.md):
 *  - the shop owner opts in/out in Settings → General ("Quartermaster network" card);
 *  - a platform admin can remove a shop (moderation). That also sets platform setting
 *    `networkBlocked`, so the owner cannot simply switch it back on; the platform admin can allow it again.
 * Every change is audited on the tenant and revalidates the network caches.
 */

export type NetworkMembership = {
  optIn: boolean;
  joinedAt: Date | null;
  blocked: boolean;
  /** Why opted-in stock would not be shown yet (empty = visible). */
  blockers: string[];
  /** Public network address, e.g. https://platform.example/network (null when no host is configured). */
  networkUrl: string | null;
};

export function networkPublicUrl(): string | null {
  const hosts = readNetworkHosts();
  if (hosts.networkHost) return `${originOf(hosts.networkHost)}/`;
  if (hosts.platformHost) {
    const mount = networkMount(hosts.platformHost, hosts);
    return mount.kind === "serve" ? `${mount.origin}${NETWORK_PATH}` : null;
  }
  return null;
}

export async function getNetworkMembership(ctx: ServiceContext): Promise<NetworkMembership> {
  const [tenant, platform] = await Promise.all([
    db.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { status: true, networkOptIn: true, networkJoinedAt: true, setupState: true, setupCompletedAt: true, domains: { where: { isPrimary: true }, select: { id: true } } },
    }),
    getSettings(ctx.tenantId, "platform"),
  ]);
  if (!tenant) throw new ServiceError("NOT_FOUND", "Shop not found");
  const blockers: string[] = [];
  if (platform.networkBlocked) blockers.push("Quartermaster removed this shop from the network. Contact support to be listed again.");
  if (tenant.status !== "ACTIVE") blockers.push("The shop is not active.");
  if (isSetupPending(tenant)) blockers.push("The shop is not live yet (finish the setup wizard).");
  if (!tenant.domains.length) blockers.push("The shop has no primary domain.");
  return { optIn: tenant.networkOptIn, joinedAt: tenant.networkJoinedAt, blocked: platform.networkBlocked, blockers, networkUrl: networkPublicUrl() };
}

/** Owner (or SUPERADMIN working on the shop): show / hide this shop's stock in the network. */
export async function setNetworkOptIn(ctx: ServiceContext, optIn: boolean): Promise<NetworkMembership> {
  const on = parseInput(z.boolean(), optIn);
  if (on && ctx.actor.role !== "SUPERADMIN" && (await getSettings(ctx.tenantId, "platform")).networkBlocked) {
    throw new ServiceError("FORBIDDEN", "Quartermaster removed this shop from the network. Contact support to be listed again.");
  }
  const current = await db.tenant.findUnique({ where: { id: ctx.tenantId }, select: { networkOptIn: true } });
  if (!current) throw new ServiceError("NOT_FOUND", "Shop not found");
  if (current.networkOptIn !== on) {
    await db.tenant.update({ where: { id: ctx.tenantId }, data: { networkOptIn: on, networkJoinedAt: on ? new Date() : null } });
    await audit({
      action: on ? "tenant.network_joined" : "tenant.network_left",
      tenantId: ctx.tenantId,
      actorId: ctx.actor.id,
      entity: "Tenant",
      entityId: ctx.tenantId,
    });
    revalidateNetwork();
  }
  return getNetworkMembership(ctx);
}

const idSchema = z.string().trim().min(1).max(64);

/** Platform moderation: take a shop out of the network and keep it out until allowed again. */
export async function removeFromNetwork(ctx: PlatformContext, tenantId: string): Promise<void> {
  assertPlatformActor(ctx);
  const id = parseInput(idSchema, tenantId);
  const tenant = await db.tenant.findUnique({ where: { id }, select: { networkOptIn: true } });
  if (!tenant) throw new ServiceError("NOT_FOUND", "Tenant not found");
  await db.tenant.update({ where: { id }, data: { networkOptIn: false, networkJoinedAt: null } });
  await updateSettings(id, "platform", { networkBlocked: true }, ctx.actor);
  await audit({ action: "tenant.network_removed", tenantId: id, actorId: ctx.actor.id, entity: "Tenant", entityId: id, data: { wasListed: tenant.networkOptIn } });
  revalidateNetwork();
}

/** Platform moderation: let the owner opt in again (does not opt the shop in by itself). */
export async function allowNetwork(ctx: PlatformContext, tenantId: string): Promise<void> {
  assertPlatformActor(ctx);
  const id = parseInput(idSchema, tenantId);
  if (!(await db.tenant.findUnique({ where: { id }, select: { id: true } }))) throw new ServiceError("NOT_FOUND", "Tenant not found");
  await updateSettings(id, "platform", { networkBlocked: false }, ctx.actor);
  await audit({ action: "tenant.network_allowed", tenantId: id, actorId: ctx.actor.id, entity: "Tenant", entityId: id });
}
