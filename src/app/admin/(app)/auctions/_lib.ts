/*
 * Pure helpers for the auction admin screens (no server imports: usable in server and client
 * components, and unit-tested in _lib.test.ts).
 */
import type { StatusTone } from "@/components/admin/ui";
import type { AuctionLotStatus, AuctionStatus } from "@/generated/prisma/enums";
import { dateToLocalInput, localInputToDate } from "../coupons/_lib";

export { dateToLocalInput, localInputToDate };

export const AUCTION_STATUS_TONE: Record<AuctionStatus, StatusTone> = {
  DRAFT: "mute",
  PUBLISHED: "info",
  LIVE: "ok",
  CLOSED: "mute",
  CANCELLED: "crit",
};

/** Lots (and the schedule) can be changed until the auction goes live. */
export function isEditable(status: AuctionStatus): boolean {
  return status === "DRAFT" || status === "PUBLISHED";
}

/** Start / reserve can be changed per lot while the auction is not over and nobody has bid yet. */
export function lotPricesEditable(auctionStatus: AuctionStatus, lot: { status: AuctionLotStatus; bidCount: number }): boolean {
  return (auctionStatus === "DRAFT" || auctionStatus === "PUBLISHED" || auctionStatus === "LIVE") && lot.status === "OPEN" && lot.bidCount === 0;
}

// ─── Schedule form (drawer) ─────────────────────────────────────────────────

export type ScheduleFields = {
  type: string;
  title: string;
  opensAt: string;
  firstCloseAt: string;
  gapSeconds: string;
  extendSeconds: string;
  payDays: string;
};

export type ScheduleInput = {
  type: "DAY" | "SINGLE";
  title: string;
  opensAt: Date;
  firstCloseAt: Date;
  gapSeconds: number;
  extendSeconds: number;
  payDays: number;
};

export type ScheduleResult = { ok: true; input: ScheduleInput } | { ok: false; errors: Record<string, string[]> };

function intIn(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return n >= min && n <= max ? n : null;
}

/**
 * Validates the drawer fields. Date-times are datetime-local values in the shop's time zone;
 * gap and extension are entered in minutes (gap may be 0 for a single lot) and returned in seconds.
 */
export function parseSchedule(fields: ScheduleFields, timeZone: string, now: Date = new Date()): ScheduleResult {
  const errors: Record<string, string[]> = {};
  const add = (k: string, m: string) => (errors[k] ??= []).push(m);

  const type = fields.type === "SINGLE" ? "SINGLE" : fields.type === "DAY" ? "DAY" : null;
  if (!type) add("type", "Choose a type.");
  const title = fields.title.trim();
  if (!title) add("title", "Enter a title.");
  else if (title.length > 160) add("title", "Keep the title under 160 characters.");

  const opensAt = localInputToDate(fields.opensAt, timeZone);
  const firstCloseAt = localInputToDate(fields.firstCloseAt, timeZone);
  if (!opensAt) add("opensAt", "Enter when bidding opens.");
  if (!firstCloseAt) add("firstCloseAt", type === "SINGLE" ? "Enter when the lot closes." : "Enter when the first lot closes.");
  if (opensAt && firstCloseAt && firstCloseAt.getTime() <= opensAt.getTime()) add("firstCloseAt", "Must be after the opening time.");
  if (firstCloseAt && firstCloseAt.getTime() <= now.getTime()) add("firstCloseAt", "Must be in the future.");

  const gapMin = type === "SINGLE" && fields.gapSeconds.trim() === "" ? 0 : intIn(fields.gapSeconds, 0, 60);
  if (gapMin === null) add("gapSeconds", "Enter 0 to 60 minutes.");
  const extendMin = intIn(fields.extendSeconds, 0, 30);
  if (extendMin === null) add("extendSeconds", "Enter 0 to 30 minutes.");
  const payDays = intIn(fields.payDays, 1, 30);
  if (payDays === null) add("payDays", "Enter 1 to 30 days.");

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    input: {
      type: type!,
      title,
      opensAt: opensAt!,
      firstCloseAt: firstCloseAt!,
      gapSeconds: gapMin! * 60,
      extendSeconds: extendMin! * 60,
      payDays: payDays!,
    },
  };
}

