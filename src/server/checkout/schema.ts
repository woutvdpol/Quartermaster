// Checkout input validation (pure: no server-only, no DB) — shared by the server action and unit tests.
// Field paths ("shipping.city") double as the form field names, so errors map 1:1 onto inputs.
import { z } from "zod";
import { isCountryCode } from "@/server/shipping/countries";

/** Countries without a (mandatory) postal code. Everywhere else a postal code is required. */
export const NO_POSTCODE_COUNTRIES: ReadonlySet<string> = new Set([
  "AE", "AG", "AO", "AW", "BF", "BI", "BJ", "BO", "BS", "BW", "BZ", "CD", "CF", "CG", "CI", "CK", "CM", "CW", "DJ", "DM",
  "ER", "FJ", "GA", "GD", "GH", "GM", "GQ", "GY", "HK", "IE", "JM", "KI", "KM", "KN", "KP", "LC", "ML", "MO", "MR", "MS",
  "MW", "NR", "NU", "QA", "RW", "SB", "SC", "SL", "SR", "ST", "SY", "TD", "TF", "TG", "TK", "TL", "TO", "TT", "TV", "TZ",
  "UG", "VU", "YE", "ZW",
]);

const text = (max: number) => z.string().trim().max(max, `Use at most ${max} characters`);
const required = (max: number, label: string) => text(max).min(1, `Enter your ${label}`);
const optional = (max: number) =>
  text(max)
    .optional()
    .transform((v) => (v ? v : null));

const countryCode = z
  .string()
  .trim()
  .toUpperCase()
  .refine((c) => isCountryCode(c), "Choose a country");

export const addressSchema = z
  .object({
    firstName: required(100, "first name"),
    lastName: required(100, "last name"),
    company: optional(200),
    street: required(200, "street"),
    houseNumber: optional(20),
    line2: optional(200),
    postalCode: optional(20),
    city: required(100, "city"),
    region: optional(100),
    countryCode,
  })
  .superRefine((a, ctx) => {
    if (!a.postalCode && !NO_POSTCODE_COUNTRIES.has(a.countryCode)) {
      ctx.addIssue({ code: "custom", path: ["postalCode"], message: "Enter your postal code" });
    }
  });
export type AddressInput = z.output<typeof addressSchema>;

const checkbox = z.preprocess((v) => v === true || v === "on" || v === "true" || v === "1", z.boolean());

export const checkoutInputSchema = z
  .object({
    email: z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address")),
    phone: z
      .string()
      .trim()
      .min(6, "Enter your phone number")
      .max(40, "Phone number is too long")
      .regex(/^\+?[0-9 ()./-]{6,40}$/, "Enter a valid phone number"),
    shipping: addressSchema,
    billingSameAsShipping: checkbox,
    billing: z.unknown().optional(),
    shippingOptionId: z.string().trim().min(1, "Choose a shipping option").max(64),
    insurance: checkbox.default(false),
    /** Mollie method id; "" = let the customer choose on Mollie's page (only when we offer no list). */
    paymentMethod: z.string().trim().toLowerCase().max(40).default(""),
    termsAccepted: checkbox.refine((v) => v, "Please accept the terms and conditions"),
    newsletter: checkbox.default(false),
    ageConfirmed: checkbox.default(false),
    customerNote: optional(1000),
    /** Random per checkout page render; double submits carry the same key. */
    idempotencyKey: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,64}$/)
      .optional(),
  })
  .transform((v, ctx) => {
    let billing: AddressInput = v.shipping;
    if (!v.billingSameAsShipping) {
      const parsed = addressSchema.safeParse(v.billing ?? {});
      if (!parsed.success) {
        for (const issue of parsed.error.issues) ctx.addIssue({ ...issue, path: ["billing", ...issue.path] } as z.core.$ZodRawIssue);
        return z.NEVER;
      }
      billing = parsed.data;
    }
    return { ...v, billing };
  });

export type CheckoutInput = z.output<typeof checkoutInputSchema>;
export type CheckoutRawInput = z.input<typeof checkoutInputSchema>;
export type FieldErrors = Record<string, string>;

/** First message per field path ("shipping.city"). */
export function fieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_form";
    out[key] ??= issue.message;
  }
  return out;
}

/** FormData with dotted names ("shipping.city") → nested plain object. Only string values are kept. */
export function formDataToObject(form: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of form.entries()) {
    if (typeof value !== "string" || name.startsWith("$ACTION")) continue;
    const parts = name.split(".").slice(0, 3);
    if (parts.some((p) => !/^[A-Za-z][A-Za-z0-9]*$/.test(p))) continue;
    let node = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const next = node[parts[i]];
      if (typeof next !== "object" || next === null) node[parts[i]] = {};
      node = node[parts[i]] as Record<string, unknown>;
    }
    node[parts[parts.length - 1]] = value;
  }
  return out;
}

export function parseCheckoutInput(raw: unknown): { ok: true; data: CheckoutInput } | { ok: false; errors: FieldErrors } {
  const res = checkoutInputSchema.safeParse(raw);
  return res.success ? { ok: true, data: res.data } : { ok: false, errors: fieldErrors(res.error) };
}
