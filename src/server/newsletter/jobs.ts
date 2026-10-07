import { z } from "zod";
import { defineJob } from "@/server/jobs/registry";

export const CAMPAIGN_BATCH_SIZE = 200;

/** One fan-out batch of a campaign: queues a `mail.send` job per still-active subscriber. */
export const campaignBatchJob = defineJob(
  "newsletter.campaign.batch",
  z.object({
    tenantId: z.string().min(1),
    campaignId: z.string().min(1),
    subscriberIds: z.array(z.string().min(1)).min(1).max(CAMPAIGN_BATCH_SIZE),
  }),
  async (payload) => {
    const { processCampaignBatch } = await import("./campaigns");
    return processCampaignBatch(payload);
  },
  { queue: { retryLimit: 5, retryDelay: 30, retryBackoff: true, retryDelayMax: 15 * 60 }, concurrency: 2 },
);
