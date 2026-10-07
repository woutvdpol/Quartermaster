import "server-only";
import { formatMoney } from "@/components/admin/ui/money-utils";
import { formatDate } from "@/components/admin/ui/date-utils";
import type { PackingSlipData } from "@/server/orders/commands";
import { addressLines, countryName, paymentMethodLabel } from "../../_lib/labels";

/*
 * Printable packing slips: a standalone HTML document (no admin shell) with print CSS, rendered on
 * the server from packingSlipData(). No PDF library — the browser's "Print / Save as PDF" does that.
 * Deliberately neutral black-on-white (it is a customer-facing paper document, not admin UI).
 * Several slips (shipping board bulk print) go in one document, one per printed page.
 */

const esc = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function addressBlock(title: string, a: PackingSlipData["shippingAddress"]) {
  if (!a) return "";
  const lines = addressLines(a);
  return `<section class="addr"><h2>${esc(title)}</h2><p>${lines.map(esc).join("<br>")}${a.phone ? `<br>${esc(a.phone)}` : ""}</p></section>`;
}

function renderSheet(data: PackingSlipData, timeZone: string) {
  const { shop, order, lines, totals } = data;
  const money = (v: number | null) => (v === null ? "" : esc(formatMoney(v, order.currency)));
  const shopAddress = [
    shop.address.line1,
    shop.address.line2,
    [shop.address.postalCode, shop.address.city].filter(Boolean).join(" "),
    countryName(shop.address.country),
  ].filter(Boolean);
  const pickup = order.shippingMethod === "PICKUP";
  const method = paymentMethodLabel(order.paymentMethod);

  const rows = lines
    .map(
      (l) => `<tr>
        <td class="check" aria-hidden="true"><span></span></td>
        <td class="mono">${esc(l.stockCode ?? l.sku ?? "")}</td>
        <td>${esc(l.title)}</td>
        <td class="num mono">${l.quantity}</td>
        ${data.showPrices ? `<td class="num mono">${money(l.unitPrice)}</td><td class="num mono">${money(l.lineTotal)}</td>` : ""}
      </tr>`,
    )
    .join("");

  const totalsHtml = totals
    ? `<table class="totals"><tbody>
        <tr><th>Subtotal</th><td class="mono">${money(totals.subtotal)}</td></tr>
        ${totals.discount ? `<tr><th>Discount${totals.couponCode ? ` · ${esc(totals.couponCode)}` : ""}</th><td class="mono">−${money(totals.discount)}</td></tr>` : ""}
        <tr><th>Shipping${order.shippingZoneName ? ` · ${esc(order.shippingZoneName)}` : ""}</th><td class="mono">${money(totals.shipping)}</td></tr>
        ${totals.surcharge ? `<tr><th>${esc(totals.surchargeLabel?.trim() || "Payment surcharge")}</th><td class="mono">${money(totals.surcharge)}</td></tr>` : ""}
        <tr class="grand"><th>Total</th><td class="mono">${money(totals.total)}</td></tr>
      </tbody></table>`
    : "";

  return `<main class="sheet">
  <header>
    <div>
      <h1>Packing slip</h1>
      <div class="mono" style="font-size:18px;margin-top:4px">#${order.number}</div>
    </div>
    <div class="shop">
      ${shop.name ? `<strong>${esc(shop.name)}</strong><br>` : ""}
      ${shopAddress.map(esc).join("<br>")}
      ${shop.email ? `<br>${esc(shop.email)}` : ""}${shop.phone ? `<br>${esc(shop.phone)}` : ""}${shop.domain ? `<br>${esc(shop.domain)}` : ""}
    </div>
  </header>
  <div class="meta">
    <div><b>Order date</b>${esc(formatDate(order.placedAt, "date", timeZone))}</div>
    ${order.paidAt ? `<div><b>Paid</b>${esc(formatDate(order.paidAt, "date", timeZone))}${method ? ` · ${esc(method)}` : ""}</div>` : ""}
    <div><b>Delivery</b>${pickup ? "Pickup" : esc(order.shippingZoneName ?? "Shipping")}</div>
    <div><b>Items</b>${data.itemCount}</div>
  </div>
  <div class="addrs">
    ${pickup ? `<section class="addr ship"><h2>Pickup</h2><p>${esc(data.customer.name)}<br>${esc(data.customer.email)}${data.customer.phone ? `<br>${esc(data.customer.phone)}` : ""}</p></section>` : addressBlock("Ship to", data.shippingAddress).replace('class="addr"', 'class="addr ship"')}
    ${addressBlock("Billing address", data.billingAddress)}
  </div>
  <table class="lines">
    <thead><tr><th class="check" aria-label="Packed"></th><th>Stock code</th><th>Item</th><th class="num">Qty</th>${data.showPrices ? '<th class="num">Price</th><th class="num">Total</th>' : ""}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${totalsHtml}
  ${order.customerNote ? `<div class="note"><h2>Customer note</h2>${esc(order.customerNote)}</div>` : ""}
  <footer><span>Thank you for your order.</span><span class="mono">#${order.number}</span></footer>
</main>`;
}

