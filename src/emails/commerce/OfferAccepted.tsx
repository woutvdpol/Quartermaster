import { Heading, Section, Text } from "@react-email/components";
import { EmailLayout, FallbackLink, PrimaryButton, styles } from "../components/Layout";
import { formatMoney, type MailBrand } from "../types";
import { ProductRow } from "./ProductRow";
import type { OfferMailData } from "./types";

export type OfferAcceptedProps = { brand: MailBrand; offer: OfferMailData; checkoutUrl: string; expiresInHours: number };

export function offerAcceptedSubject(brand: MailBrand, offer: Pick<OfferMailData, "productTitle">) {
  return `Your offer for ${offer.productTitle} was accepted — ${brand.name}`;
}

/** To the customer: the agreed price + personal checkout link. */
export default function OfferAccepted({ brand, offer, checkoutUrl, expiresInHours }: OfferAcceptedProps) {
  const agreed = offer.agreedAmount ?? offer.amount;
  return (
    <EmailLayout brand={brand} preview={`Good news: you can buy ${offer.productTitle} for ${formatMoney(agreed, offer.currency)}.`}>
      <Heading as="h1" style={styles.h1}>
        Your offer was accepted
      </Heading>
      <Text style={styles.text}>
        Dear {offer.customerName}, good news — you can buy this item for <strong>{formatMoney(agreed, offer.currency)}</strong>. Use
        your personal link below; it is valid for {expiresInHours} hours. Until you check out the item stays for sale, so don&apos;t wait
        too long.
      </Text>
      {offer.responseNote ? <Text style={{ ...styles.text, whiteSpace: "pre-line" }}>{offer.responseNote}</Text> : null}
      <Section style={{ marginBottom: "14px" }}>
        <ProductRow title={offer.productTitle} url={offer.productUrl} imageUrl={offer.imageUrl} amount={formatMoney(agreed, offer.currency)} meta={`List price ${formatMoney(offer.listPrice, offer.currency)}`} />
      </Section>
      <PrimaryButton brand={brand} href={checkoutUrl}>
        Buy now for {formatMoney(agreed, offer.currency)}
      </PrimaryButton>
      <Text style={{ ...styles.text, marginTop: "18px" }}>Keep this link private: anyone with it can buy at your price.</Text>
      <FallbackLink href={checkoutUrl} />
    </EmailLayout>
  );
}
