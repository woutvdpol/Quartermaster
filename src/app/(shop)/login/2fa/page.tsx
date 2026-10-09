import type { Metadata } from "next";
import { Suspense } from "react";
import { accountCopies } from "@/components/shop/account/_copy";
import { AuthPanel } from "@/components/shop/account/AuthPanel";
import { FormSkeleton } from "@/components/shop/account/FormSkeleton";
import { DEFAULT_AFTER_LOGIN, hasPendingCustomerTotp, safeShopRedirect } from "@/server/customer-auth";
import { localeHref, localeRedirect, shopCopy } from "@/server/i18n/locale";
import { TotpForm } from "./TotpForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = (await shopCopy(accountCopies)).twoFactor;
  return { title: t.title, robots: { index: false, follow: false } };
}

export default async function TwoFactorPage({ searchParams }: PageProps<"/login/2fa">) {
  const t = (await shopCopy(accountCopies)).twoFactor;
  return (
    <AuthPanel title={t.title} intro={t.intro}>
      <Suspense fallback={<FormSkeleton fields={1} />}>
        <TwoFactorContent searchParams={searchParams} />
      </Suspense>
    </AuthPanel>
  );
}

async function TwoFactorContent({ searchParams }: { searchParams: PageProps<"/login/2fa">["searchParams"] }) {
  const next = safeShopRedirect((await searchParams).next, await localeHref(DEFAULT_AFTER_LOGIN));
  if (!(await hasPendingCustomerTotp())) await localeRedirect("/login");
  return <TotpForm next={next} />;
}
