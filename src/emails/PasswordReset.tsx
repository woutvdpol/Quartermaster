import { Heading, Text } from "@react-email/components";
import { EmailLayout, FallbackLink, PrimaryButton, styles } from "./components/Layout";
import type { MailBrand } from "./types";

export type PasswordResetProps = { brand: MailBrand; resetUrl: string; expiresInMinutes: number };

export function passwordResetSubject(brand: MailBrand) {
  return `Reset your ${brand.name} password`;
}

export default function PasswordReset({ brand, resetUrl, expiresInMinutes }: PasswordResetProps) {
  return (
    <EmailLayout brand={brand} preview="Use this link to choose a new password.">
      <Heading as="h1" style={styles.h1}>
        Reset your password
      </Heading>
      <Text style={styles.text}>
        We received a request to reset the password of your {brand.name} account. Click the button below to choose a new
        password. The link works once and expires in {expiresInMinutes} minutes.
      </Text>
      <PrimaryButton brand={brand} href={resetUrl}>
        Choose a new password
      </PrimaryButton>
      <Text style={{ ...styles.text, marginTop: "18px" }}>
        Didn&apos;t ask for this? Then you can ignore this email — your password stays the same.
      </Text>
      <FallbackLink href={resetUrl} />
    </EmailLayout>
  );
}
