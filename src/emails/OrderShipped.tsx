import { Heading, Link, Section, Text } from "@react-email/components";
import { EmailLayout, FallbackLink, PrimaryButton, styles } from "./components/Layout";
import type { MailBrand, OrderMailAddress } from "./types";

export type OrderShippedData = {
  number: number;
  customerName: string;
  carrier: string | null;
  trackingNumber: string | null;
  /** Carrier tracking page, or null when the shop did not add one. */
  trackingUrl: string | null;
  shippingMethod: "SHIP" | "PICKUP";
  shippingAddress: OrderMailAddress | null;
  lines: { title: string; stockCode: number | null; quantity: number }[];
  statusUrl: string | null;
};

export type OrderShippedProps = { brand: MailBrand; order: OrderShippedData };

export function orderShippedSubject(brand: MailBrand, order: Pick<OrderShippedData, "number" | "shippingMethod">) {
  return order.shippingMethod === "PICKUP"
    ? `Your ${brand.name} order #${order.number} is ready`
    : `Your ${brand.name} order #${order.number} is on its way`;
}

export default function OrderShipped({ brand, order }: OrderShippedProps) {
  const pickup = order.shippingMethod === "PICKUP";
  const firstName = order.customerName.split(" ")[0] || order.customerName;
  return (
    <EmailLayout brand={brand} preview={pickup ? `Order #${order.number} is ready for pickup.` : `Order #${order.number} has been shipped.`}>
      <Heading as="h1" style={styles.h1}>
        {pickup ? "Your order is ready" : "Your order is on its way"}
      </Heading>
      <Text style={styles.text}>
        Hi {firstName}, {pickup ? `order #${order.number} is ready for you.` : `we have shipped order #${order.number}.`}
        {order.carrier && !pickup ? ` It travels with ${order.carrier}.` : ""}
      </Text>

      {order.trackingUrl ? (
        <>
          <PrimaryButton brand={brand} href={order.trackingUrl}>
            Track your parcel
          </PrimaryButton>
          {order.trackingNumber ? <Text style={{ ...styles.muted, marginTop: "10px" }}>Tracking code: {order.trackingNumber}</Text> : null}
          <FallbackLink href={order.trackingUrl} />
        </>
      ) : order.trackingNumber ? (
        <Text style={styles.text}>
          Tracking code{order.carrier ? ` (${order.carrier})` : ""}: <b>{order.trackingNumber}</b>
        </Text>
      ) : null}

      <Section style={{ marginTop: "8px" }}>
        <Text style={{ ...styles.text, fontWeight: 600, marginBottom: "6px" }}>In this parcel</Text>
        {order.lines.map((l, i) => (
          <Text key={i} style={{ ...styles.text, margin: "0 0 4px" }}>
            {l.quantity > 1 ? `${l.quantity} × ` : ""}
            {l.title}
            {l.stockCode !== null ? <span style={{ color: "#777777" }}> · #{l.stockCode}</span> : null}
          </Text>
        ))}
      </Section>

      {order.shippingAddress && !pickup ? (
        <Section style={{ marginTop: "12px" }}>
          <Text style={{ ...styles.text, fontWeight: 600, marginBottom: "6px" }}>Shipping to</Text>
          <Text style={styles.text}>
            {order.shippingAddress.name}
            {order.shippingAddress.company ? (
              <>
                <br />
                {order.shippingAddress.company}
              </>
            ) : null}
            {order.shippingAddress.lines.map((l, i) => (
              <span key={i}>
                <br />
                {l}
              </span>
            ))}
          </Text>
        </Section>
      ) : null}

      {order.statusUrl ? (
        <Text style={styles.text}>
          <Link href={order.statusUrl} style={{ color: brand.colors.accent }}>
            View your order
          </Link>
        </Text>
      ) : null}
      <Text style={styles.text}>Questions? Just reply to this email.</Text>
    </EmailLayout>
  );
}
