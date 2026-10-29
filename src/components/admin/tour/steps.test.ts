import { describe, expect, it } from "vitest";
import { availableSteps, tourSteps } from "./steps";

describe("admin tour steps", () => {
  it("starts with the welcome and ends with the closing card", () => {
    const steps = tourSteps("Vries Militaria", "⌘K");
    expect(steps[0]).toMatchObject({ id: "welcome", target: null, title: "Welcome to Vries Militaria" });
    expect(steps.at(-1)).toMatchObject({ id: "done", target: null });
    expect(steps.find((s) => s.id === "search")?.title).toBe("Search or press ⌘K");
  });

  it("drops steps whose element is missing and keeps the untargeted ones", () => {
    const steps = availableSteps(tourSteps("Shop", "Ctrl K"), (t) => t !== "locked" && t !== "todo");
    const ids = steps.map((s) => s.id);
    expect(ids).not.toContain("locked");
    expect(ids).not.toContain("todo");
    expect(ids[0]).toBe("welcome");
    expect(ids.at(-1)).toBe("done");
  });
});
