import { Heading, Text } from "@react-email/components";
import { EmailLayout, styles } from "./components/Layout";
import type { LeadMailData } from "./LeadReceived";
import type { MailBrand } from "./types";

export type LeadReceivedConfirmationProps = { brand: MailBrand; lead: LeadMailData };

export function leadReceivedConfirmationSubject(brand: MailBrand) {
  return `We received your items — ${brand.name}`;
}

export default function LeadReceivedConfirmation({ brand, lead }: LeadReceivedConfirmationProps) {
  const n = lead.photos.length;
  return (
    <EmailLayout brand={brand} preview="Thanks — we will look at your items and get back to you.">
      <Heading as="h1" style={styles.h1}>
        Thank you, {lead.name}
      </Heading>
      <Text style={styles.text}>
        We received your request to sell items to {brand.name}
        {n ? ` together with ${n} photo${n === 1 ? "" : "s"}` : ""}. We will review it and contact you — usually within a few working days.
        There is no obligation on either side until we agree on a price.
      </Text>
      <Text style={{ ...styles.text, whiteSpace: "pre-line" }}>
        <strong>What you told us:</strong>
        <br />
        {lead.itemsDescription}
      </Text>
      <Text style={styles.muted}>
        Didn&apos;t send this? Then someone entered your email address by mistake — you can ignore this message
        {brand.contactEmail ? ` or let us know at ${brand.contactEmail}` : ""}.
      </Text>
    </EmailLayout>
  );
}
