import { STEP_NAMES, type StepName } from "./context";

export type CliArgs = {
  tenant: string;
  domain: string | null;
  name: string | null;
  dryRun: boolean;
  only: StepName[] | null;
  skipImages: boolean;
  report: string | null;
  legacyHosts: string[];
  zoneCountries: Record<string, string[]>;
  facetMap: string | null;
  force: boolean;
  help: boolean;
};

export const USAGE = `Concept500 → Quartermaster ETL

Usage: npm run etl -- --tenant <slug> [options]

Env:   LEGACY_DATABASE_URL  mysql://user:pass@host:port/db   (required)
       DATABASE_URL         target Postgres (Quartermaster)
       LEGACY_CF_ACCOUNT_HASH  Cloudflare Images account hash (photo download; optional)

Options:
  --tenant <slug>          target tenant (created when missing; needs --domain)
  --domain <host>          primary domain for a new tenant, e.g. import.localhost:3000
  --name <name>            name for a new tenant (default: legacy shop_name)
  --dry-run                run everything in one transaction and roll it back (report only)
  --only <step,…>          run only these steps: ${STEP_NAMES.join(", ")}
  --skip-images            never download photos (placeholders only)
  --report <path>          report path (default .local/etl-report-<timestamp>.md)
  --legacy-host <host,…>   hostnames of the old shop (absolute links in content → relative)
  --zone-countries <map>   region countries, e.g. "Freeyo=NL,BE;Rest=*"
  --facet-map <csv>        tag → facet mapping CSV (docs/etl/facets.md)
  --force                  allow a tenant that already has non-ETL products
  --help`;

export function parseArgs(argv: readonly string[]): CliArgs {
  const out: CliArgs = {
    tenant: "",
    domain: null,
    name: null,
    dryRun: false,
    only: null,
    skipImages: false,
    report: null,
    legacyHosts: [],
    zoneCountries: {},
    facetMap: null,
    force: false,
    help: false,
  };
  const args = [...argv];
  const value = (flag: string) => {
    const v = args.shift();
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    return v;
  };
  while (args.length) {
    let arg = args.shift()!;
    const eq = arg.indexOf("=");
    if (arg.startsWith("--") && eq > 0) {
      args.unshift(arg.slice(eq + 1));
      arg = arg.slice(0, eq);
    }
    switch (arg) {
      case "--tenant":
        out.tenant = value(arg);
        break;
      case "--domain":
        out.domain = value(arg);
        break;
      case "--name":
        out.name = value(arg);
        break;
      case "--dry-run":
        out.dryRun = true;
        break;
      case "--skip-images":
        out.skipImages = true;
        break;
      case "--force":
        out.force = true;
        break;
      case "--report":
        out.report = value(arg);
        break;
      case "--facet-map":
        out.facetMap = value(arg);
        break;
      case "--legacy-host":
        out.legacyHosts.push(...value(arg).split(",").map((h) => h.trim()).filter(Boolean));
        break;
      case "--only": {
        const steps = value(arg).split(",").map((s) => s.trim()).filter(Boolean);
        const bad = steps.filter((s) => !(STEP_NAMES as readonly string[]).includes(s));
        if (bad.length) throw new Error(`Unknown step(s): ${bad.join(", ")} (valid: ${STEP_NAMES.join(", ")})`);
        out.only = steps as StepName[];
        break;
      }
      case "--zone-countries":
        for (const part of value(arg).split(";")) {
          const [region, list] = part.split("=");
          if (!region?.trim() || !list) throw new Error(`--zone-countries: expected "Region=NL,BE"`);
          out.zoneCountries[region.trim()] = list.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
        }
        break;
      case "--help":
      case "-h":
        out.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!out.help && !out.tenant) throw new Error("--tenant <slug> is required");
  return out;
}
