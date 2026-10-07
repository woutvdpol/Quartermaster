import { Heading, Text } from "@react-email/components";
import { EmailLayout, FallbackLink, PrimaryButton, styles } from "./components/Layout";
import type { MailBrand } from "./types";

export type CustomerEmailVerificationProps = { brand: MailBrand; verifyUrl: string; expiresInHours: number };

export function customerEmailVerificationSubject(brand: MailBrand) {
  return `Confirm your email address for ${brand.name}`;
}

export default function CustomerEmailVerification({ brand, verifyUrl, expiresInHours }: CustomerEmailVerificationProps) {
  return (
    <EmailLayout brand={brand} preview="One click to confirm your email address.">
      <Heading as="h1" style={styles.h1}>
        Confirm your email address
      </Heading>
      <Text style={styles.text}>
        Please confirm that this is the email address of your {brand.name} account. Confirmed addresses get order updates and
        password resets reliably.
      </Text>
      <PrimaryButton brand={brand} href={verifyUrl}>
        Confirm email address
      </PrimaryButton>
      <Text style={{ ...styles.text, marginTop: "18px" }}>
        The link expires in {expiresInHours} hours. Didn&apos;t create an account? Then you can ignore this email.
      </Text>
      <FallbackLink href={verifyUrl} />
    </EmailLayout>
  );
}
