import { Heading, Text } from "@react-email/components";
import { EmailLayout, FallbackLink, PrimaryButton, styles } from "./components/Layout";
import type { MailBrand } from "./types";

export type SavedSearchConfirmProps = { brand: MailBrand; searchName: string; confirmUrl: string; expiresInDays: number };

export function savedSearchConfirmSubject(brand: MailBrand) {
  return `Please confirm your alert at ${brand.name}`;
}

export default function SavedSearchConfirm({ brand, searchName, confirmUrl, expiresInDays }: SavedSearchConfirmProps) {
  return (
    <EmailLayout brand={brand} preview="One click to start your new-arrival alert.">
      <Heading as="h1" style={styles.h1}>
        Confirm your alert
      </Heading>
      <Text style={styles.text}>
        You asked {brand.name} to email you when a new item arrives that matches <strong>{searchName}</strong>. Please
        confirm that this is your email address — we won&apos;t send any alerts until you do.
      </Text>
      <PrimaryButton brand={brand} href={confirmUrl}>
        Yes, notify me
      </PrimaryButton>
      <Text style={{ ...styles.text, marginTop: "18px" }}>
        The link expires in {expiresInDays} days. If you didn&apos;t ask for this, ignore this email and you won&apos;t hear from us.
      </Text>
      <FallbackLink href={confirmUrl} />
    </EmailLayout>
  );
}
