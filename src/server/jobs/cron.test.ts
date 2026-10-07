import { describe, expect, it } from "vitest";
import { CRON_TASKS, isAuthorizedCronRequest, isCronTaskName } from "./cron";

const SECRET = "s3cret-value-that-is-long-enough";

describe("isAuthorizedCronRequest", () => {
  it("accepts the right bearer token", () => {
    expect(isAuthorizedCronRequest(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isAuthorizedCronRequest(`bearer   ${SECRET}  `, SECRET)).toBe(true);
  });

  it("rejects wrong, partial or missing tokens", () => {
    expect(isAuthorizedCronRequest(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isAuthorizedCronRequest(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toBe(false);
    expect(isAuthorizedCronRequest(SECRET, SECRET)).toBe(false);
    expect(isAuthorizedCronRequest(`Basic ${SECRET}`, SECRET)).toBe(false);
    expect(isAuthorizedCronRequest(null, SECRET)).toBe(false);
    expect(isAuthorizedCronRequest("", SECRET)).toBe(false);
  });

  it("is disabled without a (sufficiently long) secret", () => {
    expect(isAuthorizedCronRequest("Bearer ", undefined)).toBe(false);
    expect(isAuthorizedCronRequest("Bearer ", "")).toBe(false);
    expect(isAuthorizedCronRequest("Bearer short", "short")).toBe(false);
  });
});

describe("cron tasks", () => {
  it("knows its tasks and rejects others", () => {
    expect(isCronTaskName("reservations.expire")).toBe(true);
    expect(isCronTaskName("rate-limit.prune")).toBe(true);
    expect(isCronTaskName("toString")).toBe(false);
    expect(isCronTaskName("../etc")).toBe(false);
    for (const t of Object.values(CRON_TASKS)) expect(t.schedule.split(" ")).toHaveLength(5);
  });
});
