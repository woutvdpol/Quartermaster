import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { ServiceError, type ServiceContext } from "@/server/context";
import { createProduct } from "@/server/catalog/products";
import { createTag } from "@/server/catalog/tags";
import { createFacet, createFacetValue } from "@/server/facets";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { createRedirect, deleteRedirect, exportRedirectsCsv, getRedirect, importRedirectsCsv, listRedirects, updateRedirect } from "./index";
import { directRedirectDeps, flushRedirectHits, recordRedirectHits, resolveRedirect } from "./lookup";

const code = (p: Promise<unknown>) =>
  p.then(
    () => "OK",
    (e) => (e instanceof ServiceError ? e.code : `THREW ${String(e)}`),
  );

const resolve = (ctx: ServiceContext, path: string) => resolveRedirect(ctx.tenantId, path, directRedirectDeps);

describe("redirects service + lookup", () => {
  let a: ServiceContext;
  let b: ServiceContext;
  beforeEach(async () => {
    await resetDb();
    a = await createTenantContext({ slug: "a" });
    b = await createTenantContext({ slug: "b" });
    await db.tenantDomain.create({ data: { tenantId: a.tenantId, host: "shop-a.test", isPrimary: true } });
  });

  it("creates normalised manual redirects, audits and resolves them", async () => {
    const r = await createRedirect(a, { fromPath: "https://old.example/Over-Ons/?utm_source=x", toPath: "https://shop-a.test/pages/about", statusCode: 301 });
    expect(r).toMatchObject({ fromPath: "/over-ons", toPath: "/pages/about", statusCode: 301, source: "MANUAL" });
    expect(await db.auditLog.count({ where: { tenantId: a.tenantId, action: "redirect.create" } })).toBe(1);

    expect(await resolve(a, "/Over-Ons")).toEqual({ target: "/pages/about", statusCode: 301, ids: [r.id] });
    expect(await resolve(a, "/over-ons/?page=2")).toMatchObject({ target: "/pages/about" });
    expect(await resolve(a, "/nope")).toBeNull();
  });

  it("validates input: duplicates, self-redirects, loops, reserved and foreign targets", async () => {
    await createRedirect(a, { fromPath: "/a", toPath: "/b" });
    expect(await code(createRedirect(a, { fromPath: "/A/", toPath: "/c" }))).toBe("INVALID"); // duplicate
    expect(await code(createRedirect(a, { fromPath: "/x", toPath: "/X/" }))).toBe("INVALID");
    expect(await code(createRedirect(a, { fromPath: "/b", toPath: "/a" }))).toBe("INVALID"); // loop
    expect(await code(createRedirect(a, { fromPath: "/", toPath: "/shop" }))).toBe("INVALID");
    expect(await code(createRedirect(a, { fromPath: "/admin/x", toPath: "/shop" }))).toBe("INVALID");
    expect(await code(createRedirect(a, { fromPath: "/y", toPath: "https://evil.example/" }))).toBe("INVALID");
    expect(await code(createRedirect(a, { fromPath: "/y", toPath: "//evil.example/" }))).toBe("INVALID");
    expect(await code(createRedirect(a, { fromPath: "/y", toPath: "/z", statusCode: 307 }))).toBe("INVALID");
    // Chains are allowed (each request is one hop); the same path in another shop is fine.
    expect(await code(createRedirect(a, { fromPath: "/b", toPath: "/c" }))).toBe("OK");
    expect(await code(createRedirect(b, { fromPath: "/a", toPath: "/z" }))).toBe("OK");
  });

  it("keeps shops apart (list, get, update, delete, lookup)", async () => {
    const mine = await createRedirect(a, { fromPath: "/old", toPath: "/new" });
    const theirs = await createRedirect(b, { fromPath: "/old", toPath: "/other" });
    expect((await listRedirects(a)).rows.map((r) => r.id)).toEqual([mine.id]);
    expect(await code(getRedirect(a, theirs.id))).toBe("NOT_FOUND");
    expect(await code(updateRedirect(a, theirs.id, { fromPath: "/old", toPath: "/hijack" }))).toBe("NOT_FOUND");
    expect(await code(deleteRedirect(a, theirs.id))).toBe("NOT_FOUND");
    expect(await resolve(a, "/old")).toMatchObject({ target: "/new" });
    expect(await resolve(b, "/old")).toMatchObject({ target: "/other" });
    expect(await db.redirect.count()).toBe(2);
  });

  it("legacy rows can be deleted but not edited; list filters, searches and sorts", async () => {
    const legacy = await db.redirect.create({ data: { tenantId: a.tenantId, fromPath: "/shop.php?code=7", toPath: "/product/7", source: "LEGACY", hits: 5, lastHitAt: new Date() } });
    const manual = await createRedirect(a, { fromPath: "/sale", toPath: "/shop", statusCode: 302 });
    expect(await code(updateRedirect(a, legacy.id, { fromPath: "/x", toPath: "/y" }))).toBe("CONFLICT");
    expect(await code(updateRedirect(a, manual.id, { fromPath: "/sale", toPath: "/archive", statusCode: 301 }))).toBe("OK");

    const all = await listRedirects(a, { sort: "hits", dir: "desc" });
    expect(all.counts).toEqual({ all: 2, MANUAL: 1, LEGACY: 1 });
    expect(all.rows.map((r) => r.id)).toEqual([legacy.id, manual.id]);
    expect((await listRedirects(a, { source: "LEGACY" })).rows.map((r) => r.id)).toEqual([legacy.id]);
    expect((await listRedirects(a, { q: "ARCHIVE" })).rows.map((r) => r.id)).toEqual([manual.id]);

    await deleteRedirect(a, legacy.id);
    expect(await code(getRedirect(a, legacy.id))).toBe("NOT_FOUND");
    expect(await db.auditLog.count({ where: { tenantId: a.tenantId, action: "redirect.delete" } })).toBe(1);
  });

  it("runtime: one hop, query-based rows, loops and unsafe ETL rows", async () => {
    await db.redirect.createMany({
      data: [
        { tenantId: a.tenantId, fromPath: "/x", toPath: "/y", source: "LEGACY" },
        { tenantId: a.tenantId, fromPath: "/y", toPath: "/z", source: "LEGACY", statusCode: 302 },
        { tenantId: a.tenantId, fromPath: "/loop-1", toPath: "/loop-2", source: "LEGACY" },
        { tenantId: a.tenantId, fromPath: "/loop-2", toPath: "/loop-1", source: "LEGACY" },
        { tenantId: a.tenantId, fromPath: "/evil", toPath: "https://evil.example/", source: "LEGACY" },
        { tenantId: a.tenantId, fromPath: "/page.php?id=3", toPath: "/pages/three", source: "LEGACY" },
      ],
    });
    expect(await resolve(a, "/x")).toMatchObject({ target: "/y", statusCode: 301 });
    expect(await resolve(a, "/y")).toMatchObject({ target: "/z", statusCode: 302 });
    expect(await resolve(a, "/loop-1")).toBeNull();
    expect(await resolve(a, "/evil")).toBeNull();
    expect(await resolve(a, "/page.php?id=3&utm_campaign=x")).toMatchObject({ target: "/pages/three" });
    expect(await resolve(a, "/page.php?id=4")).toBeNull();
    expect(await resolve(a, "/api/x")).toBeNull();
  });

  it("built-in Concept500 patterns: shop.php?code, static paths and tag names", async () => {
    const p = await createProduct(a, { title: "Stahlhelm M40", price: 1000, status: "ACTIVE" });
    await createProduct(b, { title: "Other shop", price: 1000, status: "ACTIVE" });
    const draft = await createProduct(a, { title: "Draft", price: 1000 });
    expect(await resolve(a, `/shop.php?code=${p.stockCode}`)).toEqual({ target: `/product/${p.stockCode}/stahlhelm-m40`, statusCode: 301, ids: [] });
    expect(await resolve(a, `/shop.php?code=${draft.stockCode}`)).toBeNull();
    expect(await resolve(a, "/shop.php?code=999999")).toBeNull();
    expect(await resolve(a, "/basket")).toMatchObject({ target: "/cart" });

    const period = await createFacet(a, { kind: "PERIOD", name: "Period" });
    await createFacetValue(a, period.id, { name: "WW1" });
    await createTag(a, { name: "Medals" });
    expect(await resolve(a, "/shop/tag/ww1")).toMatchObject({ target: "/shop/facet/period/ww1" });
    expect(await resolve(a, "/shop/tag/Medals")).toMatchObject({ target: "/shop?tag=medals" });
    expect(await resolve(b, "/shop/tag/ww1")).toBeNull();

    // A stored row wins over the built-in pattern.
    await createRedirect(a, { fromPath: "/basket", toPath: "/shop" });
    expect(await resolve(a, "/basket")).toMatchObject({ target: "/shop" });
  });

  it("counts hits after the fact", async () => {
    const r = await createRedirect(a, { fromPath: "/old", toPath: "/new" });
    recordRedirectHits([r.id]);
    recordRedirectHits([r.id]);
    await flushRedirectHits();
    const row = await getRedirect(a, r.id);
    expect(row.hits).toBe(2);
    expect(row.lastHitAt).toBeInstanceOf(Date);
  });

  it("imports and exports CSV", async () => {
    await db.redirect.create({ data: { tenantId: a.tenantId, fromPath: "/legacy", toPath: "/old-target", source: "LEGACY" } });
    const res = await importRedirectsCsv(a, ["from,to,status", "/one,/shop", '"/two";/cart', "/legacy,/new-target,302", "/bad,https://evil.example/", "/three,/archive,999", ""].join("\n"));
    expect(res.created).toBe(1);
    expect(res.updated).toBe(1);
    expect(res.errors.map((e) => e.line)).toEqual([3, 5, 6]); // ';' line under a ',' file, foreign target, bad status
    const legacy = await db.redirect.findFirstOrThrow({ where: { tenantId: a.tenantId, fromPath: "/legacy" } });
    expect(legacy).toMatchObject({ toPath: "/new-target", statusCode: 302, source: "MANUAL" });
    expect(await db.auditLog.count({ where: { tenantId: a.tenantId, action: "redirect.import" } })).toBe(1);

    const csv = await exportRedirectsCsv(a);
    expect(csv.split("\n")[0]).toBe("from,to,status,source,hits,last_hit");
    expect(csv).toContain("/one,/shop,301,MANUAL,0,");
    expect(await exportRedirectsCsv(b)).toBe("from,to,status,source,hits,last_hit\n");
  });
});
