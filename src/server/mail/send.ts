import "server-only";
import type { ReactElement } from "react";
import { render, toPlainText } from "@react-email/render";
import type Mail from "nodemailer/lib/mailer";
import { loadMailIdentity, type MailIdentity } from "./identity";
import { transmit, type SentMail } from "./transport";

export type SendMailInput = {
  /** null = platform mail. Determines From name and default Reply-To. */
  tenantId: string | null;
  to: string;
  subject: string;
  react: ReactElement;
  /** Plain-text part; derived from the HTML when omitted. */
  text?: string;
  /** Overrides the tenant's reply-to (e.g. the customer's address on owner notifications). */
  replyTo?: string | null;
  headers?: Record<string, string>;
  attachments?: Mail.Attachment[];
};

/** Renders a React Email element to HTML + text. */
export async function renderMail(react: ReactElement): Promise<{ html: string; text: string }> {
  const html = await render(react);
  return { html, text: toPlainText(html) };
}

/**
 * Sends one mail right now. Prefer `queueMail()` (retries, no blocking) — this is what the
 * `mail.send` job calls. Must run outside React Server Components (react-dom/server).
 */
export async function sendMail(input: SendMailInput, identity?: MailIdentity): Promise<SentMail> {
  identity ??= await loadMailIdentity(input.tenantId);
  const { html, text } = await renderMail(input.react);
  const replyTo = input.replyTo === undefined ? identity.replyTo : input.replyTo;
  return transmit({
    from: identity.from,
    to: input.to,
    subject: input.subject,
    html,
    text: input.text ?? text,
    ...(replyTo ? { replyTo } : {}),
    headers: input.headers,
    attachments: input.attachments,
  });
}
