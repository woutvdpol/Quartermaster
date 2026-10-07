import { handleCspReport } from "@/server/security/csp-report";

/**
 * CSP violation reports (report-uri and Reporting API `report-to`), see src/lib/csp.ts and
 * src/server/security/csp-report.ts. Unauthenticated by nature: size- and rate-limited, logs only.
 */
export async function POST(request: Request) {
  try {
    return await handleCspReport(request);
  } catch (err) {
    console.error("[csp] report handling failed:", err instanceof Error ? err.message : err);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }
}
