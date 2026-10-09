"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button, Card, Checkbox, InlineAlert, toast } from "@/components/admin/ui";
import { LOCALE_LABELS } from "@/server/translations/fields";
import type { TranslationOverview } from "@/server/translations/service";
import { queueExistingAction } from "../../translations/actions";

/** Settings → Languages: progress per language and the one-off "Translate existing stock". */
export function TranslateStockCard({ overview }: { overview: TranslationOverview }) {
  const [includeSold, setIncludeSold] = useState(false);
  const [pending, start] = useTransition();
  const on = overview.locales.length > 0;
  return (
    <Card title="Translate existing stock" aside="Runs on your own server">
      <div className="grid gap-3 text-[13px]">
        {on ? (
          <ul className="grid gap-1">
            {overview.locales.map((l) => {
              const c = overview.counts[l];
              return (
                <li key={l}>
                  <span className="font-medium text-ink">{LOCALE_LABELS[l]}:</span>{" "}
                  <span className="text-muted">
                    {c.approved} online · {c.machine} to review · {c.queued} waiting for the translator
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <InlineAlert tone="info">Switch on a language above and save first.</InlineAlert>
        )}
        <p className="text-muted">
          New and edited items are translated automatically. This translates everything that is already in the shop — items, categories, facets, pages and menus — once, into
          the review list. Nothing goes online until you approve it.
        </p>
        <Checkbox label="Include sold items (the public sold archive)" checked={includeSold} onChange={(e) => setIncludeSold(e.target.checked)} />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            disabled={!on || pending}
            onClick={() =>
              start(async () => {
                const res = await queueExistingAction(includeSold);
                (res.ok ? toast.ok : toast.crit)(res.message ?? "");
              })
            }
          >
            {pending ? "Queueing…" : "Translate existing stock"}
          </Button>
          <Link href="/admin/translations" className="text-accent underline-offset-2 hover:underline">
            Review list
          </Link>
          <Link href="/admin/translations/glossary" className="text-accent underline-offset-2 hover:underline">
            Glossary
          </Link>
        </div>
        {!overview.translatorConfigured ? <p className="text-xs text-warn">Machine translation is not configured on this server (no embedder).</p> : null}
      </div>
    </Card>
  );
}
