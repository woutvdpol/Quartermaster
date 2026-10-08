import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { AuthError } from "@/server/auth/guards";
import { ServiceError, type ServiceContext } from "@/server/context";
import { parseInput } from "@/server/catalog/errors";
import { addBlock, createPage, ensureSystemPages, getPage, removeBlock, updatePage } from "@/server/content/pages";
import { getMollieStatus } from "@/server/payments/mollie-config";
import { normalizeDomainHost } from "@/server/platform/hosts";
import { DISPLAY_CURRENCIES, getSettings, updateSettings } from "@/server/settings";
import { createZone } from "@/server/shipping";
import { countryName, isCountryCode } from "@/server/shipping/countries";
import { isPlatformHost } from "@/server/tenant";
import { isTurnstileConfigured } from "@/server/turnstile";
import type { Prisma } from "@/generated/prisma/client";
import { notifySuperadmins } from "./applications";
import { shopSubdomainBase } from "./rules";
import {
  IMPORT_CHOICES,
  LEGAL_PAGE_INFO,
  LEGAL_PAGES,
  SHIPPING_TEMPLATES,
  isSetupPending,
  legalTemplateMarkdown,
  parseSetupState,
  shippingTemplateZones,
  withStep,
  type ImportChoice,
  type LegalPageKey,
  type SetupState,
  type SetupStepKey,
  type ShippingTemplate,
} from "./setup-rules";

/*
 * Owner setup wizard (/admin/setup). Only for the OWNER of a tenant created by onboarding
 * (Tenant.setupState not null) until "Go live" sets setupCompletedAt. Every step saves through the
 * existing services (settings, payments, shipping zones, content pages); progress is merged into
 * Tenant.setupState under a row lock. Existing tenants (setupState null) never see the wizard.
 */

/** Only the tenant's own OWNER runs its wizard (a SUPERADMIN looking at the shop does not). */
export function assertSetupActor(ctx: ServiceContext): void {
  if (ctx.actor.role !== "OWNER" || ctx.actor.tenantId !== ctx.tenantId) throw new AuthError("FORBIDDEN");
}

export async function loadSetupTenant(ctx: ServiceContext) {
  assertSetupActor(ctx);
  const tenant = await db.tenant.findUnique({
    where: { id: ctx.tenantId },
    select: {
      id: true,
      name: true,
      slug: true,
      currency: true,
      setupState: true,
      setupCompletedAt: true,
      domains: { orderBy: [{ isPrimary: "desc" }, { host: "asc" }], select: { host: true, isPrimary: true } },
    },
  });
  if (!tenant) throw new ServiceError("NOT_FOUND", "Shop not found");
  return { ...tenant, state: parseSetupState(tenant.setupState), pending: isSetupPending(tenant) };
}

/** The wizard's tenant, or null when this actor has no pending wizard (never throws for OWNERs). */
export async function getPendingSetup(ctx: ServiceContext) {
  if (ctx.actor.role !== "OWNER" || ctx.actor.tenantId !== ctx.tenantId) return null;
  const tenant = await loadSetupTenant(ctx);
  return tenant.pending ? tenant : null;
}

async function requirePending(ctx: ServiceContext) {
  const tenant = await loadSetupTenant(ctx);
  if (!tenant.pending) throw new ServiceError("INVALID", "Setup is already complete");
  return tenant;
}

/** Records a step as done or skipped (row-locked JSON merge) and audits it. */
export async function markSetupStep(
  ctx: ServiceContext,
  step: SetupStepKey,
  status: "done" | "skipped",
  extra: { choice?: string; domainRequest?: string } = {},
): Promise<SetupState> {
  assertSetupActor(ctx);
  const next = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ setupState: unknown; setupCompletedAt: Date | null }[]>`
      SELECT "setupState", "setupCompletedAt" FROM "tenants" WHERE "id" = ${ctx.tenantId} FOR UPDATE`;
    const row = rows[0];
    if (!row || !isSetupPending(row)) throw new ServiceError("INVALID", "Setup is already complete");
    const state = withStep(parseSetupState(row.setupState), step, { done: status === "done", skipped: status === "skipped" ? true : undefined, ...extra });
    if (status === "done") delete state[step]!.skipped;
    await tx.tenant.update({ where: { id: ctx.tenantId }, data: { setupState: state as unknown as Prisma.InputJsonValue } });
    return state;
  });
  await audit({
    action: status === "done" ? "setup.step_done" : "setup.step_skipped",
    tenantId: ctx.tenantId,
    actorId: ctx.actor.id,
    entity: "Tenant",
    entityId: ctx.tenantId,
    data: { step, ...extra },
  });
  return next;
}

