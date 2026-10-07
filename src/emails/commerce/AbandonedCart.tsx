import { Heading, Section, Text } from "@react-email/components";
import { EmailLayout, FallbackLink, PrimaryButton, styles } from "../components/Layout";
import { formatMoney, type MailBrand } from "../types";
import { ProductRow } from "./ProductRow";
import type { CartMailLine } from "./types";

export type AbandonedCartProps = { brand: MailBrand; lines: CartMailLine[]; currency: string; restoreUrl: string };

export function abandonedCartSubject(brand: MailBrand) {
  return `You left something in your cart — ${brand.name}`;
}

/** Sent once per cart, only with the customer's explicit consent at checkout. */
export default function AbandonedCart({ brand, lines, currency, restoreUrl }: AbandonedCartProps) {
  return (
    <EmailLayout
      brand={brand}
      preview="Your cart is waiting — but the items are not reserved anymore."
      footer={<Text style={styles.muted}>You receive this one-time reminder because you asked us to at checkout. We won&apos;t send another one for this cart.</Text>}
    >
      <Heading as="h1" style={styles.h1}>
        Your cart is waiting
      </Heading>
      <Text style={styles.text}>
        You left these items in your cart. Every item is one of a kind and your reservation has expired, so they are for sale to everyone
        again — first come, first served.
      </Text>
      <Section style={{ marginBottom: "14px" }}>
        {lines.map((l, i) => (
          <ProductRow key={i} title={l.title} url={l.url} imageUrl={l.imageUrl} amount={l.available ? formatMoney(l.price, currency) : "Sold"} muted={!l.available} />
        ))}
      </Section>
      <PrimaryButton brand={brand} href={restoreUrl}>
        Back to your cart
      </PrimaryButton>
      <FallbackLink href={restoreUrl} />
    </EmailLayout>
  );
}
