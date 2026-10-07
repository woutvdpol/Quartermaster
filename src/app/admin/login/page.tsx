import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeAdminRedirect } from "@/lib/admin-nav";
import { getDictionary } from "@/lib/i18n";
import { currentUser } from "@/server/auth/guards";
import { getRequestTenant } from "@/server/tenant";
import { AuthCard } from "./AuthCard";
import { LoginForm } from "./LoginForm";

const t = getDictionary().login;

export const metadata: Metadata = { title: t.title };

export default async function LoginPage({ searchParams }: PageProps<"/admin/login">) {
  const next = safeAdminRedirect((await searchParams).next);
  const user = await currentUser();
  if (user && user.role !== "CUSTOMER") redirect(next);
  const tenant = await getRequestTenant();

  return (
    <AuthCard title={t.title} subtitle={tenant ? `${tenant.name} · ${t.subtitle}` : t.subtitlePlatform}>
      <LoginForm next={next} />
    </AuthCard>
  );
}
