import { describe, expect, it } from "vitest";
import { PLATFORM_LANDING_PATH, platformLandingRewrite } from "./platform-landing";

describe("platformLandingRewrite", () => {
  it("serves the landing for the platform host's root, whatever the host's case or trailing dot", () => {
    expect(platformLandingRewrite("quartermaster.example", "/", "quartermaster.example")).toBe(PLATFORM_LANDING_PATH);
    expect(platformLandingRewrite("Quartermaster.Example.", "/", "quartermaster.example")).toBe(PLATFORM_LANDING_PATH);
  });

  it("leaves other paths, shop hosts and an unset platform host alone", () => {
    expect(platformLandingRewrite("quartermaster.example", "/apply", "quartermaster.example")).toBeNull();
    expect(platformLandingRewrite("shop.example", "/", "quartermaster.example")).toBeNull();
    expect(platformLandingRewrite(null, "/", "quartermaster.example")).toBeNull();
    expect(platformLandingRewrite("quartermaster.example", "/", undefined)).toBeNull();
  });
});
