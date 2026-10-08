/**
 * Shopify product CSV (Products → Export → "CSV for Excel" or "Plain CSV") → SourceProduct[]. Pure.
 *
 * A product spans several rows with the same Handle: the first carries the product fields, further
 * rows add variants and/or extra images (Image Src + Image Position).
 *
 * Decisions (docs/import.md):
 *  - products with several variants → ONE item using the first variant (price, SKU, stock), forced to
 *    draft for review; the other variants are not imported (warning).
 *  - category: the merchant's own "Type" (one level); without a Type, the last segment of Shopify's
 *    standard "Product Category" taxonomy (its full path is generic, e.g. "Apparel & Accessories > …").
 *  - published in the source = Status "active" (and Published not FALSE); "archived" items are drafts.
 *  - gift cards are skipped.
 */
import { columnIndex, type CsvTable } from "./csv";
import { parseCount } from "./woocommerce";
import { ImportFormatError, type ParsedSource, type RowMessage, type SourceProduct } from "./types";

const H = {
  handle: ["Handle"],
  title: ["Title"],
  body: ["Body (HTML)", "Body HTML"],
  vendor: ["Vendor"],
  productCategory: ["Product Category", "Product category"],
  type: ["Type", "Product Type"],
  tags: ["Tags"],
  published: ["Published"],
  option1Value: ["Option1 Value"],
  sku: ["Variant SKU"],
  grams: ["Variant Grams"],
  tracker: ["Variant Inventory Tracker"],
  qty: ["Variant Inventory Qty"],
  price: ["Variant Price"],
  compareAt: ["Variant Compare At Price"],
  imageSrc: ["Image Src"],
  imagePosition: ["Image Position"],
  variantImage: ["Variant Image"],
  giftCard: ["Gift Card"],
  seoTitle: ["SEO Title"],
  seoDescription: ["SEO Description"],
  cost: ["Cost per item"],
  status: ["Status"],
} as const;

export function looksLikeShopify(headers: string[]): boolean {
  const col = columnIndex(headers);
  return col(...H.handle) >= 0 && col(...H.title) >= 0 && (col(...H.price) >= 0 || col(...H.body) >= 0);
}

const isTrue = (v: string) => /^(true|yes|1)$/i.test(v.trim());

