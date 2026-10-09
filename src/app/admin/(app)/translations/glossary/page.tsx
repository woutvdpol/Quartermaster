import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { TRANSLATION_LOCALES } from "@/server/translations/fields";
import { listGlossary } from "@/server/translations/service";
import { enabledLocales } from "@/server/translations/sync";
import { GlossaryEditor } from "../_components/GlossaryEditor";
import { TranslationsTabs } from "../_components/TranslationsTabs";

export const metadata: Metadata = { title: "Translation glossary" };

export default async function GlossaryPage() {
  const ctx = await requireStaffContext();
  const [terms, enabled] = await Promise.all([listGlossary(ctx), enabledLocales(ctx.tenantId)]);
  const locales = enabled.length ? enabled : [...TRANSLATION_LOCALES];
  return (
    <>
      <PageHeader crumb="Website · Translations" title="Glossary" />
      <TranslationsTabs active="glossary" />
      <div className="grid gap-4 p-4 md:px-[22px] md:py-5">
        <p className="max-w-3xl text-[13px] text-muted">
          Collector terms the translator must use, per language — or keep untranslated (unit names, “Stahlhelm”). Applied to every new machine translation; matching ignores
          upper/lower case and only whole words count. Maker codes, sizes, lot and stock numbers are always kept as they are.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          {locales.map((l) => (
            <GlossaryEditor key={l} locale={l} terms={terms.filter((t) => t.locale === l)} />
          ))}
        </div>
      </div>
    </>
  );
}
