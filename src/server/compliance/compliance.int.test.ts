import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { ServiceContext } from "@/server/context";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { createCategory } from "@/server/catalog/categories";
import { createProduct } from "@/server/catalog/products";
import { createComplianceRule, deleteComplianceRule, getComplianceRule, listComplianceRules, setComplianceRuleActive, updateComplianceRule } from "./rules";
import { complianceHideFilter, loadCompiledRules, resolveCompliance, testCompliance } from "./resolve";
import { assertDeactivationCertOnFile, deactivationCertBlockers } from "./guard";
import { visitorCountry } from "./country";

describe("compliance", () => {
  let a: ServiceContext;
  let b: ServiceContext;
  beforeEach(async () => {
    await resetDb();
    a = await createTenantContext();
    b = await createTenantContext();
  });

  it("validates and manages rules", async () => {
    const cat = await createCategory(a, { title: "Third Reich" });
    await expect(createComplianceRule(a, { name: "x", match: "CATEGORY", countries: ["DE"], action: "HIDE_PRODUCT" })).rejects.toMatchObject({ code: "INVALID" });
    await expect(createComplianceRule(a, { name: "x", match: "AGE_RESTRICTED", countries: ["ZZ"], action: "HIDE_PRODUCT" })).rejects.toMatchObject({ code: "INVALID" });
    await expect(createComplianceRule(a, { name: "x", match: "AGE_RESTRICTED", countries: [], action: "HIDE_PRODUCT" })).rejects.toMatchObject({ code: "INVALID" });
    const catB = await createCategory(b, { title: "Other" });
    await expect(createComplianceRule(a, { name: "x", match: "CATEGORY", categoryId: catB.id, countries: ["DE"], action: "HIDE_PRODUCT" })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const rule = await createComplianceRule(a, { name: "§86a", match: "CATEGORY", categoryId: cat.id, countries: ["at", "DE", "de"], action: "HIDE_PRODUCT", note: "§86a StGB" });
    expect(rule).toMatchObject({ countries: ["AT", "DE"], category: { title: "Third Reich" }, isActive: true });
    // Non-category rules drop the category.
    const updated = await updateComplianceRule(a, rule.id, { name: "Symbols", match: "RESTRICTED_SYMBOLS", categoryId: cat.id, countries: ["FR"], action: "BLUR_IMAGES" });
    expect(updated).toMatchObject({ categoryId: null, countries: ["FR"], action: "BLUR_IMAGES", note: null });
    await setComplianceRuleActive(a, rule.id, false);
    expect((await getComplianceRule(a, rule.id)).isActive).toBe(false);

    await expect(getComplianceRule(b, rule.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateComplianceRule(b, rule.id, { name: "x", match: "AGE_RESTRICTED", countries: ["DE"], action: "NO_SHIPPING" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteComplianceRule(b, rule.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await listComplianceRules(b)).toEqual([]);
    await deleteComplianceRule(a, rule.id);
    expect(await listComplianceRules(a)).toEqual([]);
  });

  it("resolves verdicts by category subtree, flags and country", async () => {
    const root = await createCategory(a, { title: "Germany" });
    const child = await createCategory(a, { title: "Heer", parentId: root.id });
    const grand = await createCategory(a, { title: "Helmets", parentId: child.id });
    const other = await createCategory(a, { title: "Dutch" });
    const helmet = await createProduct(a, { title: "M40", categoryId: grand.id });
    const dutch = await createProduct(a, { title: "M34", categoryId: other.id });
    const symbols = await createProduct(a, { title: "Cap", restrictedSymbols: true, categoryId: other.id });
    const age = await createProduct(a, { title: "Bayonet", ageRestricted: true });
    const gun = await createProduct(a, { title: "Kar98k deko" });
    await db.product.update({ where: { id: gun.id }, data: { requiresDeactivationCert: true } });

    await createComplianceRule(a, { name: "Hide DE", match: "CATEGORY", categoryId: child.id, countries: ["DE", "AT"], action: "HIDE_PRODUCT" });
    await createComplianceRule(a, { name: "Blur symbols", match: "RESTRICTED_SYMBOLS", countries: ["FR"], action: "BLUR_IMAGES", note: "R645-1" });
    await createComplianceRule(a, { name: "No age items UK", match: "AGE_RESTRICTED", countries: ["GB"], action: "NO_SHIPPING" });
    await createComplianceRule(a, { name: "No guns US", match: "DEACTIVATED_WEAPON", countries: ["US"], action: "NO_SHIPPING" });
    const off = await createComplianceRule(a, { name: "Inactive", match: "RESTRICTED_SYMBOLS", countries: ["NL"], action: "HIDE_PRODUCT" });
    await setComplianceRuleActive(a, off.id, false);

    const ids = [helmet.id, dutch.id, symbols.id, age.id, gun.id];
    const de = await resolveCompliance(a.tenantId, ids, "de");
    expect(de[helmet.id]).toMatchObject({ hidden: true, noShipping: true, blurred: false });
    expect(de[helmet.id].reasons.map((r) => r.name)).toEqual(["Hide DE"]);
    expect(de[dutch.id]).toMatchObject({ hidden: false, blurred: false, noShipping: false, reasons: [] });

    const fr = await resolveCompliance(a.tenantId, ids, "FR");
    expect(fr[symbols.id]).toMatchObject({ blurred: true, hidden: false, reasons: [{ note: "R645-1", action: "BLUR_IMAGES" }] });
    expect(fr[helmet.id].hidden).toBe(false);
    expect((await resolveCompliance(a.tenantId, ids, "GB"))[age.id]).toMatchObject({ noShipping: true, hidden: false });
    expect((await resolveCompliance(a.tenantId, ids, "US"))[gun.id]).toMatchObject({ noShipping: true });
    expect((await resolveCompliance(a.tenantId, ids, "NL"))[symbols.id].hidden).toBe(false); // inactive rule

    // Unknown / no country: no geo rules.
    const none = await resolveCompliance(a.tenantId, ids, null);
    expect(Object.values(none).every((v) => !v.hidden && !v.blurred && !v.noShipping)).toBe(true);
    expect((await resolveCompliance(a.tenantId, ids, "XX"))[helmet.id].hidden).toBe(false);

    // Hide predicate for listings.
    expect(await complianceHideFilter(a.tenantId, "DE")).toEqual({ categoryIds: [child.id, grand.id].sort(), restrictedSymbols: false, ageRestricted: false, deactivatedWeapons: false });
    expect(await complianceHideFilter(a.tenantId, "FR")).toBeNull();
    expect(await complianceHideFilter(a.tenantId, null)).toBeNull();

    // Moving a category under the ruled subtree is picked up on the next compile.
    await db.category.update({ where: { id: other.id }, data: { parentId: root.id } });
    expect((await loadCompiledRules(a.tenantId)).find((r) => r.name === "Hide DE")?.categoryIds).not.toContain(other.id);
    await db.category.update({ where: { id: other.id }, data: { parentId: child.id } });
    expect((await loadCompiledRules(a.tenantId)).find((r) => r.name === "Hide DE")?.categoryIds).toContain(other.id);

    // Tenant isolation: other tenant's ids are omitted; their rules do not apply.
    const pb = await createProduct(b, { title: "B", categoryId: null });
    expect(Object.keys(await resolveCompliance(a.tenantId, [pb.id], "DE"))).toEqual([]);
    expect((await resolveCompliance(b.tenantId, [pb.id], "DE"))[pb.id].hidden).toBe(false);

    const t = await testCompliance(a, { stockCode: (await db.product.findUniqueOrThrow({ where: { id: helmet.id } })).stockCode, countryCode: "AT" });
    expect(t.verdict.hidden).toBe(true);
    await expect(testCompliance(b, { stockCode: 999999, countryCode: "AT" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("requires a deactivation certificate before going live", async () => {
    const gun = await createProduct(a, { title: "MP40 deko", price: 1000 });
    const plain = await createProduct(a, { title: "Helmet", price: 1000 });
    await db.product.update({ where: { id: gun.id }, data: { requiresDeactivationCert: true } });
    await expect(db.$transaction((tx) => assertDeactivationCertOnFile(tx, gun.id))).rejects.toMatchObject({ code: "INVALID" });
    await expect(assertDeactivationCertOnFile(db, plain.id)).resolves.toBeUndefined();
    expect((await deactivationCertBlockers(db, a.tenantId, [gun.id, plain.id])).map((x) => x.id)).toEqual([gun.id]);
    await db.productDocument.create({
      data: { tenantId: a.tenantId, productId: gun.id, kind: "PROVENANCE", title: "Letter", storageKey: "k1", mimeType: "application/pdf", byteSize: 1 },
    });
    await expect(assertDeactivationCertOnFile(db, gun.id, a.tenantId)).rejects.toMatchObject({ code: "INVALID" });
    await db.productDocument.create({
      data: { tenantId: a.tenantId, productId: gun.id, kind: "DEACTIVATION_CERT", title: "Cert", storageKey: "k2", mimeType: "application/pdf", byteSize: 1 },
    });
    await expect(assertDeactivationCertOnFile(db, gun.id, a.tenantId)).resolves.toBeUndefined();
    expect(await deactivationCertBlockers(db, b.tenantId, [gun.id])).toEqual([]);
  });

  it("reads the visitor country from edge headers only", () => {
    expect(visitorCountry(new Headers({ "cf-ipcountry": "de" }))).toBe("DE");
    expect(visitorCountry(new Headers({ "cf-ipcountry": "XX", "x-vercel-ip-country": "AT" }))).toBe("AT");
    expect(visitorCountry(new Headers({ "x-country": "fr" }))).toBe("FR");
    expect(visitorCountry(new Headers({ "cf-ipcountry": "T1", "accept-language": "de-DE" }))).toBeNull();
    expect(visitorCountry(null)).toBeNull();
  });
});
