import { describe, expect, it } from "vitest";
import {
  applicationSchema,
  baseTenantSlug,
  checkCocFormat,
  defaultTimeZone,
  isDisposableEmail,
  nextFreeTenantSlug,
  parseChecks,
  shopNameKey,
  shopSubdomainBase,
  shopSubdomainHost,
  summarizeChecks,
} from "./rules";

const valid = {
  applicantName: "Jan de Vries",
  email: "  Jan@Example.NL ",
  shopName: "Vries Militaria",
  country: "nl",
  cocNumber: "12345678",
  currentPlatform: "woocommerce",
  description: "WW2 helmets, uniforms and insignia — about 300 pieces.",
  legalConsent: true,
};

describe("applicationSchema", () => {
  it("normalizes a valid application", () => {
    const res = applicationSchema.parse(valid);
    expect(res.email).toBe("jan@example.nl");
    expect(res.country).toBe("NL");
    expect(res.cocNumber).toBe("12345678");
  });

  it("treats an empty CoC number as not given", () => {
    expect(applicationSchema.parse({ ...valid, cocNumber: "  " }).cocNumber).toBeNull();
  });

  it("rejects missing consent, unknown platform/country, short description and bad email", () => {
    const res = applicationSchema.safeParse({ ...valid, legalConsent: false, currentPlatform: "ebay", country: "XX", description: "helmets", email: "nope" });
    expect(res.success).toBe(false);
    const fields = new Set(res.error!.issues.map((i) => i.path[0]));
    expect(fields).toEqual(new Set(["legalConsent", "currentPlatform", "country", "description", "email"]));
  });

  it("rejects CoC numbers with odd characters", () => {
    expect(applicationSchema.safeParse({ ...valid, cocNumber: "<script>" }).success).toBe(false);
  });
});

describe("checkCocFormat", () => {
  it.each([
    ["NL", "12345678", "ok"],
    ["NL", "1234 5678", "ok"],
    ["NL", "1234567", "invalid"],
    ["BE", "0123.456.789", "ok"],
    ["BE", "2123456789", "invalid"],
    ["DE", "HRB 12345", "ok"],
    ["DE", "12345", "invalid"],
    ["FR", "732 829 320", "ok"],
    ["GB", "SC123456", "ok"],
    ["US", "anything", "unchecked"],
    ["NL", "", "missing"],
    ["NL", null, "missing"],
  ] as const)("%s %s → %s", (country, coc, expected) => {
    expect(checkCocFormat(country, coc)).toBe(expected);
  });
});

describe("isDisposableEmail", () => {
  it("flags known and look-alike throw-away domains", () => {
    expect(isDisposableEmail("x@mailinator.com")).toBe(true);
    expect(isDisposableEmail("x@sub.yopmail.com")).toBe(true);
    expect(isDisposableEmail("x@my-tempmail.example")).toBe(true);
  });
  it("leaves normal providers alone", () => {
    expect(isDisposableEmail("x@gmail.com")).toBe(false);
    expect(isDisposableEmail("x@concept-militaria.nl")).toBe(false);
    expect(isDisposableEmail("no-at-sign")).toBe(false);
  });
});

describe("shopNameKey", () => {
  it("ignores case, punctuation and company suffixes", () => {
    expect(shopNameKey("Vries Militaria B.V.")).toBe(shopNameKey("vries"));
    expect(shopNameKey("The Helmet Shop")).toBe("helmet");
    expect(shopNameKey("Militaria")).toBe("");
  });
});

describe("tenant slug + subdomain", () => {
  it("derives a DNS-safe slug", () => {
    expect(baseTenantSlug("Überjäger & Co. Militaria")).toBe("uberjager-and-co-militaria");
    expect(baseTenantSlug("A")).toBe("a-shop");
    expect(baseTenantSlug("!!!")).toBe("shop");
    expect(baseTenantSlug("Admin")).toBe("admin-shop");
    expect(baseTenantSlug("x".repeat(100)).length).toBeLessThanOrEqual(40);
  });

  it("finds the next free slug", () => {
    expect(nextFreeTenantSlug("vries", [])).toBe("vries");
    expect(nextFreeTenantSlug("vries", ["vries", "vries-2"])).toBe("vries-3");
    const long = "a".repeat(40);
    const next = nextFreeTenantSlug(long, [long]);
    expect(next).toHaveLength(40);
    expect(next.endsWith("-2")).toBe(true);
  });

  it("builds the platform sub-domain host from SHOP_SUBDOMAIN_BASE", () => {
    expect(shopSubdomainBase({})).toBe("localhost:3000");
    expect(shopSubdomainBase({ SHOP_SUBDOMAIN_BASE: " https://Quartermaster.NL/ " })).toBe("quartermaster.nl");
    expect(shopSubdomainHost("vries", "quartermaster.nl")).toBe("vries.quartermaster.nl");
    expect(shopSubdomainHost("vries", "localhost:3000")).toBe("vries.localhost:3000");
  });

  it("picks a time zone per country", () => {
    expect(defaultTimeZone("BE")).toBe("Europe/Brussels");
    expect(defaultTimeZone("US")).toBe("Europe/Amsterdam");
  });
});

describe("checks", () => {
  it("parses stored checks leniently and summarizes worst first", () => {
    const checks = parseChecks({ emailVerified: true, cocFormat: "invalid", duplicateEmail: false, disposableEmail: true, junk: 1 });
    expect(checks?.cocFormat).toBe("invalid");
    expect(parseChecks("nope")).toBeNull();
    const summary = summarizeChecks(checks);
    expect(summary[0].tone).toBe("crit");
    expect(summary.at(-1)).toMatchObject({ key: "emailVerified", tone: "ok" });
    expect(summarizeChecks(null)[0].tone).toBe("warn");
  });
});
