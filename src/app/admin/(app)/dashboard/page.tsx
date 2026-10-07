import type { Metadata } from "next";
import { Card } from "@/components/admin/Card";
import { KpiCard } from "@/components/admin/KpiCard";
import { PageHeader } from "@/components/admin/PageHeader";
import { StatusPill } from "@/components/admin/StatusPill";
import { getDictionary } from "@/lib/i18n";

const t = getDictionary().dashboard;

export const metadata: Metadata = { title: t.title };

/*
 * Phase 0 shell: every number below is SAMPLE DATA (clearly labelled in the UI).
 * Real figures (paid orders only, excl. shipping) are wired up in phase 2.
 */
const SAMPLE = {
  kpis: [
    { label: t.kpis.revenue, value: "€18,420", delta: "12.4%", trend: "up", note: t.kpis.vsPrevious },
    { label: t.kpis.orders, value: "47", delta: "6", trend: "up", note: t.kpis.vsPrevious },
    { label: t.kpis.averageOrder, value: "€391.91", delta: "3.1%", trend: "down", note: t.kpis.vsPrevious },
    { label: t.kpis.margin, value: "38%", note: t.kpis.fromPurchasePrice },
  ],
  todo: [
    { label: t.todo.paidNotShipped, count: 5, tone: "warn" },
    { label: t.todo.awaitingTransfer, count: 2, tone: "info" },
    { label: t.todo.failedPayment, count: 1, tone: "crit" },
    { label: t.todo.offerReceived, count: 1, tone: "mute" },
  ],
  liveVisitors: 14,
  reservedItems: 3,
} as const;

function SampleBadge() {
  return (
    <span className="type-label rounded-[3px] border border-dashed border-warn px-1.5 py-px text-[10px] text-warn">
      {t.sampleData}
    </span>
  );
}

export default function DashboardPage() {
  const openCount = SAMPLE.todo.reduce((n, item) => n + item.count, 0);
  return (
    <>
      <PageHeader crumb={t.crumb} title={t.title} actions={<SampleBadge />} />
      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5">
        <p role="note" className="rounded-card border border-dashed border-warn bg-warn-soft px-3.5 py-2 text-[13px] text-ink">
          <strong className="font-semibold">{t.sampleData}.</strong> {t.sampleDataNote}
        </p>

        <section aria-label={`${t.period} (${t.sampleData})`} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {SAMPLE.kpis.map((kpi) => (
            <KpiCard
              key={kpi.label}
              label={kpi.label}
              value={kpi.value}
              delta={"delta" in kpi ? kpi.delta : undefined}
              trend={"trend" in kpi ? kpi.trend : undefined}
              note={kpi.note}
            />
          ))}
        </section>

        <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
          <Card title={t.period} aside={<SampleBadge />}>
            <div className="grid h-48 place-items-center rounded-control border border-dashed border-line text-[13px] text-muted">
              {t.sampleDataNote}
            </div>
          </Card>

          <Card
            title={t.todo.title}
            aside={
              <span className="flex items-center gap-2">
                {t.todo.open(openCount)} <SampleBadge />
              </span>
            }
          >
            <ul className="grid gap-2.5 text-[13px]">
              {SAMPLE.todo.map((item) => (
                <li key={item.label} className="flex items-center justify-between gap-3">
                  <span>{item.label}</span>
                  <StatusPill tone={item.tone}>{item.count}</StatusPill>
                </li>
              ))}
              <li aria-hidden="true" className="my-1 border-t border-line" />
              <li className="flex items-center justify-between gap-3">
                <span className="text-muted">{t.todo.liveVisitors}</span>
                <span className="font-mono tabular-nums">{SAMPLE.liveVisitors}</span>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-muted">{t.todo.reservedInCart}</span>
                <span className="font-mono tabular-nums">{t.todo.items(SAMPLE.reservedItems)}</span>
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
