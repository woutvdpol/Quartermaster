import { describe, expect, it } from "vitest";
import { formatInvoiceNumber, invoiceFileName, vatSchemeNotice } from "./format";

describe("invoice formatting", () => {
  it("formats INV-{year}-{6 digits}", () => {
    expect(formatInvoiceNumber(123, new Date("2026-05-01T10:00:00Z"))).toBe("INV-2026-000123");
    expect(formatInvoiceNumber(1234567, new Date("2026-05-01T10:00:00Z"))).toBe("INV-2026-1234567");
  });

  it("uses the issue year in the shop time zone", () => {
    const newYearsEve = new Date("2026-12-31T23:30:00Z"); // already 2027 in Amsterdam
    expect(formatInvoiceNumber(7, newYearsEve, "Europe/Amsterdam")).toBe("INV-2027-000007");
    expect(formatInvoiceNumber(7, newYearsEve, "UTC")).toBe("INV-2026-000007");
    expect(invoiceFileName(7, newYearsEve, "UTC")).toBe("INV-2026-000007.pdf");
  });

  it("knows the margin scheme notice", () => {
    expect(vatSchemeNotice("MARGIN")?.nl).toBe("Margeregeling — BTW niet aftrekbaar");
    expect(vatSchemeNotice(null)).toBeNull();
    expect(vatSchemeNotice("STANDARD")).toBeNull();
  });
});
