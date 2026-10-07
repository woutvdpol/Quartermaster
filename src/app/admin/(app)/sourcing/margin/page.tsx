import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import {
  Card,
  DateInput,
  EmptyState,
  InlineAlert,
  Money,
  PageHeader,
  Select,
  buttonClasses,
  cx,
  getParam,
  tdClass,
  thClass,
  type SearchParamsRecord,
} from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { marginReport, type MarginRow } from "@/server/purchasing";
import { copy } from "../_copy";
import { requireTenantDisplay } from "@/server/tenant-display";
import { addDays, isYmd, startOfLocalDay, todayIn } from "../_lib/time";
import { SourcingTabs } from "../_components/SourcingTabs";

export const metadata: Metadata = { title: `${copy.margin.title} · ${copy.title}` };

const GROUPS = ["category", "supplier", "month"] as const;
type Group = (typeof GROUPS)[number];

function parseRange(sp: SearchParamsRecord, today: string) {
  const defFrom = `${today.slice(0, 4)}-01-01`;
  const rawFrom = getParam(sp, "from");
  const rawTo = getParam(sp, "to");
  let from = isYmd(rawFrom) ? rawFrom : defFrom;
  let to = isYmd(rawTo) ? rawTo : today;
  let invalid = false;
  if (to < from) {
    invalid = true;
    from = defFrom;
    to = today;
  }
  const g = getParam(sp, "group");
  const group: Group = (GROUPS as readonly string[]).includes(g ?? "") ? (g as Group) : "category";
  return { from, to, group, invalid };
}

const ymdLong = (ymd: string) =>
  new Intl.DateTimeFormat("en-NL", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${ymd}T00:00:00Z`));
const monthLabel = (ym: string) =>
  /^\d{4}-\d{2}$/.test(ym)
    ? new Intl.DateTimeFormat("en-NL", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${ym}-01T00:00:00Z`))
    : ym;
const pctText = (p: number | null) => (p == null ? copy.margin.noCost : `${p.toLocaleString("en-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);

export default async function MarginReportPage({ searchParams }: PageProps<"/admin/sourcing/margin">) {
  const sp = await searchParams;
  const ctx = await requireStaffContext();
  const fmt = await requireTenantDisplay(ctx.tenantId);
  const today = todayIn(fmt.timeZone);
  const { from, to, group, invalid } = parseRange(sp, today);

  const report = await marginReport(ctx, {
    from: startOfLocalDay(from, fmt.timeZone),
    to: startOfLocalDay(addDays(to, 1), fmt.timeZone),
    groupBy: group,
  });
  const cur = report.currency;
  const t = report.totals;

  const label = (r: MarginRow) => {
    if (group === "month") return monthLabel(r.label);
    if (group === "supplier" && r.key)
      return (
        <Link href={`/admin/sourcing?supplier=${r.key}`} className="hover:underline">
          {r.label}
        </Link>
      );
    return r.label;
  };

  const num = cx(tdClass, "text-right font-mono tabular-nums");
  const numTh = cx(thClass, "text-right");

  return (
    <>
      <PageHeader crumb={copy.crumb} title={copy.title} />
      <SourcingTabs active="margin" />
      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5">
        <Form action="/admin/sourcing/margin" className="flex flex-wrap items-end gap-3 rounded-card border border-line bg-panel p-3.5">
          <DateInput label={copy.margin.from} name="from" defaultValue={from} max={today} className="w-44" />
          <DateInput label={copy.margin.to} name="to" defaultValue={to} max={today} className="w-44" />
          <Select
            label={copy.margin.groupBy}
            name="group"
            defaultValue={group}
            className="w-44"
            options={GROUPS.map((g) => ({ value: g, label: copy.margin.groups[g] }))}
          />
          <button type="submit" className={buttonClasses({ variant: "primary" })}>
            {copy.margin.apply}
          </button>
          <p className="basis-full text-xs text-muted">{copy.margin.explain}</p>
        </Form>

        {invalid && (
          <InlineAlert tone="warn" live="status">
            {copy.margin.invalidRange}
          </InlineAlert>
        )}

        {t.linesMissingCost > 0 && (
          <InlineAlert
            tone="warn"
            action={
              <Link href="/admin/sourcing" className={buttonClasses({ size: "sm" })}>
                {copy.margin.missingAction}
              </Link>
            }
          >
            {copy.margin.missingHint(t.linesMissingCost)}
          </InlineAlert>
        )}

        <Card padded={false}>
          {report.groups.length === 0 ? (
            <EmptyState title={copy.margin.empty} body={copy.margin.emptyBody} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <caption className="sr-only">
                  {copy.margin.caption(ymdLong(from), ymdLong(to))}, {copy.margin.groups[group]}
                </caption>
                <thead className="border-b border-line bg-panel-2">
                  <tr>
                    <th scope="col" className={thClass}>{copy.margin.groups[group]}</th>
                    <th scope="col" className={cx(numTh, "hidden sm:table-cell")}>{copy.margin.lines}</th>
                    <th scope="col" className={numTh}>{copy.margin.revenue}</th>
                    <th scope="col" className={cx(numTh, "hidden md:table-cell")}>{copy.margin.cost}</th>
                    <th scope="col" className={numTh}>{copy.margin.margin}</th>
                    <th scope="col" className={numTh}>{copy.margin.marginPct}</th>
                    <th scope="col" className={cx(numTh, "hidden sm:table-cell")}>{copy.margin.missing}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.groups.map((r) => (
                    <tr key={r.key ?? `none-${r.label}`} className="border-b border-line hover:bg-panel-2">
                      <th scope="row" className={cx(tdClass, "text-left font-normal")}>{label(r)}</th>
                      <td className={cx(num, "hidden sm:table-cell")}>{r.lines}</td>
                      <td className={num}><Money amount={r.revenue} currency={cur} /></td>
                      <td className={cx(num, "hidden md:table-cell")}><Money amount={r.cost} currency={cur} /></td>
                      <td className={cx(num, r.margin < 0 && "text-crit")}><Money amount={r.margin} currency={cur} signed={r.margin < 0} /></td>
                      <td className={cx(num, r.marginPct != null && r.marginPct < 0 && "text-crit")}>{pctText(r.marginPct)}</td>
                      <td className={cx(num, "hidden sm:table-cell", r.linesMissingCost > 0 ? "text-warn" : "text-muted")}>
                        {r.linesMissingCost}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-panel-2 font-semibold">
                  <tr>
                    <th scope="row" className={cx(tdClass, "text-left")}>{copy.margin.total}</th>
                    <td className={cx(num, "hidden sm:table-cell")}>{t.lines}</td>
                    <td className={num}><Money amount={t.revenue} currency={cur} /></td>
                    <td className={cx(num, "hidden md:table-cell")}><Money amount={t.cost} currency={cur} /></td>
                    <td className={cx(num, t.margin < 0 && "text-crit")}><Money amount={t.margin} currency={cur} signed={t.margin < 0} /></td>
                    <td className={num}>{pctText(t.marginPct)}</td>
                    <td className={cx(num, "hidden sm:table-cell", t.linesMissingCost > 0 ? "text-warn" : "text-muted")}>{t.linesMissingCost}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
