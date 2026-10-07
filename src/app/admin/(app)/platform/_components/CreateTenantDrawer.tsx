"use client";

import Link from "next/link";
import { useState } from "react";
import { ActionMessage, Button, Drawer, InlineAlert, Select, TextInput, buttonClasses, type SelectOptionGroup } from "@/components/admin/ui";
import { CopyField, PendingButton, useKeepForm } from "../../_system/client";
import { createTenantAction, type CreatedTenant } from "../actions";
import { COMMON_CURRENCIES } from "../_shared";

/** "New shop" drawer: creates tenant + primary domain + owner invite, then shows the invite link once. */
export function CreateTenantDrawer({ timeZones }: { timeZones: SelectOptionGroup[] }) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const [created, setCreated] = useState<CreatedTenant | null>(null);
  return (
    <>
      <Button
        variant="primary"
        aria-haspopup="dialog"
        onClick={() => {
          setCreated(null);
          setSession((s) => s + 1);
          setOpen(true);
        }}
      >
        New shop
      </Button>
      <Drawer open={open} onOpenChange={setOpen} size="lg" title={created ? `“${created.name}” is ready` : "New shop"} description={created ? undefined : "Creates the shop, its primary domain, default settings and an owner invite."}>
        {open &&
          (created ? (
            <div className="grid gap-4">
              <InlineAlert tone="ok" live="status" title={`Invite for ${created.ownerEmail}`}>
                Invite e-mails may not be sent automatically yet. Copy this link and send it to the owner yourself. It is shown only once, works
                once and expires in 7 days.
              </InlineAlert>
              <CopyField label="Owner invite link" value={created.inviteLink} copiedMessage="Invite link copied." />
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Close
                </Button>
                <Link href={`/admin/platform/${created.id}`} className={buttonClasses({ variant: "primary" })} onClick={() => setOpen(false)}>
                  Open shop details
                </Link>
              </div>
            </div>
          ) : (
            <CreateForm key={session} timeZones={timeZones} onCreated={setCreated} onCancel={() => setOpen(false)} />
          ))}
      </Drawer>
    </>
  );
}

function CreateForm({ timeZones, onCreated, onCancel }: { timeZones: SelectOptionGroup[]; onCreated: (t: CreatedTenant) => void; onCancel: () => void }) {
  const { state, pending, error, onSubmit } = useKeepForm(createTenantAction, {
    onSuccess: (s) => {
      if (s.ok && s.data) onCreated(s.data);
    },
  });
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const slugify = (v: string) =>
    v
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <ActionMessage state={state} showSuccess={false} />
      <fieldset className="grid gap-3">
        <legend className="type-label mb-1 text-[11.5px] text-muted">Shop</legend>
        <TextInput
          label="Shop name"
          name="name"
          required
          maxLength={120}
          error={error("name")}
          onChange={(e) => {
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
        />
        <TextInput
          label="Slug"
          name="slug"
          required
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value);
          }}
          maxLength={48}
          inputClassName="font-mono"
          hint="Lower-case letters, digits and dashes. Used internally (storage paths, logs)."
          error={error("slug")}
        />
        <TextInput
          label="Primary domain"
          name="primaryHost"
          required
          placeholder="shop.example.com"
          inputClassName="font-mono"
          hint="The host the shop and its admin are served on. Point its DNS to Quartermaster."
          error={error("primaryHost")}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput
            label="Currency"
            name="currency"
            defaultValue="EUR"
            list="qm-currencies"
            maxLength={3}
            inputClassName="font-mono uppercase"
            hint="ISO code. Cannot change once the shop has products or orders."
            error={error("currency")}
          />
          <Select label="Time zone" name="timezone" defaultValue="Europe/Amsterdam" options={timeZones} error={error("timezone")} />
        </div>
        <datalist id="qm-currencies">
          {COMMON_CURRENCIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </fieldset>
      <fieldset className="grid gap-3">
        <legend className="type-label mb-1 text-[11.5px] text-muted">Owner</legend>
        <TextInput label="Owner e-mail" name="ownerEmail" type="email" required autoComplete="off" error={error("ownerEmail")} />
        <TextInput label="Owner name" name="ownerName" showOptional maxLength={120} error={error("ownerName")} />
      </fieldset>
      <div className="sticky bottom-0 -mx-4 -mb-4 flex justify-end gap-2 border-t border-line bg-panel px-4 py-3">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <PendingButton pending={pending} pendingLabel="Creating…">
          Create shop
        </PendingButton>
      </div>
    </form>
  );
}