// ─── Step 1 + 2: settings ───────────────────────────────────────────────────

const basicsSchema = z.object({
  shopName: z.string().trim().min(2, "Enter the shop name.").max(120),
  contactEmail: z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address.")),
  displayCurrencies: z.array(z.enum(DISPLAY_CURRENCIES)).max(DISPLAY_CURRENCIES.length).default([]),
});
export type BasicsInput = z.input<typeof basicsSchema>;

export async function saveBasicsStep(ctx: ServiceContext, input: BasicsInput) {
  const tenant = await requirePending(ctx);
  const data = parseInput(basicsSchema, input);
  // Display currencies are extra currencies; the shop currency itself is never one of them.
  const displayCurrencies = data.displayCurrencies.filter((c) => c !== tenant.currency);
  await updateSettings(ctx.tenantId, "general", { shopName: data.shopName, contactEmail: data.contactEmail, displayCurrencies }, ctx.actor);
  await markSetupStep(ctx, "basics", "done");
}

const businessSchema = z.object({
  cocNumber: z.string().trim().min(1, "Enter your Chamber of Commerce number.").max(30),
  vatNumber: z.string().trim().max(40).default(""),
  iban: z.string().trim().max(50).default(""),
  phone: z.string().trim().max(40).default(""),
  line1: z.string().trim().min(1, "Enter the street and number.").max(200),
  line2: z.string().trim().max(200).default(""),
  postalCode: z.string().trim().min(1, "Enter the postal code.").max(20),
  city: z.string().trim().min(1, "Enter the city.").max(100),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .refine((c) => isCountryCode(c), "Choose a country."),
});
export type BusinessInput = z.input<typeof businessSchema>;

/** Saves business details into settings.general (the settings schema normalises VAT id / IBAN and rejects bad formats). */
export async function saveBusinessStep(ctx: ServiceContext, input: BusinessInput) {
  await requirePending(ctx);
  const d = parseInput(businessSchema, input);
  await updateSettings(
    ctx.tenantId,
    "general",
    {
      cocNumber: d.cocNumber,
      vatNumber: d.vatNumber,
      iban: d.iban,
      phone: d.phone,
      address: { line1: d.line1, line2: d.line2, postalCode: d.postalCode, city: d.city, country: d.country },
    },
    ctx.actor,
  );
  await markSetupStep(ctx, "business", "done");
}

// ─── Step 5: shipping ───────────────────────────────────────────────────────

export async function countDeliveryZones(tenantId: string) {
  return db.shippingZone.count({ where: { tenantId, isPickup: false } });
}

/** Creates the template's zones (with starter rates) through the shipping service. Only when no delivery zone exists yet. */
export async function applyShippingTemplate(ctx: ServiceContext, template: ShippingTemplate) {
  await requirePending(ctx);
  const t = parseInput(z.enum(SHIPPING_TEMPLATES), template);
  if ((await countDeliveryZones(ctx.tenantId)) > 0) {
    throw new ServiceError("CONFLICT", "This shop already has shipping zones; edit them on the Shipping page");
  }
  const general = await getSettings(ctx.tenantId, "general");
  const home = general.address.country || "NL";
  for (const zone of shippingTemplateZones(t, home)) {
    await createZone(ctx, { name: zone.name, countries: zone.countries, rates: zone.rates });
  }
  await markSetupStep(ctx, "shipping", "done", { choice: t });
}

// ─── Step 6: import ─────────────────────────────────────────────────────────

