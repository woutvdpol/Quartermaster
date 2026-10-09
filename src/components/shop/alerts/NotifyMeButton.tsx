import { AlertDialogButton } from "./AlertDialog";
import { shopCopy } from "@/server/i18n/locale";
import { alertsCopies } from "./_copy";
import type { CatalogSearchInput } from "@/server/alerts/query";

/**
 * "Get notified when a similar item arrives" — for SOLD / RESERVED product pages.
 * Without `suggestedQuery` the server derives it from the product (category + facet values).
 * Same HTML for every visitor (safe inside cached product pages).
 */
export async function NotifyMeButton({
  productId,
  suggestedQuery,
  className,
  fullWidth = true,
}: {
  productId: string;
  /** Optional explicit query (catalog-param shape); default: the product's category + facets. */
  suggestedQuery?: CatalogSearchInput;
  className?: string;
  fullWidth?: boolean;
}) {
  const t = (await shopCopy(alertsCopies)).notify;
  return (
    <div className={className}>
      <p className="mb-2 text-sm text-shop-ink-2">{t.lead}</p>
      <AlertDialogButton
        source={suggestedQuery ? { query: suggestedQuery } : { productId }}
        label={t.button}
        title={t.dialogTitle}
        intro={t.intro}
        variant="outline"
        fullWidth={fullWidth}
        defaultFrequency="INSTANT"
      />
    </div>
  );
}
