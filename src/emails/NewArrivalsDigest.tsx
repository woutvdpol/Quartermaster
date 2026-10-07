import { Heading, Link, Text } from "@react-email/components";
import { EmailLayout, PrimaryButton, styles } from "./components/Layout";
import { AlertProductRow, type AlertMailProduct } from "./AlertProduct";
import type { MailBrand } from "./types";

export type NewArrivalsDigestProps = {
  brand: MailBrand;
  searchName: string;
  frequency: "INSTANT" | "DAILY" | "WEEKLY";
  products: AlertMailProduct[];
  /** Matching items not listed (the mail shows at most `products.length`). */
  moreCount: number;
  /** Absolute URL of the search in the shop. */
  searchUrl: string;
  unsubscribeUrl: string;
  manageUrl: string;
};

export function newArrivalsSubject(brand: MailBrand, searchName: string, products: { title: string }[], moreCount = 0) {
  const total = products.length + moreCount;
  if (total === 1 && products[0]) return `New at ${brand.name}: ${products[0].title}`;
  return `${total} new items for “${searchName}” at ${brand.name}`;
}

export default function NewArrivalsDigest(props: NewArrivalsDigestProps) {
  const { brand, searchName, frequency, products, moreCount, searchUrl, unsubscribeUrl, manageUrl } = props;
  const total = products.length + moreCount;
  const intro =
    frequency === "INSTANT"
      ? "Just listed — unique items tend to sell quickly:"
      : `${total === 1 ? "A new item matches" : `${total} new items match`} your alert since our last email:`;
  return (
    <EmailLayout
      brand={brand}
      preview={`${total === 1 ? "A new item" : `${total} new items`} for “${searchName}”`}
      footer={
        <Text style={styles.muted}>
          You receive this email because you set up the alert “{searchName}” at {brand.name}.{" "}
          <Link href={unsubscribeUrl} style={{ color: "#555555", textDecoration: "underline" }}>
            Stop this alert
          </Link>
          {" · "}
          <Link href={manageUrl} style={{ color: "#555555", textDecoration: "underline" }}>
            Manage all alerts
          </Link>
        </Text>
      }
    >
      <Heading as="h1" style={styles.h1}>
        New for “{searchName}”
      </Heading>
      <Text style={styles.text}>{intro}</Text>
      {products.map((p) => (
        <AlertProductRow key={`${p.stockCode}`} product={p} />
      ))}
      {moreCount > 0 ? <Text style={{ ...styles.text, marginTop: "12px" }}>…and {moreCount} more.</Text> : null}
      <div style={{ marginTop: "20px" }}>
        <PrimaryButton brand={brand} href={searchUrl}>
          See all matching items
        </PrimaryButton>
      </div>
    </EmailLayout>
  );
}
