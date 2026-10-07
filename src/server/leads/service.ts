import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { LeadStatus } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ServiceError, type ServiceContext } from "@/server/context";
import { hit, isLimited, take, type RateLimitRule } from "@/server/auth/rate-limit";
import { queueMail } from "@/server/mail";
import { getStorage } from "@/server/media/storage";
import { verifyTurnstile } from "@/server/turnstile";
import { issueDraftToken, verifyDraftToken } from "./draft";
import { LeadPhotoError, processLeadPhoto } from "./photos";
import { leadFolder, leadPhotoKey, parseLeadPhotos, photoDimensions, photoUrl, thumbKeyFor, type LeadPhoto } from "./keys";
import { LEAD_LIMITS, leadNoteSchema, leadStatusSchema, validateLeadInput, type LeadField } from "./validation";

/*
 * "Sell your collection" leads.
 *
 * Public flow (no account): page issues a draft token → photos are uploaded one by one
 * (uploadLeadPhoto, Route Handler) → the form is submitted (submitLead, Server Action) with the
 * Turnstile token. Mails: owner notification (lead-received) + seller confirmation
 * (lead-received-confirmation), queued in the same transaction as the row.
 *
 * Admin flow: listLeads / getLead / setLeadStatus / saveLeadNote (tenant-scoped, audited "lead.*").
 */

export const LEAD_RULES = {
  submitPerIp: { limit: 5, windowMs: 60 * 60 * 1000 },
  submitPerEmail: { limit: 3, windowMs: 24 * 60 * 60 * 1000 },
  photoPerIp: { limit: 60, windowMs: 60 * 60 * 1000 },
  /** Uploads per draft (allows replacing a few photos; the lead itself keeps at most 10). */
  photoPerDraft: { limit: 20, windowMs: 24 * 60 * 60 * 1000 },
} satisfies Record<string, RateLimitRule>;

// ─── Public ────────────────────────────────────────────────────────────────────────────

export function createLeadDraft(tenantId: string): string {
  return issueDraftToken(tenantId);
}

export type UploadLeadPhotoResult =
  | { ok: true; photo: { file: string; thumbUrl: string; width: number; height: number } }
  | { ok: false; error: "expired" | "rate_limited" | "invalid"; message?: string };

export async function uploadLeadPhoto(input: { tenantId: string; draftToken: unknown; bytes: Uint8Array; ip: string | null }): Promise<UploadLeadPhotoResult> {
  const leadId = verifyDraftToken(input.tenantId, input.draftToken);
  if (!leadId) return { ok: false, error: "expired" };
  const ipKey = `lead-photo:ip:${input.ip ?? "unknown"}`;
  const draftKey = `lead-photo:draft:${leadId}`;
  // Never add files to a lead that was already submitted.
  if (await db.lead.findUnique({ where: { id: leadId }, select: { id: true } })) return { ok: false, error: "expired" };
  // Atomic check-and-count (auth/rate-limit.ts).
  if (!(await take(ipKey, LEAD_RULES.photoPerIp)) || !(await take(draftKey, LEAD_RULES.photoPerDraft))) {
    return { ok: false, error: "rate_limited" };
  }

  let processed;
  try {
    processed = await processLeadPhoto(input.bytes);
  } catch (error) {
    if (error instanceof LeadPhotoError) return { ok: false, error: "invalid", message: error.message };
    throw error;
  }
  const key = `${leadFolder(input.tenantId, leadId)}${processed.file}`;
  const storage = getStorage();
  await storage.put(key, processed.full, "image/jpeg");
  await storage.put(thumbKeyFor(key), processed.thumb, "image/webp");
  return { ok: true, photo: { file: processed.file, thumbUrl: photoUrl(thumbKeyFor(key)), width: processed.width, height: processed.height } };
}

/** Removes a not-yet-submitted photo (draft owner only). */
export async function deleteDraftPhoto(input: { tenantId: string; draftToken: unknown; file: string }): Promise<boolean> {
  const leadId = verifyDraftToken(input.tenantId, input.draftToken);
  if (!leadId) return false;
  const key = leadPhotoKey(input.tenantId, leadId, input.file);
  if (!key) return false;
  if (await db.lead.findUnique({ where: { id: leadId }, select: { id: true } })) return false;
  const storage = getStorage();
  await Promise.all([storage.delete(key), storage.delete(thumbKeyFor(key))]);
  return true;
}

export type SubmitLeadResult =
  | { ok: true; leadId: string }
  | {
      ok: false;
      error: "invalid" | "expired" | "captcha" | "rate_limited" | "photos" | "duplicate";
      fieldErrors?: Partial<Record<LeadField, string>>;
    };

