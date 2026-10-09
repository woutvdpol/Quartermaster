import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { parseInsightPeriod, parseStaleDays } from "@/server/insights/pure";
import { copy } from "./_copy";
import { PeriodLinks, StaleLinks } from "./_components/PeriodLinks";
import { BuyMoreSection, CategorySection, KpiSection, StaleSection } from "./_components/sections";
import { CardSkeleton, KpiSkeleton, ListSkeleton } from "../dashboard/_components/skeletons";

export const metadata: Metadata = { title: copy.metaTitle };

export default async function InsightsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const period = parseInsightPeriod(sp.period);
  const staleDays = parseStaleDays(sp.stale);
  const ctx = await requireStaffContext();
  const props = { ctx, period, staleDays };
  const key = `${period}-${staleDays}`;

  return (
    <>
      <PageHeader crumb={copy.crumb} title={copy.title} actions={<PeriodLinks period={period} staleDays={staleDays} />} />
      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5">
        <Suspense key={`kpi-${key}`} fallback={<KpiSkeleton />}>
          <KpiSection {...props} />
        </Suspense>

        <div className="grid gap-3 lg:grid-cols-[1.35fr_1fr]">
          <Suspense key={`cat-${key}`} fallback={<CardSkeleton title={copy.categories.title} height="h-56" />}>
            <CategorySection {...props} />
          </Suspense>
          <Suspense key={`buy-${key}`} fallback={<ListSkeleton title={copy.buyMore.title} lines={6} />}>
            <BuyMoreSection {...props} />
          </Suspense>
        </div>

        <Suspense key={`stale-${key}`} fallback={<ListSkeleton title={copy.stale.title(0)} lines={6} />}>
          <StaleSection {...props} thresholdLinks={<StaleLinks period={period} staleDays={staleDays} />} />
        </Suspense>
      </div>
    </>
  );
}
