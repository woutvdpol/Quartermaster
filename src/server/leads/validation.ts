import { z } from "zod";

/*
 * Pure validation for "Sell your collection" leads (no server imports: unit-testable, and safe to
 * share field limits with the client form).
 */

export const LEAD_STATUSES = ["NEW", "CONTACTED", "BOUGHT", "DECLINED"] as const;
export type LeadStatusValue = (typeof LEAD_STATUSES)[number];

export const LEAD_LIMITS = {
  name: 200,
  email: 254,
  phone: 40,
  itemsDescriptionMin: 10,
  itemsDescription: 5000,
  message: 5000,
  note: 5000,
  photos: 10,
} as const;

/** Photo storage key under `{tenantId}/leads/{leadId}/` (validated against the lead again server-side). */
export const LEAD_PHOTO_FILE = /^p[A-Za-z0-9]{16,40}_\d{1,5}x\d{1,5}\.jpg$/;

const optionalText = (max: number, msg: string) =>
  z
    .string()
    .trim()
    .max(max, msg)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

export const leadInputSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(LEAD_LIMITS.name, "Name is too long."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(LEAD_LIMITS.email, "Email address is too long.")
    .pipe(z.email("Enter a valid email address.")),
  phone: optionalText(LEAD_LIMITS.phone, "Phone number is too long.").refine(
    (v) => v === null || /^[0-9+()\-./\s]{6,}$/.test(v),
    "Enter a valid phone number.",
  ),
  itemsDescription: z
    .string()
    .trim()
    .min(LEAD_LIMITS.itemsDescriptionMin, "Tell us a bit more about the items (at least 10 characters).")
    .max(LEAD_LIMITS.itemsDescription, "Description is too long (max 5000 characters)."),
  message: optionalText(LEAD_LIMITS.message, "Message is too long (max 5000 characters)."),
  consent: z.literal(true, "Please agree so we can contact you about your items."),
  photos: z
    .array(z.string().regex(LEAD_PHOTO_FILE, "Invalid photo."))
    .max(LEAD_LIMITS.photos, `At most ${LEAD_LIMITS.photos} photos.`)
    .default([])
    .transform((list) => [...new Set(list)]),
});

export type LeadInput = z.output<typeof leadInputSchema>;
export type LeadField = "name" | "email" | "phone" | "itemsDescription" | "message" | "consent" | "photos";

function str(fd: FormData, name: string): string {
  const v = fd.get(name);
  return typeof v === "string" ? v : "";
}

/** Reads the public form (photo file names in repeated `photos` fields). */
export function leadInputFromForm(fd: FormData): z.input<typeof leadInputSchema> {
  return {
    name: str(fd, "name"),
    email: str(fd, "email"),
    phone: str(fd, "phone"),
    itemsDescription: str(fd, "itemsDescription"),
    message: str(fd, "message"),
    consent: (fd.get("consent") === "on" || fd.get("consent") === "true") as true,
    photos: fd.getAll("photos").filter((v): v is string => typeof v === "string" && v !== ""),
  };
}

export type LeadValidation =
  | { ok: true; data: LeadInput }
  | { ok: false; fieldErrors: Partial<Record<LeadField, string>> };

export function validateLeadInput(input: unknown): LeadValidation {
  const res = leadInputSchema.safeParse(input);
  if (res.success) return { ok: true, data: res.data };
  const fieldErrors: Partial<Record<LeadField, string>> = {};
  for (const issue of res.error.issues) {
    const key = String(issue.path[0] ?? "") as LeadField;
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return { ok: false, fieldErrors };
}

export const leadStatusSchema = z.enum(LEAD_STATUSES);
export const leadNoteSchema = z
  .string()
  .trim()
  .max(LEAD_LIMITS.note, "Note is too long (max 5000 characters).")
  .transform((v) => (v === "" ? null : v));

export const LEAD_STATUS_LABEL: Record<LeadStatusValue, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  BOUGHT: "Bought",
  DECLINED: "Declined",
};
