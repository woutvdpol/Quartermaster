import type { Metadata } from "next";
import { getRequestTenant } from "@/server/tenant";
import { AuthCard } from "../login/AuthCard";
import { copy } from "./_copy";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata: Metadata = { title: copy.title };

/** Public: request a password-reset link for an admin (OWNER/SUPERADMIN) account. */
export default async function ForgotPasswordPage() {
  const tenant = await getRequestTenant();
  return (
    <AuthCard
      title={copy.title}
      subtitle={tenant ? `${tenant.name} · ${copy.subtitle}` : copy.subtitle}
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
