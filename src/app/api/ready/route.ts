import { connection } from "next/server";
import { db } from "@/server/db";
import { searchMetricsSnapshot } from "@/server/search/metrics";

/**
 * Readiness probe. Returns 200 only when the database answers, so traffic is
 * routed away from instances that cannot reach Postgres.
 */
export async function GET() {
  // Opt into request-time rendering (works with and without Cache Components).
  await connection();

  const headers = { "Cache-Control": "no-store" };
  try {
    await db.$queryRaw`SELECT 1`;
    // `search`: in-process smart-search counters (embedder calls, timeouts, lexical fallbacks) —
    // informational only; the embedder being down never makes the web pod unready.
    return Response.json({ status: "ready", checks: { database: "ok" }, search: searchMetricsSnapshot() }, { headers });
  } catch (error) {
    console.error("[ready] database check failed", error);
    return Response.json(
      { status: "unavailable", checks: { database: "error" } },
      { status: 503, headers },
    );
  }
}
