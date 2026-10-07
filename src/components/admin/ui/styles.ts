/*
 * Shared class strings for the UI kit. Semantic utilities only (see src/app/globals.css), so every
 * admin theme (A Depot, B Field Ledger, C Naval Quiet) restyles these automatically.
 */

/** Text-like controls: input, textarea, select. Invalid state comes from `aria-invalid`. */
export const controlClass =
  "block w-full min-w-0 rounded-control border border-line bg-panel px-2.5 py-[7px] text-[13.5px] text-ink " +
  "placeholder:text-muted transition-colors hover:border-line-strong " +
  "aria-invalid:border-crit aria-invalid:hover:border-crit " +
  "disabled:cursor-not-allowed disabled:bg-panel-2 disabled:text-muted [&:is(input,textarea):read-only]:bg-panel-2";

/** Field label (design A: condensed, uppercase, muted). */
export const labelClass = "type-label text-[11.5px] text-muted";

export const hintClass = "text-xs text-muted";
export const errorClass = "text-xs text-crit";

/** Wrapper for a control with leading/trailing adornments (currency symbol, unit). */
export const groupClass =
  "flex w-full min-w-0 items-stretch overflow-hidden rounded-control border border-line bg-panel transition-colors " +
  "hover:border-line-strong focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus " +
  "has-[[aria-invalid=true]]:border-crit has-[:disabled]:bg-panel-2";

/** Control inside a `groupClass` wrapper (the wrapper draws border and focus ring). */
export const groupControlClass =
  "min-w-0 flex-1 border-0 bg-transparent px-2.5 py-[7px] text-[13.5px] text-ink placeholder:text-muted " +
  "focus-visible:outline-none disabled:cursor-not-allowed disabled:text-muted";

export const adornmentClass = "flex items-center bg-panel-2 px-2.5 text-[13px] text-muted select-none";

/** Table header cell text (design A: condensed uppercase, muted). */
export const thClass = "type-label px-2.5 py-2 text-left text-[11.5px] whitespace-nowrap text-muted";
export const tdClass = "px-2.5 py-2 align-middle";