export function parseShopify(table: CsvTable): ParsedSource {
  const { headers, records } = table;
  if (!looksLikeShopify(headers)) {
    throw new ImportFormatError("This does not look like a Shopify product export (columns “Handle” and “Title” are missing).");
  }
  const col = columnIndex(headers);
  const idx = Object.fromEntries(Object.entries(H).map(([k, names]) => [k, col(...names)])) as Record<keyof typeof H, number>;

  const notes: string[] = [];
  if (idx.imageSrc < 0) notes.push("No “Image Src” column — no photos will be downloaded.");
  if (idx.qty < 0) notes.push("No “Variant Inventory Qty” column — every product is imported as one item.");

  const columns: ParsedSource["columns"] = [];
  const used = new Set<number>();
  const map = (i: number, becomes: string) => {
    if (i < 0) return;
    used.add(i);
    columns.push({ column: headers[i], becomes });
  };
  map(idx.title, "Title");
  map(idx.body, "Description (Markdown)");
  map(idx.price, "Price");
  map(idx.compareAt, "“On sale” (when above price)");
  map(idx.sku, "SKU");
  map(idx.type, "Category");
  map(idx.productCategory, "Category (when no Type)");
  map(idx.tags, "Tags");
  map(idx.imageSrc, "Photos (downloaded)");
  map(idx.imagePosition, "Photo order");
  map(idx.variantImage, "Photos (variant)");
  map(idx.qty, "Stock");
  map(idx.tracker, "Stock tracked?");
  map(idx.grams, "Weight (g)");
  map(idx.status, "Status");
  map(idx.published, "Status");
  map(idx.seoTitle, "SEO title");
  map(idx.seoDescription, "SEO description");
  map(idx.cost, "Purchase price");
  map(idx.handle, "Source id (re-import key)");
  map(idx.option1Value, "Variants (first one used)");
  map(idx.giftCard, "Gift cards (skipped)");
  const ignoredColumns = headers.filter((h, i) => !used.has(i) && h.trim() !== "");

  type Group = { handle: string; rows: { row: number; cells: string[] }[] };
  const groups = new Map<string, Group>();
  const skipped: RowMessage[] = [];
  for (const rec of records) {
    const handle = (rec.cells[idx.handle] ?? "").trim();
    if (!handle) {
      skipped.push({ row: rec.row, message: "No Handle — skipped." });
      continue;
    }
    let g = groups.get(handle);
    if (!g) groups.set(handle, (g = { handle, rows: [] }));
    g.rows.push(rec);
  }

  const products: SourceProduct[] = [];
  for (const g of groups.values()) {
    const get = (cells: string[], i: number) => (i >= 0 ? (cells[i] ?? "") : "");
    const main = g.rows.find((r) => get(r.cells, idx.title).trim()) ?? g.rows[0];
    const m = (i: number) => get(main.cells, i);
    const title = m(idx.title).trim();
    if (!title) {
      skipped.push({ row: g.rows[0].row, message: `“${g.handle}” has no title — skipped.` });
      continue;
    }
    if (isTrue(m(idx.giftCard))) {
      skipped.push({ row: main.row, message: `“${title}” is a gift card — skipped.` });
      continue;
    }

    const variantRows = g.rows.filter((r) => get(r.cells, idx.sku).trim() || get(r.cells, idx.price).trim() || get(r.cells, idx.option1Value).trim());
    const first = variantRows[0] ?? main;
    const v = (i: number) => get(first.cells, i).trim();

    // Images: Image Src rows ordered by Image Position (then file order), then variant images.
    const imgs: { url: string; pos: number; order: number }[] = [];
    g.rows.forEach((r, order) => {
      const url = get(r.cells, idx.imageSrc).trim();
      if (url) {
        const pos = Number(get(r.cells, idx.imagePosition).trim());
        imgs.push({ url, pos: Number.isFinite(pos) && pos > 0 ? pos : 10_000 + order, order });
      }
    });
    imgs.sort((a, b) => a.pos - b.pos || a.order - b.order);
    const images = imgs.map((i) => i.url);
    for (const r of variantRows) {
      const url = get(r.cells, idx.variantImage).trim();
      if (url) images.push(url);
    }

    const tracked = idx.tracker < 0 ? idx.qty >= 0 : v(idx.tracker) !== "";
    const qty = idx.qty >= 0 ? parseCount(v(idx.qty)) : null;
    const status = m(idx.status).trim().toLowerCase();
    const publishedCell = m(idx.published).trim();
    const published =
      idx.status >= 0 ? status === "active" && !/^(false|no|0)$/i.test(publishedCell) : idx.published < 0 || isTrue(publishedCell);
    const productType = m(idx.type).trim();
    const taxonomy = m(idx.productCategory)
      .split(">")
      .map((s) => s.trim())
      .filter(Boolean);
    const category = productType ? [productType] : taxonomy.length ? [taxonomy[taxonomy.length - 1]] : null;
    const price = v(idx.price);
    const compareAt = v(idx.compareAt);
    const grams = Number(v(idx.grams));

    const p: SourceProduct = {
      sourceId: `handle:${g.handle}`,
      row: main.row,
      title,
      descriptionHtml: m(idx.body),
      shortDescriptionHtml: "",
      sku: v(idx.sku) || null,
      published,
      // Shopify: Variant Price is what the customer pays; Compare At is the struck-through "was" price.
      regularPrice: compareAt && Number(compareAt) > Number(price) ? compareAt : price,
      salePrice: compareAt && Number(compareAt) > Number(price) ? price : "",
      costPrice: v(idx.cost),
      categories: category ? [category] : [],
      tags: m(idx.tags)
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      images: [...new Set(images)],
      stock: tracked ? qty : null,
      weightGrams: Number.isFinite(grams) && v(idx.grams) !== "" ? Math.round(grams) : null,
      seoTitle: m(idx.seoTitle).trim(),
      seoDescription: m(idx.seoDescription).trim(),
      variants: variantRows.length > 1 ? variantRows.length : 0,
      needsReview: variantRows.length > 1,
      warnings: [],
    };
    if (status === "archived") p.warnings.push("Archived in Shopify — imported as draft.");
    if (variantRows.length > 1) {
      p.warnings.push(`${variantRows.length} variants: imported as one draft item using the first variant — the others are not imported.`);
    }
    products.push(p);
  }
  products.sort((a, b) => a.row - b.row);

  return { products, skipped, notes, columns, ignoredColumns, rows: records.length };
}
