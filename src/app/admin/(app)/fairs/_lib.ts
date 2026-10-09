import type { StatusTone } from "@/components/admin/ui";
import type { FairStatus } from "@/generated/prisma/enums";

export const FAIR_STATUS_TONE: Record<FairStatus, StatusTone> = { PREPARING: "info", LIVE: "ok", ENDED: "mute" };

/** Date (stored as a UTC calendar day) → "YYYY-MM-DD" for date inputs. */
export function dayInput(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}
