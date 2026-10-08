import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/components/shop/ui/cn";
import { splitUnderstood } from "./highlight";
import { searchCopy } from "./_copy";

/*
 * Results-page pieces of smart search (docs/design/search/Results.dc.html). Server components: plain
 * links, no client JS — removing a chip or switching to a literal search is a navigation.
 */

const t = searchCopy.results;

export type ChipLink = { label: string; href: string };

/** “duitse helm ww2 *onder 500*” — the words the search understood as filters in the accent face. */
export function SearchHeading({ query, matched, scope }: { query: string; matched: string[]; scope?: string | null }) {
  const parts = splitUnderstood(query, matched);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm text-shop-muted">{scope ? `${t.eyebrow} · ${scope}` : t.eyebrow}</span>
      <h1 className="text-[2.1rem] leading-[1.05] tracking-[-0.03em] break-words text-shop-ink sm:text-[2.6rem]">
        “
        {parts.map((p, i) =>
          p.understood ? (
            <em key={i} className="font-shop-accent font-normal">
              {p.text}
            </em>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
        ”
      </h1>
    </div>
  );
}

const CloseGlyph = () => (
  <svg viewBox="0 0 20 20" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
    <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" strokeLinecap="round" />
  </svg>
);

/**
 * "We searched for helm with [Country: Germany ×] [Max €500 ×] — Search the words literally instead".
 * Renders nothing when the query was taken as plain words and nothing needs saying.
 */
export function InterpretationBar({
  text,
  chips,
  relaxed,
  literal,
}: {
  /** Free text that was searched (after the understood words). */
  text: string;
  chips: ChipLink[];
  relaxed: boolean;
  /** Literal-mode link: `on` = this page is a literal search (link back to the understood one). */
  literal: { on: boolean; href: string; q: string };
}) {
  if (literal.on) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-shop bg-shop-sunken px-4 py-3 text-sm text-shop-ink-2">
        <span>{t.literalOn(literal.q)}</span>
        <Link href={literal.href} rel="nofollow" className="text-shop-ink underline underline-offset-[3px] hover:text-shop-primary sm:ml-auto">
          {t.interpret}
        </Link>
      </div>
    );
  }
  if (!chips.length && !relaxed) return null;
  return (
    <div className="flex flex-col gap-2 rounded-shop bg-shop-sunken px-4 py-3" role="region" aria-label={searchCopy.panel.understood}>
      {relaxed ? <p className="text-sm text-shop-ink-2">{t.relaxed}</p> : null}
      {chips.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-sm text-shop-ink-2">
            {text ? (
              <>
                {t.searchedFor} <strong className="font-semibold text-shop-ink">{text}</strong> {t.with}
              </>
            ) : (
              t.onlyFilters
            )}
          </span>
          {chips.map((c) => (
            <Link
              key={c.label}
              href={c.href}
              rel="nofollow"
              aria-label={t.remove(c.label)}
              className="inline-flex h-8 items-center gap-2 rounded-shop-control border border-shop-line-strong bg-shop-surface pr-2 pl-3 text-sm font-semibold text-shop-ink transition-colors hover:border-shop-ink"
            >
              {c.label}
              <CloseGlyph />
            </Link>
          ))}
          <Link href={literal.href} rel="nofollow" className="text-sm text-shop-ink underline underline-offset-[3px] hover:text-shop-primary sm:ml-auto">
            {t.literal}
          </Link>
        </div>
      ) : null}
    </div>
  );
}

/** "Close, but not all filters match" — a horizontal rail below the results. */
export function NearMissRail({ dropped, total, allHref, children }: { dropped: string; total: number; allHref: string; children: ReactNode }) {
  return (
    <section aria-labelledby="search-near" className="mt-14 flex flex-col gap-3.5 border-t border-shop-line pt-8">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="flex flex-col gap-1">
          <h2 id="search-near" className="text-2xl text-shop-ink">
            {t.nearTitle}
          </h2>
          <p className="text-sm text-shop-muted">{t.nearBody(dropped, total)}</p>
        </div>
        {total > 1 ? (
          <Link href={allHref} rel="nofollow" className="text-sm font-medium text-shop-ink underline underline-offset-[3px] hover:text-shop-primary">
            {t.nearAll(total)}
          </Link>
        ) : null}
      </div>
      <div className="-mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]">{children}</div>
    </section>
  );
}

/** Zero results: did-you-mean, drop an understood filter, literal search, broader categories. */
export function SearchZeroState({
  q,
  didYouMean,
  without,
  literalHref,
  categories,
  wholeShop,
  className,
}: {
  q: string;
  didYouMean: { text: string; href: string } | null;
  without: ChipLink[];
  literalHref: string | null;
  categories: { label: string; href: string; count: number }[];
  /** On a category/landing page: the same search across the whole shop. */
  wholeShop: { label: string; href: string } | null;
  className?: string;
}) {
  const pill = "inline-flex h-9 items-center rounded-shop-control border border-shop-line-strong bg-shop-surface px-3.5 text-sm font-medium text-shop-ink transition-colors hover:border-shop-ink";
  return (
    <div className={cn("flex flex-col gap-6 rounded-shop bg-shop-sunken px-5 py-10 sm:px-10 sm:py-14", className)}>
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl text-shop-ink">{t.zeroTitle(q)}</h2>
        {didYouMean ? (
          <p className="text-[1.05rem] text-shop-ink-2">
            {t.didYouMean}{" "}
            <Link href={didYouMean.href} className="font-semibold text-shop-ink underline underline-offset-[3px] hover:text-shop-primary">
              {didYouMean.text}
            </Link>
            ?
          </p>
        ) : null}
        <p className="text-sm text-shop-muted">{searchCopy.results.tips}</p>
      </div>
      {without.length || literalHref || wholeShop ? (
        <div className="flex flex-wrap items-center gap-2">
          {without.map((c) => (
            <Link key={c.label} href={c.href} rel="nofollow" className={pill}>
              {t.tryWithout} “{c.label}”
            </Link>
          ))}
          {wholeShop ? (
            <Link href={wholeShop.href} rel="nofollow" className={pill}>
              {wholeShop.label}
            </Link>
          ) : null}
          {literalHref ? (
            <Link href={literalHref} rel="nofollow" className={pill}>
              {t.literal}
            </Link>
          ) : null}
        </div>
      ) : null}
      {categories.length ? (
        <div className="flex flex-col gap-2.5">
          <h3 className="font-shop-body text-sm font-semibold tracking-normal text-shop-ink-2">{t.browse}</h3>
          <ul className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <li key={c.href}>
                <Link href={c.href} className={pill}>
                  {c.label}
                  <span className="ml-2 text-xs text-shop-muted tabular-nums">{c.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
