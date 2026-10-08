/**
 * WooCommerce product CSV (built-in exporter: Products → Export) → SourceProduct[]. Pure.
 *
 * Decisions (docs/import.md):
 *  - simple products → one item each.
 *  - variable products → ONE item (the parent), forced to draft for review; its price comes from the
 *    parent or else the first variation. Variation rows are not imported as separate items (warning).
 *  - grouped and external/affiliate products are skipped (no physical item of their own).
 *  - several categories → the first one is used (our products have one category); a note says so.
 *  - WooCommerce escapes commas in list values as "\," and prefixes formula-like cells with "'" — both
 *    are undone here; literal "\n" in descriptions become newlines.
 */
import { columnIndex, headerKey, type CsvTable } from "./csv";
import { ImportFormatError, type ParsedSource, type RowMessage, type SourceProduct } from "./types";

// English headers of the WooCommerce exporter, plus best-effort Dutch/German translations (the
// exporter writes headers in the site language).
const H = {
  id: ["ID"],
  type: ["Type", "Typ"],
  sku: ["SKU", "Artikelnummer"],
  name: ["Name", "Naam"],
  published: ["Published", "Gepubliceerd", "Veröffentlicht"],
  shortDescription: ["Short description", "Korte beschrijving", "Kurzbeschreibung"],
  description: ["Description", "Beschrijving", "Beschreibung"],
  regularPrice: ["Regular price", "Reguliere prijs", "Regulärer Preis"],
  salePrice: ["Sale price", "Actieprijs", "Angebotspreis"],
  categories: ["Categories", "Categorieën", "Kategorien"],
  tags: ["Tags", "Schlagwörter"],
  images: ["Images", "Afbeeldingen", "Bilder"],
  stock: ["Stock", "Voorraad", "Bestand"],
  inStock: ["In stock?", "Op voorraad?", "Vorrätig?"],
  parent: ["Parent", "Hoofd", "Übergeordnetes Produkt"],
  seoTitle: ["Meta: _yoast_wpseo_title", "Meta: rank_math_title"],
  seoDescription: ["Meta: _yoast_wpseo_metadesc", "Meta: rank_math_description"],
  cost: ["Meta: _wc_cog_cost", "Meta: _alg_wc_cog_cost", "Meta: _purchase_price"],
} as const;

const WEIGHT_FACTORS: Record<string, number> = { kg: 1000, g: 1, lbs: 453.59237, lb: 453.59237, oz: 28.349523 };

/** WooCommerce prefixes cells starting with = + - @ (CSV injection guard) with a quote. */
export function unescapeWooCell(v: string): string {
  return /^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v;
}

