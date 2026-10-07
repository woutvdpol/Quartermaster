import { Column, Row, Section, Text } from "@react-email/components";
import { styles } from "./Layout";
import { formatMoney, type OrderMailAddress, type OrderMailData } from "../types";

const cell = { ...styles.text, margin: "0", fontSize: "14px" };

function Amount({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <Row>
      <Column style={{ ...cell, fontWeight: bold ? 700 : 400 }}>{label}</Column>
      <Column align="right" style={{ ...cell, fontWeight: bold ? 700 : 400 }}>
        {value}
      </Column>
    </Row>
  );
}

export function AddressBlock({ title, address }: { title: string; address: OrderMailAddress }) {
  return (
    <Section style={{ marginBottom: "12px" }}>
      <Text style={{ ...cell, fontWeight: 700 }}>{title}</Text>
      <Text style={cell}>
        {address.name}
        {address.company ? (
          <>
            <br />
            {address.company}
          </>
        ) : null}
        {address.lines.map((l, i) => (
          <span key={i}>
            <br />
            {l}
          </span>
        ))}
      </Text>
    </Section>
  );
}

export function OrderSummary({ order }: { order: OrderMailData }) {
  const money = (v: number) => formatMoney(v, order.currency);
  return (
    <Section>
      {order.lines.map((line, i) => (
        <Row key={i} style={{ borderBottom: "1px solid #eeeeec" }}>
          <Column style={{ ...cell, padding: "8px 0" }}>
            {line.quantity > 1 ? `${line.quantity} × ` : ""}
            {line.title}
            {line.stockCode !== null ? <span style={{ color: "#888888" }}> · #{line.stockCode}</span> : null}
          </Column>
          <Column align="right" style={{ ...cell, padding: "8px 0", whiteSpace: "nowrap" }}>
            {money(line.lineTotal)}
          </Column>
        </Row>
      ))}
      <Section style={{ paddingTop: "10px" }}>
        <Amount label="Subtotal" value={money(order.subtotal)} />
        {order.discountTotal ? <Amount label={`Discount${order.couponCode ? ` (${order.couponCode})` : ""}`} value={`−${money(order.discountTotal)}`} /> : null}
        <Amount
          label={order.shippingMethod === "PICKUP" ? "Pickup" : `Shipping${order.shippingZoneName ? ` (${order.shippingZoneName})` : ""}`}
          value={money(order.shippingTotal)}
        />
        {order.surchargeTotal ? <Amount label="Surcharge" value={money(order.surchargeTotal)} /> : null}
        <Amount label="Total" value={money(order.total)} bold />
      </Section>
    </Section>
  );
}
