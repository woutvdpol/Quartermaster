"use client";

import { useState } from "react";
import {
  ActionMessage,
  Button,
  DateInput,
  Drawer,
  InlineAlert,
  NumberInput,
  RadioGroup,
  TextInput,
  toast,
  type ButtonSize,
  type ButtonVariant,
} from "@/components/admin/ui";
import { PendingButton, useKeepForm } from "../../_system/client";
import type { LotCandidate } from "../_data";
import { saveAuctionAction } from "../actions";
import { auctionsCopy as t } from "../_copy";
import { CandidateSearch } from "./CandidateSearch";

/** Values for the edit form; date-times as datetime-local strings in the shop zone. */
export type AuctionFormData = {
  id: string;
  type: "DAY" | "SINGLE";
  title: string;
  opensAt: string;
  firstCloseAt: string;
  gapMinutes: number;
  extendMinutes: number;
  payDays: number;
};

type Props = {
  auction?: AuctionFormData;
  currency: string;
  /** Suggested times for a new auction (datetime-local strings in the shop zone). */
  suggest?: { opensAt: string; firstCloseAt: string };
  trigger: string;
  triggerVariant?: ButtonVariant;
  triggerSize?: ButtonSize;
};

/** Create an auction (day or single lot) or edit its schedule, in a side drawer. Creating redirects to it. */
export function AuctionDrawer({ auction, currency, suggest, trigger, triggerVariant = "secondary", triggerSize = "md" }: Props) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  return (
    <>
      <Button
        variant={triggerVariant}
        size={triggerSize}
        aria-haspopup="dialog"
        onClick={() => {
          setSession((s) => s + 1);
          setOpen(true);
        }}
      >
        {trigger}
      </Button>
      <Drawer open={open} onOpenChange={setOpen} size="lg" title={auction ? t.form.editTitle : t.form.newTitle} description={t.form.description}>
        {open && <AuctionForm key={session} auction={auction} currency={currency} suggest={suggest} onDone={() => setOpen(false)} />}
      </Drawer>
    </>
  );
}

function AuctionForm({ auction, currency, suggest, onDone }: { auction?: AuctionFormData; currency: string; suggest?: Props["suggest"]; onDone: () => void }) {
  const [type, setType] = useState<"DAY" | "SINGLE">(auction?.type ?? "DAY");
  const [product, setProduct] = useState<LotCandidate | null>(null);
  const [title, setTitle] = useState(auction?.title ?? "");
  const [titleTouched, setTitleTouched] = useState(!!auction);
  const { state, pending, error, onSubmit } = useKeepForm(saveAuctionAction, {
    onSuccess: (s) => {
      if (s.message) toast.ok(s.message);
      onDone();
    },
  });
  const single = type === "SINGLE";

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      <ActionMessage state={state} showSuccess={false} />
      {auction ? <input type="hidden" name="id" value={auction.id} /> : null}
      {auction ? (
        <input type="hidden" name="type" value={auction.type} />
      ) : (
        <RadioGroup
          name="type"
          legend={t.form.type}
          value={type}
          onValueChange={(v) => setType(v === "SINGLE" ? "SINGLE" : "DAY")}
          options={[
            { value: "DAY", label: t.form.typeDay, description: t.form.typeDayHint },
            { value: "SINGLE", label: t.form.typeSingle, description: t.form.typeSingleHint },
          ]}
          error={error("type")}
        />
      )}

      {single && !auction ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-[13px] font-medium text-ink">{t.form.product}</legend>
          <input type="hidden" name="productId" value={product?.id ?? ""} />
          {error("productId") ? <InlineAlert tone="crit">{t.form.productRequired}</InlineAlert> : null}
          <p className="text-xs text-muted">{t.form.productHint}</p>
          <CandidateSearch
            auctionId={null}
            currency={currency}
            mode="single"
            picked={new Set(product ? [product.id] : [])}
            onToggle={(c) => {
              setProduct(c);
              if (!titleTouched) setTitle(c.title);
            }}
          />
        </fieldset>
      ) : null}

      <TextInput
        label={t.form.title}
        name="title"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          setTitleTouched(true);
        }}
        required
        maxLength={160}
        error={error("title")}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <DateInput kind="datetime-local" label={t.form.opensAt} name="opensAt" defaultValue={auction?.opensAt ?? suggest?.opensAt ?? ""} required error={error("opensAt")} />
        <DateInput
          kind="datetime-local"
          label={single ? t.form.closesAt : t.form.firstCloseAt}
          name="firstCloseAt"
          defaultValue={auction?.firstCloseAt ?? suggest?.firstCloseAt ?? ""}
          required
          error={error("firstCloseAt")}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {single ? (
          <input type="hidden" name="gapMinutes" value="0" />
        ) : (
          <NumberInput label={t.form.gap} name="gapMinutes" inputMode="numeric" defaultValue={auction?.gapMinutes ?? 1} hint={t.form.gapHint} error={error("gapSeconds")} />
        )}
        <NumberInput label={t.form.extend} name="extendMinutes" inputMode="numeric" defaultValue={auction?.extendMinutes ?? 2} hint={t.form.extendHint} error={error("extendSeconds")} />
        <NumberInput label={t.form.payDays} name="payDays" inputMode="numeric" defaultValue={auction?.payDays ?? 5} hint={t.form.payDaysHint} error={error("payDays")} />
      </div>
      <div className="flex justify-end">
        <PendingButton pending={pending}>{auction ? t.form.saveEdit : t.form.save}</PendingButton>
      </div>
    </form>
  );
}
