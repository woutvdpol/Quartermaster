// Public mail API for app code. Everything here only *queues* mail (job `mail.send`); rendering and
// SMTP happen in the worker. `sendMail()` (./send) is the low-level, immediate sender used by the job.
// Side effect: registers mail senders for service hooks (owner invites). See ./hooks.ts.
import "./hooks";
export { queueMail, queueOrderConfirmation, queuePasswordResetMail, requestPasswordResetEmail, type QueueMailInput } from "./queue";
export { MAIL_TEMPLATE_NAMES, type MailTemplateName, type MailTemplateProps } from "./contracts";
export { MAIL_PATHS } from "./urls";
