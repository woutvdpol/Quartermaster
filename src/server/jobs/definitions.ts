import { z } from "zod";
import { mailSendJob } from "@/server/mail/job";
import { campaignBatchJob } from "@/server/newsletter/jobs";
import { ALERT_JOBS } from "@/server/alerts/jobs";
import { invoiceIssueJob, invoiceRenderJob } from "@/server/invoices/job";
import { passwordResetRequestJob } from "@/server/auth/jobs";
import { importImagesJob, importRunJob } from "@/server/import/jobs";
import { defineJob } from "./registry";
import { CRON_TASKS, runCronTask, type CronTaskName } from "./cron";

/**
 * Every job the app knows. Adding a job: create a light definition with `defineJob()` (heavy code
 * behind a lazy `import()` in the handler) and list it here; the worker picks it up automatically.
 */
function cronJob<N extends CronTaskName>(task: N) {
  return defineJob(`cron.${task}` as const, z.object({}).loose(), async () => runCronTask(task), {
    // A missed run is simply picked up by the next tick, so no retries; one at a time.
    queue: { policy: "stately", retryLimit: 0, expireInSeconds: 10 * 60, deleteAfterSeconds: 24 * 60 * 60 },
  });
}

export const CRON_JOBS = {
  "cron.reservations.expire": cronJob("reservations.expire"),
  "cron.rate-limit.prune": cronJob("rate-limit.prune"),
  "cron.leads.photos.cleanup": cronJob("leads.photos.cleanup"),
  "cron.alerts.digest": cronJob("alerts.digest"),
  "cron.alerts.scan": cronJob("alerts.scan"),
  "cron.offers.expire": cronJob("offers.expire"),
  "cron.cart.abandoned": cronJob("cart.abandoned"),
  "cron.rates.refresh": cronJob("rates.refresh"),
} satisfies { [K in CronTaskName as `cron.${K}`]: unknown };

export const JOBS = {
  "mail.send": mailSendJob,
  "auth.password-reset.request": passwordResetRequestJob,
  "newsletter.campaign.batch": campaignBatchJob,
  ...ALERT_JOBS, // alerts.match-product, alerts.back-available, alerts.price-drop
  "invoices.issue": invoiceIssueJob,
  "invoices.render": invoiceRenderJob,
  "import.run": importRunJob,
  "import.images": importImagesJob,
  ...CRON_JOBS,
};

export type JobName = keyof typeof JOBS;

export function cronSchedules(): { job: keyof typeof CRON_JOBS; cron: string }[] {
  return (Object.keys(CRON_TASKS) as CronTaskName[]).map((task) => ({
    job: `cron.${task}` as const,
    cron: CRON_TASKS[task].schedule,
  }));
}
