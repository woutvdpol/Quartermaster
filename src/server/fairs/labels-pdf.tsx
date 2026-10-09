import "server-only";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";
import type { FairLabel } from "./index";

/*
 * QR labels for fair stock (react-pdf). Render ONLY in a Node.js route handler — never in an RSC render.
 * Built-in Helvetica/Courier (WinAnsi: € and German umlauts print; other scripts don't — same as the
 * certificate). Black on white: these are printed on label stock.
 *
 * Layouts:
 *   a4      A4 sheet, 3 × 8 labels of 70 × 37 mm (borderless sheets such as Avery 3474 / Herma 4453)
 *   roll62  label printer, 62 mm roll, one 62 × 29 mm label per page (Brother DK-11209 and alike)
 *   tag     hang tags, one 50 × 30 mm tag per page
 */

export const LABEL_LAYOUTS = ["a4", "roll62", "tag"] as const;
export type LabelLayout = (typeof LABEL_LAYOUTS)[number];

const MM = 72 / 25.4;

type Geometry = { page: [number, number]; label: [number, number]; cols: number; rows: number; top: number; left: number };

const GEOMETRY: Record<LabelLayout, Geometry> = {
  a4: { page: [210 * MM, 297 * MM], label: [70 * MM, 37 * MM], cols: 3, rows: 8, top: 0.5 * MM, left: 0 },
  roll62: { page: [62 * MM, 29 * MM], label: [62 * MM, 29 * MM], cols: 1, rows: 1, top: 0, left: 0 },
  tag: { page: [50 * MM, 30 * MM], label: [50 * MM, 30 * MM], cols: 1, rows: 1, top: 0, left: 0 },
};

const s = StyleSheet.create({
  page: { fontFamily: "Helvetica", color: "#000000", backgroundColor: "#ffffff" },
  label: { position: "absolute", flexDirection: "row", alignItems: "center", padding: 2.5 * MM, gap: 2 * MM },
  text: { flex: 1, flexDirection: "column", justifyContent: "center", gap: 1 },
  code: { fontFamily: "Courier-Bold" },
  title: { lineHeight: 1.15 },
  price: { fontFamily: "Helvetica-Bold", marginTop: 1 },
});

type Rendered = FairLabel & { qr: string; priceLabel: string | null };

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function priceLabel(minor: number, currency: string): string {
  const whole = minor % 100 === 0;
  return new Intl.NumberFormat("en-NL", { style: "currency", currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })
    .format(minor / 100)
    .replace(/[  ]/g, " ");
}

function Label({ label, layout, x, y }: { label: Rendered; layout: LabelLayout; x: number; y: number }) {
  const g = GEOMETRY[layout];
  const [w, h] = g.label;
  const qrSize = h - 5 * MM;
  const small = layout !== "a4";
  return (
    <View style={[s.label, { left: x, top: y, width: w, height: h }]}>
      {/* react-pdf Image: no alt attribute in PDF output */}
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      <Image src={label.qr} style={{ width: qrSize, height: qrSize }} />
      <View style={s.text}>
        <Text style={[s.code, { fontSize: small ? 8.5 : 10 }]}>No. {label.stockCode}</Text>
        <Text style={[s.title, { fontSize: small ? 6.5 : 7.5 }]}>{truncate(label.title, small ? 44 : 64)}</Text>
        {label.priceLabel ? <Text style={[s.price, { fontSize: small ? 9 : 11 }]}>{label.priceLabel}</Text> : null}
      </View>
    </View>
  );
}

function LabelsDocument({ labels, layout, title }: { labels: Rendered[]; layout: LabelLayout; title: string }) {
  const g = GEOMETRY[layout];
  const perPage = g.cols * g.rows;
  const pages: Rendered[][] = [];
  for (let i = 0; i < labels.length; i += perPage) pages.push(labels.slice(i, i + perPage));
  if (!pages.length) pages.push([]);
  return (
    <Document title={title} creator="Quartermaster">
      {pages.map((chunk, p) => (
        <Page key={p} size={g.page} style={s.page}>
          {chunk.map((label, i) => (
            <Label
              key={label.stockCode}
              label={label}
              layout={layout}
              x={g.left + (i % g.cols) * g.label[0]}
              y={g.top + Math.floor(i / g.cols) * g.label[1]}
            />
          ))}
        </Page>
      ))}
    </Document>
  );
}

/** The labels as a PDF. `withPrice` prints the list price. */
export async function renderFairLabelsPdf(input: {
  labels: FairLabel[];
  layout: LabelLayout;
  withPrice: boolean;
  currency: string;
  title: string;
}): Promise<Buffer> {
  const rendered: Rendered[] = await Promise.all(
    input.labels.map(async (l) => ({
      ...l,
      qr: await QRCode.toDataURL(l.url, { errorCorrectionLevel: "M", margin: 0, width: 300 }),
      priceLabel: input.withPrice ? priceLabel(l.price, input.currency) : null,
    })),
  );
  return renderToBuffer(<LabelsDocument labels={rendered} layout={input.layout} title={input.title} />);
}
