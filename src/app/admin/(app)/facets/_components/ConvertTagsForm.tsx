"use client";

import { useMemo, useState } from "react";
import { ActionMessage, Checkbox, Select, Switch, controlClass, cx, toast } from "@/components/admin/ui";
import { PendingButton, useKeepForm } from "../../_system/client";
import { copy } from "../_copy";
import { convertTagsAction } from "../actions";

const t = copy.convert;

type FacetOption = { id: string; name: string; values: { id: string; label: string }[] };

/** Select tags → target facet (+ optional parent value) → convert. */
export function ConvertTagsForm({ tags, facets }: { tags: { id: string; name: string; productCount: number }[]; facets: FacetOption[] }) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [facetId, setFacetId] = useState(facets[0]?.id ?? "");
  const { state, pending, error, onSubmit } = useKeepForm(convertTagsAction, {
    onSuccess: (s) => {
      if (s.message) toast.ok(s.message);
      setSelected(new Set());
    },
  });
  const needle = q.trim().toLowerCase();
  const visible = useMemo(() => new Set(tags.filter((tg) => !needle || tg.name.toLowerCase().includes(needle)).map((tg) => tg.id)), [tags, needle]);
  const facet = facets.find((f) => f.id === facetId);

  function toggle(tagId: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(tagId);
      else next.delete(tagId);
      return next;
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <ActionMessage state={state} showSuccess={false} />
      <fieldset className="grid gap-2">
        <legend className="type-label mb-1 text-[11.5px] text-muted">{t.tags}</legend>
        {tags.length === 0 ? (
          <p className="text-sm text-muted">{t.noTags}</p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <input type="search" aria-label={t.search} placeholder={t.search} value={q} onChange={(e) => setQ(e.target.value)} className={cx(controlClass, "flex-1")} />
              <span className="text-xs whitespace-nowrap text-muted" aria-live="polite">
                {t.selected(selected.size)}
              </span>
            </div>
            <ul className="max-h-72 overflow-y-auto rounded-control border border-line bg-panel">
              {tags.map((tg) => (
                <li key={tg.id} className={cx("border-b border-line px-2.5 py-1.5 last:border-b-0", !visible.has(tg.id) && "hidden")}>
                  <Checkbox
                    name="tagIds"
                    value={tg.id}
                    checked={selected.has(tg.id)}
                    onChange={(e) => toggle(tg.id, e.currentTarget.checked)}
                    label={
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span>{tg.name}</span>
                        <span className="text-xs text-muted">{t.products(tg.productCount)}</span>
                      </span>
                    }
                  />
                </li>
              ))}
              {visible.size === 0 && <li className="px-3 py-4 text-center text-[13px] text-muted">{t.noMatch}</li>}
            </ul>
          </>
        )}
        {error("tagIds") && <p className="text-xs text-crit">{error("tagIds")}</p>}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label={t.facet}
          name="facetId"
          value={facetId}
          onChange={(e) => setFacetId(e.target.value)}
          options={facets.map((f) => ({ value: f.id, label: f.name }))}
          placeholder
          error={error("facetId")}
        />
        <Select
          key={facetId}
          label={t.parent}
          name="parentId"
          defaultValue=""
          options={[{ value: "", label: t.root }, ...(facet?.values.map((v) => ({ value: v.id, label: v.label })) ?? [])]}
          error={error("parentId")}
        />
      </div>
      <Switch label={t.deleteTags} description={t.deleteTagsHint} name="deleteTags" defaultChecked />
      <div>
        <PendingButton pending={pending} pendingLabel={t.pending} disabled={selected.size === 0 || !facetId}>
          {t.submit}
        </PendingButton>
      </div>
    </form>
  );
}
