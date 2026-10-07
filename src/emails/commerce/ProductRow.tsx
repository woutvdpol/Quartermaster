import { Column, Img, Link, Row, Text } from "@react-email/components";
import { styles } from "../components/Layout";

const cell = { ...styles.text, margin: "0", fontSize: "14px" };

/** Thumbnail + title + amount row used by the offer and cart mails. */
export function ProductRow(props: { title: string; url: string; imageUrl: string | null; meta?: string; amount?: string; muted?: boolean }) {
  return (
    <Row style={{ borderBottom: "1px solid #eeeeec" }}>
      <Column style={{ width: "72px", padding: "8px 12px 8px 0", verticalAlign: "top" }}>
        {props.imageUrl ? (
          <Img src={props.imageUrl} alt="" width="64" height="64" style={{ display: "block", borderRadius: "4px", objectFit: "cover" }} />
        ) : (
          <div style={{ width: "64px", height: "64px", backgroundColor: "#eeeeec", borderRadius: "4px" }} />
        )}
      </Column>
      <Column style={{ ...cell, padding: "8px 0", verticalAlign: "top", color: props.muted ? "#999999" : "#333333" }}>
        <Link href={props.url} style={{ color: props.muted ? "#999999" : "#1f1f1f", fontWeight: 600, textDecoration: "none" }}>
          {props.title}
        </Link>
        {props.meta ? <Text style={{ ...styles.muted, margin: "2px 0 0" }}>{props.meta}</Text> : null}
      </Column>
      {props.amount ? (
        <Column align="right" style={{ ...cell, padding: "8px 0", whiteSpace: "nowrap", verticalAlign: "top", color: props.muted ? "#999999" : "#333333" }}>
          {props.amount}
        </Column>
      ) : null}
    </Row>
  );
}

export function AmountLine({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <Row>
      <Column style={{ ...cell, fontWeight: bold ? 700 : 400 }}>{label}</Column>
      <Column align="right" style={{ ...cell, fontWeight: bold ? 700 : 400 }}>
        {value}
      </Column>
    </Row>
  );
}
