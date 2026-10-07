import { nextFreeSlug, slugify } from "../../../src/server/catalog/slug";
import { parseBlock, type ParsedBlock } from "../../../src/server/content/blocks";
import { MAX_PAGE_SLUG_LENGTH, MENU_CHILD_LIMIT, MENU_ROOT_LIMITS, RESERVED_SLUGS, SYSTEM_PAGES, SYSTEM_PAGE_KEYS, type SystemPageKey } from "../../../src/server/content/rules";
import { SYSTEM_PAGE_STARTER_BLOCKS } from "../../../src/server/content/starter";
import type { ContentBlockType, MenuLocation } from "../../../src/generated/prisma/enums";
import { json, type EtlContext, type Tx } from "../context";
import type { LegacyContent, LegacyContentBlock, LegacyMenuItem } from "../legacy/types";
import { legacySettingValue } from "../transforms/settings";
import { cleanMarkdown, countCloudflareImageRefs, htmlToMarkdown, looksLikeHtml } from "../transforms/text";
import { relativizeLegacyUrl, type UrlMaps } from "../transforms/urls";
import { LEGACY_CONTENT_PAGES, SYSTEM_KEY_PAGES, loadUrlMaps } from "./urlmaps";

const clip = (s: string | null | undefined, max: number) => (s ?? "").trim().slice(0, max);

type BlockDraft = { type: ContentBlockType; data: unknown; isVisible: boolean };

/** Legacy content_blocks row → block draft (null = not migratable, with reason). */
export function mapContentBlock(
  b: LegacyContentBlock,
  link: (url: string | null) => string | null,
  productId: string | null,
): { block: BlockDraft | null; reason?: string; lostImages: number } {
  const md = (s: string | null) => cleanMarkdown(s ?? "", (h) => link(h));
  const lostImages = b.image && b.image.trim() && b.image.trim() !== "[]" && b.image.trim() !== "null" ? 1 : 0;
  const href = link(b.button_link) ?? link(b.site_link);
  const cta = href ? { label: clip(b.link_text, 50) || "View", href } : null;
  const title = clip(b.title, 100);
  const type = (b.type ?? "").trim().toUpperCase();
  let draft: { type: ContentBlockType; data: unknown };
  switch (type) {
    case "HERO":
      draft = { type: "HERO", data: { title: title || "Welcome", subtitle: clip(md(b.content), 300), imageKey: null, cta } };
      break;
    case "TEXT":
      draft = { type: "TEXT", data: { title, markdown: md(b.content), cta } };
      break;
    case "TEXT_HORIZONTAL":
      draft = { type: "TEXT_HORIZONTAL", data: { title, markdown: md(b.content) } };
      break;
    case "TEXT_IMAGE":
      draft = { type: "TEXT_IMAGE", data: { title, markdown: md(b.content), imageKey: null, imagePosition: "left", cta } };
      break;
    case "TEXT_PRODUCT":
      draft = { type: "TEXT_PRODUCT", data: { title, markdown: md(b.content), productId } };
      break;
    case "TEXT_CAROUSEL":
      draft = { type: "TEXT_CAROUSEL", data: { title, markdown: md(b.content), imageKeys: [] } };
      break;
    case "QUOTE":
      draft = { type: "QUOTE", data: { quote: clip(md(b.content), 500) || title || "…", author: clip(b.author, 100) } };
      break;
    case "CTA":
      draft = {
        type: "CTA",
        data: { title: title || "Shop", text: clip(md(b.content), 200), buttonLabel: clip(b.link_text, 50) || "View", href: href ?? "/shop", imageKey: null },
      };
      break;
    case "TESTIMONIAL":
      draft = {
        type: "TESTIMONIAL",
        data: { quote: clip(md(b.content), 1000) || title || "…", author: clip(b.author, 100) || title || "Customer", link: cta },
      };
      break;
    case "NEW_ITEMS":
      draft = { type: "NEW_ITEMS", data: { title, count: Math.min(24, Math.max(1, b.amount ?? 6)), cta } };
      break;
    case "GALLERY":
      draft = { type: "GALLERY", data: { title, imageKeys: [] } };
      break;
    case "CATEGORIES":
      draft = { type: "CATEGORIES", data: { title, categoryIds: [] } };
      break;
    case "EMAILER":
    case "NEWSLETTER_SIGNUP":
      draft = { type: "NEWSLETTER_SIGNUP", data: { title: title || "Newsletter", text: clip(md(b.content), 500) } };
      break;
    default:
      return { block: null, reason: `onbekend bloktype ${type.slice(0, 30)}`, lostImages };
  }
  const parsed = parseBlock(draft.type, draft.data);
  if (!parsed.ok) return { block: null, reason: `ongeldig ${draft.type}: ${parsed.issues.map((i) => i.path).join(",")}`, lostImages };
  return { block: { type: parsed.block.type, data: parsed.block.data, isVisible: true }, lostImages };
}

