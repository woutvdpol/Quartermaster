/*
 * Reconnect timing for the auction stream (pure). Exponential backoff with jitter so that a restart of
 * the app does not get every open lot page reconnecting in the same second.
 */

export type BackoffOptions = { baseMs?: number; maxMs?: number; factor?: number; jitter?: number };

/** Delay before reconnect attempt `attempt` (0-based): base·factor^attempt, capped, ± jitter. */
export function backoffDelay(attempt: number, opts: BackoffOptions = {}, random: () => number = Math.random): number {
  const { baseMs = 1_000, maxMs = 30_000, factor = 2, jitter = 0.25 } = opts;
  const n = Math.max(0, Math.floor(attempt));
  const raw = Math.min(maxMs, baseMs * factor ** Math.min(n, 30));
  const spread = raw * jitter * (random() * 2 - 1);
  return Math.max(0, Math.min(maxMs, Math.round(raw + spread)));
}

/** Poll interval while the stream is down (docs/auctions-plan.md: every 5 s). */
export const POLL_INTERVAL_MS = 5_000;

/**
 * Failed stream attempts in a row before polling starts in between reconnects. 2: the server ends every
 * stream after a while on purpose (spreads load over replicas); one drop followed by a quick
 * reconnect must not cost a poll.
 */
export const POLL_AFTER_FAILURES = 2;
