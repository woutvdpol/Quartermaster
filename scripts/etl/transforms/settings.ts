import {
  DISPLAY_CURRENCIES,
  DROPPED_LEGACY_KEYS,
  FONT_ALLOWLIST,
  LEGACY_KEY_MAP,
  SETTINGS_SCHEMAS,
  isValidTimeZone,
  mergeSettings,
  type SettingsGroup,
} from "../../../src/server/settings/schema";
import type { LegacySetting } from "../legacy/types";
import { decodeNestedJson, decodePhotoIds } from "./json";

/**
 * Concept500 `settings` (EAV, one row per key, value column chosen by `setting_type`) → typed
 * Quartermaster settings groups, following LEGACY_KEY_MAP / DROPPED_LEGACY_KEYS in
 * src/server/settings/schema.ts. Pure: returns patches; the settings step merges them into the
 * stored rows and validates with the group schema.
 */

export type MappedSettings = {
  /** Deep patches per settings group (only keys with a usable legacy value). */
  groups: Partial<Record<SettingsGroup, Record<string, unknown>>>;
  tenant: { currency?: string; timezone?: string };
  /** legacy keys that produced a value */
  applied: string[];
  /** legacy keys present but empty/default → nothing to apply */
  empty: string[];
  /** legacy keys intentionally dropped, with the reason */
  dropped: { key: string; reason: string }[];
  /** legacy keys with no mapping at all */
  unmapped: string[];
  /** human-readable notes (no personal data) */
  warnings: string[];
  /** Cloudflare image ids of logo/banner/cta (not downloaded — local storage only) */
  images: { key: string; ids: string[] }[];
  /** display currencies derived from the legacy `currencies` table */
  displayCurrencies: string[];
};

/** Value as the legacy `Setting::getValueAttribute` returned it (raw string / JSON). */
export function legacySettingValue(row: LegacySetting): string | null {
  const type = (row.setting_type ?? "").toLowerCase();
  const pick = (v: string | null) => (v === null || v === undefined ? null : String(v));
  switch (type) {
    case "boolean":
      // Seed bug: some boolean keys have their value in string_value; prefer boolean_value.
      return pick(row.boolean_value) ?? pick(row.string_value) ?? pick(row.value);
    case "string":
      return pick(row.string_value) ?? pick(row.value);
    case "int":
      return pick(row.int_value) ?? pick(row.value);
    case "enum":
      return pick(row.list_value) ?? pick(row.value);
    case "image":
      return pick(row.image_value) ?? pick(row.value);
    case "list":
      return pick(row.list) ?? pick(row.value);
    default:
      return pick(row.value) ?? pick(row.string_value);
  }
}

function toBool(v: string | null): boolean | null {
  if (v === null) return null;
  const s = v.trim().toLowerCase();
  if (["1", "true", "on", "yes"].includes(s)) return true;
  if (["0", "false", "off", "no", ""].includes(s)) return false;
  return null;
}

function toInt(v: string | null): number | null {
  if (v === null || v.trim() === "") return null;
  const n = Number(v.trim());
  return Number.isInteger(n) ? n : null;
}

/** "#abc", "abc", "#AABBCC", "rgb(…)"-less inputs → "#aabbcc"; null when not a hex colour. */
export function normalizeHexColor(v: string | null): string | null {
  if (!v) return null;
  let s = v.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split("").map((c) => c + c).join("");
  return /^[0-9a-f]{6}$/i.test(s) ? `#${s.toLowerCase()}` : null;
}

const SORT_MAP: Record<string, string> = {
  featured: "featured",
  highlow: "price_desc",
  lowhigh: "price_asc",
  newest: "newest",
  oldest: "oldest",
  lastupdated: "updated",
  updated: "updated",
};

/** Sets `patch[a][b][c] = value` for a dotted path like "appearance.colors.primary". */
function setPath(groups: MappedSettings["groups"], path: string, value: unknown) {
  const [group, ...rest] = path.split(".") as [SettingsGroup, ...string[]];
  const root = (groups[group] ??= {});
  let node: Record<string, unknown> = root;
  for (let i = 0; i < rest.length - 1; i++) node = (node[rest[i]] ??= {}) as Record<string, unknown>;
  node[rest[rest.length - 1]] = value;
}

