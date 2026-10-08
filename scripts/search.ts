// Smart search CLI (docs/search.md § Ops).
//
//   npm run search -- reindex <tenant-slug>|--all [--force]
//   npm run search -- status <tenant-slug>
//   npm run search -- query <tenant-slug> "<query>" [--sold]
//   npm run search -- image <tenant-slug> <photo-file> ["<refinement>"]
//   npm run search -- similar <tenant-slug> <stockCode>
//   npm run search -- bench <tenant-slug> [--rounds 5]   p50/p95 of suggest / search / photo search
//
// Runs the app modules in-process (like the worker) against the embedder service at EMBEDDER_URL
// (start it with `npm run embedder`; model files: `npm run models:fetch`).
import "../src/server/jobs/node-runtime";
import { readFileSync } from "node:fs";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))] : NaN;
};
const r1 = (n: number) => Math.round(n * 10) / 10;

async function main() {
  await import("dotenv/config");
  const [cmd, a1, a2, a3] = process.argv.slice(2).filter((x) => !x.startsWith("--") || x === "--all");
  const { db } = await import("../src/server/db");
  const { getEmbedder, TEXT_MODEL, IMAGE_MODEL } = await import("../src/server/search/embedder");
  if (!process.env.EMBEDDER_URL) console.warn("EMBEDDER_URL is not set: lexical search only (start `npm run embedder`).");
  const tenantBySlug = async (slug: string | undefined) => {
    const t = slug ? await db.tenant.findUnique({ where: { slug }, select: { id: true, slug: true, currency: true } }) : null;
    if (!t) throw new Error(`Unknown tenant slug: ${slug}`);
    return t;
  };

  try {
    if (cmd === "reindex") {
      const { reindexTenant } = await import("../src/server/search/indexing");
      const tenants = a1 === "--all" ? await db.tenant.findMany({ select: { id: true, slug: true } }) : [await tenantBySlug(a1)];
      for (const t of tenants) {
        const started = performance.now();
        const res = await reindexTenant(t.id, {
          force: process.argv.includes("--force"),
          onProgress: (p) => void process.stdout.write(`\r${t.slug}: ${p.done}/${p.total} (text ${p.textEmbedded}, image ${p.imageEmbedded}, failed ${p.failed})   `),
        });
        console.log(`\n${t.slug}: done in ${Math.round((performance.now() - started) / 1000)} s`, res);
      }
    } else if (cmd === "status") {
      const t = await tenantBySlug(a1);
      const { indexStatus } = await import("../src/server/search/indexing");
      console.log(await indexStatus(t.id, { text: TEXT_MODEL.key, image: IMAGE_MODEL.key }));
    } else if (cmd === "query") {
      const t = await tenantBySlug(a1);
      const { searchProducts } = await import("../src/server/search/service");
      const e = await getEmbedder();
      await e?.load("text");
      await e?.load("imageText");
      const res = await searchProducts(t.id, { q: a2 ?? "", currency: t.currency, explain: process.argv.includes("--explain"), scope: { mode: process.argv.includes("--sold") ? "archive" : "shop", categoryIds: null } });
      console.log(JSON.stringify({ chips: res.interpretation.chips.map((c) => c.label), text: res.interpretation.text, relaxed: res.interpretation.relaxed, total: res.total, timing: res.timing }));
      for (const c of res.items.slice(0, 8)) console.log(`  ${c.stockCode}  ${c.title}  (${c.status}, €${c.price / 100})`);
      if (res.explain) {
        const titles = new Map((await db.product.findMany({ where: { tenantId: t.id }, select: { id: true, title: true } })).map((p) => [p.id, p.title.slice(0, 30)]));
        const show = (hs: { id: string; score: number }[]) => hs.map((h) => `${titles.get(h.id)} ${h.score.toFixed(3)}`).join(" | ");
        console.log(`  semantic text: ${res.explain.semanticText}\n  lexical: ${show(res.explain.lexical)}\n  semantic: ${show(res.explain.semantic)}\n  imageText: ${show(res.explain.imageText)}`);
      }
    } else if (cmd === "image") {
      const t = await tenantBySlug(a1);
      const { searchByImage } = await import("../src/server/search/service");
      const { decodeSearchImage } = await import("../src/server/search/image-input");
      const res = await searchByImage(t.id, await decodeSearchImage(readFileSync(a2!)), { q: a3, currency: t.currency });
      console.log(JSON.stringify({ total: res.total, timing: res.timing }));
      for (const c of res.items.slice(0, 8)) console.log(`  ${c.stockCode}  ${c.title}`);
    } else if (cmd === "similar") {
      const t = await tenantBySlug(a1);
      const p = await db.product.findFirst({ where: { tenantId: t.id, stockCode: Number(a2) }, select: { id: true, title: true } });
      if (!p) throw new Error("unknown stock code");
      const { similarProducts } = await import("../src/server/search/service");
      const started = performance.now();
      const cards = await similarProducts(t.id, p.id);
      console.log(`similar to ${a2} ${p.title} (${r1(performance.now() - started)} ms):`);
      for (const c of cards) console.log(`  ${c.stockCode}  ${c.title}`);
    } else if (cmd === "bench") {
      await bench(await tenantBySlug(a1), Number(arg("--rounds") ?? 5));
    } else {
      console.log("usage: npm run search -- reindex <slug>|--all [--force] | status <slug> | query <slug> <q> | image <slug> <file> [q] | similar <slug> <stockCode> | bench <slug>");
    }
  } finally {
    await db.$disconnect();
  }
}

