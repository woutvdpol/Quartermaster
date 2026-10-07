import "server-only";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { InvoiceDocument } from "./index";

/*
 * Invoice PDF (react-pdf). Render ONLY in the worker or a Node.js route handler — never during an
 * RSC render. Deliberately neutral black-on-white with the built-in Helvetica (WinAnsi: € works).
 * Bilingual labels (EN / NL) because the legal notice must be Dutch for the margin scheme.
 */

const s = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 56, paddingHorizontal: 44, fontSize: 9.5, fontFamily: "Helvetica", color: "#111111", lineHeight: 1.4 },
  header: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1.5, borderBottomColor: "#111111", paddingBottom: 12 },
  title: { fontSize: 20, fontFamily: "Helvetica-Bold", letterSpacing: 1 },
  number: { fontSize: 11, marginTop: 4, fontFamily: "Courier" },
  shop: { textAlign: "right", maxWidth: 240 },
  shopName: { fontSize: 12, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  muted: { color: "#555555" },
  meta: { flexDirection: "row", marginTop: 14, gap: 18 },
  metaItem: { minWidth: 90 },
  label: { fontSize: 7.5, color: "#555555", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 2 },
  addrs: { flexDirection: "row", marginTop: 16, marginBottom: 16, gap: 24 },
  addr: { flex: 1 },
  th: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#111111", paddingBottom: 4, marginTop: 4 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#cccccc", paddingVertical: 5 },
  cCode: { width: 70, fontFamily: "Courier" },
  cItem: { flex: 1, paddingRight: 8 },
  cQty: { width: 36, textAlign: "right" },
  cAmt: { width: 78, textAlign: "right" },
  totals: { marginTop: 10, marginLeft: "auto", width: 230 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  grand: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: "#111111", marginTop: 4, paddingTop: 5, fontFamily: "Helvetica-Bold", fontSize: 11 },
  notice: { marginTop: 18, padding: 8, borderWidth: 1, borderColor: "#111111" },
  noticeText: { fontFamily: "Helvetica-Bold" },
  footer: { position: "absolute", left: 44, right: 44, bottom: 24, fontSize: 7.5, color: "#555555", flexDirection: "row", justifyContent: "space-between", borderTopWidth: 0.5, borderTopColor: "#cccccc", paddingTop: 6 },
});

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
function country(code: string | null | undefined): string {
  if (!code) return "";
  try {
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

function money(minor: number, currency: string): string {
  const digits = ["JPY", "KRW", "ISK", "HUF", "CLP", "VND"].includes(currency) ? 0 : 2;
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(minor / 10 ** digits);
}

function date(d: Date | null, timeZone: string): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone }).format(d);
}

type Addr = InvoiceDocument["billingAddress"];
function addressLines(a: Addr): string[] {
  if (!a) return [];
  return [a.name, a.company ?? "", a.street, a.line2 ?? "", [a.postalCode, a.city].filter(Boolean).join(" "), a.region ?? "", country(a.countryCode)].filter(
    (l) => l.trim() !== "",
  );
}

