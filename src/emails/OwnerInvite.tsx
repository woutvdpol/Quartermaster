import { Heading, Text } from "@react-email/components";
import { EmailLayout, FallbackLink, PrimaryButton, styles } from "./components/Layout";
import type { MailBrand } from "./types";

export type OwnerInviteProps = {
  brand: MailBrand;
  inviteUrl: string;
  name: string | null;
  invitedBy: string | null;
  expiresInDays: number;
};

export function ownerInviteSubject(brand: MailBrand) {
  return `You're invited to manage ${brand.name}`;
}

export default function OwnerInvite({ brand, inviteUrl, name, invitedBy, expiresInDays }: OwnerInviteProps) {
  return (
    <EmailLayout brand={brand} preview={`Set a password to start managing ${brand.name}.`}>
      <Heading as="h1" style={styles.h1}>
        You&apos;re invited
      </Heading>
      <Text style={styles.text}>
        {name ? `Hi ${name}, ` : "Hi, "}
        {invitedBy ? `${invitedBy} invited you` : "you have been invited"} to manage the {brand.name} shop in Quartermaster. Choose a
        password to activate your account.
      </Text>
      <PrimaryButton brand={brand} href={inviteUrl}>
        Choose your password
      </PrimaryButton>
      <Text style={{ ...styles.text, marginTop: "18px" }}>
        The link works once and expires in {expiresInDays} days. Not expecting this? Then you can ignore this email.
      </Text>
      <FallbackLink href={inviteUrl} />
    </EmailLayout>
  );
}