export function mapLegacySettings(rows: readonly LegacySetting[], currencies: readonly string[] = []): MappedSettings {
  const out: MappedSettings = { groups: {}, tenant: {}, applied: [], empty: [], dropped: [], unmapped: [], warnings: [], images: [], displayCurrencies: [] };
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const raw = (key: string) => {
    const row = byKey.get(key);
    return row ? legacySettingValue(row) : null;
  };
  const handledTogether = new Set<string>();

  for (const row of rows) {
    const key = row.key;
    if (handledTogether.has(key)) continue;
    if (Object.hasOwn(DROPPED_LEGACY_KEYS, key)) {
      out.dropped.push({ key, reason: DROPPED_LEGACY_KEYS[key] });
      continue;
    }
    const mapping = LEGACY_KEY_MAP[key];
    if (!mapping) {
      out.unmapped.push(key);
      continue;
    }
    const value = raw(key);
    const apply = (path: string, v: unknown) => {
      setPath(out.groups, path, v);
      out.applied.push(key);
    };
    const empty = () => out.empty.push(key);

    switch (key) {
      case "currency": {
        const code = (value ?? "").trim().toUpperCase();
        if (/^[A-Z]{3}$/.test(code)) {
          out.tenant.currency = code;
          out.applied.push(key);
        } else empty();
        break;
      }
      case "timezone": {
        const tz = (value ?? "").trim();
        // Legacy default was UTC (never chosen deliberately) → keep the tenant's own default.
        if (tz && tz !== "UTC" && isValidTimeZone(tz)) {
          out.tenant.timezone = tz;
          out.applied.push(key);
        } else empty();
        break;
      }
      case "matomo_id": {
        const id = toInt(value);
        if (id && id > 0) {
          apply("analytics.matomoSiteId", id);
          out.warnings.push("matomo_id set: analytics.provider stays 'own' until a Matomo URL is entered (Settings → Analytics).");
        } else empty();
        break;
      }
      case "list_or_grid_view": {
        const v = (value ?? "").trim().toLowerCase();
        if (v.startsWith("list")) apply("catalog.layout", "list");
        else if (v.startsWith("grid")) apply("catalog.layout", "grid");
        else empty();
        break;
      }
      case "shop_display_amount": {
        const n = toInt(value);
        if (n === 3 || n === 4) apply("catalog.gridColumns", n);
        else empty();
        break;
      }
      case "shop_selected_filter": {
        const mapped = SORT_MAP[(value ?? "").trim().toLowerCase()];
        if (mapped) apply("catalog.defaultSort", mapped);
        else empty();
        break;
      }
      case "toggle_listview_stock_code":
      case "toggle_gridview_stock_code": {
        // Merged into one flag: use the key belonging to the active layout.
        handledTogether.add("toggle_listview_stock_code");
        handledTogether.add("toggle_gridview_stock_code");
        const layout = (raw("list_or_grid_view") ?? "grid").toLowerCase().startsWith("list") ? "list" : "grid";
        const preferred = toBool(raw(`toggle_${layout}view_stock_code`));
        const other = toBool(raw(`toggle_${layout === "list" ? "grid" : "list"}view_stock_code`));
        const v = preferred ?? other;
        if (v === null) empty();
        else {
          setPath(out.groups, "catalog.showStockCode", v);
          for (const k of ["toggle_listview_stock_code", "toggle_gridview_stock_code"]) if (byKey.has(k)) out.applied.push(k);
        }
        break;
      }
      case "purchase_information":
      case "show_purchase_price": {
        handledTogether.add("purchase_information");
        handledTogether.add("show_purchase_price");
        const a = toBool(raw("purchase_information"));
        const b = toBool(raw("show_purchase_price"));
        if (a === null && b === null) empty();
        else {
          setPath(out.groups, "catalog.purchaseRecords", Boolean(a) || Boolean(b));
          for (const k of ["purchase_information", "show_purchase_price"]) if (byKey.has(k)) out.applied.push(k);
        }
        break;
      }
      case "age_verify": {
        const b = toBool(value);
        if (b === null) empty();
        else apply("legal.ageVerification", b ? "popup" : "off");
        break;
      }
      case "reserved_time": {
        const seconds = toInt(value);
        if (seconds === null) empty();
        else {
          const minutes = Math.min(60, Math.max(5, Math.round(seconds / 60)));
          if (minutes * 60 !== seconds) out.warnings.push(`reserved_time ${seconds}s → ${minutes} min (clamped to 5–60).`);
          apply("checkout.reservationMinutes", minutes);
        }
        break;
      }
      case "default_specs": {
        const decoded = decodeNestedJson(value);
        const list = decoded.ok && decoded.value !== null ? decoded.value : null;
        const names = Array.isArray(list)
          ? list.map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>).key ?? (x as Record<string, unknown>).name : x))
          : list && typeof list === "object"
            ? Object.values(list as object)
            : [];
        const specs = names.map((x) => String(x ?? "").trim().slice(0, 80)).filter(Boolean).slice(0, 50);
        if (specs.length) apply("catalog.defaultSpecs", specs);
        else empty();
        break;
      }
      case "logo":
      case "banner_image":
      case "cta_image": {
        const { ids } = decodePhotoIds(value);
        if (ids.length) {
          out.images.push({ key, ids });
          out.warnings.push(`${key}: Cloudflare image not downloaded (upload it again under Settings → Appearance).`);
        }
        empty();
        break;
      }
      case "primary_color":
      case "secondary_color":
      case "tertiary_color": {
        const hex = normalizeHexColor(value);
        if (hex) apply(mapping.to, hex);
        else empty();
        break;
      }
      case "heading_font":
      case "text_font": {
        const font = (value ?? "").trim();
        if (!font) empty();
        else if ((FONT_ALLOWLIST as readonly string[]).includes(font)) apply(mapping.to, font);
        else {
          out.warnings.push(`${key}: font "${font.slice(0, 40)}" is not in the allow-list → default kept.`);
          empty();
        }
        break;
      }
      case "subscription_type": {
        const plan = (value ?? "").trim().toLowerCase();
        if (["bronze", "silver", "gold"].includes(plan)) apply("platform.plan", plan);
        else empty();
        break;
      }
      case "maximum_items":
      case "maximum_item_photos": {
        const n = toInt(value);
        // 0 / empty = "no limit" in legacy → null (plan default).
        if (n !== null && n > 0) apply(mapping.to, key === "maximum_item_photos" ? Math.min(100, n) : n);
        else empty();
        break;
      }
      case "emailer_quota": {
        const n = toInt(value);
        if (n !== null && n >= -1) apply("platform.newsletterQuota", n);
        else empty();
        break;
      }
      case "default_sku": {
        const n = toInt(value);
        if (n !== null && n >= 0) apply("catalog.skuStart", n);
        else empty();
        break;
      }
      case "shop_name":
      case "email":
      case "confirmation_message": {
        const s = (value ?? "").trim();
        if (s) apply(mapping.to, s);
        else empty();
        break;
      }
      default: {
        // Plain boolean flags.
        const b = toBool(value);
        if (b === null) empty();
        else apply(mapping.to, b);
      }
    }
  }

  // Display currencies: the legacy `currencies` table minus the base currency, allow-listed.
  const base = out.tenant.currency ?? "EUR";
  const display = [...new Set(currencies.map((c) => c.trim().toUpperCase()))].filter(
    (c) => c !== base && (DISPLAY_CURRENCIES as readonly string[]).includes(c),
  );
  if (display.length) {
    setPath(out.groups, "general.displayCurrencies", display);
    out.displayCurrencies = display;
  }
  const skippedCurrencies = currencies.filter((c) => c.trim().toUpperCase() !== base && !display.includes(c.trim().toUpperCase()));
  if (skippedCurrencies.length) out.warnings.push(`currencies not supported for display: ${skippedCurrencies.join(", ")}`);

  out.applied = [...new Set(out.applied)];
  return out;
}

/**
 * Merges a patch into stored settings data and validates with the group schema. Invalid patched keys
 * are reverted to the stored/default value (reported), so a bad legacy value never breaks a group.
 */
export function mergeAndValidate(
  group: SettingsGroup,
  current: unknown,
  patch: Record<string, unknown>,
): { data: Record<string, unknown>; rejected: string[] } {
  const schema = SETTINGS_SCHEMAS[group];
  const merged = mergeSettings(current ?? {}, patch);
  const first = schema.safeParse(merged);
  if (first.success) return { data: first.data as Record<string, unknown>, rejected: [] };
  const rejected = [...new Set(first.error.issues.map((i) => String(i.path[0] ?? "*")))];
  const trimmed: Record<string, unknown> = { ...patch };
  for (const k of rejected) delete trimmed[k];
  const second = schema.safeParse(mergeSettings(current ?? {}, trimmed));
  if (second.success) return { data: second.data as Record<string, unknown>, rejected };
  const fallback = schema.safeParse(current ?? {});
  return { data: (fallback.success ? fallback.data : schema.parse({})) as Record<string, unknown>, rejected: ["*"] };
}
