import { Heading, Link, Text } from "@react-email/components";
import { EmailLayout, PrimaryButton, styles } from "./components/Layout";
import { AlertProductRow, type AlertMailProduct } from "./AlertProduct";
import { formatMoney, type MailBrand } from "./types";

export type PriceDropProps = { brand: MailBrand; product: AlertMailProduct & { oldPrice: number }; stopUrl: string; wishlistUrl: string };

export function priceDropSubject(product: { title: string; price: number; currency: string }) {
  return `Price drop: ${product.title} — now ${formatMoney(product.price, product.currency)}`;
}

export default function PriceDrop({ brand, product, stopUrl, wishlistUrl }: PriceDropProps) {
  return (
    <EmailLayout
      brand={brand}
      preview={`${product.title} is now ${formatMoney(product.price, product.currency)}.`}
      footer={
        <Text style={styles.muted}>
          You receive this email because this item is on your wishlist at {brand.name}.{" "}
          <Link href={stopUrl} style={{ color: "#555555", textDecoration: "underline" }}>
            Remove it and stop these emails
          </Link>
          {" · "}
          <Link href={wishlistUrl} style={{ color: "#555555", textDecoration: "underline" }}>
            Your wishlist
          </Link>
        </Text>
      }
    >
      <Heading as="h1" style={styles.h1}>
        The price went down
      </Heading>
      <Text style={styles.text}>
        An item on your wishlist is now {formatMoney(product.price, product.currency)} (was {formatMoney(product.oldPrice, product.currency)}).
      </Text>
      <AlertProductRow product={product} />
      <div style={{ marginTop: "20px" }}>
        <PrimaryButton brand={brand} href={product.url}>
          View the item
        </PrimaryButton>
      </div>
    </EmailLayout>
  );
}
