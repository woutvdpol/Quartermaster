// Shared harness for mail/newsletter integration tests: captures queued jobs and outgoing mail,
// and runs captured jobs in-process (no worker, no pg-boss).
import type Mail from "nodemailer/lib/mailer";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { runJobNow, setJobTransportForTests, type EnqueuedJob } from "@/server/jobs/queue";
import { setMailSinkForTests } from "@/server/mail/transport";

export type CapturedMail = Omit<Mail.Options, "headers"> & { headers?: Record<string, string> };

export function installHarness() {
  const jobs: EnqueuedJob[] = [];
  const mails: CapturedMail[] = [];
  setJobTransportForTests((job) => void jobs.push(job));
  setMailSinkForTests((m) => void mails.push(m as CapturedMail));

  /** Runs queued jobs (and the jobs they queue) until none are left. Returns the handler results. */
  async function drain(filter?: (job: EnqueuedJob) => boolean) {
    const results: unknown[] = [];
    for (let guard = 0; guard < 10_000; guard++) {
      const index = filter ? jobs.findIndex(filter) : 0;
      if (index < 0 || jobs.length === 0) break;
      const [job] = jobs.splice(index, 1);
      results.push(await runJobNow(job.name, job.data));
    }
    return results;
  }

  return {
    jobs,
    mails,
    drain,
    uninstall() {
      setJobTransportForTests(null);
      setMailSinkForTests(null);
    },
  };
}

export async function setSettings(tenantId: string, group: string, data: Prisma.InputJsonObject) {
  await db.setting.upsert({
    where: { tenantId_group: { tenantId, group } },
    create: { tenantId, group, data },
    update: { data },
  });
}

export async function enableNewsletter(tenantId: string, quota = 1000) {
  await setSettings(tenantId, "platform", { newsletterEnabled: true, newsletterQuota: quota });
}

/** First URL in a mail's HTML that contains `needle`. */
export function linkIn(mail: CapturedMail, needle: string): URL {
  const html = String(mail.html);
  const match = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&")).find((h) => h.includes(needle));
  if (!match) throw new Error(`No link containing ${needle}`);
  return new URL(match);
}
