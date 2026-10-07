"use client";

import type { FulfillmentStatus } from "@/generated/prisma/enums";
import {
  ActionMessage,
  ActionToast,
  FormActions,
  Select,
  SubmitButton,
  TextInput,
  fulfillmentStatusLabel,
  useActionForm,
} from "@/components/admin/ui";
import { orderCopy } from "../../_copy";
import { setFulfillmentAction } from "../actions";

const t = orderCopy.fulfillment;
const STATUSES: FulfillmentStatus[] = ["UNFULFILLED", "PACKED", "SHIPPED", "DELIVERED"];

/** WIP (decision 8) but functional: fulfillment status + carrier/tracking. */
export function FulfillmentForm({
  orderId,
  paid,
  current,
}: {
  orderId: string;
  paid: boolean;
  current: {
    status: FulfillmentStatus;
    carrier: string | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
  };
}) {
  const { state, formAction, error } = useActionForm(setFulfillmentAction);

  return (
    <form action={formAction} className="grid gap-3" noValidate>
      <input type="hidden" name="id" value={orderId} />
      <ActionMessage state={state} showSuccess={false} />
      <ActionToast state={state} errors={false} />
      <Select
        label={t.status}
        name="status"
        defaultValue={current.status}
        hint={paid ? undefined : t.unpaid}
        error={error("status")}
        options={STATUSES.map((s) => ({
          value: s,
          label: fulfillmentStatusLabel(s),
          disabled: !paid && s !== "UNFULFILLED",
        }))}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextInput
          label={t.carrier}
          name="carrier"
          defaultValue={current.carrier ?? ""}
          placeholder={t.carrierPlaceholder}
          maxLength={100}
          error={error("carrier")}
        />
        <TextInput
          label={t.trackingNumber}
          name="trackingNumber"
          defaultValue={current.trackingNumber ?? ""}
          maxLength={200}
          inputClassName="font-mono"
          error={error("trackingNumber")}
        />
      </div>
      <TextInput
        label={t.trackingUrl}
        name="trackingUrl"
        type="url"
        inputMode="url"
        defaultValue={current.trackingUrl ?? ""}
        placeholder="https://"
        hint={t.trackingUrlHint}
        error={error("trackingUrl")}
      />
      <FormActions>
        <SubmitButton size="sm" disabled={!paid && current.status === "UNFULFILLED"}>
          {t.submit}
        </SubmitButton>
      </FormActions>
    </form>
  );
}
