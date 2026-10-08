import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getRequestScope } from "@/server/tenant";
import { PlatformCard, PlatformShell } from "../../_platform/PlatformShell";
import { applyCopy } from "../_copy";

const t = applyCopy.thanks;

export const metadata: Metadata = { title: { absolute: "Application received — Quartermaster" }, robots: { index: false, follow: false } };

/** Confirmation after a sign-up (no personal data in the URL). */
export default async function ApplyThanksPage() {
  if ((await getRequestScope()).kind !== "platform") notFound();
  return (
    <PlatformShell>
      <div className="mx-auto max-w-xl px-4 py-14 sm:px-6">
        <PlatformCard title={t.title}>
          <div className="grid gap-3 text-[15px] text-[#33352c]">
            {t.body.map((p) => (
              <p key={p}>{p}</p>
            ))}
            <p className="text-sm text-[#666A5A]">{t.noMail}</p>
            <p className="pt-2">
              <Link href="/" className="text-sm font-medium text-[#7E5416] underline-offset-2 hover:underline">
                {t.back}
              </Link>
            </p>
          </div>
        </PlatformCard>
      </div>
    </PlatformShell>
  );
}
