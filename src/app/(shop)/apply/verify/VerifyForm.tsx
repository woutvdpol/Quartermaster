"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { platformButtonClass } from "../../_platform/PlatformShell";
import { verifyApplicationAction, type VerifyState } from "../actions";
import { applyCopy } from "../_copy";

const t = applyCopy.verify;

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={platformButtonClass} disabled={pending}>
      {pending ? t.pending : t.button}
    </button>
  );
}

export function VerifyForm({ token }: { token: string }) {
  const [state, formAction] = useActionState<VerifyState, FormData>(verifyApplicationAction, null);
  if (state?.status === "verified" || state?.status === "already_verified") {
    return (
      <p role="status" className="text-[15px] text-[#2F6B3A]">
        {t[state.status]}
      </p>
    );
  }
  if (state?.status === "invalid") {
    return (
      <div role="alert" className="grid gap-3 text-[15px]">
        <p className="font-medium">{t.invalidTitle}</p>
        <p className="text-[#33352c]">{t.invalidBody}</p>
        <Link href="/apply" className="text-sm font-medium text-[#7E5416] underline-offset-2 hover:underline">
          {t.applyAgain}
        </Link>
      </div>
    );
  }
  return (
    <form action={formAction} className="grid gap-4">
      <p className="text-[15px] text-[#33352c]">{t.body}</p>
      {state ? (
        <p role="alert" className="text-sm text-[#a23a2a]">
          {t[state.status]}
        </p>
      ) : null}
      <input type="hidden" name="token" value={token} />
      <div>
        <Submit />
      </div>
    </form>
  );
}
