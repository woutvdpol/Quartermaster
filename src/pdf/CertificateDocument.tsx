import { Document, Font, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { provenanceCopy as t } from "@/server/provenance/copy";

/*
 * Certificate of authenticity (A4 portrait), rendered with @react-pdf/renderer.
 * Render ONLY from a Route Handler (runtime nodejs) or the worker — never during an RSC render.
 * Uses the PDF base-14 fonts (Times / Helvetica: no network, WinAnsi characters), so titles in
 * non-Latin scripts would not print — acceptable for the current shops.
 * Colours: neutral ink + the shop's primary colour (white-label) for rules and accents.
 */

// No automatic hyphenation: it splits codes and URLs ("veri-fy"). Process-wide react-pdf setting.
Font.registerHyphenationCallback((word) => [word]);

export type CertificatePdfData = {
  code: string;
  shopName: string;
  title: string;
  stockCode: number;
  issuedAtLabel: string;
  specifications: { label: string; value: string }[];
  provenanceExcerpt: string | null;
  authenticityGuaranteed: boolean;
  revoked: boolean;
  verifyUrl: string | null;
  accentColor: string;
  /** Embedded images: JPEG/PNG buffers (react-pdf supports no other formats). */
  photo: { data: Buffer; format: "jpg" | "png" } | null;
  logo: { data: Buffer; format: "jpg" | "png" } | null;
  /** PNG data URL of the QR code. */
  qrDataUrl: string | null;
};

const INK = "#1f1d1a";
const MUTED = "#6b6560";
const LINE = "#d8d2c8";

const s = StyleSheet.create({
  page: { padding: 28, fontFamily: "Helvetica", fontSize: 9.5, color: INK, backgroundColor: "#ffffff" },
  frame: { flexGrow: 1, borderWidth: 2, padding: 4 },
  inner: { flexGrow: 1, borderWidth: 0.6, paddingVertical: 22, paddingHorizontal: 26, flexDirection: "column" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  shopRow: { flexDirection: "row", alignItems: "center", gap: 10, maxWidth: "65%" },
  logo: { maxHeight: 42, maxWidth: 120, objectFit: "contain" },
  shopName: { fontFamily: "Times-Bold", fontSize: 14 },
  certNoLabel: { fontSize: 7.5, color: MUTED, textTransform: "uppercase", letterSpacing: 1, textAlign: "right" },
  certNo: { fontFamily: "Courier-Bold", fontSize: 12, textAlign: "right", marginTop: 2 },
  title: { fontFamily: "Times-Bold", fontSize: 27, textAlign: "center", marginTop: 22, letterSpacing: 0.5 },
  rule: { height: 1.2, width: 90, alignSelf: "center", marginTop: 8, marginBottom: 12 },
  statement: { fontFamily: "Times-Italic", fontSize: 11, textAlign: "center", lineHeight: 1.45, color: INK, marginHorizontal: 20 },
  banner: { marginTop: 10, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: "#b42318", color: "#ffffff", fontFamily: "Helvetica-Bold", fontSize: 11, textAlign: "center", letterSpacing: 0.5 },
  body: { flexDirection: "row", gap: 18, marginTop: 20 },
  photoBox: { width: "44%", borderWidth: 0.6, borderColor: LINE, padding: 4, alignSelf: "flex-start" },
  photo: { width: "100%", objectFit: "contain" },
  facts: { flex: 1 },
  itemTitle: { fontFamily: "Times-Bold", fontSize: 15, lineHeight: 1.25, marginBottom: 8 },
  factRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 3.5 },
  factLabel: { width: "38%", color: MUTED, fontSize: 8.5 },
  factValue: { flex: 1, fontSize: 9 },
  sectionTitle: { fontFamily: "Helvetica-Bold", fontSize: 8, textTransform: "uppercase", letterSpacing: 1, color: MUTED, marginBottom: 4 },
  provenance: { marginTop: 18 },
  provenanceText: { fontFamily: "Times-Roman", fontSize: 10.5, lineHeight: 1.45 },
  guarantee: { marginTop: 16, borderWidth: 0.8, padding: 10 },
  guaranteeTitle: { fontFamily: "Times-Bold", fontSize: 12, marginBottom: 4 },
  guaranteeText: { fontFamily: "Times-Roman", fontSize: 10, lineHeight: 1.4 },
  spacer: { flexGrow: 1 },
  footer: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 20 },
  signature: { width: "48%" },
  signatureLine: { borderBottomWidth: 0.8, borderBottomColor: INK, height: 38, marginBottom: 4 },
  small: { fontSize: 8, color: MUTED, lineHeight: 1.35 },
  verify: { width: "46%", flexDirection: "row", gap: 8, alignItems: "flex-end", justifyContent: "flex-end" },
  verifyText: { flex: 1, textAlign: "right" },
  qr: { width: 82, height: 82 },
  url: { fontFamily: "Courier", fontSize: 7.5, marginTop: 3, textAlign: "right" },
});