/** Legacy `contents` items of one ShopPageEnum page → TEXT blocks. */
export function mapContentItems(items: readonly LegacyContent[], link: (url: string | null) => string | null): BlockDraft[] {
  const out: BlockDraft[] = [];
  for (const it of items) {
    const raw = it.content ?? "";
    let markdown = looksLikeHtml(raw) ? htmlToMarkdown(raw, (h) => link(h)) : cleanMarkdown(raw, (h) => link(h));
    const dates = [it.start_date, it.end_date].filter((d): d is Date => !!d).map((d) => d.toISOString().slice(0, 10));
    if (dates.length) markdown = `*${dates.join(" – ")}*\n\n${markdown}`;
    if (it.contact) {
      try {
        const c = JSON.parse(it.contact) as Record<string, unknown>;
        const lines = Object.entries(c)
          .filter(([, v]) => v !== null && v !== "")
          .map(([k, v]) => `**${k}:** ${String(v)}`);
        if (lines.length) markdown = `${markdown}\n\n${lines.join("\n")}`.trim();
      } catch {
        /* not JSON → ignore */
      }
    }
    const href = link(it.url);
    const parsed = parseBlock("TEXT", { title: clip(it.title, 100), markdown: markdown.slice(0, 20_000), cta: href ? { label: "Visit", href } : null });
    if (parsed.ok) out.push({ type: "TEXT", data: parsed.block.data, isVisible: it.active !== 0 });
  }
  return out;
}

async function replaceBlocks(tx: Tx, tenantId: string, pageId: string, blocks: readonly BlockDraft[]) {
  // HERO rule: at most one, always first.
  const hero = blocks.filter((b) => b.type === "HERO").slice(0, 1);
  const ordered = [...hero, ...blocks.filter((b) => b.type !== "HERO")];
  await tx.contentBlock.deleteMany({ where: { pageId } });
  if (ordered.length) {
    await tx.contentBlock.createMany({
      data: ordered.map((b, i) => ({ tenantId, pageId, type: b.type, data: json(b.data), sortOrder: i, isVisible: b.isVisible })),
    });
  }
  return ordered.length;
}

