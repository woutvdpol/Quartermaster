import { getParam } from "@/components/admin/ui";
/* Shared (pure) helpers for the audit log screens (tenant log + platform log). */

export type AuditRow = {
  id: string;
  createdAt: string;
  tenantId: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  actor: string;
  ip: string | null;
  summary: string;
  details: string | null;
  href: string | null;
};

export type AuditFilters = { action?: string; entity?: string; from?: string; to?: string };

export const ACTION_PREFIXES = [
  { value: "auth.", label: "Sign-in & security" },
  { value: "user.", label: "Users" },
  { value: "order.", label: "Orders" },
  { value: "product.", label: "Products" },
  { value: "stock.", label: "Stock" },
  { value: "reservation.", label: "Reservations" },
  { value: "category.", label: "Categories" },
  { value: "tag.", label: "Tags" },
  { value: "supplier.", label: "Suppliers" },
  { value: "purchase_record.", label: "Purchase records" },
  { value: "customer.", label: "Customers" },
  { value: "content.", label: "Pages & menus" },
  { value: "newsletter.", label: "Newsletter" },
  { value: "settings.", label: "Settings" },
  { value: "shipping.", label: "Shipping" },
  { value: "payments.", label: "Payments" },
  { value: "tenant.", label: "Shop (platform)" },
  { value: "domain.", label: "Domains" },
];

export const ENTITIES = [
  "Order",
  "Product",
  "ProductImage",
  "Category",
  "Tag",
  "Supplier",
  "PurchaseRecord",
  "Customer",
  "ContentPage",
  "ContentBlock",
  "MenuItem",
  "NewsletterCampaign",
  "NewsletterSubscriber",
  "Setting",
  "ShippingZone",
  "User",
  "Session",
  "Tenant",
  "TenantDomain",
].map((e) => ({ value: e, label: e.replace(/([a-z])([A-Z])/g, "$1 $2") }));

/** Admin link for an audit entry's entity, where there is an obvious screen. */
export function entityHref(entity: string | null, entityId: string | null, tenantId: string | null, isSuper: boolean): string | null {
  if (!entity) return null;
  const id = entityId ? encodeURIComponent(entityId) : null;
  switch (entity) {
    case "Order":
      return id ? `/admin/orders/${id}` : "/admin/orders";
    case "Product":
      return id ? `/admin/inventory/${id}` : "/admin/inventory";
    case "Customer":
      return id ? `/admin/customers/${id}` : "/admin/customers";
    case "Category":
      return "/admin/categories";
    case "ShippingZone":
      return "/admin/shipping";
    case "Setting":
      return entityId === "payments" ? "/admin/payment-methods" : id ? `/admin/settings/${id}` : "/admin/settings";
    case "User":
      return "/admin/users";
    case "Session":
      return "/admin/account";
    case "Tenant":
    case "TenantDomain":
      return isSuper && tenantId ? `/admin/platform/${encodeURIComponent(tenantId)}` : null;
    default:
      return null;
  }
}

/** Offset (ms) of `timeZone` from UTC at instant `ts`. */
function tzOffset(ts: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ts));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - ts;
}

/** Start of a calendar day ("2026-10-07") in the given time zone, as an instant. */
export function zonedDayStart(day: string, timeZone: string, addDays = 0): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return undefined;
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + addDays);
  return new Date(guess - tzOffset(guess - tzOffset(guess, timeZone), timeZone));
}

/** Filters (from search params) → service query with tenant-local day boundaries. */
export function toAuditQuery(f: AuditFilters, timeZone: string) {
  const to = f.to ? zonedDayStart(f.to, timeZone, 1) : undefined;
  return {
    action: f.action || undefined,
    entity: f.entity || undefined,
    from: f.from ? zonedDayStart(f.from, timeZone) : undefined,
    to: to ? new Date(to.getTime() - 1) : undefined,
  };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Audit filters from URL search params (invalid values are dropped). */
export function readFilters(sp: Record<string, string | string[] | undefined>): AuditFilters {
  const day = (k: string) => {
    const v = getParam(sp, k);
    return v && DAY.test(v) ? v : undefined;
  };
  return {
    action: getParam(sp, "action")?.slice(0, 100) || undefined,
    entity: getParam(sp, "entity")?.slice(0, 64) || undefined,
    from: day("from"),
    to: day("to"),
  };
}

