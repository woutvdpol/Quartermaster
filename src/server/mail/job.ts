import { defineJob } from "@/server/jobs/registry";
import { MAIL_QUEUE_OPTIONS, mailJobSchema } from "./contracts";

/** Every outgoing mail is sent by this job (retries with exponential backoff). */
export const mailSendJob = defineJob(
  "mail.send",
  mailJobSchema,
  async (payload, ctx) => {
    // Lazy: rendering pulls in React Email + react-dom/server, which must not load in Next.js bundles.
    const { deliverMailJob } = await import("./deliver");
    return deliverMailJob(payload, ctx);
  },
  { queue: MAIL_QUEUE_OPTIONS, concurrency: 5 },
);
