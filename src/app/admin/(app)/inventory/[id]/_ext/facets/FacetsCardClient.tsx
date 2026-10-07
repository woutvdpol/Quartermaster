"use client";

import { useId, useState, useTransition } from "react";
import { Checkbox, controlClass, cx, toast } from "@/components/admin/ui";
import type { TaxonomyFacet } from "@/server/facets/service";
import { setProductFacetAction } from "./actions";

/** Per facet: chips of the chosen values + an expandable, filterable checkbox tree. */
export function FacetsCardClient({ productId, facets, initialSelected }: { productId: string; facets: TaxonomyFacet[]; initialSelected: string[] }) {
  const [selected, setSelected] = useState(() => new Set(initialSelected));
  const [pendingFacet, setPendingFacet] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function toggle(facet: TaxonomyFacet, valueId: string, on: boolean) {
    const before = selected;
    const next = new Set(before);
    if (on) next.add(valueId);
    else next.delete(valueId);
    setSelected(next);
    setPendingFacet(facet.id);
    const ids = facet.values.filter((v) => next.has(v.id)).map((v) => v.id);
    startTransition(async () => {
      const res = await setProductFacetAction(productId, facet.id, ids);
      setPendingFacet(null);
      if (!res.ok) {
        setSelected(before);
        toast.crit(res.message ?? "Could not save the facet values.");
      }
    });
  }

  return (
    <div className="grid gap-3">
      {facets.map((facet) => (
        <FacetPicker key={facet.id} facet={facet} selected={selected} pending={pendingFacet === facet.id} onToggle={(id, on) => toggle(facet, id, on)} />
      ))}
    </div>
  );
}

function FacetPicker({ facet, selected, pending, onToggle }: { facet: TaxonomyFacet; selected: Set<string>; pending: boolean; onToggle: (id: string, on: boolean) => void }) {
  const [q, setQ] = useState("");
  const listId = useId();
  const chosen = facet.values.filter((v) => selected.has(v.id));
  const needle = q.trim().toLowerCase();
  const visible = needle ? facet.values.filter((v) => v.path.toLowerCase().includes(needle)) : facet.values;
  return (
    <div className="grid gap-1.5" aria-busy={pending || undefined}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="type-label text-[11.5px] text-muted">{facet.name}</span>
        {pending && <span className="text-[11px] text-muted">Saving…</span>}
      </div>
      {chosen.length > 0 ? (
        <ul className="flex flex-wrap gap-1" aria-label={`${facet.name}: selected values`}>
          {chosen.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => onToggle(v.id, false)}
                aria-label={`Remove ${v.path}`}
                title={`Remove ${v.path}`}
                className="inline-flex items-center gap-1 rounded-control border border-line bg-panel-2 px-1.5 py-px text-[12px] text-ink-2 hover:border-crit hover:text-crit"
              >
                {v.path} <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">None</p>
      )}
      <details className="group">
        <summary className="cursor-pointer text-xs font-medium text-ink-2 hover:text-ink">Choose…</summary>
        <div className="mt-1.5 grid gap-1.5">
          {facet.values.length > 8 && (
            <input type="search" aria-label={`Filter ${facet.name} values`} aria-controls={listId} placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} className={controlClass} />
          )}
          <ul id={listId} className="max-h-56 overflow-y-auto rounded-control border border-line bg-panel">
            {visible.map((v) => (
              <li key={v.id} className={cx("border-b border-line py-1 pr-2 last:border-b-0")} style={{ paddingLeft: `calc(0.625rem + ${needle ? 0 : v.depth} * 1rem)` }}>
                <Checkbox label={needle ? v.path : v.name} checked={selected.has(v.id)} onChange={(e) => onToggle(v.id, e.currentTarget.checked)} />
              </li>
            ))}
            {visible.length === 0 && <li className="px-3 py-3 text-center text-xs text-muted">No value matches.</li>}
          </ul>
        </div>
      </details>
    </div>
  );
}
