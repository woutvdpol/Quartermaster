import "server-only";
import { db } from "@/server/db";
import { getSettings } from "@/server/settings";
import { ECB_DAILY_URL, crossRate, parseEcbDaily, type EcbDaily } from "./ecb";

export { ECB_DAILY_URL, crossRate, parseEcbDaily, type EcbDaily } from "./ecb";

/*
 * Exchange rates for DISPLAY only (decision 17: checkout is always in the shop currency).
 * Platform-wide ExchangeRate rows, base EUR, one row per (quote, rateDate), source "ECB".
 * Refreshed daily by the cron task `rates.refresh` (job `cron.rates.refresh`) and once at worker
 * start when today's rates are missing.
 */

const BASE = "EUR";
const FETCH_TIMEOUT_MS = 15_000;

/** Downloads and parses today's ECB reference rates. */
export async function fetchEcbDaily(fetchImpl: typeof fetch = fetch): Promise<EcbDaily> {
  const res = await fetchImpl(ECB_DAILY_URL, {
    headers: { Accept: "application/xml, text/xml" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`ECB: HTTP ${res.status}`);
  return parseEcbDaily(await res.text());
}

/** Stores a parsed daily file (idempotent upserts on (base, quote, rateDate)). Returns rows written. */
export async function storeEcbDaily(daily: EcbDaily): Promise<number> {
  const rateDate = new Date(`${daily.date}T00:00:00Z`);
  const entries = Object.entries(daily.rates);
  await db.$transaction(
    entries.map(([quote, rate]) =>
      db.exchangeRate.upsert({
        where: { base_quote_rateDate: { base: BASE, quote, rateDate } },
        create: { base: BASE, quote, rate: rate.toString(), rateDate, source: "ECB" },
        update: { rate: rate.toString(), source: "ECB" },
      }),
    ),
  );
  return entries.length;
}

/** Fetch + store. Used by the daily cron task. */
export async function refreshRates(fetchImpl?: typeof fetch): Promise<{ date: string; stored: number }> {
  const daily = await fetchEcbDaily(fetchImpl);
  return { date: daily.date, stored: await storeEcbDaily(daily) };
}

/** Latest stored reference date (UTC midnight), or null when no rates exist. */
export async function latestRateDate(): Promise<Date | null> {
  const row = await db.exchangeRate.findFirst({ where: { base: BASE }, orderBy: { rateDate: "desc" }, select: { rateDate: true } });
  return row?.rateDate ?? null;
}

/**
 * Worker start: refresh unless rates from today or yesterday exist (ECB publishes on working days
 * around 16:00 CET, so "yesterday" is current until then). Never throws.
 */
export async function refreshRatesIfStale(now = new Date()): Promise<{ refreshed: boolean; error?: string }> {
  try {
    const latest = await latestRateDate();
    const ageDays = latest ? (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - latest.getTime()) / 86_400_000 : Infinity;
    if (ageDays <= 1) return { refreshed: false };
    await refreshRates();
    return { refreshed: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[rates] refresh at start failed: ${message}`);
    return { refreshed: false, error: message };
  }
}

/** Latest EUR-based rate per requested quote currency (one indexed query). */
export async function latestEurRates(quotes: string[]): Promise<{ rates: Record<string, number>; date: Date | null }> {
  const wanted = [...new Set(quotes.map((q) => q.toUpperCase()).filter((q) => q !== BASE && /^[A-Z]{3}$/.test(q)))];
  if (wanted.length === 0) return { rates: {}, date: null };
  const rows = await db.$queryRaw<{ quote: string; rate: string; rateDate: Date }[]>`
    SELECT DISTINCT ON (quote) quote, rate::text AS rate, "rateDate"
    FROM exchange_rates
    WHERE base = ${BASE} AND quote = ANY(${wanted})
    ORDER BY quote, "rateDate" DESC`;
  const rates: Record<string, number> = {};
  let date: Date | null = null;
  for (const r of rows) {
    rates[r.quote.trim()] = Number(r.rate);
    if (!date || r.rateDate < date) date = r.rateDate; // oldest of the used rates
  }
  return { rates, date };
}

export type DisplayRate = { currency: string; rate: number };
export type DisplayRates = {
  /** The shop's checkout currency (Tenant.currency). */
  shopCurrency: string;
  /** One entry per configured display currency we have a rate for; rate = units per 1 shop-currency unit. */
  rates: DisplayRate[];
  /** Reference date of the rates (oldest used), or null when none are stored yet. */
  rateDate: Date | null;
};

/**
 * Display rates for the tenant's `general.displayCurrencies`, converted via EUR when the shop
 * currency isn't EUR. Currencies without a stored rate (or equal to the shop currency) are omitted.
 */
export async function getDisplayRates(tenantId: string): Promise<DisplayRates> {
  const [tenant, general] = await Promise.all([
    db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { currency: true } }),
    getSettings(tenantId, "general"),
  ]);
  const shopCurrency = tenant.currency.toUpperCase();
  const targets = general.displayCurrencies.filter((c) => c !== shopCurrency);
  if (targets.length === 0) return { shopCurrency, rates: [], rateDate: null };
  const { rates: eur, date } = await latestEurRates([...targets, shopCurrency]);
  const rates: DisplayRate[] = [];
  for (const currency of targets) {
    const rate = crossRate(eur, shopCurrency, currency);
    if (rate !== null) rates.push({ currency, rate });
  }
  return { shopCurrency, rates, rateDate: rates.length ? date : null };
}
