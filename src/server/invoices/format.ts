/*
 * Pure invoice helpers (no server imports): number formatting and VAT scheme texts.
 */

export const VAT_SCHEMES = ["MARGIN"] as const;
export type VatScheme = (typeof VAT_SCHEMES)[number];

/** Default for every shop: second-hand goods under the margin scheme (margeregeling). Per-shop setting later. */
export const DEFAULT_VAT_SCHEME: VatScheme = "MARGIN";

/** Legal notice printed on the invoice per scheme. Under the margin scheme no VAT amount may be shown. */
export const VAT_SCHEME_NOTICE: Record<VatScheme, { nl: string; en: string }> = {
  MARGIN: {
    nl: "Margeregeling — BTW niet aftrekbaar",
    en: "Margin scheme — VAT not deductible",
  },
};

export function vatSchemeNotice(scheme: string | null | undefined): { nl: string; en: string } | null {
  return scheme && scheme in VAT_SCHEME_NOTICE ? VAT_SCHEME_NOTICE[scheme as VatScheme] : null;
}

/** Calendar year of `date` in the shop's time zone (an invoice issued 31 Dec 23:30 CET belongs to that year). */
export function yearIn(date: Date, timeZone: string): number {
  try {
    return Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone }).format(date));
  } catch {
    return date.getUTCFullYear();
  }
}

/**
 * Display form of an invoice number: `INV-{year}-{number, 6 digits}`, e.g. INV-2026-000123.
 * The stored number is the per-tenant sequence "invoice.number" (it does not restart per year);
 * the year is the issue year in the shop's time zone.
 */
export function formatInvoiceNumber(number: number, issuedAt: Date, timeZone = "Europe/Amsterdam"): string {
  return `INV-${yearIn(issuedAt, timeZone)}-${String(number).padStart(6, "0")}`;
}

/** File name for downloads: `INV-2026-000123.pdf`. */
export function invoiceFileName(number: number, issuedAt: Date, timeZone?: string): string {
  return `${formatInvoiceNumber(number, issuedAt, timeZone)}.pdf`;
}
