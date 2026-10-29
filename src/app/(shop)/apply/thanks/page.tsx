import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSignupConfig } from "@/server/platform/signup";
import { getRequestScope } from "@/server/tenant";
import { PlatformCard, PlatformShell } from "../../_platform/PlatformShell";
import { platformCopy } from "../../_platform/_copy";
import { buttonClass, cardTitleClass } from "../../_platform/parts";
import { applyCopy } from "../_copy";

const t = applyCopy.thanks;

export const metadata: Metadata = { title: { absolute: `${t.metaTitle} — Quartermaster` }, robots: { index: false, follow: false } };

/** Confirmation after a sign-up (no personal data in the URL); text per sign-up mode. */
export default async function ApplyThanksPage() {
  if ((await getRequestScope()).kind !== "platform") notFound();
  const { signupMode } = await getSignupConfig();
  const mode = applyCopy.modes[signupMode].thanks;
  return (
    <PlatformShell cta={platformCopy.cta[signupMode].short()}>
      <PlatformCard labelledBy="thanks-title">
        <h1 id="thanks-title" className={cardTitleClass}>
          {mode.title}
        </h1>
        <div className="mt-4 grid gap-3 text-pf-ink-2">
          {mode.body.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
        <p className="mt-[22px] border-t border-pf-line-soft pt-5 text-[15px] text-pf-muted">{t.noMail}</p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link href="/" className={`${buttonClass.secondary} max-sm:w-full`}>
            {t.back}
          </Link>
        </div>
      </PlatformCard>
    </PlatformShell>
  );
}
