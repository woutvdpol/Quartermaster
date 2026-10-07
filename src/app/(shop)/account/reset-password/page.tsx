import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { accountCopy } from "@/components/shop/account/_copy";
import { AuthPanel } from "@/components/shop/account/AuthPanel";
import { Alert } from "@/components/shop/account/form";
import { FormSkeleton } from "@/components/shop/account/FormSkeleton";
import { MIN_PASSWORD_LENGTH } from "@/server/auth/password";
import { ResetForm } from "./ResetForm";

const t = accountCopy.reset;

// The token is in the URL: never index this page, never leak it via the Referer header.
export const metadata: Metadata = { title: t.title, robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function ResetPasswordPage({ searchParams }: PageProps<"/account/reset-password">) {
  return (
    <AuthPanel title={t.title}>
      <Suspense fallback={<FormSkeleton />}>
        <ResetContent searchParams={searchParams} />
      </Suspense>
    </AuthPanel>
  );
}

async function ResetContent({ searchParams }: { searchParams: PageProps<"/account/reset-password">["searchParams"] }) {
  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw.slice(0, 200) : "";
  if (!token) {
    return (
      <div className="grid gap-4">
        <Alert tone="info">{t.missingToken}</Alert>
        <Link href="/forgot-password" className="text-sm font-medium text-shop-primary underline-offset-4 hover:underline">
          {t.requestNew}
        </Link>
      </div>
    );
  }
  return <ResetForm token={token} minPasswordLength={MIN_PASSWORD_LENGTH} />;
}
