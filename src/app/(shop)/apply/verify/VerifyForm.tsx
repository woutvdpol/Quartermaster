"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { cn } from "@/components/shop/ui/cn";
import { buttonClass, cardTitleClass } from "../../_platform/parts";
import { AlertIcon, CheckIcon } from "../../_platform/icons";
import { verifyApplicationAction, type VerifyState } from "../actions";
import { applyCopy } from "../_copy";

const t = applyCopy.verify;

const DONE = ["verified", "waitlisted", "already_verified", "already_created"] as const;
type Done = (typeof DONE)[number];
const isDone = (s: VerifyState): s is { status: Done } => !!s && (DONE as readonly string[]).includes(s.status);

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={cn(buttonClass.primary, "disabled:cursor-progress max-sm:w-full")} disabled={pending} aria-disabled={pending}>
      {pending ? (
        <>
          <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-white/35 border-t-white motion-reduce:animate-none" />
          {t.pending}
        </>
      ) : (
        label
      )}
    </button>
  );
}

/** The verify card's content: the confirm step, then the outcome under a title of its own (focus moves there). */
export function VerifyForm({ token, body, button }: { token: string; body: string; button: string }) {
  const [state, formAction] = useActionState<VerifyState, FormData>(verifyApplicationAction, null);
  const title = useRef<HTMLHeadingElement>(null);
  const outcome = isDone(state) || state?.status === "invalid" ? state.status : null;

  useEffect(() => {
    if (outcome) title.current?.focus();
  }, [outcome]);

  if (isDone(state)) {
    const o = t[state.status];
    return (
      <>
        <h1 id="verify-title" ref={title} tabIndex={-1} className={cn(cardTitleClass, "flex items-start gap-3")}>
          <CheckIcon className="mt-0.5 size-7 flex-none text-pf-ok" />
          <span>{o.title}</span>
        </h1>
        <p role="status" className="mt-4 text-pf-ink-2">
          {o.body}
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link href="/" className={cn(buttonClass.secondary, "max-sm:w-full")}>
            {applyCopy.thanks.back}
          </Link>
        </div>
      </>
    );
  }
  if (state?.status === "invalid") {
    return (
      <>
        <h1 id="verify-title" ref={title} tabIndex={-1} className={cardTitleClass}>
          {t.invalidTitle}
        </h1>
        <p className="mt-4 text-pf-ink-2">{t.invalidBody}</p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link href="/apply#apply-form" className={cn(buttonClass.primary, "max-sm:w-full")}>
            {t.applyAgain}
          </Link>
        </div>
      </>
    );
  }
  return (
    <>
      <h1 id="verify-title" className={cardTitleClass}>
        {t.title}
      </h1>
      <form action={formAction}>
        <p className="mt-4 text-pf-ink-2">{body}</p>
        {state ? (
          <p role="alert" className="mt-5 flex gap-2 rounded-lg bg-pf-crit-soft px-3.5 py-3 text-[15px] leading-[1.45] font-medium text-pf-crit">
            <AlertIcon className="mt-0.5 size-[18px] flex-none" />
            <span>{state.status === "rate_limited" ? t.rate_limited : t.error}</span>
          </p>
        ) : null}
        <input type="hidden" name="token" value={token} />
        <div className="mt-7 flex flex-wrap gap-3">
          <Submit label={button} />
        </div>
      </form>
    </>
  );
}
