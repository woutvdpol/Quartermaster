import type { Metadata } from "next";
import { MIN_PASSWORD_LENGTH } from "@/server/auth/password";
import { getRequestTenant } from "@/server/tenant";
import { AuthCard } from "../login/AuthCard";
import { copy } from "./_copy";
import { InvalidLink, ResetPasswordForm } from "./ResetPasswordForm";

export const metadata: Metadata = {
  title: copy.title,
  referrer: "no-referrer",
};

/**
 * Public: `/admin/reset-password?token=…` from a reset mail or an owner invite (both are
 * PASSWORD_RESET tokens). The token is only checked on submit, by `resetPassword()`.
 */
export default async function ResetPasswordPage({
  searchParams,
}: PageProps<"/admin/reset-password">) {
  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw.trim() : "";
  const valid = token.length > 0 && token.length <= 200;
  const tenant = await getRequestTenant();
  return (
    <AuthCard
      title={copy.title}
      subtitle={tenant ? `${tenant.name} · ${copy.subtitle}` : copy.subtitle}
    >
      {valid ? (
        <ResetPasswordForm token={token} minLength={MIN_PASSWORD_LENGTH} />
      ) : (
        <InvalidLink />
      )}
    </AuthCard>
  );
}
