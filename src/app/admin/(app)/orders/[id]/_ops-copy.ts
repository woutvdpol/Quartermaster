/* Copy for the fulfillment + invoice parts of the order page (admin-ops). */

export const opsCopy = {
  invoice: {
    download: (display: string) => `Invoice ${display}`,
    downloadLabel: (display: string) => `Download invoice ${display} (PDF)`,
    issue: "Issue invoice",
    issueTitle: "Issue an invoice for this order?",
    issueBody:
      "The invoice gets the next invoice number and is stored as a PDF. Issued invoices can't be changed or deleted. Paid orders get one automatically.",
    issueConfirm: "Issue invoice",
    issueDone: (display: string) => `Invoice ${display} issued.`,
    already: (display: string) => `This order already has invoice ${display}.`,
    unpaid: "Invoices are issued once the order is paid.",
  },
  fulfillment: {
    note: "Carrier tracking pages only — no carrier integration. Marking an order shipped emails the customer once per shipment.",
    notify: "Email the customer when marked shipped",
    notifyHint: "Sends the “Your order is on its way” mail with the tracking link (once per shipment).",
    mailed: "Fulfillment updated — the customer gets a shipped email.",
  },
};
