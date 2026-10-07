import type { CampaignStatus } from "@/generated/prisma/enums";

/** Screen copy for the newsletter admin (campaigns + subscribers). */
export const copy = {
  crumb: "Website",
  title: "Newsletter",
  newCampaign: "New campaign",

  disabled: {
    title: "The newsletter is not enabled for this shop",
    body:
      "Sending newsletters is a platform feature. A platform administrator can switch it on in Settings › Platform, " +
      "together with the monthly sending quota.",
  },

  stats: {
    label: "Newsletter overview",
    confirmed: "Confirmed",
    confirmedNote: "receive campaigns",
    pending: "Pending",
    pendingNote: "awaiting confirmation",
    unsubscribed: "Unsubscribed",
    unsubscribedNote: "opted out",
    quota: "Monthly quota",
    unlimited: "Unlimited",
    quotaUsed: (used: string, limit: string) =>
      `${used} of ${limit} mails used`,
    quotaUnlimited: (used: string) => `${used} mails sent this month`,
    quotaPeriod: "Resets on",
    meterLabel: "Monthly newsletter quota used",
  },

  tabs: {
    label: "Newsletter sections",
    campaigns: "Campaigns",
    subscribers: "Subscribers",
  },

  campaigns: {
    caption: "Campaigns",
    subject: "Subject",
    status: "Status",
    recipients: "Recipients",
    sent: "Delivered",
    failed: "Failed",
    sentAt: "Sent",
    updated: "Last edited",
    emptyTitle: "No campaigns yet",
    emptyBody:
      "Write a campaign in Markdown, send yourself a test and then send it to every confirmed subscriber.",
  },

  status: {
    DRAFT: "Draft",
    SCHEDULED: "Scheduled",
    SENDING: "Sending",
    SENT: "Sent",
    FAILED: "Failed",
  } satisfies Record<CampaignStatus, string>,

  subscribers: {
    caption: "Subscribers",
    email: "Email",
    status: "Status",
    source: "Source",
    subscribed: "Signed up",
    confirmed: "Confirmed",
    unsubscribed: "Unsubscribed",
    search: "Search email…",
    searchLabel: "Search subscribers",
    export: "Export CSV",
    exportHint: "Exports every subscriber in the current view and search.",
    views: {
      active: "Confirmed",
      pending: "Pending",
      unsubscribed: "Unsubscribed",
      all: "All",
    },
    statusLabel: {
      active: "Confirmed",
      pending: "Pending",
      unsubscribed: "Unsubscribed",
    },
    emptyTitle: "No subscribers here",
    emptyBody:
      "People sign up through the newsletter form on the shop and confirm by email (double opt-in).",
    emptySearch: "No subscribers match this search.",
    bulkLabel: "Bulk actions for subscribers",
    selected: (n: number) => `${n} selected`,
    clear: "Clear",
    delete: "Delete",
    deleteTitle: (n: number) => `Delete ${n} subscriber${n === 1 ? "" : "s"}?`,
    deleteBody:
      "The addresses and their consent records are erased permanently (for example for a GDPR erasure request). " +
      "This cannot be undone. To stop mailing someone, they can also unsubscribe themselves.",
    deleteConfirm: "Delete permanently",
    deleted: (n: number) => `${n} subscriber${n === 1 ? "" : "s"} deleted.`,
  },

  editor: {
    crumbNew: "New campaign",
    titleNew: "New campaign",
    back: "Newsletter",
    subject: "Subject",
    subjectHint: "Shown in the inbox. Keep it short and specific.",
    body: "Content",
    bodyHint:
      "Markdown: # heading, **bold**, *italic*, [link](https://…), ![image](https://…), - lists, > quotes, --- divider. " +
      "The unsubscribe link and shop footer are added automatically.",
    preview: "Preview",
    previewTitle: "Campaign preview",
    previewEmpty: "Start writing to see a preview.",
    previewUpdating: "Updating preview…",
    previewNote:
      "Rendered exactly like the mail body; the shop header and footer are added when sending.",
    save: "Save draft",
    saving: "Saving…",
    create: "Create draft",
    saved: "Draft saved.",
    unsaved: "Unsaved changes",
    readOnly: "This campaign has been sent and can no longer be edited.",
    stats: "Delivery",
    created: "Created",
  },

  test: {
    title: "Send a test",
    email: "Test address",
    hint: "Sends one copy with “[Test]” in the subject. Tests don’t count towards the quota.",
    send: "Send test",
    sending: "Sending…",
    sent: (to: string) => `Test queued for ${to}.`,
    saveFirst: "Save your changes first; the test uses the saved version.",
  },

  send: {
    title: "Send to subscribers",
    trigger: "Send to all confirmed subscribers",
    confirmTitle: "Send this campaign now?",
    confirm: "Send now",
    sending: "Queuing…",
    recipients: (n: string) =>
      `It goes to ${n} confirmed subscriber${n === "1" ? "" : "s"}.`,
    quota: (used: string, after: string, limit: string) =>
      `Quota this month: ${used} used → ${after} of ${limit} after sending.`,
    quotaUnlimited: "This shop has no monthly sending limit.",
    overQuota: (remaining: string) =>
      `Only ${remaining} mails left this month — not enough for every subscriber.`,
    irreversible: "Sending cannot be stopped or undone once it has started.",
    noRecipients: "There are no confirmed subscribers yet.",
    saveFirst: "Save your changes before sending.",
    done: (n: number) =>
      `Sending started to ${n} subscriber${n === 1 ? "" : "s"}.`,
  },

  remove: {
    trigger: "Delete draft",
    title: "Delete this draft?",
    body: "The draft is removed permanently. Sent campaigns are kept as history.",
    confirm: "Delete draft",
  },

  errors: {
    notFoundTitle: "Campaign not found",
    notFoundBody:
      "It may have been deleted. Go back to the newsletter overview.",
  },
} as const;