/** Splits a WooCommerce list value ("A, B\, C" → ["A", "B, C"]). */
export function splitWooList(v: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < v.length; i++) {
    const ch = v[i];
    if (ch === "\\" && v[i + 1] === ",") {
      cur += ",";
      i++;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Parses a stock / quantity cell; null when empty or not a number. */
export function parseCount(v: string): number | null {
  const s = v.trim();
  if (!/^-?\d+([.,]0+)?$/.test(s)) return null;
  return Math.trunc(Number(s.replace(",", ".")));
}

function parseDecimal(v: string): number | null {
  const s = v.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/** True when the headers look like a WooCommerce product export. */
export function looksLikeWooCommerce(headers: string[]): boolean {
  const col = columnIndex(headers);
  return col(...H.name) >= 0 && col(...H.regularPrice) >= 0 && (col(...H.type) >= 0 || col(...H.sku) >= 0);
}

export function parseWooCommerce(table: CsvTable): ParsedSource {
  const { headers, records } = table;
  if (!looksLikeWooCommerce(headers)) {
    throw new ImportFormatError("This does not look like a WooCommerce product export (columns “Name” and “Regular price” are missing).");
  }
  const col = columnIndex(headers);
  const idx = Object.fromEntries(Object.entries(H).map(([k, names]) => [k, col(...names)])) as Record<keyof typeof H, number>;
  const weightIdx = headers.findIndex((h) => /^(weight|gewicht)\s*\(/i.test(h.trim()));
  const weightUnit = weightIdx >= 0 ? (/\(([^)]+)\)/.exec(headers[weightIdx])?.[1] ?? "kg").trim().toLowerCase() : "kg";
  const weightFactor = WEIGHT_FACTORS[weightUnit] ?? null;

  const notes: string[] = [];
  if (weightIdx >= 0 && weightFactor === null) notes.push(`Unknown weight unit “${weightUnit}” — weights are not imported.`);
  if (idx.images < 0) notes.push("No “Images” column — no photos will be downloaded.");

  const columns: ParsedSource["columns"] = [];
  const used = new Set<number>();
  const map = (i: number, becomes: string) => {
    if (i < 0) return;
    used.add(i);
    columns.push({ column: headers[i], becomes });
  };
  map(idx.name, "Title");
  map(idx.description, "Description (Markdown)");
  map(idx.shortDescription, "Description (Markdown, first)");
  map(idx.regularPrice, "Price");
  map(idx.salePrice, "Price + “on sale”");
  map(idx.sku, "SKU");
  map(idx.categories, "Category tree (first category)");
  map(idx.tags, "Tags");
  map(idx.images, "Photos (downloaded)");
  map(idx.stock, "Stock");
  map(idx.inStock, "Stock (when not tracked)");
  map(weightIdx, "Weight (g)");
  map(idx.published, "Status");
  map(idx.seoTitle, "SEO title");
  map(idx.seoDescription, "SEO description");
  map(idx.cost, "Purchase price");
  map(idx.type, "Product type (simple / variable)");
  map(idx.id, "Source id (re-import key)");
  map(idx.parent, "Variation parent");
  const ignoredColumns = headers.filter((h, i) => !used.has(i) && h.trim() !== "");

  const products: SourceProduct[] = [];
  const skipped: RowMessage[] = [];
  const byId = new Map<string, SourceProduct>();
  const bySku = new Map<string, SourceProduct>();
  const variations: { row: number; parentRef: string; price: string; sale: string }[] = [];

  for (const rec of records) {
    const cell = (i: number) => (i >= 0 ? unescapeWooCell(rec.cells[i] ?? "") : "");
    const types = cell(idx.type)
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    const name = cell(idx.name).trim();

    if (types.includes("variation")) {
      variations.push({ row: rec.row, parentRef: cell(idx.parent).trim(), price: cell(idx.regularPrice), sale: cell(idx.salePrice) });
      continue;
    }
    if (types.includes("grouped")) {
      skipped.push({ row: rec.row, message: `“${name || "(no name)"}” is a grouped product (a container of other products) — skipped.` });
      continue;
    }
    if (types.includes("external")) {
      skipped.push({ row: rec.row, message: `“${name || "(no name)"}” is an external/affiliate product — skipped.` });
      continue;
    }
    if (!name) {
      skipped.push({ row: rec.row, message: "No product name — skipped." });
      continue;
    }

    const id = cell(idx.id).trim();
    const sku = cell(idx.sku).trim() || null;
    const sourceId = id ? `id:${id}` : sku ? `sku:${sku}` : `row:${rec.row}`;
    if (byId.has(sourceId) || (sku && bySku.has(sku) && !id)) {
      skipped.push({ row: rec.row, message: `Duplicate product (${sourceId.replace(":", " ")}) — skipped.` });
      continue;
    }

    let stock = parseCount(cell(idx.stock));
    if (stock === null) {
      const inStock = cell(idx.inStock).trim().toLowerCase();
      stock = inStock === "0" || inStock === "no" || inStock === "outofstock" ? 0 : null;
    }
    const weight = weightIdx >= 0 && weightFactor !== null ? parseDecimal(cell(weightIdx)) : null;
    const categories = splitWooList(cell(idx.categories)).map((path) =>
      path
        .split(">")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    const images = splitWooList(cell(idx.images))
      .map((u) => u.split(" ! ")[0].trim())
      .filter(Boolean);

    const product: SourceProduct = {
      sourceId,
      row: rec.row,
      title: name,
      descriptionHtml: cell(idx.description).replace(/\\n/g, "\n"),
      shortDescriptionHtml: cell(idx.shortDescription).replace(/\\n/g, "\n"),
      sku,
      published: idx.published < 0 ? true : cell(idx.published).trim() === "1",
      regularPrice: cell(idx.regularPrice).trim(),
      salePrice: cell(idx.salePrice).trim(),
      costPrice: cell(idx.cost).trim(),
      categories: categories.filter((p) => p.length > 0),
      tags: splitWooList(cell(idx.tags)),
      images: [...new Set(images)],
      stock,
      weightGrams: weight === null || weightFactor === null ? null : Math.round(weight * weightFactor),
      seoTitle: cell(idx.seoTitle).trim(),
      seoDescription: cell(idx.seoDescription).trim(),
      variants: 0,
      needsReview: types.includes("variable"),
      warnings: [],
    };
    if (types.includes("variable")) product.warnings.push("Variable product: imported as one draft item — check price and stock.");
    if (product.categories.length > 1) {
      product.warnings.push(`Several categories — using “${product.categories[0].join(" › ")}”.`);
    }
    products.push(product);
    byId.set(sourceId, product);
    if (sku) bySku.set(sku, product);
  }

  for (const v of variations) {
    const ref = v.parentRef;
    const parent = /^id:/i.test(ref) ? byId.get(`id:${ref.slice(3).trim()}`) : (bySku.get(ref) ?? byId.get(`id:${ref}`));
    if (!parent) {
      skipped.push({ row: v.row, message: `Variation without a parent product in this file (“${ref || "no parent"}”) — skipped.` });
      continue;
    }
    parent.variants += 1;
    if (!parent.regularPrice && v.price.trim()) {
      parent.regularPrice = v.price.trim();
      parent.salePrice = v.sale.trim();
    }
    skipped.push({ row: v.row, message: `Variation of “${parent.title}” — variations are not imported as separate items.` });
  }
  for (const p of products) {
    if (p.variants > 0) p.warnings.push(`${p.variants} variation${p.variants === 1 ? "" : "s"} not imported separately.`);
  }

  return { products, skipped, notes, columns, ignoredColumns, rows: records.length };
}

/** Exposed for tests: normalised header keys the parser recognises. */
export const WOO_HEADER_KEYS = Object.values(H).flat().map(headerKey);
