import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { accountCopy } from "@/components/shop/account/_copy";
import { AuthPanel } from "@/components/shop/account/AuthPanel";
import { FormSkeleton } from "@/components/shop/account/FormSkeleton";
import { MIN_PASSWORD_LENGTH } from "@/server/auth/password";
import { getShopCustomer, safeShopRedirect } from "@/server/customer-auth";
import { getRequestTenant } from "@/server/tenant";
import { RegisterForm } from "./RegisterForm";

const t = accountCopy.register;

export const metadata: Metadata = { title: t.title, robots: { index: false, follow: true } };

export default function RegisterPage({ searchParams }: PageProps<"/register">) {
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
  const next = safeShopRedirect((await searchParams).next);
  if (!(await getRequestTenant())) notFound();
  if (await getShopCustomer()) redirect(next);
  return <RegisterForm next={next} minPasswordLength={MIN_PASSWORD_LENGTH} />;
}
