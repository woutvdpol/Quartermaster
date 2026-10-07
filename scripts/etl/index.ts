// Concept500 → Quartermaster ETL (phase 4). See docs/etl/README.md.
//
//   LEGACY_DATABASE_URL=mysql://root:…@127.0.0.1:33307/main \
//   npm run etl -- --tenant concept500-import --domain import.localhost:3000 --dry-run
//
// Writes a Markdown report (counts and ids only) to --report or .local/etl-report-<timestamp>.md.
import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../../src/server/db";
import { getStorage } from "../../src/server/media/storage";
import { USAGE, parseArgs } from "./args";
import { CloudflareImageDownloader } from "./images";
import { MysqlLegacyReader } from "./legacy/readers";
import { runEtl } from "./run";

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${(err as Error).message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const legacyUrl = process.env.LEGACY_DATABASE_URL;
  if (!legacyUrl) {
    console.error("LEGACY_DATABASE_URL is not set (mysql://user:pass@host:port/db)");
    process.exit(2);
  }

  const cfHash = process.env.LEGACY_CF_ACCOUNT_HASH?.trim();
  const downloader = !args.skipImages && !args.dryRun && cfHash ? new CloudflareImageDownloader(cfHash) : null;
  const facetMapCsv = args.facetMap ? await readFile(args.facetMap, "utf8") : null;

  const result = await runEtl({
    prisma: db,
    legacy: MysqlLegacyReader.connect(legacyUrl),
    downloader,
    storage: downloader ? getStorage() : null,
    options: {
      tenantSlug: args.tenant,
      domain: args.domain,
      tenantName: args.name,
      dryRun: args.dryRun,
      only: args.only,
      skipImages: args.skipImages || !downloader,
      legacyHosts: args.legacyHosts,
      zoneCountries: args.zoneCountries,
      facetMapCsv,
      force: args.force,
    },
    log: (line) => console.log(line),
  });

  if (!args.dryRun && result.ok) {
    result.report.note(
      "Na de run",
      "Shop-cache: de storefront-cache (unstable_cache, tags per tenant) kan vanuit een CLI-proces niet worden geïnvalideerd; die verloopt binnen 60 s vanzelf.",
    );
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.resolve(args.report ?? path.join(".local", `etl-report-${stamp}.md`));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, result.report.toMarkdown(), "utf8");
  console.log(`\nReport: ${file}`);
  if (!result.ok) {
    console.error(`ETL failed: ${result.error}`);
    process.exitCode = 1;
  }
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});