/** Records the import choice. Concept500 → the platform team is notified (migration is done with them). */
export async function chooseImport(ctx: ServiceContext, choice: ImportChoice, note?: string) {
  const tenant = await requirePending(ctx);
  const c = parseInput(z.enum(IMPORT_CHOICES), choice);
  const detail = note ? parseInput(z.string().trim().max(300), note) : undefined;
  if (c === "concept500" && tenant.state.import?.choice !== "concept500") {
    await notifySuperadmins({ kind: "migration", tenantId: ctx.tenantId, detail: detail || undefined });
    await audit({ action: "setup.migration_requested", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Tenant", entityId: ctx.tenantId });
  }
  await markSetupStep(ctx, "import", "done", { choice: c });
}

// ─── Step 7: legal pages ────────────────────────────────────────────────────

export type LegalPageStatus = { key: LegalPageKey; title: string; pageId: string | null; slug: string | null; published: boolean };

async function findLegalPage(tenantId: string, key: LegalPageKey) {
  const info = LEGAL_PAGE_INFO[key];
  return db.contentPage.findFirst({
    where: { tenantId, ...(info.systemKey ? { systemKey: info.systemKey } : { slug: info.slug }) },
    select: { id: true, slug: true, publishedAt: true },
  });
}

export async function getLegalPageStatus(tenantId: string): Promise<LegalPageStatus[]> {
  return Promise.all(
    LEGAL_PAGES.map(async (key) => {
      const page = await findLegalPage(tenantId, key);
      return { key, title: LEGAL_PAGE_INFO[key].title, pageId: page?.id ?? null, slug: page?.slug ?? null, published: page?.publishedAt != null };
    }),
  );
}

async function legalVars(tenantId: string) {
  const g = await getSettings(tenantId, "general");
  const a = g.address;
  return {
    shopName: g.shopName,
    email: g.contactEmail,
    address: [a.line1, a.line2, [a.postalCode, a.city].filter(Boolean).join(" "), a.country ? countryName(a.country) : ""].filter(Boolean).join(", "),
    cocNumber: g.cocNumber,
    vatNumber: g.vatNumber,
    country: a.country ? countryName(a.country) : "",
  };
}

/**
 * Writes the chosen legal pages from the templates (shop details filled in) and publishes them, via the
 * content services: TERMS/PRIVACY are the shop's system pages, returns/shipping regular pages. The
 * page content is replaced by one text block.
 */
export async function createLegalPages(ctx: ServiceContext, keys: LegalPageKey[]) {
  await requirePending(ctx);
  const chosen = parseInput(z.array(z.enum(LEGAL_PAGES)).min(1, "Choose at least one page.").max(LEGAL_PAGES.length), keys);
  await ensureSystemPages(ctx.tenantId);
  const vars = await legalVars(ctx.tenantId);
  for (const key of new Set(chosen)) {
    const info = LEGAL_PAGE_INFO[key];
    const existing = await findLegalPage(ctx.tenantId, key);
    const pageId = existing?.id ?? (await createPage(ctx, { title: info.title, slug: info.slug })).id;
    const page = await getPage(ctx, pageId);
    for (const block of page.blocks) await removeBlock(ctx, block.id);
    await addBlock(ctx, pageId, { type: "TEXT", data: { title: "", markdown: legalTemplateMarkdown(key, vars), cta: null } });
    await updatePage(ctx, pageId, { title: info.title, published: true });
  }
  await markSetupStep(ctx, "legal", "done");
}

// ─── Step 8: go live ────────────────────────────────────────────────────────

export type ChecklistItem = {
  key: "business" | "shipping" | "legal" | "payments" | "products" | "turnstile";
  label: string;
  ok: boolean;
  /** Required items block going live; the others are warnings the owner must acknowledge. */
  required: boolean;
  detail: string;
  href?: string;
};

export async function getGoLiveChecklist(ctx: ServiceContext): Promise<ChecklistItem[]> {
  assertSetupActor(ctx);
  const tid = ctx.tenantId;
  const [general, zones, legal, mollie, products] = await Promise.all([
    getSettings(tid, "general"),
    db.shippingZone.count({ where: { tenantId: tid, isPickup: false, isActive: true, rates: { some: {} } } }),
    getLegalPageStatus(tid),
    getMollieStatus(ctx),
    db.product.count({ where: { tenantId: tid, status: "ACTIVE" } }),
  ]);
  const a = general.address;
  const businessOk = Boolean(general.cocNumber && a.line1 && a.postalCode && a.city && a.country);
  const legalRequired = legal.filter((p) => p.key === "terms" || p.key === "privacy");
  const legalOk = legalRequired.every((p) => p.published);
  const turnstileOk = isTurnstileConfigured() && Boolean(process.env.TURNSTILE_SITE_KEY || process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

  return [
    {
      key: "business",
      label: "Business details",
      ok: businessOk,
      required: true,
      detail: businessOk ? "Chamber of Commerce number and address are filled in." : "Add your Chamber of Commerce number and business address.",
      href: "/admin/setup?step=business",
    },
    {
      key: "shipping",
      label: "Shipping zone with rates",
      ok: zones > 0,
      required: true,
      detail: zones > 0 ? `${zones} active delivery ${zones === 1 ? "zone" : "zones"}.` : "Customers cannot check out without a delivery zone.",
      href: zones > 0 ? "/admin/shipping" : "/admin/setup?step=shipping",
    },
    {
      key: "legal",
      label: "Terms and privacy pages published",
      ok: legalOk,
      required: true,
      detail: legalOk ? "Published. Have the texts checked if you used the templates." : "Publish your terms and conditions and privacy policy.",
      href: "/admin/setup?step=legal",
    },
    {
      key: "payments",
      label: "Mollie live key",
      ok: mollie.configured && mollie.mode === "live",
      required: false,
      detail: !mollie.configured
        ? "Mollie is not connected: customers cannot pay."
        : mollie.mode === "test"
          ? "Mollie runs in test mode: no real payments are taken."
          : "Mollie takes live payments.",
      href: "/admin/payment-methods",
    },
    {
      key: "products",
      label: "At least one product for sale",
      ok: products > 0,
      required: false,
      detail: products > 0 ? `${products} ${products === 1 ? "product" : "products"} for sale.` : "Your shop has no products for sale yet.",
      href: "/admin/inventory",
    },
    {
      key: "turnstile",
      label: "Bot protection on forms (platform)",
      ok: turnstileOk,
      required: false,
      detail: turnstileOk ? "Cloudflare Turnstile protects your contact and account forms." : "Not configured on the platform yet — the Quartermaster team handles this.",
    },
  ];
}

/** Sets setupCompletedAt. Required checklist items must pass; open warnings must be acknowledged. */
export async function completeSetup(ctx: ServiceContext, opts: { acknowledgeWarnings: boolean }) {
  await requirePending(ctx);
  const items = await getGoLiveChecklist(ctx);
  const missing = items.filter((i) => i.required && !i.ok);
  if (missing.length) throw new ServiceError("INVALID", `Not ready yet: ${missing.map((i) => i.label.toLowerCase()).join(", ")}`);
  const warnings = items.filter((i) => !i.required && !i.ok);
  if (warnings.length && !opts.acknowledgeWarnings) {
    throw new ServiceError("INVALID", "Confirm that you want to go live with the open points.");
  }
  await markSetupStep(ctx, "golive", "done");
  const { count } = await db.tenant.updateMany({ where: { id: ctx.tenantId, setupCompletedAt: null }, data: { setupCompletedAt: new Date() } });
  if (count === 0) throw new ServiceError("INVALID", "Setup is already complete");
  await audit({
    action: "setup.completed",
    tenantId: ctx.tenantId,
    actorId: ctx.actor.id,
    entity: "Tenant",
    entityId: ctx.tenantId,
    data: { openWarnings: warnings.map((w) => w.key) },
  });
}

/**
 * The owner asks for an own domain. Hosts are added by the platform team (DNS + ingress/TLS), so this
 * records the request in setupState and notifies the SUPERADMINs; it never creates a TenantDomain.
 */
export async function requestOwnDomain(ctx: ServiceContext, input: string) {
  await requirePending(ctx);
  const host = normalizeDomainHost(typeof input === "string" ? input : "");
  if (!host || !host.includes(".") || host.includes(":")) throw new ServiceError("INVALID", "domain: Enter a domain like www.your-shop.com");
  const base = shopSubdomainBase().split(":")[0];
  if (isPlatformHost(host) || host === base || host.endsWith(`.${base}`)) throw new ServiceError("INVALID", "domain: Enter your own domain, not a platform address");
  const taken = await db.tenantDomain.findUnique({ where: { host }, select: { tenantId: true } });
  if (taken && taken.tenantId !== ctx.tenantId) throw new ServiceError("CONFLICT", "domain: This domain is already used by another shop");
  const tenant = await loadSetupTenant(ctx);
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "tenants" WHERE "id" = ${ctx.tenantId} FOR UPDATE`;
    const fresh = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { setupState: true } });
    const state = parseSetupState(fresh.setupState);
    const golive = state.golive ?? { done: false, at: new Date().toISOString() };
    state.golive = { ...golive, domainRequest: host };
    await tx.tenant.update({ where: { id: ctx.tenantId }, data: { setupState: state as unknown as Prisma.InputJsonValue } });
  });
  if (tenant.state.golive?.domainRequest !== host) await notifySuperadmins({ kind: "domain", tenantId: ctx.tenantId, detail: host });
  await audit({ action: "setup.domain_requested", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Tenant", entityId: ctx.tenantId, data: { host } });
  return host;
}
