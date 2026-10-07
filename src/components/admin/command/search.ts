import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import type { ServiceContext } from "@/server/context";
import type { Prisma } from "@/generated/prisma/client";
import { SETTINGS_FORMS, SHOP_GROUPS } from "@/app/admin/(app)/settings/_fields";
import type { CommandGroup, CommandItem } from "./types";

/*
 * ⌘K search service. Every query is tenant-scoped with `ctx.tenantId`; at most PER_GROUP results
 * per group. Exact identifiers hit unique indexes: (tenantId, stockCode), (tenantId, sku),
 * (tenantId, number), (tenantId, email). Free-text title/name matches are ILIKE within the tenant
 * (no trigram index yet — fine for shop-sized catalogs; see report).
 */

export const PER_GROUP = 5;
const querySchema = z.string().trim().max(120);

const STATUS_TONE: Record<string, CommandItem["tone"]> = {
  ACTIVE: "ok",
  RESERVED: "warn",
  SOLD: "mute",
  DRAFT: "mute",
  ARCHIVED: "mute",
};

function titleCase(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

export async function searchCommands(ctx: ServiceContext, rawQuery: string): Promise<CommandGroup[]> {
  const q = querySchema.parse(rawQuery);
  const term = q.replace(/^#/, "").trim();
  if (!term) return [];
  const numeric = /^\d{1,9}$/.test(term) ? Number(term) : null;
  if (numeric === null && term.length < 2) return [];
  const tenantId = ctx.tenantId;
  const contains = { contains: term, mode: "insensitive" as const };

  const productWhere: Prisma.ProductWhereInput = {
    tenantId,
    OR: [
      ...(numeric !== null ? [{ stockCode: numeric }] : []),
      { sku: { equals: term, mode: "insensitive" } },
      { title: contains },
    ],
  };
  const orderWhere: Prisma.OrderWhereInput = {
    tenantId,
    OR: [...(numeric !== null ? [{ number: numeric }] : []), { email: contains }, { customerName: contains }],
  };
  const nameParts = term.split(/\s+/).filter(Boolean);
  const customerWhere: Prisma.CustomerWhereInput = {
    tenantId,
    OR: [
      { email: contains },
      { firstName: contains },
      { lastName: contains },
      ...(nameParts.length >= 2
        ? [{ AND: [{ firstName: { contains: nameParts[0], mode: "insensitive" as const } }, { lastName: { contains: nameParts.slice(1).join(" "), mode: "insensitive" as const } }] }]
        : []),
    ],
  };

  const [products, orders, customers, pages] = await Promise.all([
    db.product.findMany({
      where: productWhere,
      take: PER_GROUP,
      orderBy: [{ updatedAt: "desc" }],
      select: { id: true, title: true, stockCode: true, sku: true, status: true },
    }),
    db.order.findMany({
      where: orderWhere,
      take: PER_GROUP,
      orderBy: [{ placedAt: "desc" }],
      select: { id: true, number: true, customerName: true, email: true, paymentStatus: true, fulfillmentStatus: true },
    }),
    db.customer.findMany({
      where: customerWhere,
      take: PER_GROUP,
      orderBy: [{ createdAt: "desc" }],
      select: { id: true, email: true, firstName: true, lastName: true },
    }),
    db.contentPage.findMany({
      where: { tenantId, OR: [{ title: contains }, { slug: contains }] },
      take: PER_GROUP,
      orderBy: [{ updatedAt: "desc" }],
      select: { id: true, title: true, slug: true, publishedAt: true },
    }),
  ]);

  // Exact identifier matches first (a stock code / order number beats a title that contains the digits).
  products.sort((a, b) => Number(b.stockCode === numeric) - Number(a.stockCode === numeric));
  orders.sort((a, b) => Number(b.number === numeric) - Number(a.number === numeric));

  const groups: CommandGroup[] = [];
  if (products.length)
    groups.push({
      id: "products",
      label: "Products",
      items: products.map((p) => ({
        id: `product:${p.id}`,
        label: p.title,
        href: `/admin/inventory/${p.id}`,
        meta: `#${p.stockCode}${p.sku ? ` · ${p.sku}` : ""}`,
        badge: titleCase(p.status),
        tone: STATUS_TONE[p.status] ?? "mute",
      })),
    });
  if (orders.length)
    groups.push({
      id: "orders",
      label: "Orders",
      items: orders.map((o) => ({
        id: `order:${o.id}`,
        label: `#${o.number} · ${o.customerName}`,
        href: `/admin/orders/${o.id}`,
        meta: o.email,
        badge: o.paymentStatus === "PAID" ? titleCase(o.fulfillmentStatus) : titleCase(o.paymentStatus),
        tone: o.paymentStatus === "PAID" ? "ok" : o.paymentStatus === "PENDING" ? "warn" : "mute",
      })),
    });
  if (customers.length)
    groups.push({
      id: "customers",
      label: "Customers",
      items: customers.map((c) => ({
        id: `customer:${c.id}`,
        label: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email,
        href: `/admin/customers/${c.id}`,
        meta: c.email,
      })),
    });
  if (pages.length)
    groups.push({
      id: "pages",
      label: "Pages",
      items: pages.map((p) => ({
        id: `page:${p.id}`,
        label: p.title,
        href: `/admin/pages/${p.id}`,
        meta: `/${p.slug}`,
        badge: p.publishedAt ? undefined : "Draft",
        tone: "mute",
      })),
    });

  const settings = searchSettings(term, ctx.actor.role === "SUPERADMIN");
  if (settings.length) groups.push({ id: "settings", label: "Settings", items: settings });
  return groups;
}

/** Settings sections whose group, section or field labels match. Pure (no DB). */
export function searchSettings(term: string, superadmin: boolean): CommandItem[] {
  const needle = term.toLowerCase();
  const groups = superadmin ? [...SHOP_GROUPS, "platform" as const] : SHOP_GROUPS;
  const out: CommandItem[] = [];
  for (const group of groups) {
    const meta = SETTINGS_FORMS[group];
    if (!meta) continue;
    const href = `/admin/settings/${group}`;
    if (meta.label.toLowerCase().includes(needle)) {
      out.push({ id: `settings:${group}`, label: `${meta.label} settings`, href, meta: "Settings" });
      continue;
    }
    for (const section of meta.sections) {
      const field = section.fields.find((f) => f.label.toLowerCase().includes(needle));
      if (section.title.toLowerCase().includes(needle) || field) {
        out.push({
          id: `settings:${group}:${section.title}`,
          label: field ? field.label : section.title,
          href,
          meta: `Settings › ${meta.label}${field ? ` › ${section.title}` : ""}`,
        });
        break;
      }
    }
    if (out.length >= PER_GROUP) break;
  }
  return out.slice(0, PER_GROUP);
}
