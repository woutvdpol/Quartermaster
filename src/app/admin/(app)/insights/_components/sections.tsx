import type { ReactNode } from "react";
import Link from "next/link";
import { Card, ConfirmDialog, InlineAlert, KpiCard, buttonClasses, cx, formatMoney, tdClass, thClass } from "@/components/admin/ui";
import type { ServiceContext } from "@/server/context";
import {
  categoryHeadline,
  getBuyMore,
  getInsightsOverview,
  getStaleItems,
  type InsightPeriod,
  type StaleItem,
  type StaleList,
} from "@/server/insights";
import { requireTenantDisplay } from "@/server/tenant-display";
import { productEditPath } from "../../inventory/[id]/_copy";
import { repriceAction } from "../actions";
import { copy } from "../_copy";

/** Runs a loader; on failure logs and returns null so one broken card doesn't take the page down. */
async function safe<T>(label: string, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    console.error(`[insights] ${label} failed`, e);
    return { ok: false };
  }
}

function SectionError() {
  return (
    <InlineAlert tone="warn" live="none">
      {copy.error.section}
    </InlineAlert>
  );
}

type SectionProps = { ctx: ServiceContext; period: InsightPeriod; staleDays: number };

const nf = (n: number) => n.toLocaleString("en-NL");
const whole = (minor: number, currency: string) => formatMoney(minor, currency, undefined, { maximumFractionDigits: 0, minimumFractionDigits: 0 });
const pct = (share: number | null) => (share == null ? "—" : `${Math.round(share * 100)}%`);
const days = (d: number | null) => (d == null ? null : Math.round(d));

// ─── KPIs ───────────────────────────────────────────────────────────────────

export async function KpiSection({ ctx, period, staleDays }: SectionProps) {
  const [res, fmt] = await Promise.all([safe("overview", () => getInsightsOverview(ctx, { period, staleDays })), requireTenantDisplay(ctx.tenantId)]);
  if (!res.ok) return <SectionError />;
  const k = res.value.kpis;
  const cur = fmt.currency;
  const prevLabel = copy.previous[period];

  const md = days(k.medianDays);
  const mdPrev = days(k.medianDaysPrev);
  const mdDiff = md != null && mdPrev != null ? md - mdPrev : null;
  const stDiff = k.sellThrough != null && k.sellThroughPrev != null ? Math.round((k.sellThrough - k.sellThroughPrev) * 100) : null;

  return (
    <section aria-label={copy.kpis.label} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiCard
        label={copy.kpis.stockAtCost}
        value={whole(k.stockCost, cur)}
        note={
          <>
            {copy.kpis.stockNote(nf(k.stockItems), whole(k.stockList, cur))}
            {k.stockMissingCost > 0 && <span className="block text-warn">{copy.kpis.missingCost(k.stockMissingCost)}</span>}
          </>
        }
      />
      <KpiCard
        label={copy.kpis.medianDays}
        value={md == null ? "—" : nf(md)}
        // Fewer days is better: "down" in days is shown as good news.
        delta={mdDiff != null && mdDiff !== 0 ? (mdDiff < 0 ? copy.kpis.faster(-mdDiff, prevLabel) : copy.kpis.slower(mdDiff, prevLabel)) : undefined}
        trend={mdDiff == null || mdDiff === 0 ? "flat" : mdDiff < 0 ? "up" : "down"}
        note={md == null ? copy.kpis.noSales : mdDiff === 0 ? copy.kpis.same(prevLabel) : undefined}
      />
      <KpiCard
        label={copy.kpis.sellThrough}
        value={pct(k.sellThrough)}
        delta={stDiff != null && stDiff !== 0 ? `${Math.abs(stDiff)} ${copy.kpis.points}` : undefined}
        trend={stDiff == null || stDiff === 0 ? "flat" : stDiff > 0 ? "up" : "down"}
        note={k.listed === 0 ? copy.kpis.noListings : copy.kpis.sellThroughNote(k.listedSold, k.listed)}
      />
      <KpiCard
        label={copy.kpis.tiedUp(staleDays)}
        value={<span className={k.tiedCost > 0 ? "text-warn" : undefined}>{whole(k.tiedCost, cur)}</span>}
        note={copy.kpis.tiedNote(k.tiedItems)}
      />
    </section>
  );
}

// ─── By category ────────────────────────────────────────────────────────────

