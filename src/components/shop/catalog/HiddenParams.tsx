import type { CatalogParams } from "@/server/storefront-catalog/params";

type Key = "q" | "facets" | "tags" | "min" | "max" | "sort" | "view";

/** Hidden inputs that carry the current catalog state through a plain GET form (works without JS). */
export function HiddenParams({ params, keep, defaultSort }: { params: CatalogParams; keep: Key[]; defaultSort: string }) {
  const k = new Set(keep);
  return (
    <>
      {k.has("q") && params.q ? <input type="hidden" name="q" value={params.q} /> : null}
      {k.has("facets") ? params.facets.map((f) => <input key={`f:${f}`} type="hidden" name="f" value={f} />) : null}
      {k.has("tags") ? params.tags.map((t) => <input key={t} type="hidden" name="tag" value={t} />) : null}
      {k.has("min") && params.min !== null ? <input type="hidden" name="min" value={params.min} /> : null}
      {k.has("max") && params.max !== null ? <input type="hidden" name="max" value={params.max} /> : null}
      {k.has("sort") && params.sort !== defaultSort ? <input type="hidden" name="sort" value={params.sort} /> : null}
      {k.has("view") && params.view ? <input type="hidden" name="view" value={params.view} /> : null}
    </>
  );
}
