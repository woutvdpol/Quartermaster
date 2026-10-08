/*
 * Keyboard logic of the search combobox (WAI-ARIA 1.2 combobox pattern with a listbox popup and
 * aria-activedescendant — DOM focus stays in the input). Pure: unit-tested in combobox.test.ts.
 *
 *   ArrowDown   opens the popup / moves to the next option (wraps; from the last back to the input)
 *   ArrowUp     opens the popup on the last option / moves up (from the first back to the input)
 *   Enter       on an active option: open it; otherwise submit the search (default form submit)
 *   Escape      closes the popup (the text stays); when already closed the browser clears the field
 *   Tab         closes the popup and moves on
 */

export type ComboState = { open: boolean; active: number };
export type ComboEffect = "select" | "submit" | null;
export type ComboResult = { state: ComboState; effect: ComboEffect; preventDefault: boolean };

export const CLOSED: ComboState = { open: false, active: -1 };

export function comboKey(state: ComboState, key: string, count: number, mods: { alt?: boolean } = {}): ComboResult {
  const none = (s: ComboState = state): ComboResult => ({ state: s, effect: null, preventDefault: false });
  switch (key) {
    case "ArrowDown": {
      if (!count) return none();
      if (!state.open) return { state: { open: true, active: mods.alt ? -1 : 0 }, effect: null, preventDefault: true };
      const next = state.active + 1 >= count ? -1 : state.active + 1;
      return { state: { open: true, active: next }, effect: null, preventDefault: true };
    }
    case "ArrowUp": {
      if (!count) return none();
      if (!state.open) return { state: { open: true, active: mods.alt ? -1 : count - 1 }, effect: null, preventDefault: true };
      const next = state.active <= -1 ? count - 1 : state.active - 1;
      return { state: { open: true, active: next }, effect: null, preventDefault: true };
    }
    case "Enter":
      if (state.open && state.active >= 0 && state.active < count) return { state: CLOSED, effect: "select", preventDefault: true };
      return { state: CLOSED, effect: "submit", preventDefault: false };
    case "Escape":
      if (state.open) return { state: CLOSED, effect: null, preventDefault: true };
      return none();
    case "Tab":
      return none(state.open ? CLOSED : state);
    default:
      return none();
  }
}

/** Keeps the active index valid when the option list changes (new results while typing). */
export function clampActive(state: ComboState, count: number): ComboState {
  if (!count) return { open: state.open, active: -1 };
  return state.active >= count ? { ...state, active: -1 } : state;
}
