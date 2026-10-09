"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ConfirmSubmit } from "@/components/shop/account/ConfirmSubmit";
import { SubmitButton } from "@/components/shop/account/form";
import { Badge } from "@/components/shop/ui/Badge";
import { Select, TextInput } from "@/components/shop/ui/Field";
import { cn } from "@/components/shop/ui/cn";
import { alertsCopy } from "@/components/shop/alerts/_copy";
import { pushUiCopy } from "@/components/shop/push/_copy";
import { deleteAccountAlertAction, updateAccountAlertAction } from "./actions";

export type AlertRowData = {
  id: string;
  name: string;
  frequency: "INSTANT" | "DAILY" | "WEEKLY";
  /** Delivered as web push (docs/push.md). */
  push: boolean;
  active: boolean;
  summary: string;
  href: string;
  lastNotified: string | null;
};

export function AlertRow({ alert, pushAvailable = false }: { alert: AlertRowData; pushAvailable?: boolean }) {
  const [state, action] = useActionState(updateAccountAlertAction, null);
  const f = alertsCopy.form;
  return (
    <li className={cn("rounded-shop border border-shop-line bg-shop-surface p-5 sm:p-6", !alert.active && "opacity-75")}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-shop-muted">{alert.summary}</p>
          {alert.lastNotified ? <p className="text-xs text-shop-muted">{alert.push ? "Last alert" : "Last email"}: {alert.lastNotified}</p> : null}
        </div>
        <div className="flex items-center gap-3">
          {!alert.active ? <Badge tone="neutral">Paused</Badge> : null}
          <Link href={alert.href} className="inline-flex min-h-11 items-center text-sm font-semibold text-shop-ink underline underline-offset-4 hover:text-shop-primary">
            View matches
          </Link>
        </div>
      </div>
      <form action={action} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
        <input type="hidden" name="id" value={alert.id} />
        <label className="grid gap-1.5 text-sm font-medium">
          {f.name}
          <TextInput name="name" defaultValue={alert.name} maxLength={120} required />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          {pushAvailable ? pushUiCopy.delivery.label : f.frequency}
          <Select name="frequency" defaultValue={alert.push ? "PUSH" : alert.frequency} className={pushAvailable ? "sm:w-60" : "sm:w-44"}>
            {pushAvailable ? <option value="PUSH">{pushUiCopy.delivery.push}</option> : null}
            {(["INSTANT", "DAILY", "WEEKLY"] as const).map((v) => (
              <option key={v} value={v}>
                {pushAvailable ? `E-mail: ${f.frequencies[v].charAt(0).toLowerCase()}${f.frequencies[v].slice(1)}` : f.frequencies[v]}
              </option>
            ))}
          </Select>
        </label>
        <SubmitButton variant="outline">Save</SubmitButton>
      </form>
      <div className="mt-2 flex flex-wrap items-center gap-x-5 text-sm">
        <form action={action}>
          <input type="hidden" name="id" value={alert.id} />
          <input type="hidden" name="op" value={alert.active ? "pause" : "resume"} />
          <button type="submit" className="inline-flex min-h-11 items-center font-semibold text-shop-ink underline underline-offset-4 hover:text-shop-primary">
            {alert.active ? "Pause" : "Resume"}
          </button>
        </form>
        <form action={deleteAccountAlertAction}>
          <input type="hidden" name="id" value={alert.id} />
          <ConfirmSubmit message="Delete this alert?" className="inline-flex min-h-11 items-center font-semibold text-shop-crit underline underline-offset-4">
            Delete
          </ConfirmSubmit>
        </form>
        {state?.message ? (
          <span role={state.ok ? "status" : "alert"} className={state.ok ? "text-shop-ok" : "text-shop-crit"}>
            {state.message}
          </span>
        ) : null}
      </div>
    </li>
  );
}
