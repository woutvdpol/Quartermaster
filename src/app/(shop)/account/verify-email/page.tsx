import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AuthPanel } from "@/components/shop/account/AuthPanel";
import { Alert } from "@/components/shop/account/form";
import { FormSkeleton } from "@/components/shop/account/FormSkeleton";
import { getShopCustomer } from "@/server/customer-auth/current";
import { getRequestTenant } from "@/server/tenant";
import { isEmailVerified } from "@/server/email-verification";
import { ResendForm, VerifyForm } from "./VerifyForms";
import { shopCopy } from "@/server/i18n/locale";
import { verifyCopies } from "./_copy";

// The token is in the URL: never index this page, never leak it via the Referer header.
export async function generateMetadata(): Promise<Metadata> {
  const t = await shopCopy(verifyCopies);
  return { title: t.title, robots: { index: false, follow: false }, referrer: "no-referrer" };
}

/**
 * /account/verify-email?token=… — shows a "Confirm" button (POST). Opening the link alone never
 * verifies (mail scanners prefetch links). Without a token, a signed-in unverified customer can
 * request a new mail.
 */
export default async function VerifyEmailPage({ searchParams }: PageProps<"/account/verify-email">) {
  const t = await shopCopy(verifyCopies);
  return (
    <AuthPanel title={t.title} intro={t.intro}>
      <Suspense fallback={<FormSkeleton />}>
        <VerifyContent searchParams={searchParams} />
      </Suspense>
    </AuthPanel>
  );
}

async function VerifyContent({ searchParams }: { searchParams: PageProps<"/account/verify-email">["searchParams"] }) {
  const tenant = await getRequestTenant();
  if (!tenant) notFound();
  const t = await shopCopy(verifyCopies);
  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw.slice(0, 200) : "";
  const me = await getShopCustomer();
  const verified = me ? await isEmailVerified(me.user.id) : false;
  const canResend = !!me && !verified;
  if (!token) {
    if (me && verified) return <Alert tone="success">{t.alreadyVerified}</Alert>;
    return (
      <div className="grid gap-4">
        <Alert tone="info">{t.missing}</Alert>
        <ResendForm canResend={canResend} />
      </div>
    );
  }
  return <VerifyForm token={token} canResend={canResend} />;
}
