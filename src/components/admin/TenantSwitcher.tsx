"use client";

import { selectTenantAction } from "@/app/admin/(app)/actions";
import { getDictionary } from "@/lib/i18n";

type TenantOption = { id: string; name: string; status: string };

type TenantSwitcherProps = {
  /** Shops a SUPERADMIN may switch between. Empty for an OWNER, who sees their shop name only. */
  tenants: TenantOption[];
  activeId: string | null;
  activeName: string | null;
};

const t = getDictionary().tenant;

export function TenantSwitcher({ tenants, activeId, activeName }: TenantSwitcherProps) {
  if (tenants.length === 0) {
    return (
      <div className="rounded-control bg-rail-raised px-2.5 py-2">
        <p className="type-label text-[10px] text-rail-muted">{t.label}</p>
        <p className="truncate text-[13.5px] font-semibold">{activeName ?? t.none}</p>
      </div>
    );
  }

  return (
    <form key={activeId} action={selectTenantAction} className="rounded-control bg-rail-raised px-2.5 py-2">
      <label htmlFor="qm-tenant" className="type-label block text-[10px] text-rail-muted">
        {t.switchLabel} · {t.count(tenants.length)}
      </label>
      <select
        id="qm-tenant"
        name="tenantId"
        defaultValue={activeId ?? undefined}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="mt-0.5 w-full cursor-pointer truncate rounded-[3px] border-0 bg-transparent p-0 text-[13.5px] font-semibold text-rail-ink [&>option]:bg-panel [&>option]:text-ink"
      >
        {tenants.map((tenant) => (
          <option key={tenant.id} value={tenant.id}>
            {tenant.name}
            {tenant.status !== "ACTIVE" ? ` (${t.inactive})` : ""}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="mt-1 text-xs underline">
          {t.switchSubmit}
        </button>
      </noscript>
    </form>
  );
}
