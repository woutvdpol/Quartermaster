import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getRequestScope } from "@/server/tenant";
import { PlatformCard, PlatformShell } from "../../_platform/PlatformShell";
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
  return (
    <PlatformShell>
      <div className="mx-auto max-w-xl px-4 py-14 sm:px-6">
        <PlatformCard title={plausible ? t.title : t.invalidTitle}>
          {plausible ? (
            <VerifyForm token={token} />
          ) : (
            <div className="grid gap-3 text-[15px]">
              <p className="text-[#33352c]">{t.invalidBody}</p>
              <Link href="/apply" className="text-sm font-medium text-[#7E5416] underline-offset-2 hover:underline">
                {t.applyAgain}
              </Link>
            </div>
          )}
        </PlatformCard>
      </div>
    </PlatformShell>
  );
}