export async function submitLead(input: {
  tenantId: string;
  draftToken: unknown;
  data: unknown;
  ip: string | null;
  turnstileToken: string | null;
}): Promise<SubmitLeadResult> {
  const parsed = validateLeadInput(input.data);
  if (!parsed.ok) return { ok: false, error: "invalid", fieldErrors: parsed.fieldErrors };
  const data = parsed.data;

  const leadId = verifyDraftToken(input.tenantId, input.draftToken);
  if (!leadId) return { ok: false, error: "expired" };

  const ipKey = `lead:ip:${input.ip ?? "unknown"}`;
  const emailKey = `lead:email:${input.tenantId}:${data.email}`;
  if ((await isLimited(ipKey, LEAD_RULES.submitPerIp)) || (await isLimited(emailKey, LEAD_RULES.submitPerEmail))) {
    return { ok: false, error: "rate_limited" };
  }

  const captcha = await verifyTurnstile(input.turnstileToken, input.ip, { action: "sell" });
  if (!captcha.ok) return { ok: false, error: "captcha" };

  // Photos must be files this draft uploaded (they live in the lead's own folder).
  const storage = getStorage();
  const photos: LeadPhoto[] = [];
  for (const file of data.photos.slice(0, LEAD_LIMITS.photos)) {
    const key = leadPhotoKey(input.tenantId, leadId, file);
    const info = key ? await storage.head(key) : null;
    if (!key || !info) return { ok: false, error: "photos", fieldErrors: { photos: "One of the photos is missing. Please upload it again." } };
    photos.push({ key, ...photoDimensions(file), bytes: info.size });
  }

  await Promise.all([hit(ipKey), hit(emailKey)]);

  try {
    await db.$transaction(async (tx) => {
      await tx.lead.create({
        data: {
          id: leadId,
          tenantId: input.tenantId,
          name: data.name,
          email: data.email,
          phone: data.phone,
          itemsDescription: data.itemsDescription,
          message: data.message,
          photos: photos as unknown as Prisma.InputJsonValue,
        },
      });
      await queueMail({ tenantId: input.tenantId, template: "lead-received", props: { leadId } }, { tx });
      await queueMail({ tenantId: input.tenantId, template: "lead-received-confirmation", props: { leadId } }, { tx });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { ok: false, error: "duplicate" };
    throw error;
  }
  await audit({ action: "lead.created", tenantId: input.tenantId, entity: "Lead", entityId: leadId, data: { photos: photos.length } });
  return { ok: true, leadId };
}

// ─── Admin ─────────────────────────────────────────────────────────────────────────────

export type LeadListItem = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  itemsDescription: string;
  status: LeadStatus;
  photoCount: number;
  thumbUrl: string | null;
  createdAt: Date;
};

export type LeadCounts = Record<LeadStatus | "ALL", number>;

export async function listLeads(
  ctx: ServiceContext,
  opts: { status?: LeadStatus | null; q?: string | null; page?: number; pageSize?: number } = {},
): Promise<{ items: LeadListItem[]; total: number; counts: LeadCounts }> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 25, 1), 100);
  const page = Math.max(opts.page ?? 1, 1);
  const q = opts.q?.trim().slice(0, 200);
  const base: Prisma.LeadWhereInput = { tenantId: ctx.tenantId };
  if (q) {
    base.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { itemsDescription: { contains: q, mode: "insensitive" } },
    ];
  }
  const where: Prisma.LeadWhereInput = opts.status ? { ...base, status: opts.status } : base;
  const [rows, total, grouped] = await Promise.all([
    db.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, name: true, email: true, phone: true, itemsDescription: true, status: true, photos: true, createdAt: true },
    }),
    db.lead.count({ where }),
    db.lead.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
  ]);
  const counts: LeadCounts = { ALL: 0, NEW: 0, CONTACTED: 0, BOUGHT: 0, DECLINED: 0 };
  for (const g of grouped) {
    counts[g.status] = g._count._all;
    counts.ALL += g._count._all;
  }
  const items = rows.map((r) => {
    const photos = parseLeadPhotos(r.photos);
    return {
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      itemsDescription: r.itemsDescription,
      status: r.status,
      photoCount: photos.length,
      thumbUrl: photos[0] ? photoUrl(thumbKeyFor(photos[0].key)) : null,
      createdAt: r.createdAt,
    };
  });
  return { items, total, counts };
}

export type LeadDetail = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  itemsDescription: string;
  message: string | null;
  status: LeadStatus;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  handledBy: { id: string; name: string | null; email: string } | null;
  photos: { key: string; url: string; thumbUrl: string; width: number; height: number }[];
};

export async function getLead(ctx: ServiceContext, id: string): Promise<LeadDetail | null> {
  if (typeof id !== "string" || id.length > 64) return null;
  const lead = await db.lead.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!lead) return null;
  const handledBy = lead.handledById
    ? await db.user.findUnique({ where: { id: lead.handledById }, select: { id: true, name: true, email: true } })
    : null;
  return {
    id: lead.id,
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    itemsDescription: lead.itemsDescription,
    message: lead.message,
    status: lead.status,
    note: lead.note,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
    handledBy,
    photos: parseLeadPhotos(lead.photos).map((p) => ({
      key: p.key,
      url: photoUrl(p.key),
      thumbUrl: photoUrl(thumbKeyFor(p.key)),
      width: p.width,
      height: p.height,
    })),
  };
}

export async function setLeadStatus(ctx: ServiceContext, id: string, status: unknown): Promise<void> {
  const next = leadStatusSchema.safeParse(status);
  if (!next.success) throw new ServiceError("INVALID", "Unknown status.");
  const lead = await db.lead.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { status: true } });
  if (!lead) throw new ServiceError("NOT_FOUND");
  if (lead.status === next.data) return;
  await db.lead.update({ where: { id }, data: { status: next.data, handledById: ctx.actor.id } });
  await audit({
    action: "lead.status_changed",
    tenantId: ctx.tenantId,
    actorId: ctx.actor.id,
    entity: "Lead",
    entityId: id,
    data: { from: lead.status, to: next.data },
  });
}

export async function saveLeadNote(ctx: ServiceContext, id: string, note: unknown): Promise<void> {
  const parsed = leadNoteSchema.safeParse(typeof note === "string" ? note : "");
  if (!parsed.success) throw new ServiceError("INVALID", parsed.error.issues[0]?.message);
  const res = await db.lead.updateMany({ where: { id, tenantId: ctx.tenantId }, data: { note: parsed.data } });
  if (res.count === 0) throw new ServiceError("NOT_FOUND");
  await audit({ action: "lead.note_updated", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Lead", entityId: id });
}
