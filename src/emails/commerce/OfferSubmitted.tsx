import { Heading, Section, Text } from "@react-email/components";
import { EmailLayout, styles } from "../components/Layout";
import { formatMoney, type MailBrand } from "../types";
import { ProductRow } from "./ProductRow";
import type { OfferMailData } from "./types";

export type OfferSubmittedProps = { brand: MailBrand; offer: OfferMailData; respondWithinHours: number };

export function offerSubmittedSubject(brand: MailBrand, offer: Pick<OfferMailData, "productTitle">) {
  return `Your offer for ${offer.productTitle} — ${brand.name}`;
}

/** To the customer: we received your offer. */
export default function OfferSubmitted({ brand, offer, respondWithinHours }: OfferSubmittedProps) {
  return (
    <EmailLayout brand={brand} preview={`We received your offer of ${formatMoney(offer.amount, offer.currency)}.`}>
      <Heading as="h1" style={styles.h1}>
        We received your offer
      </Heading>
      <Text style={styles.text}>
        Dear {offer.customerName}, thank you for your offer of <strong>{formatMoney(offer.amount, offer.currency)}</strong>. We will
        get back to you within {respondWithinHours} hours. The item stays for sale in the meantime, so someone else may still buy it.
      </Text>
      <Section>
        <ProductRow title={offer.productTitle} url={offer.productUrl} imageUrl={offer.imageUrl} amount={formatMoney(offer.listPrice, offer.currency)} meta="List price" />
      </Section>
      <Text style={{ ...styles.text, marginTop: "18px" }}>Questions? Just reply to this email.</Text>
    </EmailLayout>
  );
}
