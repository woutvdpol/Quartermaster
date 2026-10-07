import { Heading, Text } from "@react-email/components";
import { EmailLayout, FallbackLink, PrimaryButton, styles } from "./components/Layout";
import type { MailBrand } from "./types";

export type NewsletterConfirmProps = { brand: MailBrand; confirmUrl: string; expiresInDays: number };

export function newsletterConfirmSubject(brand: MailBrand) {
  return `Please confirm your subscription to ${brand.name}`;
}

export default function NewsletterConfirm({ brand, confirmUrl, expiresInDays }: NewsletterConfirmProps) {
  return (
    <EmailLayout brand={brand} preview="One click to confirm your newsletter subscription.">
      <Heading as="h1" style={styles.h1}>
        Confirm your subscription
      </Heading>
      <Text style={styles.text}>
        Thanks for signing up for the {brand.name} newsletter. Please confirm that this is your email address — we
        won&apos;t send you anything until you do.
      </Text>
      <PrimaryButton brand={brand} href={confirmUrl}>
        Yes, subscribe me
      </PrimaryButton>
      <Text style={{ ...styles.text, marginTop: "18px" }}>
        The link expires in {expiresInDays} days. If you didn&apos;t sign up, ignore this email and you won&apos;t hear from us.
      </Text>
      <FallbackLink href={confirmUrl} />
    </EmailLayout>
  );
}
