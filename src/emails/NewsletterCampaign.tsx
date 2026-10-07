import { Link, Text } from "@react-email/components";
import { EmailLayout, styles } from "./components/Layout";
import type { MailBrand } from "./types";

export type NewsletterCampaignProps = {
  brand: MailBrand;
  subject: string;
  /** Sanitized HTML from src/server/newsletter/markdown.ts — never raw user HTML. */
  bodyHtml: string;
  unsubscribeUrl: string;
  /** Shown above the content, e.g. "[Test]" banner. */
  notice?: string;
};

export default function NewsletterCampaign({ brand, subject, bodyHtml, unsubscribeUrl, notice }: NewsletterCampaignProps) {
  return (
    <EmailLayout
      brand={brand}
      preview={subject}
      footer={
        <Text style={styles.muted}>
          You receive this email because you subscribed to the {brand.name} newsletter.{" "}
          <Link href={unsubscribeUrl} style={{ color: "#555555", textDecoration: "underline" }}>
            Unsubscribe
          </Link>
        </Text>
      }
    >
      {notice ? (
        <Text style={{ ...styles.text, backgroundColor: "#fff4d6", padding: "8px 12px", borderRadius: "4px" }}>{notice}</Text>
      ) : null}
      <div className="qm-newsletter" style={{ ...styles.text, margin: 0 }} dangerouslySetInnerHTML={{ __html: bodyHtml }} />
    </EmailLayout>
  );
}
