import { describe, expect, it } from "vitest";
import { safeAdminRedirect } from "./admin-nav";
import { safeShopRedirect } from "@/server/customer-auth/redirect";

// Security backlog #9: `?next=` after login may only lead to a relative path on this app.
const HOSTILE = [
  "https://evil.test",
  "//evil.test",
  "///evil.test",
  "/\\evil.test",
  "\\\\evil.test",
  "/admin\\@evil.test",
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  "data:text/html,x",
  "/admin/\nLocation: https://evil.test",
  "/admin\t//evil.test",
  "http:/evil.test",
  "https:evil.test",
  "  //evil.test",
  "/%2F%2Fevil.test",
  "evil.test",
  "",
  undefined,
  null,
  42,
  ["/admin/orders"],
  "/admin/" + "a".repeat(600),
];

function staysOnOrigin(target: string) {
  const base = "https://shop.test/admin/login";
  return new URL(target, base).origin === "https://shop.test";
}

describe("safeAdminRedirect", () => {
  it("accepts admin paths", () => {
    for (const ok of ["/admin", "/admin/orders", "/admin/orders?view=open#x", "/admin/inventory/abc/images"]) {
      expect(safeAdminRedirect(ok)).toBe(ok);
    }
  });

  it("falls back to the dashboard for anything else", () => {
    for (const bad of HOSTILE) {
      const out = safeAdminRedirect(bad);
      expect(staysOnOrigin(out)).toBe(true);
      expect(out.startsWith("/admin")).toBe(true);
    }
    for (const bad of ["/", "/account", "/adminx", "/admin/login", "/admin/login/2fa?next=/x", "https://evil.test/admin"]) {
      expect(safeAdminRedirect(bad)).toBe("/admin/dashboard");
    }
  });

  it("never yields a cross-origin URL even with dot segments", () => {
    for (const tricky of ["/admin/..//evil.test", "/admin/../../evil.test", "/admin/%2e%2e//evil.test"]) {
      expect(staysOnOrigin(safeAdminRedirect(tricky))).toBe(true);
    }
  });
});

describe("safeShopRedirect", () => {
  it("never yields a cross-origin URL", () => {
    for (const bad of HOSTILE) {
      const out = safeShopRedirect(bad);
      expect(staysOnOrigin(out)).toBe(true);
      expect(out.startsWith("/") && !out.startsWith("//")).toBe(true);
    }
    for (const tricky of ["/..//evil.test", "/x/../..//evil.test"]) expect(staysOnOrigin(safeShopRedirect(tricky))).toBe(true);
  });
});
