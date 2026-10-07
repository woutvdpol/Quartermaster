import { Heading, Section, Text } from "@react-email/components";
import { EmailLayout, FallbackLink, PrimaryButton, styles } from "../components/Layout";
import { formatMoney, type MailBrand } from "../types";
import { AmountLine, ProductRow } from "./ProductRow";
import type { OfferMailData } from "./types";

export type OfferCounteredProps = { brand: MailBrand; offer: OfferMailData; respondUrl: string; expiresInHours: number };

export function offerCounteredSubject(brand: MailBrand, offer: Pick<OfferMailData, "productTitle">) {
  return `A counter offer for ${offer.productTitle} — ${brand.name}`;
}

/** To the customer: the shop proposes another price. */
export default function OfferCountered({ brand, offer, respondUrl, expiresInHours }: OfferCounteredProps) {
  const money = (v: number) => formatMoney(v, offer.currency);
  const counter = offer.counterAmount ?? offer.listPrice;
  return (
    <EmailLayout brand={brand} preview={`We can offer ${offer.productTitle} for ${money(counter)}.`}>
      <Heading as="h1" style={styles.h1}>
        We have a counter offer
      </Heading>
      <Text style={styles.text}>
        Dear {offer.customerName}, thank you for your offer. We can&apos;t go as low as {money(offer.amount)}, but we can offer it to you
        for <strong>{money(counter)}</strong>. The proposal is valid for {expiresInHours} hours.
      </Text>
      {offer.responseNote ? <Text style={{ ...styles.text, whiteSpace: "pre-line" }}>{offer.responseNote}</Text> : null}
      <Section>
        <ProductRow title={offer.productTitle} url={offer.productUrl} imageUrl={offer.imageUrl} />
      </Section>
      <Section style={{ paddingTop: "10px", paddingBottom: "12px" }}>
        <AmountLine label="List price" value={money(offer.listPrice)} />
        <AmountLine label="Your offer" value={money(offer.amount)} />
        <AmountLine label="Our proposal" value={money(counter)} bold />
      </Section>
      <PrimaryButton brand={brand} href={respondUrl}>
        Accept or decline
      </PrimaryButton>
      <FallbackLink href={respondUrl} />
    </EmailLayout>
  );
}
