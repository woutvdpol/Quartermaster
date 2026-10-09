import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/shop/ui/JsonLd";
import { countryName } from "@/server/shipping/countries";
import { getNetworkDirectory, networkFilterOptions, searchNetwork } from "@/server/network/service";
import { networkQueryString, parseNetworkParams, NETWORK_MAX_QUERY, type NetworkSearchParams } from "@/server/network/params";
import { requireNetworkRequest } from "@/server/network/request";
import { networkHref, platformApplyUrl } from "@/lib/network";
import { MAX_RESULTS } from "@/server/search";
import { NetworkShell } from "./_components/NetworkShell";
import { NetworkCard } from "./_components/NetworkCard";
import { NetworkPhotoSearch } from "./_components/NetworkPhotoSearch";
import { AutoSubmit } from "./_components/AutoSubmit";
import { DealerList } from "./_components/DealerList";
import { networkCopy as t } from "./_copy";

/*
 * The Quartermaster network (docs/network.md): one search over the stock of every shop that opted in.
 * Served at PLATFORM_HOST/network, or at "/" on NETWORK_HOST (src/lib/network.ts). Public and read-only;
 * every result links into the dealer's own shop, where the buyer checks out.
 */

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const req = await requireNetworkRequest();
  const filtered = Object.keys(await searchParams).length > 0;
  const url = `${req.origin}${networkHref(req.base)}`;
  return {
    title: { absolute: t.metaTitle },
    description: t.metaDescription,
    alternates: { canonical: url },
    // Search/filter permutations are crawl traps: only the plain page is indexed (dealers + their shops are).
    ...(filtered ? { robots: { index: false, follow: true } } : {}),
    openGraph: { type: "website", siteName: t.brand, title: t.metaTitle, description: t.metaDescription, url },
  };
}

function Hidden({ params, omit }: { params: NetworkSearchParams; omit: ("q" | "filters" | "sort")[] }) {
  return (
    <>
      {!omit.includes("q") && params.q ? <input type="hidden" name="q" value={params.q} /> : null}
      {!omit.includes("sort") && params.q && params.sort === "newest" ? <input type="hidden" name="sort" value="newest" /> : null}
      {!omit.includes("filters") ? (
        <>
          {params.dealers.map((d) => (
            <input key={`d-${d}`} type="hidden" name="dealer" value={d} />
          ))}
          {params.ships ? <input type="hidden" name="ships" value="1" /> : null}
          {params.period.map((v) => (
            <input key={`p-${v}`} type="hidden" name="period" value={v} />
          ))}
          {params.country.map((v) => (
            <input key={`c-${v}`} type="hidden" name="country" value={v} />
          ))}
        </>
      ) : null}
    </>
  );
}

const DEALERS_ON_HOME = 6;
const checkbox = "mt-0.5 size-4 shrink-0 accent-[#7E5416]";