/** One HTML document with a packing slip per order, each starting on a new page. */
export function renderPackingSlips(slips: PackingSlipData[], timeZone: string): string {
  const first = slips[0];
  const title =
    slips.length === 1
      ? `Packing slip #${first.order.number}${first.shop.name ? ` · ${first.shop.name}` : ""}`
      : `Packing slips (${slips.length})${first?.shop.name ? ` · ${first.shop.name}` : ""}`;
  const sheets = slips.map((s) => renderSheet(s, timeZone)).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  html { color-scheme: light; }
  body { margin: 0; background: white; color: black; font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .sheet { max-width: 800px; margin: 24px auto; padding: 32px; border: 1px solid #ccc; }
  .toolbar { max-width: 800px; margin: 16px auto 0; display: flex; gap: 8px; justify-content: flex-end; }
  .toolbar button, .toolbar a { font: inherit; padding: 6px 14px; border: 1px solid #999; border-radius: 4px; background: white; color: black; cursor: pointer; text-decoration: none; }
  .toolbar button { background: black; color: white; border-color: black; }
  header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; border-bottom: 2px solid black; padding-bottom: 16px; }
  h1 { margin: 0; font-size: 22px; letter-spacing: .02em; text-transform: uppercase; }
  h2 { margin: 0 0 4px; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: #555; }
  .shop { text-align: right; color: #333; }
  .shop strong { color: black; font-size: 15px; }
  .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 16px 0; }
  .meta div b { display: block; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: #555; font-weight: 600; }
  .addrs { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 16px 0 20px; }
  .addr p { margin: 0; }
  .addr.ship p { font-size: 15px; }
  table.lines { width: 100%; border-collapse: collapse; }
  table.lines th { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: #555; text-align: left; border-bottom: 1px solid black; padding: 6px 8px; }
  table.lines td { border-bottom: 1px solid #ddd; padding: 8px; vertical-align: top; }
  .num { text-align: right !important; white-space: nowrap; }
  .mono { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; }
  .check { width: 28px; }
  .check span { display: inline-block; width: 14px; height: 14px; border: 1.5px solid black; border-radius: 2px; }
  table.totals { margin: 12px 0 0 auto; border-collapse: collapse; min-width: 260px; }
  table.totals th { text-align: left; font-weight: normal; color: #333; padding: 3px 8px; }
  table.totals td { text-align: right; padding: 3px 8px; }
  table.totals .grand th, table.totals .grand td { font-weight: 700; border-top: 1px solid black; padding-top: 6px; }
  .note { margin-top: 20px; padding: 10px 12px; border: 1px dashed #999; white-space: pre-line; }
  footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid #ccc; color: #555; font-size: 12px; display: flex; justify-content: space-between; gap: 12px; }
  @media print {
    .toolbar { display: none; }
    .sheet { margin: 0; padding: 0; border: 0; max-width: none; }
    tr { break-inside: avoid; }
  }
  .sheet + .sheet { break-before: page; }
  @media print { .sheet + .sheet { margin-top: 0; } }
</style>
</head>
<body>
<div class="toolbar"><button type="button" onclick="window.print()">Print</button></div>
${sheets || '<main class="sheet"><p>No orders selected.</p></main>'}
</body>
</html>`;
}
