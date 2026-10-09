import type { Metadata } from "next";
import Link from "@/components/shop/ui/Link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { accountCopies } from "@/components/shop/account/_copy";
import { AuthPanel } from "@/components/shop/account/AuthPanel";
import { Alert } from "@/components/shop/account/form";
import { FormSkeleton } from "@/components/shop/account/FormSkeleton";
import { DEFAULT_AFTER_LOGIN, getShopCustomer, safeShopRedirect } from "@/server/customer-auth";
import { localeHref, shopCopy } from "@/server/i18n/locale";
import { getRequestTenant } from "@/server/tenant";
import { LoginForm } from "./LoginForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = (await shopCopy(accountCopies)).login;
  return { title: t.title, robots: { index: false, follow: true } };
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const t = (await shopCopy(accountCopies)).login;
  return (
    <AuthPanel
      title={t.title}
      intro={t.intro}
      footer={
        <>
          {t.noAccount}{" "}
          <Link href="/register" className="font-semibold text-shop-ink underline underline-offset-4 hover:text-shop-primary">
            {t.createAccount}
          </Link>
        </>
      }
    >
      <Suspense fallback={<FormSkeleton />}>
        <LoginContent searchParams={searchParams} />
      </Suspense>
    </AuthPanel>
  );
}

async function LoginContent({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const sp = await searchParams;
  if (!(await getRequestTenant())) notFound();
  const t = (await shopCopy(accountCopies)).login;
  // `next` already carries its language prefix; the fallback is the account page in this language.
  const next = safeShopRedirect(sp.next, await localeHref(DEFAULT_AFTER_LOGIN));
  if (await getShopCustomer()) redirect(next);
  return (
    <div className="grid gap-4">
      {sp.reset === "1" ? <Alert tone="success">{t.resetDone}</Alert> : null}
      {sp.deleted === "1" ? <Alert tone="info">{t.deleted}</Alert> : null}
      <LoginForm next={next} />
    </div>
  );
}
