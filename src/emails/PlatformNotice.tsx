import { Heading, Text } from "@react-email/components";
import { EmailLayout, FallbackLink, PrimaryButton, styles } from "./components/Layout";
import type { MailBrand } from "./types";

/*
 * Generic platform (onboarding) mail: heading, a few paragraphs, an optional button and footnote.
 * Used for dealer applications (verify, rejected), the dealer invite and superadmin notifications —
 * the builders in src/server/mail/builders-onboarding.tsx write the copy.
 */
export type PlatformNoticeProps = {
  brand: MailBrand;
  preview: string;
  heading: string;
  paragraphs: string[];
  /** Label/value rows (e.g. application details for the superadmin). */
  details?: { label: string; value: string }[];
  button?: { label: string; href: string };
  footnote?: string;
};

export default function PlatformNotice({ brand, preview, heading, paragraphs, details, button, footnote }: PlatformNoticeProps) {
  return (
    <EmailLayout brand={brand} preview={preview}>
      <Heading as="h1" style={styles.h1}>
        {heading}
      </Heading>
      {paragraphs.map((p, i) => (
        <Text key={i} style={styles.text}>
          {p}
        </Text>
      ))}
      {details?.length ? (
        <Text style={{ ...styles.text, backgroundColor: "#f4f4f2", padding: "12px 14px", borderRadius: "4px" }}>
          {details.map((d, i) => (
            <span key={i}>
              <strong>{d.label}:</strong> {d.value}
              {i < details.length - 1 ? <br /> : null}
            </span>
          ))}
        </Text>
      ) : null}
      {button ? (
        <PrimaryButton brand={brand} href={button.href}>
          {button.label}
        </PrimaryButton>
      ) : null}
      {footnote ? <Text style={{ ...styles.text, marginTop: "18px" }}>{footnote}</Text> : null}
      {button ? <FallbackLink href={button.href} /> : null}
    </EmailLayout>
  );
}
