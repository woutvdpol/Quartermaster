"use client";

import { Tabs } from "@/components/admin/ui";
import type { TranslationLocale } from "@/server/translations/fields";
import type { EntityTranslationField } from "@/server/translations/service";
import { TranslationEditor } from "../../../../translations/_components/TranslationEditor";

const NAMES: Record<TranslationLocale, string> = { nl: "NL", de: "DE" };

/** Tabs per shop language; each tab lists the product's translatable fields. */
export function TranslationsPanel({ productId, locales, fields }: { productId: string; locales: TranslationLocale[]; fields: EntityTranslationField[] }) {
  const withText = fields.filter((f) => f.source);
  return (
    <div className="grid gap-3">
      <Tabs
        label="Translation language"
        items={locales.map((locale) => {
          const open = withText.filter((f) => f.cells[locale]?.status !== "APPROVED" || f.cells[locale]?.stale).length;
          return {
            id: locale,
            label: NAMES[locale],
            badge: open ? <span className="text-[11px] text-warn">· {open} open</span> : <span className="text-[11px] text-ok">· reviewed</span>,
            content: (
              <div className="grid gap-5 pt-3">
                {withText.length === 0 ? <p className="text-[13px] text-muted">Nothing to translate yet.</p> : null}
                {withText.map((f) => {
                  const c = f.cells[locale];
                  return (
                    <TranslationEditor
                      key={`${locale}-${f.field}`}
                      cell={{ entity: "PRODUCT", entityId: productId, field: f.field, locale }}
                      fieldLabel={f.label}
                      source={f.source}
                      markdown={f.markdown}
                      status={c?.status ?? null}
                      value={c?.value ?? null}
                      stale={c?.stale ?? false}
                    />
                  );
                })}
              </div>
            ),
          };
        })}
      />
      <p className="text-xs text-muted">
        Translated on your own server — texts never leave it. A language shows a text only after you approve it; until then visitors see English. Facet values and categories
        are translated once in the review list, not per product.
      </p>
    </div>
  );
}
