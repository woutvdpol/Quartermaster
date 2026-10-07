// Demo facets + compliance for "concept-militaria" (run after db:seed and db:seed:demo):
//
//   npx tsx --import ./scripts/server-only-shim.mjs scripts/seed-facets-demo.ts
//
//  1. seedDefaultFacets: Period / Country / Branch / Unit / Type / Maker with starter values.
//  2. Converts the demo tags into facet values (convertTagsToFacet, tags deleted afterwards):
//     periods → Period, countries → Country, Heer/Luftwaffe/Kriegsmarine/Army → Branch (matched by
//     name, so Heer lands under Army › Heer), KNIL → Branch under Army, Infantry/Airborne → Unit.
//  3. Type values from the top-level categories, assigned to the products in each category subtree.
//  4. One example compliance rule: hide items with restricted symbols for DE + AT (§86a StGB).
// Idempotent: converted tags are gone on a second run; values/rules are matched by name.
import "dotenv/config";

const TENANT = process.argv[2] ?? "concept-militaria";

const GROUPS: { facet: string; tags: string[]; parent?: string }[] = [
  { facet: "period", tags: ["WW1", "Interbellum", "WW2", "Cold War"] },
  { facet: "country", tags: ["Germany", "Netherlands", "Belgium", "France", "United Kingdom", "USA", "Soviet Union"] },
  { facet: "branch", tags: ["Heer", "Luftwaffe", "Kriegsmarine", "Army"] },
  { facet: "branch", tags: ["KNIL"], parent: "Army" },
  { facet: "unit", tags: ["Infantry", "Airborne"] },
];

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo data in production.");
  const { db } = await import("../src/server/db");
  const facets = await import("../src/server/facets");
  const compliance = await import("../src/server/compliance");

  const tenant = await db.tenant.findUnique({ where: { slug: TENANT } });
  if (!tenant) throw new Error(`Tenant "${TENANT}" not found — run npm run db:seed first.`);
  const owner = await db.user.findFirst({ where: { OR: [{ tenantId: tenant.id, role: "OWNER" }, { role: "SUPERADMIN" }] }, orderBy: { role: "asc" } });
  if (!owner) throw new Error("No owner or superadmin user found.");
  const ctx = { tenantId: tenant.id, actor: { id: owner.id, role: owner.role, tenantId: owner.tenantId, email: owner.email } };

  const seeded = await facets.seedDefaultFacets(tenant.id, owner.id);
  console.log(`Default facets: +${seeded.facetsCreated} facets, +${seeded.valuesCreated} values`);

  const bySlug = new Map((await db.facet.findMany({ where: { tenantId: tenant.id } })).map((f) => [f.slug, f]));
  for (const group of GROUPS) {
    const facet = bySlug.get(group.facet);
    if (!facet) continue;
    const tags = await db.tag.findMany({ where: { tenantId: tenant.id, name: { in: group.tags } }, select: { id: true } });
    if (!tags.length) continue;
    let parentId: string | null = null;
    if (group.parent) {
      parentId = (await db.facetValue.findFirst({ where: { facetId: facet.id, name: group.parent }, select: { id: true } }))?.id ?? null;
    }
    const res = await facets.convertTagsToFacet(ctx, tags.map((t) => t.id), facet.id, { parentId, deleteTags: true });
    console.log(`Tags → ${facet.name}: ${res.created} created, ${res.reused} reused, ${res.linked} links, ${res.deletedTags} tags deleted`);
  }

  // Type facet from the top-level categories.
  const type = bySlug.get("type");
  if (type) {
    const cats = await db.category.findMany({ where: { tenantId: tenant.id }, select: { id: true, parentId: true, title: true } });
    let links = 0;
    for (const root of cats.filter((c) => !c.parentId)) {
      const subtree = facets.descendantIds(cats, root.id);
      const products = await db.product.findMany({ where: { tenantId: tenant.id, categoryId: { in: subtree } }, select: { id: true } });
      if (!products.length) continue;
      const value =
        (await db.facetValue.findFirst({ where: { facetId: type.id, name: root.title } })) ?? (await facets.createFacetValue(ctx, type.id, { name: root.title }));
      for (let i = 0; i < products.length; i += 400) {
        links += (await facets.assignFacetValues(ctx, products.slice(i, i + 400).map((p) => p.id), [value.id])).linked;
      }
    }
    console.log(`Type facet: ${links} product links`);
  }

  const ruleName = "§86a — hide restricted symbols (DE, AT)";
  if (!(await db.complianceRule.findFirst({ where: { tenantId: tenant.id, name: ruleName } }))) {
    await compliance.createComplianceRule(ctx, { name: ruleName, match: "RESTRICTED_SYMBOLS", countries: ["DE", "AT"], action: "HIDE_PRODUCT", note: "§86a StGB / §3 VerbotsG" });
    console.log("Compliance: example rule created");
  }
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
