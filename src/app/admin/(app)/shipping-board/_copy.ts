/* Screen copy for the shipping board (WIP preview). */

export const boardCopy = {
  crumb: "Orders",
  title: "Shipping board",
  list: "Order list",
  wipTitle: "Preview",
  wipBody:
    "A read-only preview of the daily routine: paid orders move from packing to shipped. Drag-and-drop, labels and the automatic “shipped” mail come later — change statuses on the order itself for now.",
  lanes: {
    awaiting: "Awaiting payment",
    packing: "Packing",
    ready: "Ready to ship",
    shipped: "Shipped",
  },
  empty: "Nothing here",
  day: (n: number) => `day ${n}`,
  paid: (d: string) => `Paid ${d}`,
  packed: "Packed",
  delivered: "Delivered",
  shipped: "Shipped",
  shippedRecent: (n: number, total: number) => (total > n ? `latest ${n} of ${total}` : null),
  truncated: (n: number) => `Showing the newest ${n} open orders.`,
  items: (n: number) => `${n} ${n === 1 ? "item" : "items"}`,
};
