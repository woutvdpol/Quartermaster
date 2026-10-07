import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LocalDriver, setStorageForTests } from "@/server/media/storage";
import { GET } from "@/app/uploads/[...path]/route";

vi.mock("next/server", () => ({ connection: async () => {} }));
const blurred = new Set<string>();
let viewer: { role: string; tenantId: string | null } | null = null;
vi.mock("@/server/db", () => ({
  db: { product: { findFirst: async ({ where }: { where: { id: string } }) => ({ blurred: blurred.has(where.id) }) } },
}));
vi.mock("@/server/auth/guards", () => ({
  currentUser: async () => viewer,
  canAccessTenant: (u: { role: string; tenantId: string | null }, t: string) => u.role === "SUPERADMIN" || (u.role === "OWNER" && u.tenantId === t),
}));

let root: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "qm-route-"));
  const driver = new LocalDriver(root);
  setStorageForTests(driver);
  await driver.put("t1/products/p1/i1/thumb.webp", new TextEncoder().encode("webp-bytes"), "image/webp");
  await driver.put("t1/products/p1/i1.jpg", new TextEncoder().encode("jpg"), "image/jpeg");
  await driver.put("t1/branding/logo.png", new TextEncoder().encode("png"), "image/png");
  await fs.writeFile(path.join(root, "t1", "evil.svg"), "<svg/>");
  await fs.writeFile(path.join(root, "secret.webp"), "outside-key-space");
  await driver.put("t1/products/p1/docs/d1.jpg", new TextEncoder().encode("doc"), "image/jpeg");
  await driver.put("t1/certificates/c1/photo.jpg", new TextEncoder().encode("cert"), "image/jpeg");
  await driver.put("t1/leads/l1/a.jpg", new TextEncoder().encode("lead"), "image/jpeg");
  await driver.put("t1/products/p9/i9/card.webp", new TextEncoder().encode("sharp"), "image/webp");
  await driver.put("t1/products/p9/i9/blur.webp", new TextEncoder().encode("blur"), "image/webp");
});

afterAll(async () => {
  setStorageForTests(null);
  await fs.rm(root, { recursive: true, force: true });
});

function get(segments: string[], headers: Record<string, string> = {}) {
  return GET(new Request(`http://localhost/uploads/${segments.join("/")}`, { headers }), {
    params: Promise.resolve({ path: segments }),
  } as RouteContext<"/uploads/[...path]">);
}

describe("GET /uploads/[...path]", () => {
  it("streams a variant with immutable caching", async () => {
    const res = await get(["t1", "products", "p1", "i1", "thumb.webp"]);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("content-length")).toBe("10");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toBe("webp-bytes");
  });

  it("serves originals as immutable and other files with a short cache", async () => {
    const original = await get(["t1", "products", "p1", "i1.jpg"]);
    expect(original.headers.get("content-type")).toBe("image/jpeg");
    expect(original.headers.get("cache-control")).toContain("immutable");
    const logo = await get(["t1", "branding", "logo.png"]);
    expect(logo.status).toBe(200);
    expect(logo.headers.get("cache-control")).toBe("public, max-age=300");
  });

  it("answers 304 for a matching If-None-Match", async () => {
    const first = await get(["t1", "products", "p1", "i1", "thumb.webp"]);
    const etag = first.headers.get("etag")!;
    expect(etag).toBeTruthy();
    const second = await get(["t1", "products", "p1", "i1", "thumb.webp"], { "if-none-match": `W/"x", ${etag}` });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
    const stale = await get(["t1", "products", "p1", "i1", "thumb.webp"], { "if-none-match": '"other"' });
    expect(stale.status).toBe(200);
  });

  it.each([
    [["t1", "products", "p1", "missing.webp"]],
    [["..", "secret.webp"]],
    [["t1", "..", "secret.webp"]],
    [["t1", "evil.svg"]],
    [["t1", "products"]],
    [[".tmp-abc"]],
  ])("404s for %j", async (segments) => {
    const res = await get(segments);
    expect(res.status).toBe(404);
  });

  it("never serves documents or certificate files", async () => {
    expect((await get(["t1", "products", "p1", "docs", "d1.jpg"])).status).toBe(404);
    expect((await get(["t1", "certificates", "c1", "photo.jpg"])).status).toBe(404);
  });

  it("serves lead photos only to staff of that shop, never cached publicly", async () => {
    viewer = null;
    expect((await get(["t1", "leads", "l1", "a.jpg"])).status).toBe(404);
    viewer = { role: "OWNER", tenantId: "t2" };
    expect((await get(["t1", "leads", "l1", "a.jpg"])).status).toBe(404);
    viewer = { role: "OWNER", tenantId: "t1" };
    const res = await get(["t1", "leads", "l1", "a.jpg"]);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    viewer = null;
  });

  it("gives guests only the blur variant of sensitive products", async () => {
    blurred.add("p9");
    viewer = null;
    expect((await get(["t1", "products", "p9", "i9", "card.webp"])).status).toBe(404);
    expect((await get(["t1", "products", "p9", "i9", "blur.webp"])).status).toBe(200);
    viewer = { role: "CUSTOMER", tenantId: "t1" };
    expect((await get(["t1", "products", "p9", "i9", "card.webp"])).status).toBe(200);
    viewer = null;
    blurred.clear();
  });
});
