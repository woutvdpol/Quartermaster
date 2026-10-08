"use client";

import { useEffect, useState, useTransition } from "react";
import { Button, Card, InlineAlert } from "@/components/admin/ui";
import type { SearchIndexOverview } from "@/server/search";
import { rebuildSearchIndexAction, searchIndexOverviewAction } from "../search-actions";

const POLL_MS = 2000;

/** Settings → Catalog: smart-search index coverage and the "Rebuild search index" action with progress. */
export function SearchIndexCard({ initial }: { initial: SearchIndexOverview }) {
  const [data, setData] = useState(initial);
  const [message, setMessage] = useState<{ tone: "ok" | "crit"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = data.run;
  const active = run?.status === "queued" || run?.status === "running";

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      void searchIndexOverviewAction().then((next) => next && setData(next));
    }, POLL_MS);
    return () => clearInterval(t);
  }, [active]);

  const rebuild = (force: boolean) =>
    start(async () => {
      const res = await rebuildSearchIndexAction(force);
      if (res.ok && res.data) setData(res.data);
      setMessage(res.ok ? null : { tone: "crit", text: res.message ?? "Could not queue the rebuild." });
    });

  const s = data.status;
  const pct = run && run.total > 0 ? Math.min(100, Math.round((run.done / run.total) * 100)) : 0;

  return (
    <Card title="Search index" aside="Smart search: meaning, synonyms and photo search">
      <div className="grid gap-3 text-[13px]">
        <p className="text-ink">
          <span className="tabular-nums">{s.textIndexed}</span> of <span className="tabular-nums">{s.products}</span> products indexed for text search
          {s.withPhoto > 0 ? (
            <>
              {" · "}
              <span className="tabular-nums">{s.imageIndexed}</span> of <span className="tabular-nums">{s.withPhoto}</span> photos for photo search
            </>
          ) : null}
          {s.outdated > 0 ? <span className="text-muted"> · {s.outdated} waiting to be (re)indexed</span> : null}
        </p>
        {run ? (
          <div className="grid gap-1.5" aria-live="polite">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>
                {run.status === "queued" && "Rebuild queued — starts when the background worker picks it up."}
                {run.status === "running" && `Rebuilding… ${run.done} of ${run.total} products checked`}
                {run.status === "done" && `Last rebuild finished: ${run.textEmbedded} texts and ${run.imageEmbedded} photos updated${run.failed ? `, ${run.failed} photos failed` : ""}.`}
                {run.status === "failed" && `Last rebuild failed: ${run.error ?? "unknown error"}`}
              </span>
              {active ? <span className="tabular-nums">{pct}%</span> : null}
            </div>
            {active ? (
              <div className="h-1.5 overflow-hidden rounded-full bg-panel-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
              </div>
            ) : null}
          </div>
        ) : null}
        {message ? <InlineAlert tone={message.tone}>{message.text}</InlineAlert> : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={pending || active} onClick={() => rebuild(false)}>
            Rebuild search index
          </Button>
          <Button variant="ghost" disabled={pending || active} onClick={() => rebuild(true)} title="Re-embed every product, also unchanged ones (after a model update).">
            Re-embed everything
          </Button>
        </div>
        <p className="text-xs text-muted">
          Products are indexed automatically after every change. A rebuild only redoes products whose text or main photo changed.
        </p>
      </div>
    </Card>
  );
}