export default async function NetworkPage({ searchParams }: Props) {
  const req = await requireNetworkRequest();
  const params = parseNetworkParams(await searchParams);
  const [dir, result] = await Promise.all([getNetworkDirectory(), searchNetwork(params, req.country)]);
  const options = networkFilterOptions(dir);
  const home = networkHref(req.base);
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const dealerCount = Object.keys(result.perDealer).length;
  const hasFilters = params.dealers.length > 0 || params.ships || params.period.length > 0 || params.country.length > 0;
  const pageHref = (page: number) => `${home}${networkQueryString({ ...params, page })}`;

  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: t.metaTitle,
    itemListElement: result.items.map((c, i) => ({ "@type": "ListItem", position: (result.page - 1) * result.pageSize + i + 1, url: c.href, name: c.title })),
  };
  const organization = { "@context": "https://schema.org", "@type": "Organization", name: `${t.brand} ${t.brandTag}`, url: `${req.origin}${home}` };

  return (
    <NetworkShell base={req.base} applyUrl={platformApplyUrl(req.base)}>
      <JsonLd data={organization} />
      {result.items.length ? <JsonLd data={itemList} /> : null}
      <div className="bg-[#2A2F22] text-[#ECECE5]">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-3.5 px-4 pt-6 pb-10 sm:px-6">
          <h1 className="max-w-[820px] text-[40px] leading-none font-bold sm:text-[52px] [font-family:var(--nw-display)]">{t.title}</h1>
          <form action={home} role="search" className="flex h-14 max-w-[820px] items-center gap-2.5 rounded-full bg-white pr-2 pl-5">
            <label htmlFor="network-q" className="sr-only">
              {t.searchLabel}
            </label>
            <input
              id="network-q"
              type="search"
              name="q"
              defaultValue={params.q}
              maxLength={NETWORK_MAX_QUERY}
              placeholder={t.searchPlaceholder}
              className="min-w-0 flex-1 bg-transparent text-[17px] text-[#1E2119] outline-none placeholder:text-[#8A8C7E]"
            />
            <Hidden params={params} omit={["q", "sort"]} />
            <NetworkPhotoSearch />
            <button type="submit" className="h-[42px] shrink-0 rounded-full bg-[#C08A2E] px-5.5 font-semibold text-[#1E2119] hover:bg-[#D9A94E]">
              {t.searchButton}
            </button>
          </form>
          <p className="text-[13px] text-[#C9CBBC]">{t.stats(dir.dealers.length, dir.totalProducts)}</p>
        </div>
      </div>

      <main id="main" className="mx-auto flex max-w-[1240px] flex-wrap gap-7 px-4 pt-7 pb-16 sm:px-6">
        <aside aria-label={t.filters.label} className="flex max-w-full flex-[1_1_220px] flex-col gap-4.5 text-sm sm:max-w-[260px]">
          <form action={home} className="flex flex-col gap-4.5">
            <Hidden params={params} omit={["filters"]} />
            {dir.dealers.length ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1.5 font-semibold">{t.filters.dealer}</legend>
                {dir.dealers.map((d) => (
                  <label key={d.id} className="flex gap-2">
                    <input type="checkbox" name="dealer" value={d.slug} defaultChecked={params.dealers.includes(d.slug)} className={checkbox} />
                    <span>
                      {d.name}
                      {d.country ? <span className="text-[#6B6E60]"> · {d.country}</span> : null}
                    </span>
                  </label>
                ))}
              </fieldset>
            ) : null}
            {req.country ? (
              <label className="flex items-start gap-2">
                <input type="checkbox" name="ships" value="1" defaultChecked={params.ships} className={checkbox} />
                <span>
                  {t.filters.ships(countryName(req.country))}
                  <br />
                  <span className="text-[13px] text-[#6B6E60]">{t.filters.shipsHint}</span>
                </span>
              </label>
            ) : null}
            {(
              [
                ["period", t.filters.period, options.period, params.period],
                ["country", t.filters.country, options.country, params.country],
              ] as const
            ).map(([name, legend, opts, selected]) =>
              opts.length ? (
                <fieldset key={name} className="flex flex-col gap-2">
                  <legend className="mb-1.5 font-semibold">{legend}</legend>
                  {opts.map((o) => (
                    <label key={o.key} className="flex gap-2">
                      <input type="checkbox" name={name} value={o.key} defaultChecked={selected.includes(o.key)} className={checkbox} />
                      {o.label}
                    </label>
                  ))}
                </fieldset>
              ) : null,
            )}
            <div className="flex flex-wrap items-center gap-3">
              <button id="network-apply" type="submit" className="h-9 rounded-full border border-[#1E2119] px-4 font-semibold hover:bg-[#1E2119] hover:text-white">
                {t.filters.apply}
              </button>
              {hasFilters ? (
                <Link href={`${home}${networkQueryString({ q: params.q, sort: params.sort })}`} className="text-[#7E5416] underline-offset-2 hover:underline">
                  {t.filters.clear}
                </Link>
              ) : null}
            </div>
            <AutoSubmit buttonId="network-apply" />
          </form>
          <p className="rounded-[10px] border border-[#DEDCCF] bg-white p-3.5 text-[13px] leading-normal text-[#4A4D40]">{t.trust}</p>
        </aside>

        <section aria-label={t.resultsLabel} className="flex min-w-0 flex-[999_1_640px] flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <p className="text-sm" aria-live="polite">
              <b>{result.total >= MAX_RESULTS ? t.countCapped : t.count(result.total, dealerCount)}</b>
              {result.text ? <> {t.searchedFor(result.text)}</> : null}
            </p>
            {params.q ? (
              <form action={home} className="flex items-center gap-2">
                <Hidden params={params} omit={["sort"]} />
                <label htmlFor="network-sort" className="sr-only">
                  {t.sort.label}
                </label>
                <select
                  id="network-sort"
                  name="sort"
                  defaultValue={params.sort}
                  className="h-9 rounded-full border border-[#DEDCCF] bg-white px-3 text-sm"
                >
                  <option value="relevance">{t.sort.relevance}</option>
                  <option value="newest">{t.sort.newest}</option>
                </select>
                <button id="network-sort-apply" type="submit" className="h-9 rounded-full border border-[#DEDCCF] bg-white px-3 text-sm">
                  {t.sort.label}
                </button>
                <AutoSubmit buttonId="network-sort-apply" />
              </form>
            ) : null}
          </div>
          {result.items.length ? (
            <ul className="grid grid-cols-2 gap-x-4.5 gap-y-5.5 sm:grid-cols-[repeat(auto-fill,minmax(210px,1fr))]">
              {result.items.map((card, i) => (
                <li key={card.id} className="flex">
                  <NetworkCard card={card} priority={i === 0} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed border-[#DEDCCF] p-8 text-center text-[#4A4D40]">{dir.dealers.length ? t.none : t.empty}</p>
          )}
          {pages > 1 ? (
            <nav aria-label={t.pageOf(result.page, pages)} className="flex items-center justify-center gap-4 pt-4 text-sm">
              {result.page > 1 ? (
                <Link href={pageHref(result.page - 1)} rel="prev" className="rounded-full border border-[#DEDCCF] bg-white px-4 py-2 hover:border-[#7E5416]">
                  {t.prev}
                </Link>
              ) : null}
              <span className="text-[#6B6E60]">{t.pageOf(result.page, pages)}</span>
              {result.page < pages ? (
                <Link href={pageHref(result.page + 1)} rel="next" className="rounded-full border border-[#DEDCCF] bg-white px-4 py-2 hover:border-[#7E5416]">
                  {t.next}
                </Link>
              ) : null}
            </nav>
          ) : null}
        </section>
      </main>

      {dir.dealers.length ? (
        <section aria-labelledby="network-dealers" className="mx-auto grid max-w-[1240px] gap-4 px-4 pb-14 sm:px-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="network-dealers" className="text-[28px] font-bold [font-family:var(--nw-display)]">
              {t.dealers.title}
            </h2>
            <Link href={networkHref(req.base, "/dealers")} className="text-sm text-[#7E5416] underline-offset-2 hover:underline">
              {t.dealers.all}
            </Link>
          </div>
          <DealerList dealers={dir.dealers.slice(0, DEALERS_ON_HOME)} base={req.base} headingLevel={3} />
        </section>
      ) : null}
    </NetworkShell>
  );
}
