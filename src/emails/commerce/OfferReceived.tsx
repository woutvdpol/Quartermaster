import { Heading, Section, Text } from "@react-email/components";
import { EmailLayout, PrimaryButton, styles } from "../components/Layout";
import { formatMoney, type MailBrand } from "../types";
import { AmountLine, ProductRow } from "./ProductRow";
import type { OfferMailData } from "./types";

export type OfferReceivedProps = { brand: MailBrand; offer: OfferMailData; adminUrl: string; percent: number | null };

export function offerReceivedSubject(offer: Pick<OfferMailData, "productTitle" | "amount" | "currency">) {
  return `New offer: ${formatMoney(offer.amount, offer.currency)} for ${offer.productTitle}`;
}

/** To the shop owner: a customer made an offer. */
export default function OfferReceived({ brand, offer, adminUrl, percent }: OfferReceivedProps) {
  const money = (v: number) => formatMoney(v, offer.currency);
  return (
    <EmailLayout brand={brand} preview={`${offer.customerName} offers ${money(offer.amount)} for ${offer.productTitle}.`}>
      <Heading as="h1" style={styles.h1}>
        New offer received
      </Heading>
      <Text style={styles.text}>
        <strong>{offer.customerName}</strong> ({offer.email}) made an offer. Offers you don&apos;t answer expire after 72 hours.
      </Text>
      <Section>
        <ProductRow title={offer.productTitle} url={offer.productUrl} imageUrl={offer.imageUrl} meta={`#${offer.stockCode}`} />
      </Section>
      <Section style={{ paddingTop: "10px", paddingBottom: "6px" }}>
        <AmountLine label="List price" value={money(offer.listPrice)} />
        <AmountLine label={`Offer${percent !== null ? ` (${percent}% of price)` : ""}`} value={money(offer.amount)} bold />
      </Section>
      {offer.message ? (
        <Text style={{ ...styles.text, whiteSpace: "pre-line" }}>
          <strong>Message:</strong> {offer.message}
        </Text>
      ) : null}
      <PrimaryButton brand={brand} href={adminUrl}>
        Review the offer
      </PrimaryButton>
    </EmailLayout>
  );
}
