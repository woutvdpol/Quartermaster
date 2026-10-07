import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { accountCopy } from "@/components/shop/account/_copy";
import { AuthPanel } from "@/components/shop/account/AuthPanel";
import { Alert } from "@/components/shop/account/form";
import { FormSkeleton } from "@/components/shop/account/FormSkeleton";
import { getShopCustomer, safeShopRedirect } from "@/server/customer-auth";
import { getRequestTenant } from "@/server/tenant";
import { LoginForm } from "./LoginForm";

const t = accountCopy.login;

export const metadata: Metadata = { title: t.title, robots: { index: false, follow: true } };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <AuthPanel
      title={t.title}
      intro={t.intro}
      footer={
        <>
          {t.noAccount}{" "}
          <Link href="/register" className="font-medium text-shop-primary underline-offset-4 hover:underline">
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
  const next = safeShopRedirect(sp.next);
  if (await getShopCustomer()) redirect(next);
  return (
    <div className="grid gap-4">
      {sp.reset === "1" ? <Alert tone="success">{t.resetDone}</Alert> : null}
      {sp.deleted === "1" ? <Alert tone="info">{t.deleted}</Alert> : null}
      <LoginForm next={next} />
    </div>
  );
}
