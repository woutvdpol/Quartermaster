// Human-readable one-line summaries for audit entries. Pure (no DB) so it is unit-testable.
// Unknown actions fall back to a generic sentence, so new actions never break the log view.

export type SummaryInput = {
  action: string;
  entity: string | null;
  entityId: string | null;
  data: unknown;
  actorLabel: string; // e.g. "jan@shop.nl", "Quartermaster staff", "System"
};

type Data = Record<string, unknown>;
type Fn = (d: Data, e: SummaryInput) => string;

const str = (v: unknown, fallback = "?") => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : fallback);
const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x)).join(", ") : "");
const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const ref = (e: SummaryInput) => (e.entityId ? `${e.entity ?? "item"} ${e.entityId}` : (e.entity ?? "an item"));

/** action → sentence (without actor). The actor is prefixed by `summarizeAudit`. */
const SUMMARIES: Record<string, Fn> = {
  // auth
  "auth.login": (d) => (d.method === "recovery_code" ? "signed in with a recovery code" : d.method === "totp" ? "signed in with 2FA" : "signed in"),
  "auth.login_password_ok": () => "entered a correct password (awaiting 2FA)",
  "auth.login_failed": (d) => `failed to sign in as ${str(d.email)} (${str(d.reason, "unknown reason").replace(/_/g, " ")})`,
  "auth.logout": () => "signed out",
  "auth.totp_enabled": () => "enabled two-factor authentication",
  "auth.totp_disabled": () => "disabled two-factor authentication",
  "auth.totp_failed": (d) => `entered a wrong 2FA code${d.reason === "rate_limited" ? " too often" : ""}`,
  "auth.recovery_code_used": () => "used a recovery code",
  "auth.password_changed": () => "changed their password",
  "auth.password_reset_requested": () => "requested a password reset",
  "auth.password_reset": () => "reset their password",
  "auth.session_revoked": () => "signed out a session",
  "auth.sessions_revoked": (d) => `signed out ${plural(Number(d.count) || 0, "other session")}`,
  // users
  "user.invited": (d) => `invited ${str(d.email)} as shop owner`,
  "user.invite_resent": (_d, e) => `re-sent the invite for user ${e.entityId ?? "?"}`,
  "user.disabled": (d) => `disabled the account of ${str(d.email)}`,
  "user.enabled": (d) => `re-enabled the account of ${str(d.email)}`,
  "user.2fa_reset": (d) => `reset two-factor authentication for ${str(d.email)}`,
  "user.email_changed": (d) => `changed their e-mail from ${str(d.from)} to ${str(d.to)}`,
  "user.profile_updated": () => "updated their profile",
  // platform
  "tenant.created": (d) => `created shop "${str(d.name)}" (${str(d.host)})`,
  "tenant.updated": (d) => `updated shop details (${Object.keys(d).join(", ")})`,
  "tenant.status_changed": (d) => `changed shop status from ${str(d.from)} to ${str(d.to)}`,
  "domain.added": (d) => `added domain ${str(d.host)}${d.primary ? " (primary)" : ""}`,
  "domain.removed": (d) => `removed domain ${str(d.host)}`,
  "domain.primary_set": (d) => `made ${str(d.host)} the primary domain`,
  // settings
  "settings.update": (d) => `changed ${str(d.group)} settings${count(d.changed) ? `: ${list(d.changed)}` : ""}`,
  // catalog
  "product.create": (d) => `created product ${str(d.stockCode)}${d.title ? ` "${str(d.title)}"` : ""}`,
  "product.duplicate": (d) => `duplicated product ${str(d.fromStockCode)} as ${str(d.stockCode)}`,
  "product.bump": () => "bumped a product to the top",
  "product.bulk_update": () => "bulk-updated products",
  "product.delete": (d) => `deleted product ${str(d.stockCode)}`,
  "product.update": (d, e) => `updated product ${e.entityId ?? ""}${count(d.fields) ? ` (${list(d.fields)})` : ""}`,
  "product.status": (d, e) => `changed product ${e.entityId ?? ""} status from ${str(d.from)} to ${str(d.to)}`,
  "product.purchase_price": () => "updated purchase prices",
  "product.images.added": (_d, e) => `added images to product ${e.entityId ?? ""}`,
  "product.images.reordered": (_d, e) => `reordered images of product ${e.entityId ?? ""}`,
  "product.image.alt_updated": () => "updated an image description",
  "product.image.deleted": () => "deleted a product image",
  "category.create": (d) => `created category "${str(d.title)}"`,
  "category.update": (_d, e) => `updated category ${e.entityId ?? ""}`,
  "category.move": (_d, e) => `moved category ${e.entityId ?? ""}`,
  "category.reorder": () => "reordered categories",
  "category.delete": (_d, e) => `deleted category ${e.entityId ?? ""}`,
  "tag.create": (d) => `created tag "${str(d.name)}"`,
  "tag.update": (_d, e) => `updated tag ${e.entityId ?? ""}`,
  "tag.delete": (_d, e) => `deleted tag ${e.entityId ?? ""}`,
  "tag.merge": (d) => `merged ${plural(count(d.sourceIds), "tag")} into another tag`,
  "stock.adjust": (_d, e) => `adjusted stock of product ${e.entityId ?? ""}`,
  "reservation.release": (_d, e) => `released the reservation on product ${e.entityId ?? ""}`,
  // purchasing
  "supplier.create": () => "created a supplier",
  "supplier.update": () => "updated a supplier",
  "supplier.delete": () => "deleted a supplier",
  "purchase_record.create": () => "created a purchase record",
  "purchase_record.update": () => "updated a purchase record",
  "purchase_record.delete": () => "deleted a purchase record",
  "purchase_record.link": (d) => `linked ${plural(count(d.productIds), "product")} to a purchase record`,
  "purchase_record.unlink": (d) => `unlinked ${plural(count(d.productIds), "product")} from a purchase record`,
  // customers & orders
  "customer.update": (_d, e) => `updated customer ${e.entityId ?? ""}`,
  "customer.anonymize": (_d, e) => `anonymized customer ${e.entityId ?? ""}`,
  "order.mark_paid": (_d, e) => `marked order ${e.entityId ?? ""} as paid`,
  "order.cancel": (_d, e) => `canceled order ${e.entityId ?? ""}`,
  "order.archive": (_d, e) => `archived order ${e.entityId ?? ""}`,
  "order.unarchive": (_d, e) => `restored order ${e.entityId ?? ""}`,
  "order.note": (_d, e) => `edited the note on order ${e.entityId ?? ""}`,
  "order.fulfillment": (_d, e) => `updated fulfillment of order ${e.entityId ?? ""}`,
};

export function summarizeAudit(entry: SummaryInput): string {
  const data: Data = entry.data && typeof entry.data === "object" && !Array.isArray(entry.data) ? (entry.data as Data) : {};
  const fn = SUMMARIES[entry.action];
  let sentence: string;
  try {
    sentence = fn ? fn(data, entry) : `performed "${entry.action}" on ${ref(entry)}`;
  } catch {
    sentence = `performed "${entry.action}" on ${ref(entry)}`;
  }
  return `${entry.actorLabel} ${sentence.trim()}`;
}

export const KNOWN_AUDIT_ACTIONS = Object.keys(SUMMARIES);
