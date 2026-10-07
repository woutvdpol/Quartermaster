"use client";

import { useState } from "react";
import { ActionMessage, Button, Drawer, Textarea, labelClass, toast } from "@/components/admin/ui";
import type { ImportResult } from "@/server/redirects";
import { PendingButton, useKeepForm } from "../../_system/client";
import { importRedirectsAction } from "../actions";
import { redirectsCopy as t } from "../_copy";

/** CSV import (file upload or pasted lines) with a per-line error report. */
export function ImportDrawer() {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  return (
    <>
      <Button
        variant="secondary"
        aria-haspopup="dialog"
        onClick={() => {
          setSession((s) => s + 1);
          setOpen(true);
        }}
      >
        {t.import.trigger}
      </Button>
      <Drawer open={open} onOpenChange={setOpen} size="lg" title={t.import.title} description={t.import.description}>
        {open && <ImportForm key={session} />}
      </Drawer>
    </>
  );
}

function ImportForm() {
  const [report, setReport] = useState<ImportResult | null>(null);
  const { state, pending, error, onSubmit } = useKeepForm<ImportResult>(importRedirectsAction, {
    onSuccess: (s) => {
      if (s.message) toast.ok(s.message);
      setReport((s.ok && s.data) || null);
    },
  });
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      <ActionMessage state={state} showSuccess={false} />
      <div className="grid gap-1.5">
        <label htmlFor="redirect-csv-file" className={labelClass}>
          {t.import.file}
        </label>
        <input id="redirect-csv-file" type="file" name="file" accept=".csv,text/csv,text/plain" className="text-sm" />
        {error("file") ? <p className="text-xs text-crit">{error("file")}</p> : null}
      </div>
      <Textarea label={t.import.paste} name="csv" rows={8} inputClassName="font-mono text-xs" placeholder={t.import.pasteHint} spellCheck={false} />
      {report && report.errors.length > 0 ? (
        <div className="grid gap-1 rounded-md border border-line bg-panel-2 p-3 text-xs" role="status">
          <p className="font-medium text-ink">{t.import.errors(report.errors.length)}</p>
          <ul className="grid max-h-60 gap-0.5 overflow-auto">
            {report.errors.map((e) => (
              <li key={e.line}>
                <span className="font-mono text-muted">{t.import.line(e.line)}</span> — {e.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex justify-end">
        <PendingButton pending={pending} pendingLabel="Importing…">
          {t.import.submit}
        </PendingButton>
      </div>
    </form>
  );
}
