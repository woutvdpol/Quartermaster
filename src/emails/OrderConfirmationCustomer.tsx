import { Heading, Text } from "@react-email/components";
import { EmailLayout, PrimaryButton, styles } from "./components/Layout";
import { AddressBlock, OrderSummary } from "./components/OrderSummary";
import { formatDate, type MailBrand, type OrderMailData } from "./types";

export type OrderConfirmationCustomerProps = {
  brand: MailBrand;
  order: OrderMailData;
  /** Free text from settings mail.confirmationMessage (plain text, newlines kept). */
  message?: string;
  timeZone?: string;
};

export function orderConfirmationCustomerSubject(brand: MailBrand, order: Pick<OrderMailData, "number">) {
  return `Your order #${order.number} at ${brand.name}`;
}

export default function OrderConfirmationCustomer({ brand, order, message, timeZone }: OrderConfirmationCustomerProps) {
  const paid = order.paymentStatus === "PAID";
  return (
    <EmailLayout brand={brand} preview={`Thank you for your order #${order.number}.`}>
      <Heading as="h1" style={styles.h1}>
        Thank you for your order
      </Heading>
      <Text style={styles.text}>
        Dear {order.customerName}, we have received your order <strong>#{order.number}</strong> placed on{" "}
        {formatDate(order.placedAt, timeZone)}.{" "}
        {paid ? "Your payment has been received." : "We will process it as soon as your payment has been received."}
      </Text>
      {message ? <Text style={{ ...styles.text, whiteSpace: "pre-line" }}>{message}</Text> : null}
      <OrderSummary order={order} />
      {order.shippingAddress ? <AddressBlock title="Shipping address" address={order.shippingAddress} /> : null}
      {order.shippingMethod === "PICKUP" ? <Text style={styles.text}>You chose to pick up your order.</Text> : null}
      {order.customerNote ? (
        <Text style={{ ...styles.text, whiteSpace: "pre-line" }}>
          <strong>Your note:</strong> {order.customerNote}
        </Text>
      ) : null}
      {order.statusUrl ? (
        <PrimaryButton brand={brand} href={order.statusUrl}>
          View your order
        </PrimaryButton>
      ) : null}
      <Text style={{ ...styles.text, marginTop: "18px" }}>Questions? Just reply to this email.</Text>
    </EmailLayout>
  );
}
