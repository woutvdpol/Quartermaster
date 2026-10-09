import type { Metadata } from "next";
import Link from "@/components/shop/ui/Link";
import { Suspense } from "react";
import { accountCopies } from "@/components/shop/account/_copy";
import { shopCopy } from "@/server/i18n/locale";
import { AuthPanel } from "@/components/shop/account/AuthPanel";
import { Alert } from "@/components/shop/account/form";
import { FormSkeleton } from "@/components/shop/account/FormSkeleton";
import { MIN_PASSWORD_LENGTH } from "@/server/auth/password";
import { ResetForm } from "./ResetForm";

// The token is in the URL: never index this page, never leak it via the Referer header.
export async function generateMetadata(): Promise<Metadata> {
  const t = (await shopCopy(accountCopies)).reset;
  return { title: t.title, robots: { index: false, follow: false }, referrer: "no-referrer" };
}

export default async function ResetPasswordPage({ searchParams }: PageProps<"/account/reset-password">) {
  const t = (await shopCopy(accountCopies)).reset;
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
    const t = (await shopCopy(accountCopies)).reset;
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
