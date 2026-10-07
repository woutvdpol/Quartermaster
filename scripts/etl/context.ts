import type { Prisma, PrismaClient } from "../../src/generated/prisma/client";
import type { StorageDriver } from "../../src/server/media/storage";
import type { ImageDownloader } from "./images";
import type { LegacyReader } from "./legacy/types";
import type { EtlReport } from "./report";

export type Tx = Prisma.TransactionClient;

export const STEP_NAMES = [
  "settings",
  "categories",
  "tags",
  "purchasing",
  "products",
  "images",
  "facets",
  "shipping",
  "payments",
  "users",
  "orders",
  "content",
  "newsletter",
  "redirects",
  "sequences",
] as const;
export type StepName = (typeof STEP_NAMES)[number];

export type EtlOptions = {
  /** target tenant slug (created when missing) */
  tenantSlug: string;
  /** primary domain for a new tenant (and added to an existing one when missing) */
  domain: string | null;
  /** display name for a new tenant (default: legacy shop_name, else the slug) */
  tenantName?: string | null;
  dryRun: boolean;
  /** run only these steps (null = all) */
  only: StepName[] | null;
  skipImages: boolean;
  /** hosts of the old shop (e.g. "www.concept500.nl"), used to make absolute links relative */
  legacyHosts: string[];
  /** legacy region title → ISO country codes (overrides the inference from orders) */
  zoneCountries: Record<string, string[]>;
  /** facet mapping CSV content (docs/etl/facets.md), or null */
  facetMapCsv: string | null;
  /** allow importing into a tenant that has non-ETL catalog data */
  force: boolean;
  /** "now" for age-based rules (fulfilment inference, pending subscribers); tests pin it */
  now?: Date;
};

export type EtlContext = {
  /** write client of the current step (a transaction) */
  tx: Tx;
  /** base client — only for work that must not run inside the step transaction (image downloads) */
  prisma: PrismaClient;
  legacy: LegacyReader;
  report: EtlReport;
  options: EtlOptions;
  tenantId: string;
  currency: string;
  downloader: ImageDownloader | null;
  storage: StorageDriver | null;
  now: Date;
};

/** Marker stored in legacyData of rows the ETL owns (products, orders). */
export const ETL_MARK = "concept500";

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** JSON-safe copy (Dates → ISO strings, undefined dropped) for Prisma Json columns. */
export function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** True when every key of `data` equals the stored value (Dates and JSON compared structurally). */
export function sameValues(current: Record<string, unknown>, data: Record<string, unknown>): boolean {
  return Object.keys(data).every((k) => stableJson(current[k]) === stableJson(data[k]));
}

/** JSON with object keys sorted (Postgres jsonb does not keep key order). */
export function stableJson(value: unknown): string {
  return JSON.stringify(value === undefined ? null : value, (_k, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/** Row created by this ETL (legacyData.etl marker). */
export function isEtlOwned(p: { legacyData: Prisma.JsonValue }): boolean {
  const d = p.legacyData;
  return !!d && typeof d === "object" && !Array.isArray(d) && (d as Record<string, unknown>).etl === ETL_MARK;
}
