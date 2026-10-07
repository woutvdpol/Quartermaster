import { describe, expect, it } from "vitest";
import { summarizeAudit } from "./summary";

describe("summarizeAudit", () => {
  it("uses action-specific sentences with data", () => {
    expect(summarizeAudit({ action: "user.invited", entity: "User", entityId: "u1", data: { email: "a@b.nl" }, actorLabel: "jan@x.nl" })).toBe(
      "jan@x.nl invited a@b.nl as shop owner",
    );
    expect(
      summarizeAudit({ action: "settings.update", entity: "Setting", entityId: "catalog", data: { group: "catalog", changed: ["layout", "gridColumns"] }, actorLabel: "X" }),
    ).toBe("X changed catalog settings: layout, gridColumns");
    expect(summarizeAudit({ action: "auth.login_failed", entity: null, entityId: null, data: { email: "a@b.nl", reason: "invalid_credentials" }, actorLabel: "Someone" })).toBe(
      "Someone failed to sign in as a@b.nl (invalid credentials)",
    );
  });

  it("falls back for unknown actions and odd data", () => {
    expect(summarizeAudit({ action: "foo.bar", entity: "Thing", entityId: "7", data: null, actorLabel: "X" })).toBe('X performed "foo.bar" on Thing 7');
    expect(summarizeAudit({ action: "user.disabled", entity: "User", entityId: "u", data: [1, 2], actorLabel: "X" })).toBe("X disabled the account of ?");
  });
});
