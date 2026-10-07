import type { NextRequest } from "next/server";
import { AuthError } from "@/server/auth/guards";
import { requireStaffContext } from "@/server/context";
import { exportRedirectsCsv } from "@/server/redirects";

const SOURCES = ["all", "MANUAL", "LEGACY"] as const;
type Source = (typeof SOURCES)[number];

/** GET /admin/redirects/export?source=all|MANUAL|LEGACY — CSV download of the shop's redirects (staff only). */
export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireStaffContext();
  } catch (err) {
    if (err instanceof AuthError) {
      const status = err.code === "UNAUTHENTICATED" ? 401 : 403;
      return new Response(status === 401 ? "Sign in first." : "Forbidden.", { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
    }
    throw err;
  }
  const raw = request.nextUrl.searchParams.get("source");
  const source: Source = SOURCES.includes(raw as Source) ? (raw as Source) : "all";
  const csv = await exportRedirectsCsv(ctx, source);
  const date = new Date().toISOString().slice(0, 10);
  // BOM so spreadsheet apps detect UTF-8.
  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="redirects-${source.toLowerCase()}-${date}.csv"`,
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
