/*
 * In-process counters of smart search (per web/worker process). Exposed on GET /api/ready under
 * `search` (docs/search.md § Ops) — enough to see from a probe or a log scrape whether the embedder
 * is being used or search is running on its lexical fallback.
 */
export const searchMetrics = {
  /** Successful embedder HTTP calls and their summed duration (incl. the network hop). */
  embedCalls: 0,
  embedMsTotal: 0,
  /** Embedder calls that timed out / failed (connection, 401, 5xx). */
  timeouts: 0,
  errors: 0,
  /** 4xx answers to bad input (e.g. an undecodable photo). */
  badRequests: 0,
  /** Searches that ran without the semantic retrievers because the embedder was unavailable. */
  lexicalFallbacks: 0,
};

export function searchMetricsSnapshot() {
  const m = searchMetrics;
  return { ...m, embedMsAvg: m.embedCalls ? Math.round((m.embedMsTotal / m.embedCalls) * 10) / 10 : null, embedMsTotal: Math.round(m.embedMsTotal) };
}
