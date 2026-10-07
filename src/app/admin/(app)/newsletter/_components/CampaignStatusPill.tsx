import { StatusPill, type StatusTone } from "@/components/admin/ui";
import type { CampaignStatus } from "@/generated/prisma/enums";
import { copy } from "../_copy";

const TONE: Record<CampaignStatus, StatusTone> = {
  DRAFT: "mute",
  SCHEDULED: "info",
  SENDING: "info",
  SENT: "ok",
  FAILED: "crit",
};

export function CampaignStatusPill({ status }: { status: CampaignStatus }) {
  return <StatusPill tone={TONE[status]}>{copy.status[status]}</StatusPill>;
}
