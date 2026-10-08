import { describe, expect, it } from "vitest";
import { CLOSED, clampActive, comboKey } from "./combobox";

describe("comboKey", () => {
  it("ArrowDown opens on the first option, moves down and wraps back to the input", () => {
    let r = comboKey(CLOSED, "ArrowDown", 3);
    expect(r).toEqual({ state: { open: true, active: 0 }, effect: null, preventDefault: true });
    r = comboKey(r.state, "ArrowDown", 3);
    r = comboKey(r.state, "ArrowDown", 3);
    expect(r.state.active).toBe(2);
    expect(comboKey(r.state, "ArrowDown", 3).state.active).toBe(-1);
    expect(comboKey(CLOSED, "ArrowDown", 3, { alt: true }).state).toEqual({ open: true, active: -1 });
  });

  it("ArrowUp opens on the last option and walks back through the input", () => {
    const r = comboKey(CLOSED, "ArrowUp", 4);
    expect(r.state).toEqual({ open: true, active: 3 });
    expect(comboKey({ open: true, active: 0 }, "ArrowUp", 4).state.active).toBe(-1);
    expect(comboKey({ open: true, active: -1 }, "ArrowUp", 4).state.active).toBe(3);
  });

  it("arrows do nothing without options (caret keeps working)", () => {
    expect(comboKey(CLOSED, "ArrowDown", 0)).toEqual({ state: CLOSED, effect: null, preventDefault: false });
  });

  it("Enter selects the active option, otherwise lets the form submit", () => {
    expect(comboKey({ open: true, active: 1 }, "Enter", 3)).toEqual({ state: CLOSED, effect: "select", preventDefault: true });
    expect(comboKey({ open: true, active: -1 }, "Enter", 3)).toEqual({ state: CLOSED, effect: "submit", preventDefault: false });
    expect(comboKey(CLOSED, "Enter", 0).effect).toBe("submit");
  });

  it("Escape closes an open popup (and only then swallows the key); Tab closes", () => {
    expect(comboKey({ open: true, active: 2 }, "Escape", 3)).toEqual({ state: CLOSED, effect: null, preventDefault: true });
    expect(comboKey(CLOSED, "Escape", 3).preventDefault).toBe(false);
    expect(comboKey({ open: true, active: 0 }, "Tab", 3)).toEqual({ state: CLOSED, effect: null, preventDefault: false });
    expect(comboKey({ open: true, active: 0 }, "a", 3).state).toEqual({ open: true, active: 0 });
  });

  it("clampActive drops an active index past the new list", () => {
    expect(clampActive({ open: true, active: 4 }, 2)).toEqual({ open: true, active: -1 });
    expect(clampActive({ open: true, active: 1 }, 2)).toEqual({ open: true, active: 1 });
    expect(clampActive({ open: true, active: 1 }, 0)).toEqual({ open: true, active: -1 });
  });
});
