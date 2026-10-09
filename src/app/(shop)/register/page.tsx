import type { Metadata } from "next";
import Link from "@/components/shop/ui/Link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { accountCopies } from "@/components/shop/account/_copy";
import { AuthPanel } from "@/components/shop/account/AuthPanel";
import { FormSkeleton } from "@/components/shop/account/FormSkeleton";
import { MIN_PASSWORD_LENGTH } from "@/server/auth/password";
import { DEFAULT_AFTER_LOGIN, getShopCustomer, safeShopRedirect } from "@/server/customer-auth";
import { localeHref, shopCopy } from "@/server/i18n/locale";
import { getRequestTenant } from "@/server/tenant";
import { RegisterForm } from "./RegisterForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = (await shopCopy(accountCopies)).register;
  return { title: t.title, robots: { index: false, follow: true } };
}

export default async function RegisterPage({ searchParams }: PageProps<"/register">) {
  const t = (await shopCopy(accountCopies)).register;
  return (
    <AuthPanel
      title={t.title}
      intro={t.intro}
      footer={
        <>
          {t.haveAccount}{" "}
          <Link href="/login" className="font-semibold text-shop-ink underline underline-offset-4 hover:text-shop-primary">
            {t.login}
          </Link>
        </>
      }
    >
      <Suspense fallback={<FormSkeleton fields={3} />}>
        <RegisterContent searchParams={searchParams} />
      </Suspense>
    </AuthPanel>
  );
}

async function RegisterContent({ searchParams }: { searchParams: PageProps<"/register">["searchParams"] }) {
  const next = safeShopRedirect((await searchParams).next, await localeHref(DEFAULT_AFTER_LOGIN));
  if (!(await getRequestTenant())) notFound();
  if (await getShopCustomer()) redirect(next);
  return <RegisterForm next={next} minPasswordLength={MIN_PASSWORD_LENGTH} />;
}
