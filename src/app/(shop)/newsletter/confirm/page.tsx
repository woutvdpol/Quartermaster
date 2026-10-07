import type { Metadata } from "next";
import { Suspense } from "react";
import { accountCopy } from "@/components/shop/account/_copy";
import { AuthPanel } from "@/components/shop/account/AuthPanel";
import { Alert, SubmitButton } from "@/components/shop/account/form";
import { FormSkeleton } from "@/components/shop/account/FormSkeleton";
import { confirmNewsletterAction } from "./actions";

const t = accountCopy.newsletter;

// The token is in the URL: keep it out of search engines and Referer headers.
export const metadata: Metadata = { title: t.confirmTitle, robots: { index: false, follow: false }, referrer: "no-referrer" };

/** Landing page of the confirmation mail link. Shows a button; nothing changes until it is pressed. */
export default function NewsletterConfirmPage({ searchParams }: PageProps<"/newsletter/confirm">) {
  return (
    <AuthPanel title={t.confirmTitle}>
      <Suspense fallback={<FormSkeleton fields={0} />}>
        <ConfirmContent searchParams={searchParams} />
      </Suspense>
    </AuthPanel>
  );
}

async function ConfirmContent({ searchParams }: { searchParams: PageProps<"/newsletter/confirm">["searchParams"] }) {
  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw.slice(0, 200) : "";
  if (!token) return <Alert tone="info">{t.missingToken}</Alert>;
  return (
    <form action={confirmNewsletterAction} className="grid gap-4">
      <p className="text-shop-ink-2">{t.confirmIntro}</p>
      <input type="hidden" name="token" value={token} />
      <SubmitButton pendingLabel={t.confirming} fullWidth>
        {t.confirmButton}
      </SubmitButton>
    </form>
  );
}
