import { Heading, Section, Text } from "@react-email/components";
import { EmailLayout, styles } from "../components/Layout";
import { formatMoney, type MailBrand } from "../types";
import { ProductRow } from "./ProductRow";
import type { OfferMailData } from "./types";

export type OfferRejectedProps = { brand: MailBrand; offer: OfferMailData };

export function offerRejectedSubject(brand: MailBrand, offer: Pick<OfferMailData, "productTitle">) {
  return `About your offer for ${offer.productTitle} — ${brand.name}`;
}

/** To the customer: the offer was declined. */
export default function OfferRejected({ brand, offer }: OfferRejectedProps) {
  return (
    <EmailLayout brand={brand} preview="Thank you for your offer.">
      <Heading as="h1" style={styles.h1}>
        Thank you for your offer
      </Heading>
      <Text style={styles.text}>
        Dear {offer.customerName}, unfortunately we can&apos;t accept your offer of {formatMoney(offer.amount, offer.currency)} for this item.
      </Text>
      {offer.responseNote ? <Text style={{ ...styles.text, whiteSpace: "pre-line" }}>{offer.responseNote}</Text> : null}
      <Section>
        <ProductRow title={offer.productTitle} url={offer.productUrl} imageUrl={offer.imageUrl} amount={formatMoney(offer.listPrice, offer.currency)} meta="List price" />
      </Section>
      <Text style={{ ...styles.text, marginTop: "18px" }}>You are welcome to buy it at the list price while it is still available.</Text>
    </EmailLayout>
  );
}
