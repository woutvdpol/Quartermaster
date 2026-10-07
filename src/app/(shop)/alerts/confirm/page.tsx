import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthPanel } from "@/components/shop/account/AuthPanel";
import { Alert, SubmitButton } from "@/components/shop/account/form";
import { FormSkeleton } from "@/components/shop/account/FormSkeleton";
import { alertPagesCopy as t } from "../_copy";
import { confirmAlertAction } from "./actions";

// The token is in the URL: keep it out of search engines and Referer headers.
export const metadata: Metadata = { title: t.confirmTitle, robots: { index: false, follow: false }, referrer: "no-referrer" };

/** Landing page of the confirmation mail. Shows a button; nothing changes until it is pressed (POST). */
export default function AlertConfirmPage({ searchParams }: PageProps<"/alerts/confirm">) {
  return (
    <AuthPanel title={t.confirmTitle}>
      <Suspense fallback={<FormSkeleton fields={0} />}>
        <ConfirmContent searchParams={searchParams} />
      </Suspense>
    </AuthPanel>
  );
}

async function ConfirmContent({ searchParams }: { searchParams: PageProps<"/alerts/confirm">["searchParams"] }) {
  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw.slice(0, 200) : "";
  if (!token) return <Alert tone="info">{t.missingToken}</Alert>;
  return (
    <form action={confirmAlertAction} className="grid gap-4">
      <p className="text-shop-ink-2">{t.confirmIntro}</p>
      <input type="hidden" name="token" value={token} />
      <SubmitButton pendingLabel={t.confirming} fullWidth>
        {t.confirmButton}
      </SubmitButton>
    </form>
  );
}
