import type { Metadata } from "next";
import Link from "next/link";
import {
  EmptyState,
  FilterBar,
  FilterSelect,
  InlineAlert,
  PageHeader,
  Pagination,
  ViewTabs,
  buttonClasses,
  getParam,
  parsePage,
} from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { ENTITY_LABELS, LOCALE_LABELS, TRANSLATION_ENTITIES, TRANSLATION_LOCALES, type TranslationEntityName, type TranslationLocale } from "@/server/translations/fields";
import { getTranslationOverview, listTranslations, type ReviewView } from "@/server/translations/service";
import { ReviewList } from "./_components/ReviewList";
import { RetranslateButton } from "./_components/RetranslateButton";
import { TranslationsTabs } from "./_components/TranslationsTabs";

export const metadata: Metadata = { title: "Translations" };

const BASE = "/admin/translations";
const PAGE_SIZE = 20;
const VIEWS: { value: ReviewView; label: string }[] = [
  { value: "review", label: "To review" },
  { value: "queued", label: "Waiting for translator" },
  { value: "approved", label: "Approved" },
  { value: "all", label: "All" },
];

export default async function TranslationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireStaffContext();
  const overview = await getTranslationOverview(ctx);

  if (!overview.locales.length) {
    return (
      <>
        <PageHeader crumb="Website · Translations" title="Translations" />
        <EmptyState
          title="The shop is only in English"
          body="Switch on Dutch or German under Settings → Languages. Texts are then translated on your own server and go online in a language after you approve them."
          action={
            <Link href="/admin/settings/i18n" className={buttonClasses({ variant: "primary" })}>
              Shop languages
            </Link>
          }
        />
      </>
    );
  }

  const viewParam = getParam(sp, "view");
  const view: ReviewView = VIEWS.some((v) => v.value === viewParam) ? (viewParam as ReviewView) : "review";
  const localeParam = getParam(sp, "locale");
  const locale = (TRANSLATION_LOCALES as readonly string[]).includes(localeParam ?? "") ? (localeParam as TranslationLocale) : undefined;
  const entityParam = getParam(sp, "entity");
  const entity = (TRANSLATION_ENTITIES as readonly string[]).includes(entityParam ?? "") ? (entityParam as TranslationEntityName) : undefined;
  const page = parsePage(sp.page);
  const list = await listTranslations(ctx, { view, locale, entity, page, pageSize: PAGE_SIZE });

  return (
    <>
      <PageHeader
        crumb="Website · Translations"
        title="Translations"
        actions={
          <>
            {overview.locales.map((l) => (
              <RetranslateButton key={l} locale={l} label={`Translate unreviewed ${l.toUpperCase()} again`} />
            ))}
            <Link href="/admin/settings/i18n" className={buttonClasses({ variant: "ghost" })}>
              Languages & bulk translate
            </Link>
          </>
        }
      />
      <TranslationsTabs active="review" />
      <div className="grid gap-3 p-4 md:px-[22px] md:py-5">
        <div className="flex flex-wrap gap-2">
          {overview.locales.map((l) => {
            const c = overview.counts[l];
            return (
              <p key={l} className="rounded-card border border-line bg-panel px-3 py-2 text-[13px] shadow-card">
                <span className="font-medium text-ink">{LOCALE_LABELS[l]}</span>
                <span className="text-muted">
                  {" "}
                  · {c.approved} online · {c.machine} to review{c.stale ? ` · ${c.stale} changed since approval` : ""}
                  {c.queued ? ` · ${c.queued} waiting` : ""}
                </span>
              </p>
            );
          })}
        </div>
        {!overview.translatorConfigured ? (
          <InlineAlert tone="warn">Machine translation is not configured on this server (no embedder). You can still type and approve translations yourself.</InlineAlert>
        ) : null}
        <p className="max-w-3xl text-[13px] text-muted">
          Machine translations stay offline until you approve them; visitors see English until then. Approve them one by one (edit first if needed), or select several and approve
          them as they are. When the English text changes, the approved translation stays online and shows up here as “English changed”.
        </p>
        <ViewTabs
          basePath={BASE}
          searchParams={sp}
          active={view === "review" ? null : view}
          views={VIEWS.map((v) => ({ value: v.value === "review" ? null : v.value, label: v.label, count: list.counts[v.value] }))}
        />
        <FilterBar>
          <FilterSelect param="locale" label="Language" anyLabel="All languages" options={overview.locales.map((l) => ({ value: l, label: LOCALE_LABELS[l] }))} />
          <FilterSelect param="entity" label="Type" anyLabel="All types" options={TRANSLATION_ENTITIES.map((e) => ({ value: e, label: ENTITY_LABELS[e] }))} />
        </FilterBar>
        {list.rows.length ? (
          <ReviewList key={`${view}-${locale}-${entity}-${page}`} rows={list.rows} />
        ) : (
          <EmptyState
            compact
            title={view === "review" ? "Nothing to review" : "Nothing here"}
            body={
              view === "review"
                ? list.counts.queued
                  ? `${list.counts.queued} texts are waiting for the translator; they appear here when done.`
                  : "New and changed texts are translated automatically. Use “Translate existing stock” under Settings → Languages for older items."
                : undefined
            }
          />
        )}
        <Pagination page={page} pageSize={PAGE_SIZE} total={list.total} basePath={BASE} searchParams={sp} />
      </div>
    </>
  );
}
