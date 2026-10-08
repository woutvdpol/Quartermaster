import type { Metadata } from "next";
import Link from "next/link";
import { Card, DateTime, PageHeader, getParam, type SearchParamsRecord } from "@/components/admin/ui";
import { ProductImport } from "@/components/admin/import/ProductImport";
import { importCopy as t } from "@/components/admin/import/copy";
import { ServiceError, requireStaffContext } from "@/server/context";
import { getImportJob, listImportJobs, type ImportJobView } from "@/server/import";
import { requireTenantDisplay } from "@/server/tenant-display";

export const metadata: Metadata = { title: t.title };

const BASE = "/admin/inventory/import";
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export default async function ImportPage({ searchParams }: PageProps<"/admin/inventory/import">) {
  const sp = (await searchParams) as SearchParamsRecord;
  const ctx = await requireStaffContext();
  const jobParam = getParam(sp, "job");
  const [tenant, history, requested] = await Promise.all([
    requireTenantDisplay(ctx.tenantId),
    listImportJobs(ctx, 10),
    jobParam && ID_RE.test(jobParam)
      ? getImportJob(ctx, jobParam).catch((err) => {
          if (err instanceof ServiceError && err.code === "NOT_FOUND") return null;
          throw err;
        })
      : Promise.resolve(null),
  ]);
  // Without ?job, pick up an import that is still running so a reload does not lose it.
  const initialJob = requested ?? history.find((j) => j.status === "RUNNING" || j.status === "IMAGES") ?? null;

  return (
    <>
      <PageHeader
        crumb={
          <>
            <Link href="/admin/inventory" className="hover:text-ink hover:underline">
              {t.crumbInventory}
            </Link>{" "}
            › {t.title}
          </>
        }
        title={t.title}
      />
      <div className="grid max-w-5xl content-start gap-5 p-4 md:p-[22px]">
        <p className="max-w-2xl text-[13.5px] text-ink-2">{t.intro}</p>
        <ProductImport key={initialJob?.id ?? "new"} currency={tenant.currency} initialJob={initialJob} />
        <History jobs={history} timeZone={tenant.timeZone} />
      </div>
    </>
  );
}

function History({ jobs, timeZone }: { jobs: ImportJobView[]; timeZone: string }) {
  return (
    <Card title={t.history.title} padded={jobs.length === 0}>
      {jobs.length === 0 ? (
        <p className="text-[13px] text-muted">{t.history.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="px-3.5 py-2 font-semibold">{t.history.columns.date}</th>
                <th className="px-3.5 py-2 font-semibold">{t.history.columns.file}</th>
                <th className="px-3.5 py-2 font-semibold">{t.history.columns.source}</th>
                <th className="px-3.5 py-2 font-semibold">{t.history.columns.status}</th>
                <th className="px-3.5 py-2 text-right font-semibold">{t.history.columns.items}</th>
                <th className="px-3.5 py-2">
                  <span className="sr-only">{t.history.open}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-t border-line">
                  <td className="px-3.5 py-2 whitespace-nowrap">
                    <DateTime value={j.createdAt} format="datetime" timeZone={timeZone} className="font-mono text-xs" />
                  </td>
                  <td className="max-w-[240px] truncate px-3.5 py-2" title={j.fileName}>
                    {j.fileName}
                  </td>
                  <td className="px-3.5 py-2">{t.sources[j.source].label}</td>
                  <td className="px-3.5 py-2">{t.progress.status[j.status]}</td>
                  <td className="px-3.5 py-2 text-right font-mono tabular-nums">{j.progress?.created ?? "—"}</td>
                  <td className="px-3.5 py-2 text-right">
                    <Link href={`${BASE}?job=${j.id}`} className="text-accent hover:underline">
                      {t.history.open}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
