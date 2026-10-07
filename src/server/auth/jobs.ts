import { z } from "zod";
import { defineJob } from "@/server/jobs/registry";

/**
 * "Forgot password" processing, off the request path (security backlog #8): the HTTP action only
 * queues this job — the same single insert for known and unknown addresses — so neither the
 * response nor its timing reveals whether an account exists. The worker looks the account up,
 * issues the token and queues the actual mail (`mail.send`). The payload holds no token.
 */
export const passwordResetRequestJob = defineJob(
  "auth.password-reset.request",
  z.object({
    tenantId: z.string().min(1).max(64).nullable(),
    email: z.string().max(254),
    audience: z.enum(["admin", "customer"]),
  }),
  async (payload) => {
    const { processPasswordResetRequest } = await import("@/server/mail/queue");
    await processPasswordResetRequest(payload.tenantId, payload.email, payload.audience);
  },
  // A retry would only re-run the lookup (rate limited per email) — keep it short-lived.
  { queue: { retryLimit: 2, retryDelay: 15, retryBackoff: true, expireInSeconds: 5 * 60, deleteAfterSeconds: 24 * 60 * 60 }, concurrency: 2 },
);
