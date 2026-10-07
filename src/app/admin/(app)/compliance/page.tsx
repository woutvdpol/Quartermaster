import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Card, DataTable, EmptyState, PageHeader, StatusPill, buttonClasses, getParam, hrefWith, type Column, type SearchParamsRecord } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { listCategoryTree } from "@/server/catalog/categories";
import { ACTION_LABELS, MATCH_LABELS, listComplianceRules, type ComplianceRuleRow } from "@/server/compliance";
import { getSettings } from "@/server/settings";
import { countryName } from "@/server/shipping/countries";
import { flattenCategories } from "../inventory/_data";
import { copy } from "./_copy";
import { RuleDrawer } from "./_components/RuleDrawer";
import { TestBox } from "./_components/TestBox";

export const metadata: Metadata = { title: copy.title };

const BASE = "/admin/compliance";
const MAX_CODES = 6;
const ACTION_TONE = { HIDE_PRODUCT: "crit", BLUR_IMAGES: "warn", NO_SHIPPING: "info" } as const;

export default async function CompliancePage({ searchParams }: PageProps<"/admin/compliance">) {
  const sp = (await searchParams) as SearchParamsRecord;
  const ctx = await requireStaffContext();
  const [rules, tree, general] = await Promise.all([listComplianceRules(ctx), listCategoryTree(ctx), getSettings(ctx.tenantId, "general")]);
  const categories = flattenCategories(tree).map((c) => ({ value: c.id, label: c.path }));

  let drawer: ReactNode = null;
  const editId = getParam(sp, "edit");
  if (getParam(sp, "new") === "1") {
    drawer = (
      <RuleDrawer
        initial={{ name: "", match: "RESTRICTED_SYMBOLS", categoryId: null, countries: [], action: "HIDE_PRODUCT", note: "", isActive: true }}
        categories={categories}
        closeHref={BASE}
      />
    );
  } else if (editId) {
    const rule = rules.find((x) => x.id === editId);
    if (rule) {
      drawer = (
        <RuleDrawer
          key={rule.id}
          initial={{ id: rule.id, name: rule.name, match: rule.match, categoryId: rule.categoryId, countries: rule.countries, action: rule.action, note: rule.note ?? "", isActive: rule.isActive }}
          categories={categories}
          closeHref={BASE}
        />
      );
    }
  }

  const columns: Column<ComplianceRuleRow>[] = [
    {
      key: "name",
      header: copy.list.name,
      cell: (rule) => (
        <div className="grid">
          <Link href={hrefWith(BASE, {}, { edit: rule.id })} scroll={false} className="font-medium text-ink hover:underline" aria-label={copy.list.editLabel(rule.name)}>
            {rule.name}
          </Link>
          {rule.note && <span className="text-xs text-muted">{rule.note}</span>}
        </div>
      ),
    },
    {
      key: "match",
      header: copy.list.match,
      hideBelow: "md",
      cell: (rule) => (rule.match === "CATEGORY" ? `${MATCH_LABELS.CATEGORY.replace(/ \(.*\)$/, "")}: ${rule.category?.title ?? "—"}` : MATCH_LABELS[rule.match]),
    },
    {
      key: "countries",
      header: copy.list.countries,
      cell: (rule) => (
        <span className="font-mono text-xs" title={rule.countries.map(countryName).join(", ")}>
          {rule.countries.slice(0, MAX_CODES).join(" ")}
          {rule.countries.length > MAX_CODES && <span className="text-muted"> {copy.list.more(rule.countries.length - MAX_CODES)}</span>}
        </span>
      ),
    },
    { key: "action", header: copy.list.action, cell: (rule) => <StatusPill tone={ACTION_TONE[rule.action]}>{ACTION_LABELS[rule.action]}</StatusPill> },
    {
      key: "status",
      header: copy.list.status,
      hideBelow: "sm",
      cell: (rule) => (rule.isActive ? <StatusPill tone="ok">{copy.list.active}</StatusPill> : <StatusPill tone="mute">{copy.list.inactive}</StatusPill>),
    },
  ];

  const newHref = hrefWith(BASE, {}, { new: 1 });
  return (
    <>
      <PageHeader
        crumb={copy.crumb}
        title={copy.title}
        actions={
          <Link href={newHref} scroll={false} className={buttonClasses({ variant: "primary" })}>
            <span aria-hidden="true">+</span> {copy.list.new}
          </Link>
        }
      />
      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 content-start gap-3">
          <p className="max-w-3xl text-sm text-muted">{copy.intro}</p>
          <DataTable
            caption={copy.list.caption}
            columns={columns}
            rows={rules}
            rowKey={(rule) => rule.id}
            rowLabel={(rule) => rule.name}
            empty={
              <EmptyState
                compact
                title={copy.list.emptyTitle}
                body={copy.list.emptyBody}
                action={
                  <Link href={newHref} scroll={false} className={buttonClasses({ variant: "primary" })}>
                    {copy.list.new}
                  </Link>
                }
              />
            }
          />
        </div>
        <div className="min-w-0">
          <Card title={copy.test.heading}>
            <TestBox defaultCountry={general.address.country || "DE"} />
          </Card>
        </div>
      </div>
      {drawer}
    </>
  );
}
