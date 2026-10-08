import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { InlineAlert, PageHeader, buttonClasses } from "@/components/admin/ui";
import { SETUP_STEPS, completedStepCount, getPendingSetup } from "@/server/onboarding";
import { requireStaffContext } from "@/server/context";
import { copy, parsePeriod } from "./_copy";
import { PeriodLinks } from "./_components/PeriodLinks";
import {
  KpiSection,
  LatestOrdersSection,
  MarginSection,
  RevenueSection,
  StockSection,
  TodoSection,
  VisitorsSection,
} from "./_components/sections";
import { CardSkeleton, KpiSkeleton, ListSkeleton } from "./_components/skeletons";

export const metadata: Metadata = { title: copy.title };

export default async function DashboardPage({ searchParams }: PageProps<"/admin/dashboard">) {
  const sp = await searchParams;
  const days = parsePeriod(sp.days);
  const ctx = await requireStaffContext();
  const setup = await getPendingSetup(ctx);

  return (
    <>
      <PageHeader
        crumb={copy.crumb}
        title={copy.title}
        actions={
          <>
            <PeriodLinks active={days} />
            <Link href="/admin/inventory/new" className={buttonClasses({ variant: "primary" })}>
              {copy.newProduct}
            </Link>
          </>
        }
      />
      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5">
        {setup ? (
          <InlineAlert
            tone="info"
            title="Finish setting up your shop"
            action={
              <Link href="/admin/setup" className={buttonClasses({ variant: "primary", size: "sm" })}>
                Continue setup
              </Link>
            }
          >
            {completedStepCount(setup.state)} of {SETUP_STEPS.length} steps done. The wizard walks you through payments, shipping, products and legal pages.
          </InlineAlert>
        ) : sp.setup === "done" ? (
          <InlineAlert tone="ok" title="Your shop is live">
            Setup is complete. You can change everything later under Settings.
          </InlineAlert>
        ) : null}
        <Suspense key={`kpi-${days}`} fallback={<KpiSkeleton />}>
          <KpiSection ctx={ctx} days={days} />
        </Suspense>

        <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
          <Suspense key={`rev-${days}`} fallback={<CardSkeleton title={copy.chart.title} height="h-56" />}>
            <RevenueSection ctx={ctx} days={days} />
          </Suspense>
          <Suspense fallback={<ListSkeleton title={copy.todo.title} lines={6} />}>
            <TodoSection ctx={ctx} />
          </Suspense>
        </div>

        <Suspense fallback={<CardSkeleton title={copy.stock.title} height="h-12" />}>
          <StockSection ctx={ctx} />
        </Suspense>

        <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
          <Suspense fallback={<ListSkeleton title={copy.latest.title} lines={5} />}>
            <LatestOrdersSection ctx={ctx} />
          </Suspense>
          <Suspense key={`vis-${days}`} fallback={<CardSkeleton title={copy.visitors.title} height="h-40" />}>
            <VisitorsSection ctx={ctx} days={days} />
          </Suspense>
        </div>

        <Suspense fallback={<ListSkeleton title={copy.margin.title} lines={4} />}>
          <MarginSection ctx={ctx} />
        </Suspense>
      </div>
    </>
  );
}
