"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ProductImport } from "@/components/admin/import/ProductImport";
import type { ImportJobView } from "@/server/import/types";
import {
  ActionMessage,
  ActionToast,
  Checkbox,
  FormActions,
  RadioGroup,
  Select,
  SubmitButton,
  TextInput,
  Textarea,
  useActionForm,
  type ActionResult,
  type ActionState,
} from "@/components/admin/ui";
import {
  applyShippingTemplateAction,
  chooseImportAction,
  createLegalPagesAction,
  goLiveAction,
  recordImportAction,
  requestDomainAction,
  saveBasicsAction,
  saveBusinessAction,
} from "../actions";

type Option = { value: string; label: string };
type Action = (prev: ActionState, formData: FormData) => Promise<ActionResult>;

function useStepForm(action: Action) {
  return useActionForm(action);
}

// ─── Shop basics ────────────────────────────────────────────────────────────

export function BasicsForm(props: {
  shopName: string;
  contactEmail: string;
  host: string;
  currency: string;
  currencies: string[];
  displayCurrencies: string[];
}) {
  const { state, formAction, error } = useStepForm(saveBasicsAction);
  return (
    <form action={formAction} className="grid gap-4" noValidate>
      <ActionMessage state={state} showSuccess={false} />
      <TextInput label="Shop name" name="shopName" defaultValue={props.shopName} required maxLength={120} error={error("shopName")} />
      <TextInput
        label="Contact email"
        name="contactEmail"
        type="email"
        defaultValue={props.contactEmail}
        required
        hint="Shown to customers and used as reply-to address for shop mails."
        error={error("contactEmail")}
      />
      <TextInput label="Shop address" name="host" value={props.host} readOnly inputClassName="font-mono bg-panel-2" hint="Your shop's address on Quartermaster. You can connect your own domain in the last step." />
      <Select label="Language" name="language" defaultValue="en" disabled options={[{ value: "en", label: "English" }]} hint="More languages follow later." />
      <fieldset className="grid gap-2">
        <legend className="type-label mb-1 text-[11.5px] text-muted">Also show prices in</legend>
        <p className="text-xs text-muted">Checkout is always in {props.currency}. Visitors can switch the displayed currency.</p>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {props.currencies.map((c) => (
            <Checkbox key={c} name="displayCurrencies" value={c} label={c} defaultChecked={props.displayCurrencies.includes(c)} />
          ))}
        </div>
      </fieldset>
      <FormActions>
        <SubmitButton>Save and continue</SubmitButton>
      </FormActions>
    </form>
  );
}

// ─── Business details ───────────────────────────────────────────────────────

export function BusinessForm(props: {
  values: { cocNumber: string; vatNumber: string; iban: string; phone: string; line1: string; line2: string; postalCode: string; city: string; country: string };
  countries: Option[];
}) {
  const { state, formAction, error } = useStepForm(saveBusinessAction);
  const v = props.values;
  return (
    <form action={formAction} className="grid gap-4" noValidate>
      <ActionMessage state={state} showSuccess={false} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput label="Chamber of Commerce no." name="cocNumber" defaultValue={v.cocNumber} required inputClassName="font-mono" error={error("cocNumber")} />
        <TextInput label="VAT id" name="vatNumber" defaultValue={v.vatNumber} placeholder="NL123456789B01" inputClassName="font-mono" error={error("vatNumber")} showOptional />
        <TextInput label="IBAN" name="iban" defaultValue={v.iban} placeholder="NL91ABNA0417164300" inputClassName="font-mono" hint="Shown on invoices for bank transfers." error={error("iban")} showOptional />
        <TextInput label="Phone" name="phone" type="tel" defaultValue={v.phone} error={error("phone")} showOptional />
      </div>
      <TextInput label="Street and number" name="line1" defaultValue={v.line1} required autoComplete="address-line1" error={error("line1") ?? error("address.line1")} />
      <TextInput label="Address line 2" name="line2" defaultValue={v.line2} autoComplete="address-line2" error={error("line2")} showOptional />
      <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
        <TextInput label="Postal code" name="postalCode" defaultValue={v.postalCode} required autoComplete="postal-code" error={error("postalCode")} />
        <TextInput label="City" name="city" defaultValue={v.city} required autoComplete="address-level2" error={error("city")} />
      </div>
      <Select label="Country" name="country" defaultValue={v.country || "NL"} options={props.countries} required error={error("country")} />
      <FormActions>
        <SubmitButton>Save and continue</SubmitButton>
      </FormActions>
    </form>
  );
}

// ─── Shipping ───────────────────────────────────────────────────────────────

export function ShippingTemplateForm({ templates }: { templates: { value: string; label: string; description: string }[] }) {
  const { state, formAction, error } = useStepForm(applyShippingTemplateAction);
  return (
    <form action={formAction} className="grid gap-4" noValidate>
      <ActionMessage state={state} showSuccess={false} />
      <RadioGroup name="template" legend="Start from a template" options={templates} defaultValue={templates[1]?.value} error={error("template")} required />
      <FormActions>
        <SubmitButton pendingLabel="Creating zones…">Create zones and continue</SubmitButton>
      </FormActions>
    </form>
  );
}

// ─── Import ─────────────────────────────────────────────────────────────────

/**
 * Import step: CSV import (WooCommerce / Shopify — the embedded ProductImport component, which has its
 * own source switch, preview and Import button), Concept500 migration with our team, or start empty.
 * A finished CSV import marks the step done automatically.
 */
