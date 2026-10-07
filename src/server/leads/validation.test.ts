import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leadInputFromForm, validateLeadInput } from "./validation";
import { issueDraftToken, verifyDraftToken, DRAFT_TTL_MS } from "./draft";
import { sniffImageType } from "./sniff";
import { leadPhotoKey, parseLeadPhotos, photoDimensions, thumbKeyFor } from "./keys";

const good = {
  name: "  Jan de Vries ",
  email: " Jan@Example.COM ",
  phone: "+31 6 1234 5678",
  itemsDescription: "Two M35 helmets and a box of insignia.",
  message: "",
  consent: true as const,
  photos: ["pABCDEFGHIJKLMNOPQRSTUVWX_1200x900.jpg"],
};

describe("lead validation", () => {
  it("accepts and normalises a valid lead", () => {
    const res = validateLeadInput(good);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toMatchObject({ name: "Jan de Vries", email: "jan@example.com", message: null, phone: "+31 6 1234 5678" });
    expect(res.data.photos).toHaveLength(1);
  });

  it("requires consent, name, valid email and a real description", () => {
    const res = validateLeadInput({ ...good, consent: false, name: " ", email: "nope", itemsDescription: "helmet" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(Object.keys(res.fieldErrors).sort()).toEqual(["consent", "email", "itemsDescription", "name"]);
  });

  it("rejects bad phone numbers but allows none", () => {
    expect(validateLeadInput({ ...good, phone: "call me" }).ok).toBe(false);
    const res = validateLeadInput({ ...good, phone: "" });
    expect(res.ok && res.data.phone).toBeNull();
  });

  it("limits photos to 10 well-formed file names and de-duplicates", () => {
    const name = (i: number) => `p${"A".repeat(20)}${String(i).padStart(4, "0")}_10x10.jpg`;
    expect(validateLeadInput({ ...good, photos: Array.from({ length: 11 }, (_, i) => name(i)) }).ok).toBe(false);
    expect(validateLeadInput({ ...good, photos: ["../../etc/passwd"] }).ok).toBe(false);
    expect(validateLeadInput({ ...good, photos: ["t1/leads/x/pAAAAAAAAAAAAAAAAAAAA_1x1.jpg"] }).ok).toBe(false);
    const res = validateLeadInput({ ...good, photos: [name(1), name(1)] });
    expect(res.ok && res.data.photos).toEqual([name(1)]);
  });

  it("limits text lengths", () => {
    expect(validateLeadInput({ ...good, itemsDescription: "x".repeat(5001) }).ok).toBe(false);
    expect(validateLeadInput({ ...good, message: "x".repeat(5001) }).ok).toBe(false);
  });

  it("reads the public form", () => {
    const fd = new FormData();
    fd.set("name", "A");
    fd.set("email", "a@b.nl");
    fd.set("itemsDescription", "A long enough description");
    fd.set("consent", "on");
    fd.append("photos", "p1");
    fd.append("photos", "");
    expect(leadInputFromForm(fd)).toMatchObject({ name: "A", consent: true, photos: ["p1"], phone: "" });
  });
});

describe("lead photo keys", () => {
  it("builds keys only from valid file names", () => {
    expect(leadPhotoKey("t1", "ld1", "pABCDEFGHIJKLMNOPQRSTUVWX_1200x900.jpg")).toBe("t1/leads/ld1/pABCDEFGHIJKLMNOPQRSTUVWX_1200x900.jpg");
    expect(leadPhotoKey("t1", "ld1", "x.jpg")).toBeNull();
    expect(thumbKeyFor("t1/leads/ld1/pA_1x1.jpg")).toBe("t1/leads/ld1/pA_1x1_t.webp");
    expect(photoDimensions("pABC_1200x900.jpg")).toEqual({ width: 1200, height: 900 });
    expect(parseLeadPhotos([{ key: "k", width: 2, height: 3, bytes: 4 }, null, { nokey: 1 }])).toEqual([{ key: "k", width: 2, height: 3, bytes: 4 }]);
    expect(parseLeadPhotos("x")).toEqual([]);
  });

  it("sniffs magic bytes", () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
    expect(sniffImageType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
    expect(sniffImageType(new TextEncoder().encode("<svg xmlns="))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("GIF89a"))).toBeNull();
  });
});

describe("lead draft tokens", () => {
  const prev = process.env.APP_ENCRYPTION_KEY;
  beforeAll(() => {
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });
  afterAll(() => {
    process.env.APP_ENCRYPTION_KEY = prev;
  });

  it("round-trips for the same tenant only", () => {
    const token = issueDraftToken("t1");
    const id = verifyDraftToken("t1", token);
    expect(id).toMatch(/^ld[A-Za-z0-9]{22}$/);
    expect(verifyDraftToken("t2", token)).toBeNull();
  });

  it("rejects tampering and expiry", () => {
    const now = Date.now();
    const token = issueDraftToken("t1", now);
    const [, ts, sig] = token.split(".");
    expect(verifyDraftToken("t1", `ldAAAAAAAAAAAAAAAAAAAAAA.${ts}.${sig}`)).toBeNull();
    expect(verifyDraftToken("t1", token, now + DRAFT_TTL_MS + 1)).toBeNull();
    expect(verifyDraftToken("t1", 42)).toBeNull();
    expect(verifyDraftToken("t1", "a.b.c.d")).toBeNull();
  });
});
