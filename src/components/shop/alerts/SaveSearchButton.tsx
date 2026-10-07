import { AlertDialogButton } from "./AlertDialog";
import { alertsCopy } from "./_copy";
import type { CatalogSearchInput } from "@/server/alerts/query";

/**
 * "Save search" for the catalog toolbar. Pass the parsed catalog params as they are:
 *   <SaveSearchButton query={{ q: params.q, tags: params.tags, min: params.min, max: params.max,
 *                              categoryId: category?.id ?? null, facetValueIds }} />
 * (tags = slugs, min/max = whole currency units; ids of other shops are dropped server-side).
 */
export function SaveSearchButton({ query, className }: { query: CatalogSearchInput; className?: string }) {
  const t = alertsCopy.save;
  return (
    <AlertDialogButton
      source={{ query }}
      label={t.button}
      title={t.dialogTitle}
      intro={t.intro}
      variant="outline"
      size="sm"
      className={className}
      defaultFrequency="DAILY"
    />
  );
}
