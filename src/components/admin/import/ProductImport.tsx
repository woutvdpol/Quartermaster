"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useId, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Button, ConfirmDialog, FileInput, InlineAlert, Spinner, buttonClasses, cx, formatMoney, toast } from "@/components/admin/ui";
import {
  cancelImportAction,
  discardImportAction,
  deleteImportedDraftsAction,
  getImportStatusAction,
  retryImportAction,
  startImportAction,
  type ImportActionResult,
} from "@/app/admin/(app)/inventory/import/actions";
import {
  DEFAULT_IMPORT_OPTIONS,
  IMPORT_SOURCES,
  MAX_IMPORT_FILE_MB,
  type ImportJobView,
  type ImportOptions,
  type ImportSourceName,
  type ImportUploadResponse,
  type RowMessage,
} from "@/server/import/types";
import { importCopy as t } from "./copy";

export type ProductImportProps = {
  /** Tenant currency (Tenant.currency) for the sample prices. */
  currency: string;
  /** Continue with an existing import (e.g. `?job=` or the wizard's saved job id). */
  initialJob?: ImportJobView | null;
  /** Link to the imported items (default: inventory filtered on this import). */
  inventoryHref?: (jobId: string) => string;
  /** Called on every job change (upload, start, progress, finish, discard → null). */
  onJobChange?: (job: ImportJobView | null) => void;
  /** Called once when an import reaches DONE (or CANCELED / FAILED). */
  onFinished?: (job: ImportJobView) => void;
  /** Hide the "Import another file" button after a finished import (the wizard moves on instead). */
  hideRestart?: boolean;
  className?: string;
};

const UPLOAD_URL = "/admin/inventory/import/upload";
const POLL_MS = 1500;
const ACTIVE = new Set(["RUNNING", "IMAGES"]);
const FINISHED = new Set(["DONE", "FAILED", "CANCELED"]);

const defaultInventoryHref = (id: string) => `/admin/inventory?view=all&import=${encodeURIComponent(id)}`;

/**
 * Product import from a WooCommerce / Shopify CSV export: choose source → upload → preview with
 * counts, column mapping and options → start → live progress → result. Used by Inventory → Import
 * and the setup wizard. All server work goes through the upload route and ./actions (tenant-scoped).
 */
export function ProductImport({ currency, initialJob = null, inventoryHref = defaultInventoryHref, onJobChange, onFinished, hideRestart, className }: ProductImportProps) {
  const [job, setJobState] = useState<ImportJobView | null>(initialJob);
  const [source, setSource] = useState<ImportSourceName>(initialJob?.source ?? "WOOCOMMERCE");
  const [options, setOptions] = useState<ImportOptions>(initialJob?.options ?? DEFAULT_IMPORT_OPTIONS);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const finishedFor = useRef<string | null>(initialJob && FINISHED.has(initialJob.status) ? initialJob.id : null);

  const setJob = (next: ImportJobView | null) => {
    setJobState(next);
    onJobChange?.(next);
    if (next && FINISHED.has(next.status) && finishedFor.current !== next.id) {
      finishedFor.current = next.id;
      onFinished?.(next);
    }
  };

  const apply = (res: ImportActionResult) => {
    if (!res.ok) {
      setError(res.message);
      return false;
    }
    setError(null);
    setJob(res.job);
    if (res.message) toast(res.message, { tone: "ok" });
    return true;
  };

  // Poll while the import runs.
  const poll = useEffectEvent(async () => {
    if (!job) return;
    const res = await getImportStatusAction(job.id);
    if (res.ok && res.job) setJob(res.job);
  });
  const active = !!job && ACTIVE.has(job.status);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(timer);
  }, [active]);

  return (
    <div className={cx("grid gap-4", className)}>
      {error && (
        <InlineAlert tone="crit" live="alert">
          {error}
        </InlineAlert>
      )}
      {!job && <UploadStep source={source} onSource={setSource} onUploaded={(j) => (setError(null), setOptions(j.options), setJob(j))} onError={setError} />}
      {job?.status === "UPLOADED" && job.preview && (
        <PreviewStep
          job={job}
          currency={currency}
          options={options}
          onOptions={setOptions}
          pending={pending}
          onDiscard={() => startTransition(async () => void apply(await discardImportAction(job.id)))}
          onStart={() => startTransition(async () => void apply(await startImportAction(job.id, options)))}
        />
      )}
      {job && job.status !== "UPLOADED" && (
        <ProgressStep
          job={job}
          pending={pending}
          inventoryHref={inventoryHref(job.id)}
          hideRestart={hideRestart}
          onCancel={() => startTransition(async () => void apply(await cancelImportAction(job.id)))}
          onRetry={() => startTransition(async () => void apply(await retryImportAction(job.id)))}
          onRestart={() => (setError(null), setJob(null))}
          onUndo={async () => {
            const res = await deleteImportedDraftsAction(job.id);
            if (res.ok) setJob(res.job);
            return res.ok ? { ok: true, message: res.message } : { ok: false, message: res.message };
          }}
        />
      )}
    </div>
  );
}

