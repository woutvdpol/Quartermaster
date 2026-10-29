/*
 * Steps of the first-sign-in admin tour (docs/admin-tour.md). Pure, so the filtering is unit-testable.
 * Each step points at an element with `data-tour="<target>"` on the dashboard or in the sidebar; the
 * welcome and closing steps have no target and show as a centred card.
 */

export type TourTarget = "nav" | "search" | "todo" | "new-product" | "orders" | "website" | "payments" | "locked" | "account";
export type TourStep = { id: string; target: TourTarget | null; title: string; body: string };

export const tourSelector = (target: TourTarget) => `[data-tour="${target}"]`;

export function tourSteps(shopName: string, shortcut: string): TourStep[] {
  return [
    { id: "welcome", target: null, title: `Welcome to ${shopName}`, body: "A one-minute tour of your admin. You can play it again any time from your account." },
    { id: "nav", target: "nav", title: "Everything is in the menu", body: "Grouped by Catalog, Sales, Website and System. On a phone it sits behind the Menu button." },
    { id: "search", target: "search", title: `Search or press ${shortcut}`, body: "Jump to a product, an order number or a page from the keyboard." },
    { id: "todo", target: "todo", title: "To do today", body: "What needs you now: paid orders to ship, payments waiting, items reserved in a cart." },
    { id: "new-product", target: "new-product", title: "Add your first piece", body: "Every piece is unique: one product, one stock number, sold once." },
    { id: "orders", target: "orders", title: "Orders", body: "Web shop and fair sales arrive here. The shipping board shows what to pack." },
    { id: "website", target: "website", title: "Your website", body: "Change the look, pages and menus of your shop under Website." },
    { id: "payments", target: "payments", title: "Take payments", body: "Connect Mollie under Payment methods to take real payments." },
    { id: "locked", target: "locked", title: "Locked items", body: "A lock means the module is not in your package. Open it to see what it does and what it costs." },
    { id: "account", target: "account", title: "Your account", body: "Your password, two-factor sign-in, and this tour again." },
    { id: "done", target: null, title: "You're set", body: "Have a look at your shop as visitors see it." },
  ];
}

/** Leaves out steps whose element is not on the page (e.g. no locked modules on the Complete package). */
export function availableSteps(steps: TourStep[], exists: (target: TourTarget) => boolean): TourStep[] {
  return steps.filter((s) => s.target === null || exists(s.target));
}
