"use client";

import { useState, useTransition } from "react";
import { Button, Card, Checkbox, TextInput, toast } from "@/components/admin/ui";
import { LOCALE_LABELS, type TranslationLocale } from "@/server/translations/fields";
import type { GlossaryRow } from "@/server/translations/service";
import { addSuggestedTermsAction, deleteTermAction, saveTermAction } from "../actions";

/** Glossary of one language: list of terms (English → translation / never translate) + add form. */
export function GlossaryEditor({ locale, terms }: { locale: TranslationLocale; terms: GlossaryRow[] }) {
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [keep, setKeep] = useState(false);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      const res = await saveTermAction({ locale, source, target: keep ? null : target });
      if (!res.ok) return void toast.crit(res.message ?? "Could not save the term.");
      toast.ok(res.message ?? "Saved.");
      setSource("");
      setTarget("");
      setKeep(false);
    });

  const remove = (id: string) =>
    start(async () => {
      const res = await deleteTermAction(id);
      (res.ok ? toast.ok : toast.crit)(res.message ?? "");
    });

  const suggest = () =>
    start(async () => {
      const res = await addSuggestedTermsAction(locale);
      (res.ok ? toast.ok : toast.crit)(res.message ?? "");
    });

  return (
    <Card title={`Your glossary · ${locale.toUpperCase()}`} aside={LOCALE_LABELS[locale]}>
      <div className="grid gap-3">
        {terms.length ? (
          <ul className="grid gap-1">
            {terms.map((t) => (
              <li key={t.id} className="flex items-center gap-2 rounded-control border border-line bg-panel-2 px-2.5 py-1.5 text-[13px]">
                <span className="min-w-0 flex-1 truncate text-ink">{t.source}</span>
                <span aria-hidden="true" className="text-muted">
                  →
                </span>
                <b className={t.target ? "min-w-0 flex-1 truncate text-ink" : "min-w-0 flex-1 truncate font-medium text-muted"}>{t.target ?? "never translate"}</b>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  aria-label={`Edit ${t.source}`}
                  onClick={() => {
                    setSource(t.source);
                    setTarget(t.target ?? "");
                    setKeep(t.target === null);
                  }}
                >
                  Edit
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} aria-label={`Remove ${t.source}`} onClick={() => remove(t.id)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">No terms yet.</p>
        )}
        <form
          className="grid gap-2 border-t border-line pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <TextInput label="English term" value={source} onChange={(e) => setSource(e.target.value)} maxLength={100} placeholder="liner" required />
            <TextInput
              label={`${LOCALE_LABELS[locale]} translation`}
              value={keep ? "" : target}
              onChange={(e) => setTarget(e.target.value)}
              maxLength={100}
              placeholder={locale === "de" ? "Innenfutter" : "voering"}
              disabled={keep}
            />
          </div>
          <Checkbox label="Never translate (keep the English/original term)" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" size="sm" disabled={pending || !source.trim() || (!keep && !target.trim())}>
              + Add or update term
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={suggest} title="Wehrmacht, Heer, Luftwaffe, Kriegsmarine, Stahlhelm … as “never translate”">
              Add suggested collector terms
            </Button>
          </div>
        </form>
      </div>
    </Card>
  );
}
