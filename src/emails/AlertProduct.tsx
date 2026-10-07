import { Column, Img, Link, Row, Section, Text } from "@react-email/components";
import { styles } from "./components/Layout";
import { formatMoney } from "./types";

/** One product as shown in alert mails (new arrivals, back in stock, price drop). */
export type AlertMailProduct = {
  title: string;
  stockCode: number;
  /** Absolute product URL. */
  url: string;
  /** Absolute image URL, or null (no image / sensitive item). */
  imageUrl: string | null;
  /** Minor units. */
  price: number;
  /** Previous price (price drop), minor units. */
  oldPrice?: number | null;
  currency: string;
  category?: string | null;
};

export function AlertProductRow({ product }: { product: AlertMailProduct }) {
  return (
    <Section style={{ borderBottom: "1px solid #ecece8", padding: "12px 0" }}>
      <Row>
        <Column style={{ width: "96px", verticalAlign: "top" }}>
          {product.imageUrl ? (
            <Link href={product.url}>
              <Img src={product.imageUrl} alt="" width="84" height="84" style={{ display: "block", objectFit: "cover", borderRadius: "4px" }} />
            </Link>
          ) : (
            <div style={{ width: "84px", height: "84px", backgroundColor: "#ecece8", borderRadius: "4px" }} />
          )}
        </Column>
        <Column style={{ verticalAlign: "top" }}>
          <Text style={{ ...styles.text, margin: "0 0 4px", fontWeight: 600 }}>
            <Link href={product.url} style={{ color: "#1f1f1f", textDecoration: "none" }}>
              {product.title}
            </Link>
          </Text>
          <Text style={{ ...styles.muted, margin: "0 0 6px" }}>
            #{product.stockCode}
            {product.category ? ` · ${product.category}` : ""}
          </Text>
          <Text style={{ ...styles.text, margin: 0 }}>
            {product.oldPrice != null && product.oldPrice > product.price ? (
              <>
                <span style={{ textDecoration: "line-through", color: "#888888" }}>{formatMoney(product.oldPrice, product.currency)}</span>{" "}
              </>
            ) : null}
            <strong>{formatMoney(product.price, product.currency)}</strong>
          </Text>
        </Column>
      </Row>
    </Section>
  );
}
