import { describe, expect, it } from "vitest";
import { SHOP_LOCALES } from "./shop-locales";

/*
 * Every shop UI dictionary bundle (`…Copies = localized({ en, nl, de })`) must have every English key in
 * Dutch and German, with the same kind of value (string/function/object/array) and no empty strings.
 * The types (CopyShape) already enforce the keys; this also catches `as` casts and blank translations.
 */

const modules = {
  ...import.meta.glob("/src/components/shop/**/_copy*.ts", { eager: true }),
  ...import.meta.glob("/src/app/\\(shop\\)/**/_copy*.ts", { eager: true }),
  ...import.meta.glob("/src/server/provenance/copy.ts", { eager: true }),
} as Record<string, Record<string, unknown>>;

type Bundle = Record<(typeof SHOP_LOCALES)[number], unknown>;

const bundles: [string, Bundle][] = Object.entries(modules).flatMap(([file, mod]) =>
  Object.entries(mod)
    .filter(([name, v]) => name.endsWith("Copies") && v && typeof v === "object" && "en" in v)
    .map(([name, v]) => [`${file.replace(/^\/src\//, "")} ${name}`, v as Bundle] as [string, Bundle]),
);

function kind(v: unknown): string {
  return Array.isArray(v) ? "array" : v === null ? "null" : typeof v;
}

/** Problems of `other` against `en`, as "path: problem" lines. */
function compare(en: unknown, other: unknown, path: string, out: string[]): void {
  if (kind(en) !== kind(other)) {
    out.push(`${path}: expected ${kind(en)}, got ${kind(other)}`);
    return;
  }
  if (typeof other === "string" && other.trim() === "" && typeof en === "string" && en.trim() !== "") out.push(`${path}: empty`);
  if (typeof en === "function") {
    // Plurals etc.: must return a non-empty string for typical arguments.
    try {
      const sample = (other as (...a: unknown[]) => unknown)(1, 2, 3);
      if (typeof sample === "string" && sample.trim() === "") out.push(`${path}(): empty`);
    } catch {
      /* functions with object arguments — the type check covers them */
    }
    return;
  }
  if (en && typeof en === "object" && !Array.isArray(en)) {
    const a = en as Record<string, unknown>;
    const b = other as Record<string, unknown>;
    for (const k of Object.keys(a)) {
      if (!(k in b)) out.push(`${path}.${k}: missing`);
      else compare(a[k], b[k], `${path}.${k}`, out);
    }
    for (const k of Object.keys(b)) if (!(k in a)) out.push(`${path}.${k}: not in English`);
  }
}

describe("shop dictionaries", () => {
  it("finds the bundles", () => {
    expect(bundles.length).toBeGreaterThanOrEqual(10);
  });

  it.each(bundles)("%s is complete in every language", (_name, bundle) => {
    for (const locale of SHOP_LOCALES) {
      if (locale === "en") continue;
      const problems: string[] = [];
      compare(bundle.en, bundle[locale], locale, problems);
      expect(problems).toEqual([]);
    }
  });
});