export async function CategorySection({ ctx, period, staleDays }: SectionProps) {
  const res = await safe("overview", () => getInsightsOverview(ctx, { period, staleDays }));
  if (!res.ok) {
    return (
      <Card title={copy.categories.title}>
        <SectionError />
      </Card>
    );
  }
  const rows = res.value.categories;
  const headline = categoryHeadline(rows);
  return (
    <Card title={copy.categories.title} padded={false}>
      {rows.length === 0 ? (
        <p className="p-3.5 text-[13px] text-muted">{copy.categories.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b border-line">
              <tr>
                <th scope="col" className={thClass}>{copy.categories.category}</th>
                <th scope="col" className={cx(thClass, "text-right")}>{copy.categories.inStock}</th>
                <th scope="col" className={cx(thClass, "text-right")}>{copy.categories.sold}</th>
                <th scope="col" className={cx(thClass, "text-right")}>{copy.categories.days}</th>
                <th scope="col" className={cx(thClass, "text-right")}>{copy.categories.margin}</th>
                <th scope="col" className={cx(thClass, "w-[28%]")}>{copy.categories.sellThrough}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id ?? "none"} className="border-b border-line last:border-b-0">
                  <th scope="row" className={cx(tdClass, "text-left font-medium")}>{c.title}</th>
                  <td className={cx(tdClass, "text-right tabular-nums")}>{nf(c.inStock)}</td>
                  <td className={cx(tdClass, "text-right tabular-nums")}>{nf(c.sold)}</td>
                  <td className={cx(tdClass, "text-right tabular-nums")}>{c.medianDays == null ? "—" : copy.categories.daysValue(Math.round(c.medianDays))}</td>
                  <td className={cx(tdClass, "text-right tabular-nums")}>{c.marginPct == null ? "—" : `${Math.round(c.marginPct)}%`}</td>
                  <td className={tdClass}>
                    <SellThroughBar share={c.sellThrough} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {headline && (
        <p className="border-t border-line px-3.5 py-2.5 text-xs text-muted">
          {copy.categories.headline(headline.fast, headline.slow, headline.ratio.toLocaleString("en-NL"), headline.margin)}
        </p>
      )}
    </Card>
  );
}

function SellThroughBar({ share }: { share: number | null }) {
  const value = share == null ? 0 : Math.round(share * 100);
  return (
    <span className="flex items-center gap-2">
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-panel-2" aria-hidden="true">
        <span className="block h-full rounded-full bg-accent" style={{ width: `${value}%` }} />
      </span>
      <span className="w-9 text-right text-xs tabular-nums">{pct(share)}</span>
    </span>
  );
}

// ─── Buy more of these ──────────────────────────────────────────────────────

export async function BuyMoreSection({ ctx, period, staleDays }: SectionProps) {
  const res = await safe("buyMore", () => getBuyMore(ctx, { period, staleDays }));
  if (!res.ok) {
    return (
      <Card title={copy.buyMore.title}>
        <SectionError />
      </Card>
    );
  }
  const { groups, zeroResults } = res.value;
  return (
    <Card title={copy.buyMore.title}>
      <div className="grid gap-3">
        {groups.length === 0 ? (
          <p className="text-[13px] text-muted">{copy.buyMore.noGroups}</p>
        ) : (
          <ul className="grid">
            {groups.map((g) => (
              <li key={g.key} className="flex items-start justify-between gap-3 border-b border-line py-2 first:pt-0 last:border-b-0">
                <span>
                  <b className="font-semibold">{g.label}</b>
                  <span className="block text-xs text-muted">{copy.buyMore.groupNote(g.sold, Math.round(g.medianDays ?? 0), g.marginPct == null ? null : Math.round(g.marginPct))}</span>
                </span>
                <span className="text-xs whitespace-nowrap text-ok">{copy.buyMore.inStock(g.inStock)}</span>
              </li>
            ))}
          </ul>
        )}
        <div>
          <h3 className="type-label mb-1 text-[11.5px] text-muted">{copy.buyMore.searchesTitle}</h3>
          {zeroResults.length === 0 ? (
            <p className="text-[13px] text-muted">{copy.buyMore.noSearches}</p>
          ) : (
            <ul className="grid gap-1 text-[13px]">
              {zeroResults.map((s) => (
                <li key={s.query}>{copy.buyMore.search(s.query, s.zeroResults)}</li>
              ))}
            </ul>
          )}
        </div>
        <p className="text-xs text-muted">{copy.buyMore.basis}</p>
      </div>
    </Card>
  );
}

// ─── Sitting too long ───────────────────────────────────────────────────────

export async function StaleSection({ ctx, period, staleDays, thresholdLinks }: SectionProps & { thresholdLinks: ReactNode }) {
  const [res, fmt] = await Promise.all([safe("stale", () => getStaleItems(ctx, { period, staleDays })), requireTenantDisplay(ctx.tenantId)]);
  if (!res.ok) {
    return (
      <Card title={copy.stale.title(0)}>
        <SectionError />
      </Card>
    );
  }
  const list = res.value;
  return (
    <Card
      title={copy.stale.title(list.total)}
      aside={
        <span className="flex flex-wrap items-center gap-3">
          <span>{copy.stale.note}</span>
          {thresholdLinks}
        </span>
      }
      padded={false}
    >
      {list.items.length === 0 ? (
        <p className="p-3.5 text-[13px] text-muted">{copy.stale.empty(staleDays)}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b border-line">
              <tr>
                <th scope="col" className={thClass}>{copy.stale.item}</th>
                <th scope="col" className={thClass}>{copy.stale.listed}</th>
                <th scope="col" className={thClass}>
                  <abbr title={copy.stale.viewsTitle} className="no-underline">
                    {copy.stale.viewsAlerts}
                  </abbr>
                </th>
                <th scope="col" className={thClass}>{copy.stale.why}</th>
                <th scope="col" className={thClass}>{copy.stale.suggestion}</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((item) => (
                <StaleRow key={item.id} item={item} list={list} currency={fmt.currency} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.total > list.items.length && <p className="border-t border-line px-3.5 py-2.5 text-xs text-muted">{copy.stale.more(list.total - list.items.length)}</p>}
    </Card>
  );
}

function reasonText(item: StaleItem, currency: string): string {
  const r = copy.stale.reasons;
  if (item.reason === "comparables" && item.reprice) return r.comparables(whole(item.reprice.low, currency), whole(item.reprice.high, currency));
  if (item.reason === "comparables") return r.price;
  return r[item.reason];
}

function StaleRow({ item, list, currency }: { item: StaleItem; list: StaleList; currency: string }) {
  const money = (v: number) => formatMoney(v, currency);
  const fairHref = list.nextFair ? `/admin/fairs/${list.nextFair.id}` : "/admin/fairs";
  const homeHref = list.homePageId ? `/admin/pages/${list.homePageId}` : "/admin/pages";
  const secondary = buttonClasses({ variant: "ghost", size: "sm" });
  return (
    <tr className="border-b border-line align-top last:border-b-0">
      <td className={tdClass}>
        <span className="block font-mono text-[11px] text-muted">No. {item.stockCode}</span>
        <Link href={productEditPath(item.id)} className="hover:underline">
          {item.title}
        </Link>{" "}
        · <b className="tabular-nums">{money(item.price)}</b>
      </td>
      <td className={cx(tdClass, "whitespace-nowrap tabular-nums")}>{copy.stale.days(item.daysListed)}</td>
      <td className={cx(tdClass, "whitespace-nowrap tabular-nums")}>
        {item.views == null ? copy.stale.noViews : nf(item.views)} / {nf(item.interest)}
      </td>
      <td className={cx(tdClass, "text-muted")}>{reasonText(item, currency)}</td>
      <td className={tdClass}>
        <span className="flex flex-wrap gap-1.5">
          {item.reprice?.price != null && (
            <ConfirmDialog
              trigger={copy.stale.reprice(whole(item.reprice.price, currency))}
              triggerSize="sm"
              triggerVariant="secondary"
              tone="primary"
              title={copy.stale.repriceTitle(item.stockCode)}
              description={copy.stale.repriceBody(item.title, money(item.price), money(item.reprice.price), item.reprice.count)}
              confirmLabel={copy.stale.repriceConfirm}
              action={repriceAction}
              fields={{ productId: item.id, expectedPrice: String(item.price), price: String(item.reprice.price) }}
            />
          )}
          {item.reason === "findability" && (
            <Link href={homeHref} className={buttonClasses({ variant: "secondary", size: "sm" })}>
              {copy.stale.feature}
            </Link>
          )}
          {item.reason === "slowCategory" && item.bundleWith && (
            <span className="self-center text-xs text-muted" title={copy.stale.bundleTitle(item.bundleWith.title)}>
              {copy.stale.bundle(item.bundleWith.stockCode)}
            </span>
          )}
          <Link href={fairHref} className={secondary}>
            {copy.stale.fair}
          </Link>
        </span>
      </td>
    </tr>
  );
}

