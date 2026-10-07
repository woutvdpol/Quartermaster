import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";
import type Mail from "nodemailer/lib/mailer";

/**
 * Mail transport:
 *  - SMTP_URL set → nodemailer SMTP (e.g. `smtps://user:pass@smtp.example.com:465`, or
 *    `smtp://mailpit:1025` locally). Pooled connection, reused for the process lifetime.
 *  - SMTP_URL unset (development) → the composed message is written as an .eml file to
 *    `<cwd>/.local/mail/` (override: MAIL_OUTBOX_DIR) and the path is logged. Open it in any mail client.
 *  - SMTP_URL unset in production → sending fails (the job retries), so mail is never silently dropped —
 *    unless MAIL_OUTBOX_DIR is set explicitly (e.g. the Compose worker), which keeps the .eml fallback.
 */
export type SentMail = { messageId: string; file?: string };
export type MailSink = (message: Mail.Options) => void | Promise<void>;

let smtp: Transporter | null = null;
let sink: MailSink | null = null;

/** Tests: capture composed messages instead of sending. Pass null to restore. */
export function setMailSinkForTests(fn: MailSink | null) {
  sink = fn;
}

export function outboxDir(): string {
  return process.env.MAIL_OUTBOX_DIR || path.join(process.cwd(), ".local", "mail");
}

function smtpTransport(url: string): Transporter {
  smtp ??= nodemailer.createTransport(url.includes("pool=") ? url : `${url}${url.includes("?") ? "&" : "?"}pool=true`);
  return smtp;
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "mail";
}

export async function transmit(message: Mail.Options): Promise<SentMail> {
  if (sink) {
    await sink(message);
    return { messageId: `<test-${randomBytes(6).toString("hex")}@quartermaster>` };
  }
  const url = process.env.SMTP_URL?.trim();
  if (url) {
    const info = await smtpTransport(url).sendMail(message);
    return { messageId: info.messageId };
  }
  if (process.env.NODE_ENV === "production" && !process.env.MAIL_OUTBOX_DIR) {
    throw new Error("SMTP_URL is not set; refusing to drop mail in production (set MAIL_OUTBOX_DIR to write .eml files instead)");
  }

  const info = await nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" }).sendMail(message);
  const dir = outboxDir();
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `${stamp}-${slug(String(message.subject ?? ""))}-${randomBytes(3).toString("hex")}.eml`);
  await fs.writeFile(file, info.message as Buffer);
  console.info(`[mail] SMTP_URL not set — wrote ${file}`);
  return { messageId: info.messageId, file };
}

export async function closeMailTransport() {
  smtp?.close();
  smtp = null;
}
