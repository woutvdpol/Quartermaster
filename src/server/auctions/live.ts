import "server-only";
import { loadPublicLot, type PublicLot } from "./public";

/*
 * Lot snapshots for the live endpoints. Every open SSE stream of an auction reacts to the same NOTIFY,
 * so fetches of one lot within a short window share one query (per process).
 */

const MEMO_MS = 300;
const memo = new Map<string, { at: number; value: Promise<PublicLot | null> }>();

export function freshPublicLot(tenantId: string, lotId: string): Promise<PublicLot | null> {
  const key = `${tenantId}:${lotId}`;
  const now = Date.now();
  const hit = memo.get(key);
  if (hit && now - hit.at < MEMO_MS) return hit.value;
  const value = loadPublicLot(tenantId, lotId).catch((err) => {
    memo.delete(key);
    throw err;
  });
  memo.set(key, { at: now, value });
  if (memo.size > 5000) for (const [k, v] of memo) if (now - v.at >= MEMO_MS) memo.delete(k);
  return value;
}