export function CertificateDocument({ data }: { data: CertificatePdfData }) {
  const accent = data.accentColor;
  const facts = [{ label: t.stockCode, value: `#${data.stockCode}` }, ...data.specifications];
  return (
    <Document title={`${t.certificateTitle} ${data.code}`} author={data.shopName} subject={data.title} creator="Quartermaster" producer="Quartermaster">
      <Page size="A4" style={s.page}>
        <View style={[s.frame, { borderColor: accent }]}>
          <View style={[s.inner, { borderColor: accent }]}>
            <View style={s.header}>
              <View style={s.shopRow}>
                {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
                {data.logo ? <Image src={data.logo} style={s.logo} /> : null}
                <Text style={s.shopName}>{data.shopName}</Text>
              </View>
              <View>
                <Text style={s.certNoLabel}>{t.certificateNo}</Text>
                <Text style={s.certNo}>{data.code}</Text>
              </View>
            </View>

            {data.revoked ? <Text style={s.banner}>{t.revokedBanner}</Text> : null}

            <Text style={s.title}>{t.certificateTitle}</Text>
            <View style={[s.rule, { backgroundColor: accent }]} />
            <Text style={s.statement}>{t.certificateStatement(data.shopName)}</Text>

            <View style={s.body}>
              {data.photo ? (
                <View style={s.photoBox}>
                  {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
                  <Image src={data.photo} style={s.photo} />
                </View>
              ) : null}
              <View style={s.facts}>
                <Text style={s.itemTitle}>{data.title}</Text>
                {facts.map((f, i) => (
                  <View key={`${i}-${f.label}`} style={s.factRow} wrap={false}>
                    <Text style={s.factLabel}>{f.label}</Text>
                    <Text style={s.factValue}>{f.value}</Text>
                  </View>
                ))}
              </View>
            </View>

            {data.provenanceExcerpt ? (
              <View style={s.provenance}>
                <Text style={s.sectionTitle}>Provenance</Text>
                <Text style={s.provenanceText}>{data.provenanceExcerpt}</Text>
              </View>
            ) : null}

            {data.authenticityGuaranteed ? (
              <View style={[s.guarantee, { borderColor: accent }]} wrap={false}>
                <Text style={s.guaranteeTitle}>{t.guaranteeTitle}</Text>
                <Text style={s.guaranteeText}>{t.guaranteeText}</Text>
              </View>
            ) : null}

            <View style={s.spacer} />

            <View style={s.footer} wrap={false}>
              <View style={s.signature}>
                <View style={s.signatureLine} />
                <Text style={s.small}>
                  {t.signatureLine} · {data.shopName}
                </Text>
                <Text style={s.small}>
                  {t.issuedOn} {data.issuedAtLabel}
                </Text>
              </View>
              {data.verifyUrl ? (
                <View style={s.verify}>
                  <View style={s.verifyText}>
                    <Text style={s.small}>{t.verifyHint}</Text>
                    <Text style={s.url}>{data.verifyUrl}</Text>
                  </View>
                  {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
                  {data.qrDataUrl ? <Image src={data.qrDataUrl} style={s.qr} /> : null}
                </View>
              ) : null}
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}
