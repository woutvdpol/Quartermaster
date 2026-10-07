import { Heading, Link, Text } from "@react-email/components";
import { EmailLayout, PrimaryButton, styles } from "./components/Layout";
import { AlertProductRow, type AlertMailProduct } from "./AlertProduct";
import type { MailBrand } from "./types";

export type BackAvailableProps = { brand: MailBrand; product: AlertMailProduct; stopUrl: string; wishlistUrl: string };

export function backAvailableSubject(product: { title: string }) {
  return `Available again: ${product.title}`;
}

export default function BackAvailable({ brand, product, stopUrl, wishlistUrl }: BackAvailableProps) {
  return (
    <EmailLayout
      brand={brand}
      preview={`${product.title} from your wishlist is available again.`}
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
        Good news — it&apos;s available again
      </Heading>
      <Text style={styles.text}>
        An item on your wishlist was released from someone&apos;s basket. It&apos;s one of a kind, so whoever orders first gets it.
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