async function freeSlug(tx: Tx, tenantId: string, wanted: string, excludeId: string | null): Promise<string> {
  const base = (slugify(wanted, MAX_PAGE_SLUG_LENGTH) || "page").replace(/^home$/, "home-page");
  const rows = await tx.contentPage.findMany({
    where: { tenantId, OR: [{ slug: base }, { slug: { startsWith: `${base}-` } }], ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    select: { slug: true },
  });
  const taken = [...rows.map((r) => r.slug), ...RESERVED_SLUGS];
  return nextFreeSlug(base, taken);
}

/**
 * CMS: legacy `content_pages` + `content_blocks` (page builder) and `contents` (fixed pages: terms,
 * privacy, news, …) → ContentPage + ContentBlock; `menu_items` → MenuItem. Absolute links to the old
 * shop become relative and are mapped to the new routes; Cloudflare images are not migrated (the
 * block keeps no image; reported). Missing system pages are created as drafts with starter blocks.
 */
export async function contentStep(ctx: EtlContext) {
  const { tx, report, tenantId } = ctx;
  const legacyPages = await ctx.legacy.read("content_pages");
  const legacyBlocks = await ctx.legacy.read("content_blocks");
  const contents = await ctx.legacy.read("contents");
  const settings = await ctx.legacy.read("settings");
  report.legacy("content pages", legacyPages.length);
  report.legacy("content blocks", legacyBlocks.length);
  report.legacy("content items (contents)", contents.length);

  const flag = (key: string) => {
    const row = settings.find((s) => s.key === key);
    const v = row ? legacySettingValue(row) : null;
    return v === null ? null : ["1", "true", "on"].includes(v.trim().toLowerCase());
  };

  // ── 1. Page rows (slugs first, so links between pages can be mapped) ──
  const pageIdByLegacy = new Map<number, string>();
  for (const lp of legacyPages) {
    const isHome = lp.url.trim().replace(/^\/+|\/+$/g, "").toLowerCase() === "home" || lp.slug.trim().toLowerCase() === "home";
    let page = await tx.contentPage.findFirst({ where: { tenantId, legacyId: lp.id } });
    if (!page && isHome) page = await tx.contentPage.findFirst({ where: { tenantId, systemKey: "HOME" } });
    const title = clip(lp.title, 200) || "Page";
    const publishedAt = lp.created_at ?? ctx.now;
    if (page) {
      const slug = isHome ? page.slug : await freeSlug(tx, tenantId, lp.slug || lp.url || title, page.id);
      await tx.contentPage.update({ where: { id: page.id }, data: { legacyId: lp.id, title, slug, publishedAt: page.publishedAt ?? publishedAt } });
      report.updated("content pages");
    } else {
      const slug = isHome ? await freeSlugHome(tx, tenantId) : await freeSlug(tx, tenantId, lp.slug || lp.url || title, null);
      page = await tx.contentPage.create({
        data: { tenantId, legacyId: lp.id, title, slug, systemKey: isHome ? "HOME" : null, publishedAt, ...(lp.created_at ? { createdAt: lp.created_at } : {}) },
      });
      report.created("content pages");
    }
    if (page.slug !== slugify(lp.slug || lp.url || "") && !isHome) report.note("Slug-botsingen", `CMS-pagina legacy #${lp.id}: slug aangepast naar "${page.slug}"`);
    pageIdByLegacy.set(lp.id, page.id);
  }

  const groups = new Map<string, LegacyContent[]>();
  for (const c of contents) groups.set(c.page.toUpperCase(), [...(groups.get(c.page.toUpperCase()) ?? []), c]);
  const contentPageIds = new Map<string, string>();
  for (const key of LEGACY_CONTENT_PAGES) {
    const items = groups.get(key) ?? [];
    const visible = flag(key.toLowerCase());
    const isSystem = SYSTEM_KEY_PAGES.has(key);
    let page = isSystem
      ? await tx.contentPage.findFirst({ where: { tenantId, systemKey: key } })
      : await tx.contentPage.findFirst({ where: { tenantId, slug: key.toLowerCase(), systemKey: null } });
    if (!items.length && !isSystem) continue;
    if (!page) {
      const def = isSystem ? SYSTEM_PAGES[key as SystemPageKey] : { slug: key.toLowerCase(), title: key.charAt(0) + key.slice(1).toLowerCase() };
      page = await tx.contentPage.create({
        data: {
          tenantId,
          systemKey: isSystem ? key : null,
          title: def.title,
          slug: await freeSlug(tx, tenantId, def.slug, null),
          publishedAt: items.length && visible !== false ? ctx.now : null,
        },
      });
      report.created("content pages");
      if (!items.length) {
        await replaceBlocks(tx, tenantId, page.id, SYSTEM_PAGE_STARTER_BLOCKS[key as SystemPageKey].map((b: ParsedBlock) => ({ ...b, isVisible: true })));
        report.note("CMS", `Systeempagina ${key} aangemaakt als concept met startblokken (geen legacy-inhoud)`);
      }
    } else if (items.length) {
      await tx.contentPage.update({ where: { id: page.id }, data: { publishedAt: visible === false ? null : (page.publishedAt ?? ctx.now) } });
      report.updated("content pages");
    }
    if (items.length) contentPageIds.set(key, page.id);
  }
  if (groups.has("BANNER")) report.skip("content items (contents)", "BANNER (vervangen door appearance.bannerPath)", groups.get("BANNER")!.length);
  for (const [key, items] of groups) {
    if (!(LEGACY_CONTENT_PAGES as readonly string[]).includes(key) && key !== "BANNER") report.skip("content items (contents)", `pagina ${key.slice(0, 20)} niet ondersteund`, items.length);
  }
  for (const key of SYSTEM_PAGE_KEYS) {
    if (key === "HOME" && !(await tx.contentPage.findFirst({ where: { tenantId, systemKey: "HOME" } }))) {
      const page = await tx.contentPage.create({ data: { tenantId, systemKey: "HOME", title: SYSTEM_PAGES.HOME.title, slug: await freeSlugHome(tx, tenantId), publishedAt: null } });
      await replaceBlocks(tx, tenantId, page.id, SYSTEM_PAGE_STARTER_BLOCKS.HOME.map((b) => ({ ...b, isVisible: true })));
      report.created("content pages");
    }
  }

  // ── 2. Blocks (now that every page has its final slug) ──
  const maps: UrlMaps = await loadUrlMaps(ctx);
  const link = (url: string | null) => relativizeLegacyUrl(url, maps, ctx.options.legacyHosts);
  const products = new Map(
    (await tx.product.findMany({ where: { tenantId, stockCode: { in: legacyBlocks.map((b) => b.product_id ?? 0) } }, select: { id: true, stockCode: true } })).map((p) => [p.stockCode, p.id]),
  );
  let lostImages = 0;
  let cfInText = 0;
  for (const lp of legacyPages) {
    const blocks: BlockDraft[] = [];
    for (const b of legacyBlocks.filter((x) => x.content_page_id === lp.id)) {
      const res = mapContentBlock(b, link, b.product_id !== null ? (products.get(b.product_id) ?? null) : null);
      lostImages += res.lostImages;
      cfInText += countCloudflareImageRefs(b.content ?? "");
      if (res.block) blocks.push(res.block);
      else report.skip("content blocks", res.reason ?? "ongeldig");
    }
    const n = await replaceBlocks(tx, tenantId, pageIdByLegacy.get(lp.id)!, blocks);
    report.created("content blocks", n);
  }
  const orphan = legacyBlocks.filter((b) => !pageIdByLegacy.has(b.content_page_id)).length;
  if (orphan) report.skip("content blocks", "pagina ontbreekt", orphan);
  for (const [key, pageId] of contentPageIds) {
    const items = groups.get(key) ?? [];
    for (const it of items) cfInText += countCloudflareImageRefs(it.content ?? "");
    const n = await replaceBlocks(tx, tenantId, pageId, mapContentItems(items, link));
    report.created("content items (contents)", n);
  }
  if (lostImages) report.warn(`${lostImages} content block(s) had Cloudflare images → not migrated (re-upload in the page editor)`);
  if (cfInText) report.warn(`${cfInText} Cloudflare image URL(s) inside content text kept as links (imagedelivery.net) — replace after the photo migration`);

  await menusStep(ctx, link);
}

async function freeSlugHome(tx: Tx, tenantId: string) {
  const rows = await tx.contentPage.findMany({ where: { tenantId, OR: [{ slug: "home" }, { slug: { startsWith: "home-" } }] }, select: { slug: true } });
  return nextFreeSlug("home", rows.map((r) => r.slug));
}

/** Menu target for a legacy URL: page → pageId, fixed routes → qm:route:…, categories → qm:category:…. */
async function menuTarget(tx: Tx, tenantId: string, href: string | null): Promise<{ url: string | null; pageId: string | null }> {
  if (!href) return { url: null, pageId: null };
  const routes: Record<string, string> = { "/": "home", "/shop": "shop", "/cart": "cart", "/account": "account", "/account/wishlist": "wishlist" };
  if (routes[href]) return { url: `qm:route:${routes[href]}`, pageId: null };
  const cat = /^\/shop\/category\/([^/?#]+)$/.exec(href);
  if (cat) {
    const c = await tx.category.findFirst({ where: { tenantId, slug: decodeURIComponent(cat[1]) }, select: { id: true } });
    if (c) return { url: `qm:category:${c.id}`, pageId: null };
  }
  const page = /^\/([a-z0-9-]+)$/.exec(href);
  if (page) {
    const p = await tx.contentPage.findFirst({ where: { tenantId, slug: page[1] }, select: { id: true } });
    if (p) return { url: null, pageId: p.id };
  }
  return { url: href, pageId: null };
}

/**
 * Legacy menu_items → MenuItem (two levels). Legacy seed bug: footer sub-items pointed at the header
 * "Contact" item (parent 4) instead of the footer root (5) → items whose parent has another location
 * are re-attached to the (single) root of their own location. MenuItem has no legacy id, so menus are
 * only imported when the tenant has none yet (re-runs skip; delete the menus to re-import).
 */
async function menusStep(ctx: EtlContext, link: (url: string | null) => string | null) {
  const { tx, report, tenantId } = ctx;
  const items = await ctx.legacy.read("menu_items");
  report.legacy("menu items", items.length);
  if (!items.length) return;
  if ((await tx.menuItem.count({ where: { tenantId } })) > 0) {
    report.skip("menu items", "tenant heeft al menu's (niet overschreven)", items.length);
    return;
  }
  const loc = (m: LegacyMenuItem): MenuLocation => ((m.location ?? "").toUpperCase() === "FOOTER" ? "FOOTER" : "HEADER");
  const byId = new Map(items.map((m) => [m.id, m]));
  const roots = items.filter((m) => m.parent_id === null);
  const children = items.filter((m) => m.parent_id !== null);
  const parentOf = new Map<number, number | null>();
  for (const c of children) {
    const parent = byId.get(c.parent_id!);
    if (parent && loc(parent) === loc(c) && parent.parent_id === null) parentOf.set(c.id, parent.id);
    else {
      const sameLoc = roots.filter((r) => loc(r) === loc(c));
      parentOf.set(c.id, sameLoc.length === 1 ? sameLoc[0].id : null);
      report.note("Menu's", `menu-item legacy #${c.id}: ouder #${c.parent_id} hoorde bij ander menu → ${sameLoc.length === 1 ? `#${sameLoc[0].id}` : "hoofdniveau"}`);
    }
  }
  const newIds = new Map<number, string>();
  const rootCount: Record<MenuLocation, number> = { HEADER: 0, FOOTER: 0 };
  const childCount = new Map<number, number>();
  const ordered = [...items].sort((a, b) => a.order - b.order || a.id - b.id);
  for (const m of ordered.filter((x) => x.parent_id === null || parentOf.get(x.id) === null)) {
    const location = loc(m);
    if (rootCount[location] >= MENU_ROOT_LIMITS[location]) {
      report.skip("menu items", `meer dan ${MENU_ROOT_LIMITS[location]} hoofditems in ${location}`);
      continue;
    }
    const label = clip(m.main_name ?? m.sub_name, 50) || (location === "FOOTER" ? "Information" : "Menu");
    const target = await menuTarget(tx, tenantId, link(m.url ?? m.sub_url));
    if (location === "HEADER" && !target.url && !target.pageId && !items.some((c) => parentOf.get(c.id) === m.id)) {
      report.skip("menu items", "hoofditem zonder link of subitems");
      continue;
    }
    const row = await tx.menuItem.create({ data: { tenantId, location, label, sortOrder: rootCount[location]++, ...target } });
    newIds.set(m.id, row.id);
    report.created("menu items");
  }
  for (const m of ordered.filter((x) => x.parent_id !== null && parentOf.get(x.id) !== null)) {
    const parentLegacy = parentOf.get(m.id)!;
    const parentId = newIds.get(parentLegacy);
    if (!parentId) {
      report.skip("menu items", "ouder niet geïmporteerd");
      continue;
    }
    const n = childCount.get(parentLegacy) ?? 0;
    if (n >= MENU_CHILD_LIMIT) {
      report.skip("menu items", `meer dan ${MENU_CHILD_LIMIT} subitems`);
      continue;
    }
    const target = await menuTarget(tx, tenantId, link(m.sub_url ?? m.url));
    if (!target.url && !target.pageId) {
      report.skip("menu items", "subitem zonder link");
      continue;
    }
    childCount.set(parentLegacy, n + 1);
    await tx.menuItem.create({
      data: { tenantId, location: loc(byId.get(parentLegacy)!), parentId, label: clip(m.sub_name ?? m.main_name, 50) || "Link", sortOrder: n, ...target },
    });
    report.created("menu items");
  }
}
