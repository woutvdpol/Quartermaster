import type { NextRequest } from "next/server";
import { AuthError } from "@/server/auth/guards";
import { requireStaffContext, ServiceError } from "@/server/context";
import { exportSubscribersCsv } from "@/server/newsletter";

const STATUSES = ["active", "pending", "unsubscribed", "all"] as const;
type Status = (typeof STATUSES)[number];

/**
 * GET /admin/newsletter/export?status=active|pending|unsubscribed|all&q=… — CSV download of the
 * subscribers in the current view. Read-only (the service audits the export); staff only.
 */
export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireStaffContext();
  } catch (err) {
    if (err instanceof AuthError) {
      return new Response(
        err.code === "UNAUTHENTICATED" ? "Sign in first." : "Forbidden.",
        {
          status: err.code === "UNAUTHENTICATED" ? 401 : 403,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
          },
        },
      );
    }
    throw err;
  }

  const params = request.nextUrl.searchParams;
  const rawStatus = params.get("status");
  const status: Status = STATUSES.includes(rawStatus as Status)
    ? (rawStatus as Status)
    : "active";
  const search = (params.get("q") ?? "").trim().slice(0, 254) || undefined;

  let csv: string;
  try {
    csv = await exportSubscribersCsv(ctx, { status, search });
  } catch (err) {
    if (err instanceof ServiceError) {
      return new Response(err.message, {
        status: 400,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }
    throw err;
  }

  const date = new Date().toISOString().slice(0, 10);
  // BOM so spreadsheet apps detect UTF-8.
  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="subscribers-${status}-${date}.csv"`,
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