// ─── Step 1: source + file ──────────────────────────────────────────────────

function UploadStep({
  source,
  onSource,
  onUploaded,
  onError,
}: {
  source: ImportSourceName;
  onSource: (s: ImportSourceName) => void;
  onUploaded: (job: ImportJobView) => void;
  onError: (message: string | null) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileId = useId();

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const file = (form.elements.namedItem("file") as HTMLInputElement | null)?.files?.[0];
    if (!file) return setFileError(t.file.required);
    if (file.size > MAX_IMPORT_FILE_MB * 1024 * 1024) return setFileError(t.file.tooLarge(MAX_IMPORT_FILE_MB));
    setFileError(null);
    onError(null);
    setUploading(true);
    try {
      const body = new FormData();
      body.set("source", source);
      body.set("file", file);
      const res = await fetch(UPLOAD_URL, { method: "POST", body });
      const data = (await res.json().catch(() => null)) as ImportUploadResponse | null;
      if (data?.ok) onUploaded(data.job);
      else onError(data?.message ?? t.file.failed);
    } catch {
      onError(t.file.failed);
    } finally {
      setUploading(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <fieldset className="grid gap-3 sm:grid-cols-2" aria-label={t.sourceLegend}>
        <legend className="sr-only">{t.sourceLegend}</legend>
        {IMPORT_SOURCES.map((s) => (
          <label
            key={s}
            className={cx(
              "flex cursor-pointer flex-col gap-1.5 rounded-card border bg-panel p-4 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus",
              source === s ? "border-2 border-accent" : "border-line bg-panel-2",
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <strong className="text-ink">{t.sources[s].label}</strong>
              <input type="radio" name="source" value={s} checked={source === s} onChange={() => onSource(s)} className="size-3.5 accent-accent" />
            </span>
            <span className="text-[13px] text-muted">{t.sources[s].hint}</span>
          </label>
        ))}
      </fieldset>
      <div className="grid gap-1.5">
        <label htmlFor={fileId} className="text-[13px] font-medium text-ink">
          {t.file.label}
        </label>
        <FileInput
          id={fileId}
          name="file"
          accept=".csv,text/csv"
          aria-describedby={`${fileId}-hint${fileError ? ` ${fileId}-error` : ""}`}
          aria-invalid={fileError ? true : undefined}
          onChange={() => setFileError(null)}
          className="max-w-md"
        />
        <p id={`${fileId}-hint`} className="text-xs text-muted">
          {t.file.hint(MAX_IMPORT_FILE_MB)}
        </p>
        {fileError && (
          <p id={`${fileId}-error`} className="text-xs text-crit">
            {fileError}
          </p>
        )}
      </div>
      <div>
        <Button type="submit" variant="primary" disabled={uploading}>
          {uploading ? (
            <>
              <Spinner /> {t.file.uploading}
            </>
          ) : (
            t.file.upload
          )}
        </Button>
      </div>
    </form>
  );
}

// ─── Step 2: preview + options ──────────────────────────────────────────────

function Tile({ value, label, note, tone }: { value: ReactNode; label: string; note?: ReactNode; tone?: "warn" }) {
  return (
    <div className={cx("rounded-control border p-3", tone === "warn" ? "border-warn/50 bg-warn-soft" : "border-line bg-panel")}>
      <span className={cx("block font-mono text-[26px] leading-tight font-semibold tabular-nums", tone === "warn" ? "text-warn" : "text-ink")}>{value}</span>
      <span className="text-xs text-muted">{label}</span>
      {note && <span className="block text-xs text-muted">{note}</span>}
    </div>
  );
}

function MessageList({ items, total }: { items: RowMessage[]; total: number }) {
  return (
    <ul className="mt-2 grid max-h-64 gap-1 overflow-y-auto text-[13px]">
      {items.map((m, i) => (
        <li key={i} className="flex gap-2">
          <span className="w-16 shrink-0 font-mono text-xs text-muted tabular-nums">{t.preview.row(m.row)}</span>
          <span className="text-ink-2">{m.message}</span>
        </li>
      ))}
      {total > items.length && <li className="text-xs text-muted">{t.preview.more(total - items.length)}</li>}
    </ul>
  );
}

const thCls = "border-b border-line px-2.5 py-2 text-left text-xs font-semibold tracking-wider text-muted uppercase";
const tdCls = "border-b border-line px-2.5 py-2 align-top";
const selectCls = "h-[30px] rounded-control border border-line-strong bg-panel px-1.5 text-[13px] text-ink";

function PreviewStep({
  job,
  currency,
  options,
  onOptions,
  pending,
  onStart,
  onDiscard,
}: {
  job: ImportJobView;
  currency: string;
  options: ImportOptions;
  onOptions: (o: ImportOptions) => void;
  pending: boolean;
  onStart: () => void;
  onDiscard: () => void;
}) {
  const pv = job.preview!;
  const set = <K extends keyof ImportOptions>(k: K, v: ImportOptions[K]) => onOptions({ ...options, [k]: v });
  const items = options.stockMode === "split" ? pv.itemsIfSplit : pv.itemsIfSingle;
  const tagsColumn = pv.columns.find((c) => /^tags$/i.test(c.column));
  const stockColumn = pv.columns.find((c) => /stock|inventory qty|voorraad|bestand/i.test(c.column) && !/\?|tracker/i.test(c.column));
  const otherColumns = pv.columns.filter((c) => c !== tagsColumn && c !== stockColumn);
  const tagsId = useId();
  const stockId = useId();

  return (
    <section aria-label={t.preview.label} className="grid gap-3.5 rounded-card border border-line bg-panel-2 p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13.5px]">
          <strong className="text-ink">{job.fileName}</strong> <span className="text-muted">· {t.sources[job.source].label} · {t.preview.rowsRead(pv.rows)}</span>
        </span>
        <button type="button" onClick={onDiscard} disabled={pending} className="text-[13px] text-accent underline-offset-2 hover:underline disabled:opacity-60">
          {t.preview.another}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Tile value={items} label={t.preview.productsReady} />
        <Tile value={options.images ? pv.images : 0} label={t.preview.photos} />
        <Tile value={pv.categories.total} label={t.preview.categories} note={t.preview.categoriesNote(pv.categories.existing, pv.categories.new)} />
        <Tile value={pv.attention} label={t.preview.attention} tone={pv.attention ? "warn" : undefined} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={thCls}>{t.preview.column}</th>
              <th className={thCls}>{t.preview.becomes}</th>
              <th className={thCls}>{t.preview.example}</th>
            </tr>
          </thead>
          <tbody>
            {otherColumns.map((c) => (
              <tr key={c.column}>
                <td className={cx(tdCls, "font-mono text-xs")}>{c.column}</td>
                <td className={tdCls}>{c.becomes}</td>
                <td className={cx(tdCls, "max-w-[280px] truncate text-ink-2")} title={c.example}>
                  {c.example}
                </td>
              </tr>
            ))}
            {tagsColumn && (
              <tr>
                <td className={cx(tdCls, "font-mono text-xs")}>{tagsColumn.column}</td>
                <td className={tdCls}>
                  <label htmlFor={tagsId} className="sr-only">
                    {tagsColumn.column} → {t.preview.becomes}
                  </label>
                  <select id={tagsId} className={selectCls} value={options.tagsAs} onChange={(e) => set("tagsAs", e.target.value as ImportOptions["tagsAs"])}>
                    <option value="facets">{t.preview.tagsFacets}</option>
                    <option value="tags">{t.preview.tagsPlain}</option>
                  </select>
                  {options.tagsAs === "facets" && <p className="mt-1 text-xs text-muted">{t.preview.tagsHint(pv.tags.facetMatchedCount, pv.tags.total)}</p>}
                </td>
                <td className={cx(tdCls, "text-ink-2")}>{tagsColumn.example}</td>
              </tr>
            )}
            {stockColumn && (
              <tr>
                <td className={cx(tdCls, "border-b-0 font-mono text-xs")}>{stockColumn.column}</td>
                <td className={cx(tdCls, "border-b-0")}>
                  {pv.multiStock > 0 ? (
                    <>
                      <label htmlFor={stockId} className="sr-only">
                        {stockColumn.column} → {t.preview.becomes}
                      </label>
                      <select id={stockId} className={selectCls} value={options.stockMode} onChange={(e) => set("stockMode", e.target.value as ImportOptions["stockMode"])}>
                        <option value="split">{t.preview.stockSplit}</option>
                        <option value="single">{t.preview.stockSingle}</option>
                      </select>
                    </>
                  ) : (
                    t.preview.uniqueItem
                  )}
                </td>
                <td className={cx(tdCls, "border-b-0", pv.multiStock ? "text-warn" : "text-ink-2")}>{pv.multiStock ? t.preview.stockHint(pv.multiStock) : stockColumn.example}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pv.sample.length > 0 && (
        <details className="text-[13px]">
          <summary className="cursor-pointer font-medium text-ink">{t.preview.sample}</summary>
          <ul className="mt-2 grid gap-1">
            {pv.sample.map((s) => (
              <li key={s.row} className="flex flex-wrap gap-x-2 text-ink-2">
                <span className="font-medium text-ink">{s.title}</span>
                <span className="font-mono tabular-nums">{formatMoney(s.price, currency)}</span>
                {s.category && <span className="text-muted">· {s.category}</span>}
                {s.tags.length > 0 && <span className="text-muted">· {s.tags.join(", ")}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {options.tagsAs === "facets" && pv.tags.facetMatched.length > 0 && (
        <details className="text-[13px]">
          <summary className="cursor-pointer font-medium text-ink">
            {t.preview.facetMatches} ({pv.tags.facetMatchedCount})
          </summary>
          <p className="mt-2 text-ink-2">{pv.tags.facetMatched.map((m) => `${m.tag} → ${m.facet}: ${m.value}`).join(" · ")}</p>
        </details>
      )}
      {pv.warningCount > 0 && (
        <details className="text-[13px]">
          <summary className="cursor-pointer font-medium text-ink">{t.preview.warnings(pv.warningCount)}</summary>
          <MessageList items={pv.warnings} total={pv.warningCount} />
        </details>
      )}
      {pv.skippedCount > 0 && (
        <details className="text-[13px]">
          <summary className="cursor-pointer font-medium text-ink">{t.preview.skipped(pv.skippedCount)}</summary>
          <MessageList items={pv.skipped} total={pv.skippedCount} />
        </details>
      )}
      {pv.ignoredColumns.length > 0 && (
        <details className="text-[13px]">
          <summary className="cursor-pointer font-medium text-ink">{t.preview.ignored(pv.ignoredColumns.length)}</summary>
          <p className="mt-2 font-mono text-xs text-muted">{pv.ignoredColumns.join(", ")}</p>
        </details>
      )}
      {pv.skuConflicts > 0 && <InlineAlert tone="warn">{t.preview.skuConflicts(pv.skuConflicts)}</InlineAlert>}

      <div className="grid gap-2">
        <label className="flex items-start gap-2 text-[13px]">
          <input type="checkbox" checked={options.publish} onChange={(e) => set("publish", e.target.checked)} className="mt-[3px] size-3.5 accent-accent" />
          <span>
            {t.preview.publish}
            {options.publish && <span className="block text-xs text-muted">{t.preview.publishHint(pv.publishable)}</span>}
          </span>
        </label>
        {pv.images > 0 && (
          <label className="flex items-start gap-2 text-[13px]">
            <input type="checkbox" checked={options.images} onChange={(e) => set("images", e.target.checked)} className="mt-[3px] size-3.5 accent-accent" />
            <span>
              {t.preview.images}
              <span className="block text-xs text-muted">{t.preview.imagesHint}</span>
            </span>
          </label>
        )}
      </div>

      <div className="flex justify-end">
        <Button type="button" variant="primary" onClick={onStart} disabled={pending}>
          {pending ? t.preview.starting : t.preview.start(items)}
        </Button>
      </div>
    </section>
  );
}

// ─── Step 3: progress + result ──────────────────────────────────────────────

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="grid gap-1">
      <div className="flex justify-between text-[13px]">
        <span className="text-ink">{label}</span>
        <span className="font-mono text-xs text-muted tabular-nums">{t.progress.of(value, max)}</span>
      </div>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className="h-2 overflow-hidden rounded-full bg-panel-2">
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ProgressStep({
  job,
  pending,
  inventoryHref,
  hideRestart,
  onCancel,
  onRetry,
  onRestart,
  onUndo,
}: {
  job: ImportJobView;
  pending: boolean;
  inventoryHref: string;
  hideRestart?: boolean;
  onCancel: () => void;
  onRetry: () => void;
  onRestart: () => void;
  onUndo: () => Promise<{ ok: boolean; message?: string }>;
}) {
  const p = job.progress;
  const running = ACTIVE.has(job.status);
  const finished = FINISHED.has(job.status);
  const toneClass = job.status === "DONE" ? "text-ok" : job.status === "FAILED" ? "text-crit" : job.status === "CANCELED" ? "text-warn" : "text-info";
  const created = p?.created ?? 0;
  const failures = job.failures;
  const imageFailures = job.imageFailures;

  return (
    <section aria-label={t.progress.label} aria-busy={running} className="grid gap-3.5 rounded-card border border-line bg-panel-2 p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13.5px]">
          <strong className="text-ink">{job.fileName}</strong> <span className="text-muted">· {t.sources[job.source].label}</span>
        </span>
        <span role="status" className={cx("inline-flex items-center gap-1.5 text-[13px] font-medium", toneClass)}>
          {running && <Spinner />}
          {t.progress.status[job.status]}
        </span>
      </div>

      {running && !p && <p className="text-[13px] text-muted">{t.progress.waiting}</p>}
      {p && (running || job.status === "CANCELED") && (
        <div className="grid gap-3">
          <Bar label={t.progress.products} value={p.processed} max={p.products || job.preview?.products || 0} />
          {(p.phase !== "products" || p.imagesTotal > 0) && job.options.images && (
            <Bar label={t.progress.images} value={p.imagesDone + (p.imagesFailed ?? 0)} max={p.imagesTotal} />
          )}
        </div>
      )}

      {finished && p && (
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          <Tile value={created} label={t.result.created} />
          <Tile value={p.published} label={t.result.published} note={`${Math.max(0, created - p.published)} ${t.result.drafts}`} />
          <Tile value={job.options.images ? p.imagesDone : 0} label={t.result.photos} note={imageFailures.length ? `${imageFailures.length} ${t.result.photosFailed}` : undefined} />
          <Tile value={failures.length} label={t.result.failed} tone={failures.length ? "warn" : undefined} />
        </div>
      )}
      {finished && p && p.existing > 0 && <p className="text-[13px] text-muted">{t.result.existing(p.existing)}</p>}
      {job.error && (
        <InlineAlert tone="crit" title={t.result.error}>
          {job.error}
        </InlineAlert>
      )}
      {failures.length > 0 && (
        <details className="text-[13px]" open={finished}>
          <summary className="cursor-pointer font-medium text-ink">{t.result.failures(failures.length)}</summary>
          <MessageList items={failures.map((f) => ({ row: f.row, message: `${f.title}: ${f.reason}` }))} total={failures.length} />
        </details>
      )}
      {imageFailures.length > 0 && (
        <details className="text-[13px]">
          <summary className="cursor-pointer font-medium text-ink">{t.result.imageFailures(imageFailures.length)}</summary>
          <MessageList items={imageFailures.map((f) => ({ row: f.row, message: `${f.title} — ${f.reason}` }))} total={imageFailures.length} />
        </details>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {running && (
          <Button type="button" onClick={onCancel} disabled={pending}>
            {pending ? t.progress.canceling : t.progress.cancel}
          </Button>
        )}
        {job.status === "FAILED" && (
          <Button type="button" onClick={onRetry} disabled={pending}>
            {t.result.retry}
          </Button>
        )}
        {finished && created > 0 && (
          <ConfirmDialog
            trigger={t.result.undo}
            tone="danger"
            title={t.result.undoTitle}
            description={t.result.undoBody}
            confirmLabel={t.result.undoConfirm}
            action={onUndo}
          />
        )}
        {finished && !hideRestart && (
          <Button type="button" onClick={onRestart}>
            {t.result.another}
          </Button>
        )}
        {created > 0 && (
          <Link href={inventoryHref} className={buttonClasses({ variant: finished ? "primary" : "secondary" })}>
            {t.result.view}
          </Link>
        )}
      </div>
    </section>
  );
}
