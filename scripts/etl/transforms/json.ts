/**
 * Concept500 stores JSON in TEXT columns and often encodes it twice (the model cast `array` plus a
 * manual `json_encode`), e.g. `products.photos` = `"[\"65944cf5-…\",\"cfed22ae-…\"]"`.
 * These helpers decode single- and double-encoded values robustly.
 */

export type DecodeResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** JSON.parse repeatedly while the result is still a string (max 3 levels). Empty/null → null. */
export function decodeNestedJson(raw: string | null | undefined): DecodeResult<unknown> {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  let value: unknown = raw;
  for (let depth = 0; depth < 3 && typeof value === "string"; depth++) {
    const s = value.trim();
    if (s === "" || s === "null") return { ok: true, value: null };
    try {
      value = JSON.parse(s);
    } catch {
      return { ok: false, error: "invalid JSON" };
    }
  }
  return { ok: true, value };
}

// Cloudflare Images ids are UUID-like ("65944cf5-72f3-4e12-be78-fe2d817ca800") but custom ids may be
// any path-safe string; accept a conservative charset.
const CF_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Decodes `products.photos` (or `content_blocks.image` / `settings.image_value`) into an ordered,
 * de-duplicated list of Cloudflare image ids. The first id is the cover photo.
 */
export function decodePhotoIds(raw: string | null | undefined): { ids: string[]; invalid: string[]; error?: string } {
  const decoded = decodeNestedJson(raw);
  if (!decoded.ok) return { ids: [], invalid: [], error: decoded.error };
  const value = decoded.value;
  if (value === null) return { ids: [], invalid: [] };
  const list = Array.isArray(value) ? value : typeof value === "object" ? Object.values(value as object) : [value];
  const ids: string[] = [];
  const invalid: string[] = [];
  for (const item of list) {
    const id = typeof item === "string" ? item.trim() : typeof item === "number" ? String(item) : "";
    if (!id) continue;
    if (!CF_ID.test(id)) {
      invalid.push(id.slice(0, 40));
      continue;
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return { ids, invalid };
}

export type Specification = { label: string; value: string };

/**
 * `products.specifications` (Backpack "table" field, columns key/value) → `[{ label, value }]`.
 * Accepts `[{key, value}]`, `[{label, value}]`, `{ key: value }` and double encoding. Rows without a
 * label and value are dropped; lengths are capped like the admin form.
 */
export function decodeSpecifications(raw: string | null | undefined): { specs: Specification[] | null; error?: string } {
  const decoded = decodeNestedJson(raw);
  if (!decoded.ok) return { specs: null, error: decoded.error };
  const value = decoded.value;
  if (value === null) return { specs: null };
  const out: Specification[] = [];
  const push = (label: unknown, val: unknown) => {
    const l = label === null || label === undefined ? "" : String(label).trim();
    const v = val === null || val === undefined ? "" : String(val).trim();
    if (!l && !v) return;
    out.push({ label: l.slice(0, 80), value: v.slice(0, 500) });
  };
  if (Array.isArray(value)) {
    for (const row of value) {
      if (row && typeof row === "object") {
        const r = row as Record<string, unknown>;
        push(r.key ?? r.label ?? r.name, r.value ?? r.specification);
      }
    }
  } else if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) push(k, v);
  } else {
    return { specs: null, error: "unexpected specifications shape" };
  }
  return { specs: out.length ? out : null };
}
