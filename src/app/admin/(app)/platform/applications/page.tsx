import type { Metadata } from "next";
import Link from "next/link";
import { DataTable, DateTime, EmptyState, PageHeader, StatusPill, ViewTabs, getParam, hrefWith, type Column } from "@/components/admin/ui";
import { countApplications, getApplication, listApplications, summarizeChecks, type ApplicationListItem } from "@/server/onboarding";
import { requirePlatformContext } from "@/server/platform";
import { ServiceError } from "@/server/context";
import type { DealerApplicationStatus } from "@/generated/prisma/enums";
import { ApplicationPanel, APPLICATION_STATUS_LABEL, platformLabel } from "./_components/ApplicationPanel";

export const metadata: Metadata = { title: "Platform · Dealer applications" };

const STATUSES: DealerApplicationStatus[] = ["PENDING", "APPROVED", "REJECTED"];

/** Dealer applications (SUPERADMIN; the platform layout 404s everyone else). */
export default async function ApplicationsPage({ searchParams }: PageProps<"/admin/platform/applications">) {
  const sp = await searchParams;
  const ctx = await requirePlatformContext();
  const statusParam = getParam(sp, "status")?.toUpperCase();
  const status = STATUSES.find((s) => s === statusParam) ?? "PENDING";
  const selectedId = getParam(sp, "id")?.slice(0, 64);
  const basePath = "/admin/platform/applications";

  const [rows, counts, selected] = await Promise.all([
    listApplications(ctx, status),
    countApplications(ctx),
    selectedId
      ? getApplication(ctx, selectedId).catch((err) => {
          if (err instanceof ServiceError && err.code === "NOT_FOUND") return null;
          throw err;
        })
      : null,
  ]);
  const now = new Date();

  const columns: Column<ApplicationListItem>[] = [
    {
      key: "shop",
      header: "Shop",
      cell: (a) => (
        <span className="grid">
          <Link
            href={hrefWith(basePath, sp, { id: a.id })}
            aria-current={a.id === selectedId ? "true" : undefined}
            className="font-medium text-ink underline-offset-2 hover:text-accent hover:underline"
          >
            {a.shopName}
          </Link>
          <span className="text-xs text-muted">{a.email}</span>
        </span>
      ),
    },
    { key: "country", header: "Country", cell: (a) => <span className="font-mono">{a.country}</span> },
    { key: "via", header: "Sells via", hideBelow: "md", cell: (a) => platformLabel(a.currentPlatform) },
    {
      key: "checks",
      header: "Checks",
      hideBelow: "sm",
      cell: (a) => {
        const items = summarizeChecks(a.checks);
        const worst = items[0];
        const issues = items.filter((i) => i.tone !== "ok").length;
        return (
          <span title={items.map((i) => i.label).join(" · ")}>
            <StatusPill tone={worst.tone}>{issues ? `${worst.label}${issues > 1 ? ` +${issues - 1}` : ""}` : "All checks OK"}</StatusPill>
          </span>
        );
      },
    },
    { key: "received", header: "Received", hideBelow: "md", cell: (a) => <DateTime value={a.createdAt} format="relative" now={now} /> },
  ];

  return (
    <>
      <PageHeader
        crumb={
          <>
            <Link href="/admin/platform" className="hover:underline">
              Platform
            </Link>{" "}
            › Applications
          </>
        }
        title="Dealer applications"
      />
      <div className={`grid content-start gap-4 p-4 md:px-[22px] md:py-5 ${selected ? "xl:grid-cols-[minmax(0,1fr)_420px]" : ""}`}>
        <DataTable
          caption={`${APPLICATION_STATUS_LABEL[status]} dealer applications`}
          columns={columns}
          rows={rows}
          rowKey={(a) => a.id}
          rowLabel={(a) => a.shopName}
          rowClassName={(a) => (a.id === selectedId ? "bg-panel-2" : undefined)}
          toolbar={
            <ViewTabs
              basePath={basePath}
              searchParams={{ ...sp, id: undefined }}
              param="status"
              active={status === "PENDING" ? null : status.toLowerCase()}
              label="Application status"
              views={STATUSES.map((s) => ({ value: s === "PENDING" ? null : s.toLowerCase(), label: APPLICATION_STATUS_LABEL[s], count: counts[s] }))}
            />
          }
          empty={
            <EmptyState
              compact
              title={status === "PENDING" ? "No applications waiting" : `No ${APPLICATION_STATUS_LABEL[status].toLowerCase()} applications`}
              body={status === "PENDING" ? "New dealer sign-ups from the platform page (/apply) appear here." : undefined}
            />
          }
        />
        {selected ? <ApplicationPanel app={selected} closeHref={hrefWith(basePath, sp, { id: null })} /> : null}
      </div>
    </>
  );
}
