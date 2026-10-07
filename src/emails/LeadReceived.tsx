import { Column, Heading, Img, Link, Row, Section, Text } from "@react-email/components";
import { EmailLayout, PrimaryButton, styles } from "./components/Layout";
import { formatDate, type MailBrand } from "./types";

/** What the lead mails show. Photo URLs are absolute. */
export type LeadMailData = {
  name: string;
  email: string;
  phone: string | null;
  itemsDescription: string;
  message: string | null;
  createdAt: Date;
  photos: { url: string; thumbUrl: string }[];
};

export type LeadReceivedProps = { brand: MailBrand; lead: LeadMailData; adminUrl: string; timeZone?: string };

export function leadReceivedSubject(lead: Pick<LeadMailData, "name" | "photos">) {
  const n = lead.photos.length;
  return `New "sell your collection" request from ${lead.name}${n ? ` (${n} photo${n === 1 ? "" : "s"})` : ""}`;
}

/** Thumbnails in rows of 3 (tables — renders in Outlook). */
export function LeadPhotoGrid({ photos }: { photos: LeadMailData["photos"] }) {
  const rows: LeadMailData["photos"][] = [];
  for (let i = 0; i < photos.length; i += 3) rows.push(photos.slice(i, i + 3));
  return (
    <Section style={{ margin: "0 0 14px" }}>
      {rows.map((row, r) => (
        <Row key={r}>
          {row.map((p, i) => (
            <Column key={i} style={{ width: "33%", padding: "4px", verticalAlign: "top" }}>
              <Link href={p.url}>
                <Img src={p.thumbUrl} alt={`Photo ${r * 3 + i + 1}`} width="160" style={{ display: "block", width: "100%", maxWidth: "160px", height: "auto", borderRadius: "3px" }} />
              </Link>
            </Column>
          ))}
        </Row>
      ))}
    </Section>
  );
}

export default function LeadReceived({ brand, lead, adminUrl, timeZone }: LeadReceivedProps) {
  return (
    <EmailLayout brand={brand} preview={`${lead.name} wants to sell items to ${brand.name}.`}>
      <Heading as="h1" style={styles.h1}>
        New request to sell items
      </Heading>
      <Text style={styles.text}>
        Received on {formatDate(lead.createdAt, timeZone)} from <strong>{lead.name}</strong> ({lead.email}
        {lead.phone ? `, ${lead.phone}` : ""}).
      </Text>
      <Text style={{ ...styles.text, whiteSpace: "pre-line" }}>
        <strong>Items:</strong>
        <br />
        {lead.itemsDescription}
      </Text>
      {lead.message ? (
        <Text style={{ ...styles.text, whiteSpace: "pre-line" }}>
          <strong>Message:</strong>
          <br />
          {lead.message}
        </Text>
      ) : null}
      {lead.photos.length ? <LeadPhotoGrid photos={lead.photos} /> : <Text style={styles.muted}>No photos were attached.</Text>}
      <PrimaryButton brand={brand} href={adminUrl}>
        Open in admin
      </PrimaryButton>
      <Text style={{ ...styles.text, marginTop: "18px" }}>Reply to this email to contact the seller.</Text>
    </EmailLayout>
  );
}
