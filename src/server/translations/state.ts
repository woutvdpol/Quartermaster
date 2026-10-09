/*
 * Translation row state machine (pure, unit-tested in state.test.ts). docs/i18n.md § Vertalen.
 *
 *   (no row) ──source text──▶ QUEUED ──job──▶ MACHINE ──approve──▶ APPROVED
 *                               ▲               │                    │
 *                               └─source changed┘                    │ source changed
 *                                                                    ▼
 *                                                       APPROVED + stale (old value stays online)
 *
 * `sourceHash` is the hash of the English text the row's value belongs to:
 *  - QUEUED/MACHINE: the text being / that was machine translated. A source change re-queues the row
 *    (the outdated machine value is replaced by the job; it was never online).
 *  - APPROVED: the text the reviewer approved. A source change does NOT touch value or status — the
 *    approved translation stays online — it only sets `stale = true` (and back to false when the
 *    English text is reverted). No machine proposal is stored for stale rows: the reviewer asks for
 *    one on demand ("Translate again", computed live) and approves again, which clears `stale`.
 *  - Empty source text: the row is deleted (nothing to translate, nothing to show).
 */
import { createHash } from "node:crypto";

export type RowStatus = "QUEUED" | "MACHINE" | "APPROVED";
export type RowState = { status: RowStatus; sourceHash: string; stale: boolean };

export type SyncPlan =
  | { kind: "none" }
  | { kind: "create"; sourceHash: string }
  | { kind: "requeue"; sourceHash: string }
  | { kind: "stale"; stale: boolean }
  | { kind: "delete" };

/** Normalised source text: null when there is nothing to translate. */
export function normalizeSource(text: string | null | undefined): string | null {
  const t = (text ?? "").replace(/\r\n?/g, "\n").trim();
  return t === "" ? null : t;
}

export function sourceHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 32);
}

/** What to do with one (entity, field, locale) row when its source text is (re)read. */
export function planSync(row: RowState | null, source: string | null): SyncPlan {
  if (source === null) return row ? { kind: "delete" } : { kind: "none" };
  const hash = sourceHash(source);
  if (!row) return { kind: "create", sourceHash: hash };
  if (row.status === "APPROVED") {
    const stale = row.sourceHash !== hash;
    return stale === row.stale ? { kind: "none" } : { kind: "stale", stale };
  }
  return row.sourceHash === hash ? { kind: "none" } : { kind: "requeue", sourceHash: hash };
}

/** Rows that need a reviewer: machine proposals and approved rows whose English text changed. */
export function needsReview(row: { status: RowStatus; stale: boolean }): boolean {
  return row.status === "MACHINE" || (row.status === "APPROVED" && row.stale);
}

/**
 * A finished machine translation may only be stored while the row is still QUEUED for the same source
 * (a later edit re-queued it with another hash → this result is outdated and dropped).
 */
export function acceptsMachineResult(row: RowState, translatedHash: string): boolean {
  return row.status === "QUEUED" && row.sourceHash === translatedHash;
}
