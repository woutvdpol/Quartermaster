"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ActionMessage,
  ActionToast,
  DateTime,
  Drawer,
  FormActions,
  KeyValue,
  SegmentedControl,
  SubmitButton,
  Textarea,
  buttonClasses,
  useActionForm,
} from "@/components/admin/ui";
import { LEAD_STATUSES, LEAD_STATUS_LABEL, type LeadStatusValue } from "@/server/leads/validation";
import { saveLeadNoteAction, setLeadStatusAction } from "../actions";
import { copy } from "../_copy";

export type LeadDrawerData = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  itemsDescription: string;
  message: string | null;
  status: LeadStatusValue;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  handledBy: string | null;
  photos: { url: string; thumbUrl: string }[];
};

const t = copy.drawer;

/** Builds the Sourcing deep link ("Create purchase record") with the seller prefilled. */
export function purchaseRecordHref(lead: Pick<LeadDrawerData, "id" | "name" | "email">): string {
  const q = new URLSearchParams({
    new: "1",
    supplierName: lead.name,
    notes: `From sell request by ${lead.name} <${lead.email}>`,
    lead: lead.id,
  });
  return `/admin/sourcing?${q.toString()}`;
}

function StatusForm({ lead }: { lead: LeadDrawerData }) {
  const { state, formAction, error } = useActionForm(setLeadStatusAction);
  return (
    <form action={formAction} className="grid gap-3">
      <input type="hidden" name="id" value={lead.id} />
      <ActionToast state={state} errors={false} />
      <ActionMessage state={state} showSuccess={false} />
      <SegmentedControl
        name="status"
        legend={t.status}
        size="sm"
        defaultValue={lead.status}
        error={error("status")}
        options={LEAD_STATUSES.map((s) => ({ value: s, label: LEAD_STATUS_LABEL[s] }))}
      />
      <FormActions>
        <SubmitButton size="sm">{t.saveStatus}</SubmitButton>
      </FormActions>
    </form>
  );
}

function NoteForm({ lead }: { lead: LeadDrawerData }) {
  const { state, formAction, error } = useActionForm(saveLeadNoteAction);
  return (
    <form action={formAction} className="grid gap-3">
      <input type="hidden" name="id" value={lead.id} />
      <ActionToast state={state} errors={false} />
      <ActionMessage state={state} showSuccess={false} />
      <Textarea label={t.note} hint={t.noteHint} name="note" rows={4} maxLength={5000} defaultValue={lead.note ?? ""} error={error("note")} />
      <FormActions>
        <SubmitButton size="sm" variant="secondary">
          {t.saveNote}
        </SubmitButton>
      </FormActions>
    </form>
  );
}

/** URL-driven detail panel (`?lead=<id>`); closing navigates to `closeHref`. */
export function LeadDrawer({ lead, closeHref, timeZone }: { lead: LeadDrawerData; closeHref: string; timeZone: string }) {
  const router = useRouter();
  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) router.push(closeHref, { scroll: false });
      }}
      size="lg"
      title={lead.name}
      description={
        <>
          {LEAD_STATUS_LABEL[lead.status]} · <DateTime value={lead.createdAt} format="datetime" timeZone={timeZone} />
        </>
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <a href={`mailto:${lead.email}`} className={buttonClasses({ variant: "secondary", size: "sm" })}>
            {t.reply}
          </a>
          <Link href={purchaseRecordHref(lead)} className={buttonClasses({ variant: "primary", size: "sm" })} title={t.createPurchaseHint}>
            {t.createPurchase}
          </Link>
        </div>
      }
    >
      <div className="grid gap-6">
        <KeyValue
          items={[
            { label: t.email, value: <a href={`mailto:${lead.email}`} className="hover:underline">{lead.email}</a> },
            { label: t.phone, value: lead.phone ? <a href={`tel:${lead.phone.replace(/[^0-9+]/g, "")}`} className="hover:underline">{lead.phone}</a> : "—" },
            { label: t.received, value: <DateTime value={lead.createdAt} format="long" timeZone={timeZone} /> },
            ...(lead.handledBy ? [{ label: t.handledBy, value: lead.handledBy }] : []),
          ]}
        />

        <section className="grid gap-2">
          <h3 className="type-label">{t.items}</h3>
          <p className="text-[13px] whitespace-pre-line">{lead.itemsDescription}</p>
        </section>

        {lead.message ? (
          <section className="grid gap-2">
            <h3 className="type-label">{t.message}</h3>
            <p className="text-[13px] whitespace-pre-line">{lead.message}</p>
          </section>
        ) : null}

        <section className="grid gap-2">
          <h3 className="type-label">{t.photos(lead.photos.length)}</h3>
          {lead.photos.length ? (
            <ul role="list" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {lead.photos.map((p, i) => (
                <li key={p.url}>
                  <a href={p.url} target="_blank" rel="noopener noreferrer" aria-label={t.openPhoto(i + 1)} className="block overflow-hidden rounded-control border border-line">
                    {/* eslint-disable-next-line @next/next/no-img-element -- stored upload thumbnail */}
                    <img src={p.thumbUrl} alt="" loading="lazy" className="aspect-square w-full bg-panel-3 object-cover" />
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">{t.noPhotos}</p>
          )}
        </section>

        <div className="grid gap-6 border-t border-line pt-5">
          <StatusForm key={`s-${lead.updatedAt}`} lead={lead} />
          <NoteForm key={`n-${lead.updatedAt}`} lead={lead} />
        </div>
      </div>
    </Drawer>
  );
}
