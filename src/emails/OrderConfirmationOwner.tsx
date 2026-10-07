import { Heading, Text } from "@react-email/components";
import { EmailLayout, PrimaryButton, styles } from "./components/Layout";
import { AddressBlock, OrderSummary } from "./components/OrderSummary";
import { formatDate, formatMoney, type MailBrand, type OrderMailData } from "./types";

export type OrderConfirmationOwnerProps = { brand: MailBrand; order: OrderMailData; adminUrl: string; timeZone?: string };

export function orderConfirmationOwnerSubject(order: Pick<OrderMailData, "number" | "total" | "currency" | "customerName">) {
  return `New order #${order.number} — ${formatMoney(order.total, order.currency)} from ${order.customerName}`;
}

export default function OrderConfirmationOwner({ brand, order, adminUrl, timeZone }: OrderConfirmationOwnerProps) {
  return (
    <EmailLayout brand={brand} preview={`New order #${order.number} from ${order.customerName}.`}>
      <Heading as="h1" style={styles.h1}>
        New order #{order.number}
      </Heading>
      <Text style={styles.text}>
        Placed on {formatDate(order.placedAt, timeZone)} by {order.customerName} ({order.email}
        {order.phone ? `, ${order.phone}` : ""}). Payment: {order.paymentStatus.toLowerCase()}
        {order.paymentMethod ? ` via ${order.paymentMethod}` : ""}.
      </Text>
      <OrderSummary order={order} />
      {order.shippingAddress ? <AddressBlock title="Shipping address" address={order.shippingAddress} /> : null}
      {order.billingAddress ? <AddressBlock title="Billing address" address={order.billingAddress} /> : null}
      {order.shippingMethod === "PICKUP" ? <Text style={styles.text}>The customer will pick up the order.</Text> : null}
      {order.customerNote ? (
        <Text style={{ ...styles.text, whiteSpace: "pre-line" }}>
          <strong>Customer note:</strong> {order.customerNote}
        </Text>
      ) : null}
      <PrimaryButton brand={brand} href={adminUrl}>
        Open in admin
      </PrimaryButton>
      <Text style={{ ...styles.text, marginTop: "18px" }}>Reply to this email to contact the customer.</Text>
    </EmailLayout>
  );
}
