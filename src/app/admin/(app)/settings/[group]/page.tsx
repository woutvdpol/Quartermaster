import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, Card, KeyValue, PageHeader } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { getSettings, isSettingsGroup, PLATFORM_ONLY_GROUPS } from "@/server/settings";
import { getTenantInfo } from "../../_system/tenant";
import { saveSettingsAction } from "../actions";
import { SETTINGS_FORMS } from "../_fields";
import { SettingsForm } from "../_components/SettingsForm";
import { SettingsNav } from "../_components/SettingsNav";

export async function generateMetadata({ params }: PageProps<"/admin/settings/[group]">): Promise<Metadata> {
  const { group } = await params;
  return { title: isSettingsGroup(group) ? `${SETTINGS_FORMS[group].label} settings` : "Settings" };
}

export default async function SettingsGroupPage({ params }: PageProps<"/admin/settings/[group]">) {
  const { group } = await params;
  const ctx = await requireStaffContext();
  const isSuper = ctx.actor.role === "SUPERADMIN";
  if (!isSettingsGroup(group) || (PLATFORM_ONLY_GROUPS.has(group) && !isSuper)) notFound();

  const [values, tenant] = await Promise.all([getSettings(ctx.tenantId, group), getTenantInfo(ctx.tenantId)]);
  const meta = SETTINGS_FORMS[group];
  const formId = `settings-${group}`;

  const before =
    group === "general" ? (
      <Card
        title="Shop basics"
        aside={
          isSuper ? (
            <Link href={`/admin/platform/${tenant.id}`} className="text-accent underline-offset-2 hover:underline">
              Edit on platform page
            </Link>
          ) : (
            "Set by Quartermaster"
          )
        }
      >
        <KeyValue
          items={[
            { label: "Shop currency", value: tenant.currency, mono: true },
            { label: "Time zone", value: tenant.timezone, mono: true },
            { label: "Primary domain", value: tenant.primaryHost ?? "—", mono: true },
          ]}
        />
        <p className="mt-2 text-xs text-muted">
          Prices, checkout and payments always use the shop currency. Dates in the admin are shown in this time zone.
          {!isSuper && " Contact Quartermaster support to change these."}
        </p>
      </Card>
    ) : undefined;

  return (
    <>
      <PageHeader
        crumb="System · Settings"
        title={meta.label}
        actions={
          <Button type="submit" form={formId} variant="primary">
            Save
          </Button>
        }
      />
      <div className="grid content-start gap-4 p-4 md:grid-cols-[200px_minmax(0,1fr)] md:px-[22px] md:py-5">
        <SettingsNav active={group} showPlatform={isSuper} />
        <div className="grid min-w-0 content-start gap-3">
          <p className="text-[13px] text-muted">{meta.description}</p>
          <SettingsForm
            key={group}
            formId={formId}
            sections={meta.sections}
            values={values}
            currency={tenant.currency}
            action={saveSettingsAction.bind(null, group)}
            before={before}
          />
        </div>
      </div>
    </>
  );
}
