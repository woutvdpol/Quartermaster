/** Plain, serialisable shapes shared by the ⌘K search service and the palette UI. */

export type CommandItem = {
  /** Stable id, unique across groups (used for keys, aria ids and recents). */
  id: string;
  label: string;
  /** Navigate here when chosen. */
  href?: string;
  /** Run a palette action instead of navigating (e.g. "switch-tenant:<id>"). */
  action?: string;
  meta?: string;
  badge?: string;
  tone?: "ok" | "warn" | "crit" | "info" | "mute";
  /** Keyboard hint shown on the right. */
  hint?: string;
};

export type CommandGroup = { id: string; label: string; items: CommandItem[] };
