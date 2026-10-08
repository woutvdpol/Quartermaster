// Completes stored images to the current variant set (docs/perf/round3.md § Herverwerken):
// adds the responsive widths (w480/w640/w1080/w1440) and AVIF files that uploads from before round 3
// lack, for product images (manifest in product_images.variants) and CMS content images
// (`{base}/manifest.json`). Existing files are never rewritten (their URLs are cached as immutable).
//
//   npm run media:reprocess -- --tenant concept-militaria        # one tenant (slug or id); repeatable
//   npm run media:reprocess -- --all                             # every tenant
//   npm run media:reprocess -- --tenant x --dry-run              # only report what is missing
//   options: --concurrency 2 (images in parallel; each decode can take ~160 MB for 40 MP)
//
// Idempotent and resumable: a complete image is skipped without decoding; each image's files are
// written before its manifest, so an interrupted run simply continues on the next start.
import "dotenv/config";

type Args = { tenants: string[]; all: boolean; dryRun: boolean; concurrency: number };

function parseArgs(argv: string[]): Args {
  const args: Args = { tenants: [], all: false, dryRun: false, concurrency: 2 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tenant") args.tenants.push(argv[++i] ?? "");
    else if (a === "--all") args.all = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--concurrency") args.concurrency = Math.max(1, Number(argv[++i]) || 1);
    else throw new Error(`Unknown argument ${a}`);
  }
  if (!args.all && !args.tenants.filter(Boolean).length) throw new Error("Pass --tenant <slug|id> (repeatable) or --all");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { db } = await import("../../src/server/db");
  const { getStorage } = await import("../../src/server/media/storage");
  const { completeContentImage, completeImage, listContentOriginals } = await import("../../src/server/media/reprocess");
  const storage = getStorage();

  const tenants = await db.tenant.findMany({
    where: args.all ? {} : { OR: [{ id: { in: args.tenants } }, { slug: { in: args.tenants } }] },
    select: { id: true, slug: true },
    orderBy: { slug: "asc" },
  });
  const unknown = args.tenants.filter((t) => !tenants.some((x) => x.id === t || x.slug === t));
  if (unknown.length) throw new Error(`Unknown tenant(s): ${unknown.join(", ")}`);

  const started = Date.now();
  for (const tenant of tenants) {
    const totals = { images: 0, complete: 0, updated: 0, missing: 0, failed: 0, files: 0, bytes: 0 };
    const rows = await db.productImage.findMany({
      where: { tenantId: tenant.id, processedAt: { not: null } },
      select: { id: true, storageKey: true, width: true, variants: true },
      orderBy: { id: "asc" },
    });
    const content = await listContentOriginals(storage, tenant.id);
    type Job = { kind: "product"; row: (typeof rows)[number] } | { kind: "content"; key: string };
    const jobs: Job[] = [...rows.map((row) => ({ kind: "product" as const, row })), ...content.map((key) => ({ kind: "content" as const, key }))];
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        totals.images++;
        try {
          if (job.kind === "product") {
            const manifest = (job.row.variants && typeof job.row.variants === "object" && !Array.isArray(job.row.variants) ? job.row.variants : {}) as Parameters<typeof completeImage>[2];
            const r = await completeImage(storage, job.row.storageKey, manifest, job.row.width, { dryRun: args.dryRun });
            if (r.status === "updated" && !args.dryRun) {
              // Only the manifest changes: the row's other fields (and its audit trail) stay as they are.
              await db.productImage.update({ where: { id: job.row.id }, data: { variants: r.manifest as object } });
            }
            tally(r);
          } else {
            tally(await completeContentImage(storage, job.key, { dryRun: args.dryRun }));
          }
        } catch (error) {
          totals.failed++;
          console.warn(`  ! ${job.kind === "product" ? job.row.storageKey : job.key}: ${(error as Error).message}`);
        }
        if (totals.images % 50 === 0) process.stderr.write(`  ${tenant.slug}: ${totals.images}/${jobs.length}\n`);
      }
    };
    const tally = (r: { status: string; files: number; bytes: number }) => {
      if (r.status === "complete") totals.complete++;
      else if (r.status === "updated") totals.updated++;
      else totals.missing++;
      totals.files += r.files;
      totals.bytes += r.bytes;
    };
    await Promise.all(Array.from({ length: args.concurrency }, worker));
    console.log(
      `${tenant.slug}: ${rows.length} product + ${content.length} content images · ${totals.updated} ${args.dryRun ? "to update" : "updated"} (${totals.files} files, ${(totals.bytes / 1024).toFixed(0)} kB) · ${totals.complete} already complete · ${totals.missing} original missing · ${totals.failed} failed`,
    );
  }
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)} s${args.dryRun ? " (dry run: nothing written)" : ""}`);
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
