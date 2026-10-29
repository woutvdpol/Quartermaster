import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSignupConfig } from "@/server/platform/signup";
import { getRequestScope } from "@/server/tenant";
import { PlatformCard, PlatformShell } from "../../_platform/PlatformShell";
import { platformCopy } from "../../_platform/_copy";
import { buttonClass, cardTitleClass } from "../../_platform/parts";
import { applyCopy } from "../_copy";
import { VerifyForm } from "./VerifyForm";

const t = applyCopy.verify;

export const metadata: Metadata = { title: { absolute: "Confirm your email — Quartermaster" }, robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * `/apply/verify?token=…` from the application mail. Shows a button; only the POST verifies (mail
 * scanners and link previews follow GET links). The token is checked by the action.
 */
export default async function ApplyVerifyPage({ searchParams }: PageProps<"/apply/verify">) {
  if ((await getRequestScope()).kind !== "platform") notFound();
  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw.trim() : "";
  const plausible = token.length > 0 && token.length <= 200 && token.split(".").length === 3;
  const { signupMode } = await getSignupConfig();
  const mode = applyCopy.modes[signupMode];
  return (
    <PlatformShell cta={platformCopy.cta[signupMode].short()}>
      <PlatformCard labelledBy="verify-title">
        {plausible ? (
          <VerifyForm token={token} body={mode.verifyBody} button={mode.verifyButton} />
        ) : (
          <>
            <h1 id="verify-title" className={cardTitleClass}>
              {t.invalidTitle}
            </h1>
            <p className="mt-4 text-pf-ink-2">{t.invalidBody}</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/apply#apply-form" className={`${buttonClass.primary} max-sm:w-full`}>
                {t.applyAgain}
              </Link>
            </div>
          </>
        )}
      </PlatformCard>
    </PlatformShell>
  );
}
