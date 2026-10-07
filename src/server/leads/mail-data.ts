import "server-only";
import { db } from "@/server/db";
import type { LeadMailData } from "@/emails/LeadReceived";
import { parseLeadPhotos, photoUrl, thumbKeyFor } from "./keys";

/** Admin deep link (opens the lead's drawer). */
export const leadAdminPath = (leadId: string) => `/admin/leads?lead=${encodeURIComponent(leadId)}`;

/** Loads a lead for the mail builders (worker). Null when it is gone. */
export async function loadLeadMailData(tenantId: string, leadId: string, baseUrl: string): Promise<LeadMailData | null> {
  const lead = await db.lead.findFirst({ where: { id: leadId, tenantId } });
  if (!lead) return null;
  return {
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    itemsDescription: lead.itemsDescription,
    message: lead.message,
    createdAt: lead.createdAt,
    photos: parseLeadPhotos(lead.photos).map((p) => ({
      url: `${baseUrl}${photoUrl(p.key)}`,
      thumbUrl: `${baseUrl}${photoUrl(thumbKeyFor(p.key))}`,
    })),
  };
}
