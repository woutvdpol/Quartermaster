import type { Metadata } from "next";
import Link from "@/components/shop/ui/Link";
import { accountCopies } from "@/components/shop/account/_copy";
import { shopCopy } from "@/server/i18n/locale";
import { AuthPanel } from "@/components/shop/account/AuthPanel";
import { ForgotForm } from "./ForgotForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = (await shopCopy(accountCopies)).forgot;
  return { title: t.title, robots: { index: false, follow: true } };
}

export default async function ForgotPasswordPage() {
  const t = (await shopCopy(accountCopies)).forgot;
  return (
    <AuthPanel
      title={t.title}
      intro={t.intro}
      footer={
        <Link href="/login" className="font-semibold text-shop-ink underline underline-offset-4 hover:text-shop-primary">
          {t.back}
        </Link>
      }
    >
      <ForgotForm />
    </AuthPanel>
  );
}
