import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeAdminRedirect } from "@/lib/admin-nav";
import { getDictionary } from "@/lib/i18n";
import { currentSession } from "@/server/auth/guards";
import { AuthCard } from "../AuthCard";
import { TotpForm } from "./TotpForm";

const t = getDictionary().twoFactor;

export const metadata: Metadata = { title: t.title };

export default async function TwoFactorPage({ searchParams }: PageProps<"/admin/login/2fa">) {
  const next = safeAdminRedirect((await searchParams).next);
  const session = await currentSession();
  if (!session) redirect("/admin/login");
  if (!session.pendingTotp) redirect(next);

  return (
    <AuthCard title={t.title} subtitle={t.subtitle}>
      <TotpForm next={next} />
    </AuthCard>
  );
}
