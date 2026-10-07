"use client";

import { useState } from "react";
import { ActionMessage, Button, DateInput, Drawer, MoneyInput, NumberInput, SegmentedControl, Switch, TextInput, toast, type ButtonSize, type ButtonVariant } from "@/components/admin/ui";
import { PendingButton, useKeepForm } from "../../_system/client";
import { saveCouponAction } from "../actions";
import { couponsCopy as t } from "../_copy";

export type CouponFormData = {
  id: string;
  code: string;
  description: string | null;
  type: "PERCENT" | "FIXED" | "FREE_SHIPPING";
  value: number;
  minSubtotal: number;
  startsAt: string;
  endsAt: string;
  maxRedemptions: number | null;
  perEmailLimit: number | null;
  isActive: boolean;
  used: boolean;
};

type Props = { coupon?: CouponFormData; currency: string; trigger: string; triggerVariant?: ButtonVariant; triggerSize?: ButtonSize };

/** Create / edit a coupon in a side drawer. */
export function CouponDrawer({ coupon, currency, trigger, triggerVariant = "secondary", triggerSize = "md" }: Props) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  return (
    <>
      <Button variant={triggerVariant} size={triggerSize} aria-haspopup="dialog" onClick={() => { setSession((s) => s + 1); setOpen(true); }}>
        {trigger}
      </Button>
      <Drawer open={open} onOpenChange={setOpen} size="lg" title={coupon ? t.form.editTitle(coupon.code) : t.form.newTitle} description={t.form.description}>
        {open && <CouponForm key={session} coupon={coupon} currency={currency} onDone={() => setOpen(false)} />}
      </Drawer>
    </>
  );
}

function CouponForm({ coupon, currency, onDone }: { coupon?: CouponFormData; currency: string; onDone: () => void }) {
  const [type, setType] = useState<CouponFormData["type"]>(coupon?.type ?? "PERCENT");
  const { state, pending, error, onSubmit } = useKeepForm(saveCouponAction, {
    onSuccess: (s) => {
      if (s.message) toast.ok(s.message);
      onDone();
    },
  });
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      <ActionMessage state={state} showSuccess={false} />
      {coupon ? <input type="hidden" name="id" value={coupon.id} /> : null}
      <input type="hidden" name="type" value={type} />
      <TextInput
        label={t.form.code}
        name="code"
        defaultValue={coupon?.code}
        required
        maxLength={40}
        autoCapitalize="characters"
        inputClassName="font-mono uppercase"
        hint={t.form.codeHint}
        readOnly={coupon?.used}
        error={error("code")}
      />
      <TextInput label={t.form.note} name="description" defaultValue={coupon?.description ?? ""} maxLength={200} error={error("description")} />
      <SegmentedControl
        name="typeChoice"
        legend={t.form.type}
        value={type}
        onValueChange={(v) => !coupon?.used && setType(v as CouponFormData["type"])}
        options={[
          { value: "PERCENT", label: t.type.PERCENT, disabled: coupon?.used && coupon.type !== "PERCENT" },
          { value: "FIXED", label: t.type.FIXED, disabled: coupon?.used && coupon.type !== "FIXED" },
          { value: "FREE_SHIPPING", label: t.type.FREE_SHIPPING, disabled: coupon?.used && coupon.type !== "FREE_SHIPPING" },
        ]}
      />
      {type === "PERCENT" ? (
        <NumberInput label={t.form.percent} name="percent" defaultValue={coupon?.type === "PERCENT" ? String(coupon.value / 100) : ""} trailing="%" required error={error("percent")} />
      ) : null}
      {type === "FIXED" ? (
        <MoneyInput label={t.form.amount} name="amount" currency={currency} defaultValue={coupon?.type === "FIXED" ? coupon.value : undefined} required error={error("amount")} />
      ) : null}
      <MoneyInput label={t.form.minSubtotal} name="minSubtotal" currency={currency} defaultValue={coupon?.minSubtotal ?? 0} hint={t.form.minSubtotalHint} error={error("minSubtotal")} />
      <div className="grid gap-3 sm:grid-cols-2">
        <DateInput kind="datetime-local" label={t.form.startsAt} name="startsAt" defaultValue={coupon?.startsAt ?? ""} error={error("startsAt")} />
        <DateInput kind="datetime-local" label={t.form.endsAt} name="endsAt" defaultValue={coupon?.endsAt ?? ""} error={error("endsAt")} hint={t.form.windowHint} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberInput label={t.form.maxRedemptions} name="maxRedemptions" defaultValue={coupon?.maxRedemptions ?? ""} inputMode="numeric" hint={t.form.maxHint} error={error("maxRedemptions")} />
        <NumberInput label={t.form.perEmail} name="perEmailLimit" defaultValue={coupon ? (coupon.perEmailLimit ?? "") : 1} inputMode="numeric" hint={t.form.perEmailHint} error={error("perEmailLimit")} />
      </div>
      <Switch layout="row" name="isActive" label={t.form.active} description={t.form.activeHint} defaultChecked={coupon?.isActive ?? true} />
      <div className="flex justify-end">
        <PendingButton pending={pending}>{t.form.save}</PendingButton>
      </div>
    </form>
  );
}
