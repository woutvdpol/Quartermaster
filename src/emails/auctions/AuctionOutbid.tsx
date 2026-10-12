import { Heading, Section, Text } from "@react-email/components";
import { EmailLayout, FallbackLink, PrimaryButton, styles } from "../components/Layout";
import { formatMoney, type MailBrand } from "../types";
import { ProductRow } from "../commerce/ProductRow";
import type { AuctionLotMailData } from "./types";

export type AuctionOutbidProps = { brand: MailBrand; lot: AuctionLotMailData; closesAt: Date };

export function auctionOutbidSubject(brand: MailBrand, lot: Pick<AuctionLotMailData, "productTitle">) {
  return `You've been outbid: ${lot.productTitle} — ${brand.name}`;
}

/** To the bidder whose maximum was beaten. */
export default function AuctionOutbid({ brand, lot, closesAt }: AuctionOutbidProps) {
  const current = formatMoney(lot.amount, lot.currency);
  const closes = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: lot.timeZone }).format(closesAt);
  return (
    <EmailLayout brand={brand} preview={`Someone bid more than your maximum. The bid is now ${current}.`}>
      <Heading as="h1" style={styles.h1}>
        You&apos;ve been outbid
      </Heading>
      <Text style={styles.text}>
        Dear {lot.customerName}, another bidder went above your maximum on lot {lot.lotNumber} of {lot.auctionTitle}. The bid is now <strong>{current}</strong>. The
        lot closes {closes} (a late bid extends it by a few minutes).
      </Text>
      <Section style={{ marginBottom: "14px" }}>
        <ProductRow title={lot.productTitle} url={lot.lotUrl} imageUrl={lot.imageUrl} amount={current} meta={`Lot ${lot.lotNumber}`} />
      </Section>
      <PrimaryButton brand={brand} href={lot.lotUrl}>
        Raise your maximum
      </PrimaryButton>
      <FallbackLink href={lot.lotUrl} />
    </EmailLayout>
  );
}