export function ImportForm({
  current,
  currency,
  initialJob,
}: {
  current: string | null;
  currency: string;
  initialJob: ImportJobView | null;
}) {
  const { state, formAction, error } = useStepForm(chooseImportAction);
  const router = useRouter();
  const [choice, setChoice] = useState(current === "woocommerce" || current === "shopify" || initialJob ? "csv" : (current ?? ""));
  const [finishError, setFinishError] = useState<string | null>(null);
  const options = [
    { value: "csv", label: "WooCommerce or Shopify", description: "Upload the product CSV export. Photos are downloaded from your old shop; you check a preview first." },
    { value: "concept500", label: "Concept500", description: "Full migration incl. orders and customers — done with our team." },
    { value: "empty", label: "Start empty", description: "Skip — add products later." },
  ];
  const onFinished = async (job: ImportJobView) => {
    if (job.status !== "DONE") return;
    const res = await recordImportAction(job.source.toLowerCase());
    if (!res.ok) setFinishError(res.message ?? "Could not save the step.");
    else router.refresh();
  };
  return (
    <div className="grid gap-4">
      <fieldset className="grid gap-2">
        <legend className="sr-only">How do you want to bring your products?</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {options.map((o) => (
            <label
              key={o.value}
              className="grid cursor-pointer content-start gap-1 rounded-card border border-line bg-panel p-3 text-[13.5px] has-[:checked]:border-accent has-[:checked]:shadow-[inset_0_0_0_1px_var(--qm-accent)]"
            >
              <span className="flex items-center gap-2 font-medium">
                <input type="radio" name="choice-ui" value={o.value} checked={choice === o.value} onChange={() => setChoice(o.value)} className="size-3.5 accent-accent" />
                {o.label}
              </span>
              <span className="text-xs text-muted">{o.description}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {choice === "csv" ? (
        <>
          {finishError ? <p role="alert" className="text-xs text-crit">{finishError}</p> : null}
          <ProductImport currency={currency} initialJob={initialJob} hideRestart onFinished={(job) => void onFinished(job)} />
        </>
      ) : choice ? (
        <form action={formAction} className="grid gap-4" noValidate>
          <ActionMessage state={state} showSuccess={false} />
          <input type="hidden" name="choice" value={choice} />
          {choice === "concept500" ? (
            <Textarea
              label="Anything we should know?"
              name="note"
              rows={2}
              maxLength={300}
              showOptional
              hint="We plan the migration of products, orders and customers with you and contact you by email."
              error={error("note")}
            />
          ) : null}
          {error("choice") ? <p className="text-xs text-crit">{error("choice")}</p> : null}
          <FormActions>
            <SubmitButton>{choice === "concept500" ? "Request migration" : "Start empty"}</SubmitButton>
          </FormActions>
        </form>
      ) : null}
    </div>
  );
}

// ─── Legal pages ────────────────────────────────────────────────────────────

export function LegalForm({
  pages,
}: {
  pages: { key: string; title: string; published: boolean; exists: boolean }[];
}) {
  const { state, formAction, error } = useStepForm(createLegalPagesAction);
  return (
    <form action={formAction} className="grid gap-4" noValidate>
      <ActionMessage state={state} showSuccess={false} />
      <fieldset className="grid gap-2.5">
        <legend className="type-label mb-1 text-[11.5px] text-muted">Create and publish from template</legend>
        {pages.map((p) => (
          <Checkbox
            key={p.key}
            name="pages"
            value={p.key}
            label={p.title}
            defaultChecked={!p.published}
            description={
              p.published
                ? "Already published — tick to replace its text with the template."
                : p.exists
                  ? "Draft exists — its text is replaced by the template and published."
                  : "Created from the template and published."
            }
          />
        ))}
        {error("pages") ? <p className="text-xs text-crit">{error("pages")}</p> : null}
      </fieldset>
      <FormActions>
        <SubmitButton pendingLabel="Publishing…">Create and publish</SubmitButton>
      </FormActions>
    </form>
  );
}

// ─── Go live ────────────────────────────────────────────────────────────────

export function DomainForm({ requested }: { requested: string | null }) {
  const { state, formAction, error } = useStepForm(requestDomainAction);
  return (
    <form action={formAction} className="grid gap-3" noValidate>
      <ActionMessage state={state} showSuccess={false} />
      <ActionToast state={state} errors={false} />
      <TextInput
        label="Your domain"
        name="domain"
        defaultValue={requested ?? ""}
        placeholder="www.your-shop.com"
        inputClassName="font-mono"
        error={error("domain")}
        hint={requested ? `Requested: ${requested}. You can change it.` : undefined}
      />
      <FormActions>
        <SubmitButton variant="secondary" size="sm">
          {requested ? "Update request" : "Request domain"}
        </SubmitButton>
      </FormActions>
    </form>
  );
}

export function GoLiveForm({ ready, warnings }: { ready: boolean; warnings: number }) {
  const { state, formAction, error } = useStepForm(goLiveAction);
  return (
    <form action={formAction} className="grid gap-3" noValidate>
      <ActionMessage state={state} showSuccess={false} />
      {warnings > 0 ? (
        <Checkbox
          name="acknowledge"
          label={`Go live with ${warnings} open ${warnings === 1 ? "point" : "points"}`}
          description="You can fix them later; the setup wizard closes after going live."
          error={error("acknowledge")}
        />
      ) : null}
      <FormActions>
        <SubmitButton disabled={!ready} pendingLabel="Going live…">
          Go live
        </SubmitButton>
      </FormActions>
    </form>
  );
}
