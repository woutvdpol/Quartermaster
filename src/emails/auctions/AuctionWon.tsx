import { Heading, Section, Text } from "@react-email/components";
import { EmailLayout, FallbackLink, PrimaryButton, styles } from "../components/Layout";
import { formatMoney, type MailBrand } from "../types";
import { ProductRow } from "../commerce/ProductRow";
import type { AuctionLotMailData } from "./types";

export type AuctionWonProps = { brand: MailBrand; lot: AuctionLotMailData; payUrl: string; reminder?: boolean };

export function auctionWonSubject(brand: MailBrand, lot: Pick<AuctionLotMailData, "productTitle">) {
  return `You won ${lot.productTitle} — ${brand.name}`;
}

export function auctionPaymentReminderSubject(brand: MailBrand, lot: Pick<AuctionLotMailData, "productTitle">) {
  return `Reminder: payment for ${lot.productTitle} — ${brand.name}`;
}

/** To the winner: the hammer price + personal payment link (also used for the reminder). */
export default function AuctionWon({ brand, lot, payUrl, reminder }: AuctionWonProps) {
  const hammer = formatMoney(lot.amount, lot.currency);
  const payBy = lot.payBy ? new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: lot.timeZone }).format(lot.payBy) : null;
  return (
    <EmailLayout brand={brand} preview={reminder ? `Your won lot is waiting for payment (${hammer}).` : `Congratulations — you won lot ${lot.lotNumber} for ${hammer}.`}>
      <Heading as="h1" style={styles.h1}>
        {reminder ? "Your lot is waiting for payment" : "Congratulations, you won"}
      </Heading>
      <Text style={styles.text}>
        Dear {lot.customerName}, {reminder ? "we haven't received the payment for" : "you are the winning bidder of"} lot {lot.lotNumber} of {lot.auctionTitle}. The
        hammer price is <strong>{hammer}</strong> (no buyer&apos;s premium). Choose delivery or pickup and pay with your personal link
        {payBy ? (
          <>
            {" "}
            before <strong>{payBy}</strong>
          </>
        ) : null}
        .
      </Text>
      <Section style={{ marginBottom: "14px" }}>
        <ProductRow title={lot.productTitle} url={lot.lotUrl} imageUrl={lot.imageUrl} amount={hammer} meta={`Lot ${lot.lotNumber}`} />
      </Section>
      <PrimaryButton brand={brand} href={payUrl}>
        Pay {hammer} + delivery
      </PrimaryButton>
      <Text style={{ ...styles.text, marginTop: "18px" }}>
        Shipping costs are added on the payment page. As with any online purchase you have a 14-day right of withdrawal after delivery. Keep this link private.
      </Text>
      <FallbackLink href={payUrl} />
    </EmailLayout>
  );
}