/** "1 min", "90 s", "2 h", "none". */
export function formatSeconds(seconds: number): string {
  if (seconds <= 0) return "none";
  if (seconds % 3600 === 0) return `${seconds / 3600} h`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
}

// ─── Results ────────────────────────────────────────────────────────────────

export type ResultKind = "paid" | "awaiting" | "overdue" | "unsold" | "cancelled" | "open";

export type ResultLike = {
  lotStatus: AuctionLotStatus;
  paid: boolean;
  daysSinceClose: number | null;
};

/** What happened to a lot after closing; `overdue` = sold, unpaid and past the pay term. */
export function resultKind(r: ResultLike, payDays: number): ResultKind {
  if (r.lotStatus === "OPEN") return "open";
  if (r.lotStatus === "UNSOLD") return "unsold";
  if (r.lotStatus === "CANCELLED") return "cancelled";
  if (r.paid) return "paid";
  return (r.daysSinceClose ?? 0) > payDays ? "overdue" : "awaiting";
}

export const RESULT_FILTERS = ["awaiting", "overdue", "unsold"] as const;
export type ResultFilter = (typeof RESULT_FILTERS)[number] | null;

export function parseResultFilter(value: unknown): ResultFilter {
  return typeof value === "string" && (RESULT_FILTERS as readonly string[]).includes(value) ? (value as ResultFilter) : null;
}

/** Filter chips: awaiting includes overdue (both still unpaid); "not sold" includes cancelled lots. */
export function matchesFilter(kind: ResultKind, filter: ResultFilter): boolean {
  switch (filter) {
    case null:
      return true;
    case "awaiting":
      return kind === "awaiting" || kind === "overdue";
    case "overdue":
      return kind === "overdue";
    case "unsold":
      return kind === "unsold" || kind === "cancelled";
  }
}

export function filterCounts(kinds: ResultKind[]): Record<"all" | "awaiting" | "overdue" | "unsold", number> {
  return {
    all: kinds.length,
    awaiting: kinds.filter((k) => matchesFilter(k, "awaiting")).length,
    overdue: kinds.filter((k) => k === "overdue").length,
    unsold: kinds.filter((k) => matchesFilter(k, "unsold")).length,
  };
}

/** Hammer total vs. the list prices of the sold lots, as a signed fraction (0.08 = +8%); null without sales. */
export function vsList(sold: { hammer: number; listPrice: number }[]): number | null {
  const list = sold.reduce((s, r) => s + r.listPrice, 0);
  if (!sold.length || list <= 0) return null;
  return sold.reduce((s, r) => s + r.hammer, 0) / list - 1;
}

export function formatPercent(fraction: number | null): string {
  if (fraction === null) return "—";
  const pct = Math.round(fraction * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

// ─── CSV ────────────────────────────────────────────────────────────────────

/** Quotes a cell and neutralizes spreadsheet formulas (CSV injection). */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  let s = value;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) || s !== value ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Minor units → "123.45" (plain decimal, no currency symbol: spreadsheet friendly). */
export function csvAmount(minor: number | null | undefined, digits = 2): string {
  if (minor === null || minor === undefined) return "";
  return (minor / 10 ** digits).toFixed(digits);
}

export function buildCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  return [header.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n") + "\r\n";
}

/** Default times for a new auction: bidding opens tomorrow 10:00, first lot closes a week later at 20:00 (shop zone). */
export function suggestSchedule(now: Date, timeZone: string): { opensAt: string; firstCloseAt: string } {
  const day = (offsetDays: number) => dateToLocalInput(new Date(now.getTime() + offsetDays * 86_400_000), timeZone).slice(0, 10);
  return { opensAt: `${day(1)}T10:00`, firstCloseAt: `${day(8)}T20:00` };
}
