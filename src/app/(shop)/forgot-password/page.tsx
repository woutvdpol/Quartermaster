import type { Metadata } from "next";
import Link from "next/link";
import { accountCopy } from "@/components/shop/account/_copy";
import { AuthPanel } from "@/components/shop/account/AuthPanel";
import { ForgotForm } from "./ForgotForm";

const t = accountCopy.forgot;

export const metadata: Metadata = { title: t.title, robots: { index: false, follow: true } };

export default function ForgotPasswordPage() {
  return (
    <AuthPanel
      title={t.title}
      intro={t.intro}
      footer={
        <Link href="/login" className="font-medium text-shop-primary underline-offset-4 hover:underline">
          {t.back}
        </Link>
      }
    >
      <ForgotForm />
    </AuthPanel>
  );
}
