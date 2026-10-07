import { connection } from "next/server";
import { isAuthorizedCronRequest, isCronTaskName, runCronTask } from "@/server/jobs/cron";

/**
 * Alternative trigger for the cron tasks in src/server/jobs/cron.ts, for schedulers outside the
 * worker (Kubernetes CronJob, system cron):
 *
 *   curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://<platform-host>/api/cron/reservations.expire
 *
 * Runs the task in this request (they are short and idempotent). Disabled while CRON_SECRET is unset.
 */
async function handle(request: Request, ctx: RouteContext<"/api/cron/[job]">) {
  await connection();
  const headers = { "Cache-Control": "no-store" };
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers });
  }
  const { job } = await ctx.params;
  if (!isCronTaskName(job)) return Response.json({ error: "unknown_job" }, { status: 404, headers });
  try {
    const result = await runCronTask(job);
    return Response.json({ ok: true, job, ...result }, { headers });
  } catch (err) {
    console.error(`[cron] ${job} failed`, err);
    return Response.json({ ok: false, job, error: "failed" }, { status: 500, headers });
  }
}

export const POST = handle;
export const GET = handle;
