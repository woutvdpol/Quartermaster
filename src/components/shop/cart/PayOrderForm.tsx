"use client";

import { useActionState } from "react";
import { payOrderAction, type PayOrderState } from "@/app/(shop)/order/[uuid]/actions";
import { PendingButton } from "./PendingButton";

/** "Pay now" / "Try again": POSTs the order uuid; the server re-reserves and opens a Mollie payment. */
export function PayOrderForm({ uuid, label }: { uuid: string; label: string }) {
  const [state, action] = useActionState<PayOrderState, FormData>(payOrderAction, null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="uuid" value={uuid} />
      <PendingButton size="lg">{label}</PendingButton>
      {state?.message ? (
        <p role="alert" className="text-sm font-medium text-shop-crit">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
