/*
 * Tiny toast store. Call `toast()` from client code (event handlers, effects, after an action
 * resolves). Rendered by <Toaster/>, which must be mounted once inside the admin shell.
 */

export type ToastTone = "info" | "ok" | "warn" | "crit";

export type ToastOptions = {
  tone?: ToastTone;
  description?: string;
  /** Milliseconds before auto-dismiss; 0 keeps it until dismissed. Default 5s (crit 8s). */
  duration?: number;
  action?: { label: string; onClick: () => void };
};

export type ToastItem = Required<Pick<ToastOptions, "tone" | "duration">> &
  Omit<ToastOptions, "tone" | "duration"> & { id: number; title: string };

type Listener = () => void;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<Listener>();
const EMPTY: ToastItem[] = [];
const MAX_VISIBLE = 5;

function emit() {
  for (const l of listeners) l();
}

function push(title: string, options: ToastOptions = {}): number {
  const tone = options.tone ?? "info";
  const item: ToastItem = {
    ...options,
    id: nextId++,
    title,
    tone,
    duration: options.duration ?? (tone === "crit" ? 8000 : 5000),
  };
  items = [...items, item].slice(-MAX_VISIBLE);
  emit();
  return item.id;
}

/** Show a toast. Returns its id (for toast.dismiss). */
export const toast = Object.assign(push, {
  ok: (title: string, options?: Omit<ToastOptions, "tone">) => push(title, { ...options, tone: "ok" }),
  info: (title: string, options?: Omit<ToastOptions, "tone">) => push(title, { ...options, tone: "info" }),
  warn: (title: string, options?: Omit<ToastOptions, "tone">) => push(title, { ...options, tone: "warn" }),
  crit: (title: string, options?: Omit<ToastOptions, "tone">) => push(title, { ...options, tone: "crit" }),
  dismiss(id?: number) {
    items = id === undefined ? [] : items.filter((t) => t.id !== id);
    emit();
  },
});

export const toastStore = {
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: () => items,
  getServerSnapshot: () => EMPTY,
};

// Only one mounted <Toaster/> renders, so mounting it in a page and in the shell is harmless.
let owners: string[] = [];
const ownerListeners = new Set<Listener>();
export const toasterOwners = {
  register(id: string) {
    owners = [...owners, id];
    for (const l of ownerListeners) l();
  },
  unregister(id: string) {
    owners = owners.filter((o) => o !== id);
    for (const l of ownerListeners) l();
  },
  subscribe(listener: Listener) {
    ownerListeners.add(listener);
    return () => ownerListeners.delete(listener);
  },
  first: () => owners[0] ?? null,
};