export function InvoicePdf({ doc }: { doc: InvoiceDocument }) {
  const { invoice, shop, order, totals } = doc;
  const cur = invoice.currency;
  const tz = doc.timeZone;
  const shopAddress = [shop.address.line1, shop.address.line2, [shop.address.postalCode, shop.address.city].filter(Boolean).join(" "), country(shop.address.country)].filter(Boolean);
  const pickup = order.shippingMethod === "PICKUP";
  const shipLines = pickup ? ["Pickup / Afhalen"] : addressLines(doc.shippingAddress);
  return (
    <Document title={`Invoice ${invoice.displayNumber}`} author={shop.name} creator="Quartermaster" producer="Quartermaster">
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.title}>INVOICE / FACTUUR</Text>
            <Text style={s.number}>{invoice.displayNumber}</Text>
          </View>
          <View style={s.shop}>
            <Text style={s.shopName}>{shop.name}</Text>
            {shopAddress.map((l, i) => (
              <Text key={i}>{l}</Text>
            ))}
            {shop.email ? <Text>{shop.email}</Text> : null}
            {shop.phone ? <Text>{shop.phone}</Text> : null}
            {shop.cocNumber ? <Text style={s.muted}>KvK {shop.cocNumber}</Text> : null}
            {shop.vatNumber ? <Text style={s.muted}>BTW / VAT {shop.vatNumber}</Text> : null}
            {shop.iban ? <Text style={s.muted}>IBAN {shop.iban}</Text> : null}
          </View>
        </View>

        <View style={s.meta}>
          <View style={s.metaItem}>
            <Text style={s.label}>Invoice date / Factuurdatum</Text>
            <Text>{date(invoice.issuedAt, tz)}</Text>
          </View>
          <View style={s.metaItem}>
            <Text style={s.label}>Order / Bestelling</Text>
            <Text>#{order.number}</Text>
          </View>
          <View style={s.metaItem}>
            <Text style={s.label}>Order date / Besteldatum</Text>
            <Text>{date(order.placedAt, tz)}</Text>
          </View>
          {order.paidAt ? (
            <View style={s.metaItem}>
              <Text style={s.label}>Paid / Betaald</Text>
              <Text>{date(order.paidAt, tz)}</Text>
            </View>
          ) : null}
        </View>

        <View style={s.addrs}>
          <View style={s.addr}>
            <Text style={s.label}>Invoice to / Factuuradres</Text>
            {addressLines(doc.billingAddress).length ? (
              addressLines(doc.billingAddress).map((l, i) => <Text key={i}>{l}</Text>)
            ) : (
              <Text>{doc.customer.name}</Text>
            )}
            <Text style={s.muted}>{doc.customer.email}</Text>
          </View>
          <View style={s.addr}>
            <Text style={s.label}>Delivery / Levering</Text>
            {shipLines.map((l, i) => (
              <Text key={i}>{l}</Text>
            ))}
          </View>
        </View>

        <View style={s.th}>
          <Text style={[s.cCode, s.label]}>Code</Text>
          <Text style={[s.cItem, s.label]}>Item / Artikel</Text>
          <Text style={[s.cQty, s.label]}>Qty</Text>
          <Text style={[s.cAmt, s.label]}>Price / Prijs</Text>
          <Text style={[s.cAmt, s.label]}>Total / Totaal</Text>
        </View>
        {doc.lines.map((l, i) => (
          <View key={i} style={s.tr} wrap={false}>
            <Text style={s.cCode}>{l.stockCode ?? l.sku ?? ""}</Text>
            <Text style={s.cItem}>{l.title}</Text>
            <Text style={s.cQty}>{l.quantity}</Text>
            <Text style={s.cAmt}>{money(l.unitPrice, cur)}</Text>
            <Text style={s.cAmt}>{money(l.lineTotal, cur)}</Text>
          </View>
        ))}

        <View style={s.totals} wrap={false}>
          <View style={s.totalRow}>
            <Text>Subtotal / Subtotaal</Text>
            <Text>{money(totals.subtotal, cur)}</Text>
          </View>
          {totals.discount ? (
            <View style={s.totalRow}>
              <Text>Discount / Korting{order.couponCode ? ` (${order.couponCode})` : ""}</Text>
              <Text>-{money(totals.discount, cur)}</Text>
            </View>
          ) : null}
          <View style={s.totalRow}>
            <Text>Shipping / Verzending{order.shippingZoneName && !pickup ? ` · ${order.shippingZoneName}` : ""}</Text>
            <Text>{money(totals.shipping, cur)}</Text>
          </View>
          {totals.surcharge ? (
            <View style={s.totalRow}>
              <Text>Payment surcharge / Toeslag</Text>
              <Text>{money(totals.surcharge, cur)}</Text>
            </View>
          ) : null}
          <View style={s.grand}>
            <Text>Total / Totaal</Text>
            <Text>{money(totals.total, cur)}</Text>
          </View>
        </View>

        {invoice.vatNotice ? (
          <View style={s.notice} wrap={false}>
            <Text style={s.noticeText}>{invoice.vatNotice.nl}</Text>
            <Text>{invoice.vatNotice.en}</Text>
          </View>
        ) : null}

        <View style={s.footer} fixed>
          <Text>
            {shop.name} · {invoice.displayNumber}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(doc: InvoiceDocument): Promise<Buffer> {
  return renderToBuffer(<InvoicePdf doc={doc} />);
}
