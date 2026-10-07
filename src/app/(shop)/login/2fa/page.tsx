import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { accountCopy } from "@/components/shop/account/_copy";
import { AuthPanel } from "@/components/shop/account/AuthPanel";
import { FormSkeleton } from "@/components/shop/account/FormSkeleton";
import { hasPendingCustomerTotp, safeShopRedirect } from "@/server/customer-auth";
import { TotpForm } from "./TotpForm";

const t = accountCopy.twoFactor;

export const metadata: Metadata = { title: t.title, robots: { index: false, follow: false } };

export default function TwoFactorPage({ searchParams }: PageProps<"/login/2fa">) {
  return (
    <AuthPanel title={t.title} intro={t.intro}>
      <Suspense fallback={<FormSkeleton fields={1} />}>
        <TwoFactorContent searchParams={searchParams} />
      </Suspense>
    </AuthPanel>
  );
}

async function TwoFactorContent({ searchParams }: { searchParams: PageProps<"/login/2fa">["searchParams"] }) {
  const next = safeShopRedirect((await searchParams).next);
  if (!(await hasPendingCustomerTotp())) redirect("/login");
  return <TotpForm next={next} />;
}