async function bench(t: { id: string; slug: string; currency: string }, rounds: number) {
  const { searchProducts, suggest, searchByImage, clearQueryEmbeddingCache } = await import("../src/server/search/service");
  const { searchMetricsSnapshot } = await import("../src/server/search/metrics");
  const { getEmbedder } = await import("../src/server/search/embedder");
  const { db } = await import("../src/server/db");
  const e = await getEmbedder();
  for (const part of ["text", "imageText", "image"] as const) await e?.load(part);
  const queries = ["duitse helm", "feldbluse met kraagspiegels", "Duitse helm WW2 onder 500 euro", "pegasus patch", "iron cross 1914", "jas uit de koude oorlog", "stahlhem", "veldfles", "binoculars", "50212", "dutch helmet", "medaille", "koppelslot", "bajonet", "uniform luftwaffe"];
  const prefixes = queries.flatMap((q) => [q.slice(0, 3), q.slice(0, Math.ceil(q.length / 2)), q]);
  // Warm-up (JIT, pools, caches) — not measured.
  for (const q of queries.slice(0, 3)) await searchProducts(t.id, { q, currency: t.currency });
  const timeIt = async (fn: () => Promise<unknown>) => {
    const s = performance.now();
    await fn();
    return performance.now() - s;
  };
  const sug: number[] = [];
  const srch: number[] = [];
  const srchNoFacets: number[] = [];
  const srchCold: number[] = [];
  for (let r = 0; r < rounds; r++) {
    // Round 0 embeds every query; later rounds hit the in-memory query-embedding cache (as in production).
    for (const q of prefixes) sug.push(await timeIt(() => suggest(t.id, q, { currency: t.currency })));
    for (const q of queries) srch.push(await timeIt(() => searchProducts(t.id, { q, currency: t.currency })));
    for (const q of queries) srchNoFacets.push(await timeIt(() => searchProducts(t.id, { q, currency: t.currency, facets: false })));
    // Every query embedded again over HTTP (e5 + SigLIP text in parallel): the first search of a query.
    for (const q of queries) {
      clearQueryEmbeddingCache();
      srchCold.push(await timeIt(() => searchProducts(t.id, { q, currency: t.currency })));
    }
  }
  // Photo search: product photos of this tenant as queries.
  const { decodeSearchImage } = await import("../src/server/search/image-input");
  const { getStorage } = await import("../src/server/media/storage");
  // Query photos: this tenant's product photos (a synthetic tenant without files borrows another's: --photos-from <slug>).
  const photoSlug = arg("--photos-from");
  const photoTenant = photoSlug ? await db.tenant.findUnique({ where: { slug: photoSlug }, select: { id: true } }) : null;
  const imgs = await db.productImage.findMany({ where: { tenantId: photoTenant?.id ?? t.id }, select: { storageKey: true, variants: true }, take: 10 });
  const photos: Uint8Array[] = [];
  for (const i of imgs) {
    const key = ((i.variants as Record<string, { key?: string }> | null)?.card?.key as string | undefined) ?? i.storageKey;
    const obj = await getStorage().get(key);
    if (obj) photos.push(new Uint8Array(await new Response(obj.body).arrayBuffer()));
  }
  const img: number[] = [];
  for (let r = 0; r < rounds; r++) for (const p of photos) img.push(await timeIt(async () => searchByImage(t.id, await decodeSearchImage(p), { currency: t.currency })));
  const row = (name: string, xs: number[]) => console.log(`${name.padEnd(28)} n=${String(xs.length).padStart(4)}  p50 ${r1(pct(xs, 0.5)).toString().padStart(6)} ms  p95 ${r1(pct(xs, 0.95)).toString().padStart(6)} ms  max ${r1(Math.max(...xs))} ms`);
  console.log(`tenant ${t.slug}: ${await db.product.count({ where: { tenantId: t.id } })} products`);
  row("suggest", sug);
  row("searchProducts (+facets)", srch);
  row("searchProducts (no facets)", srchNoFacets);
  row("searchProducts (uncached emb.)", srchCold);
  row("searchByImage (decode+embed)", img);
  console.log(`rss ${Math.round(process.memoryUsage().rss / 1e6)} MB, embedder calls`, searchMetricsSnapshot());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
