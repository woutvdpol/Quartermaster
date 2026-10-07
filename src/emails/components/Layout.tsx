import type { CSSProperties, ReactNode } from "react";
import { Body, Button, Container, Head, Hr, Html, Img, Link, Preview, Section, Text } from "@react-email/components";
import type { MailBrand } from "../types";

// Deliberately plain: system fonts, a single column, inline styles — renders the same in Outlook and Gmail.
const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const styles = {
  body: { backgroundColor: "#f4f4f2", fontFamily: font, margin: 0, padding: "24px 0" } satisfies CSSProperties,
  container: { backgroundColor: "#ffffff", maxWidth: "600px", margin: "0 auto", borderRadius: "4px", overflow: "hidden" } satisfies CSSProperties,
  content: { padding: "24px 32px" } satisfies CSSProperties,
  h1: { fontSize: "22px", lineHeight: "28px", margin: "0 0 16px", color: "#1f1f1f" } satisfies CSSProperties,
  text: { fontSize: "15px", lineHeight: "22px", color: "#333333", margin: "0 0 14px" } satisfies CSSProperties,
  muted: { fontSize: "12px", lineHeight: "18px", color: "#777777", margin: "0 0 6px" } satisfies CSSProperties,
  hr: { borderColor: "#e6e6e3", margin: "20px 0" } satisfies CSSProperties,
};

export function EmailLayout(props: { brand: MailBrand; preview: string; children: ReactNode; footer?: ReactNode }) {
  const { brand } = props;
  return (
    <Html lang="en">
      <Head />
      <Preview>{props.preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={{ backgroundColor: brand.colors.primary, padding: "18px 32px" }}>
            {brand.logoUrl ? (
              <Img src={brand.logoUrl} alt={brand.name} height="40" style={{ display: "block", maxHeight: "40px", width: "auto" }} />
            ) : (
              <Text style={{ margin: 0, color: "#ffffff", fontSize: "20px", fontWeight: 700, letterSpacing: "0.5px" }}>{brand.name}</Text>
            )}
          </Section>
          <Section style={styles.content}>{props.children}</Section>
          <Section style={{ padding: "0 32px 24px" }}>
            <Hr style={styles.hr} />
            {props.footer}
            <Text style={styles.muted}>
              <Link href={brand.baseUrl} style={{ color: "#777777" }}>
                {brand.name}
              </Link>
              {brand.address ? ` · ${brand.address}` : ""}
              {brand.contactEmail ? ` · ${brand.contactEmail}` : ""}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export function PrimaryButton(props: { brand: MailBrand; href: string; children: ReactNode }) {
  return (
    <Button
      href={props.href}
      style={{
        backgroundColor: props.brand.colors.accent,
        color: "#ffffff",
        padding: "12px 22px",
        borderRadius: "4px",
        fontSize: "15px",
        fontWeight: 600,
        textDecoration: "none",
        display: "inline-block",
      }}
    >
      {props.children}
    </Button>
  );
}

/** The raw link under a button, for clients that block buttons. */
export function FallbackLink(props: { href: string }) {
  return (
    <Text style={styles.muted}>
      If the button does not work, copy this link into your browser:
      <br />
      <Link href={props.href} style={{ color: "#555555", wordBreak: "break-all" }}>
        {props.href}
      </Link>
    </Text>
  );
}
