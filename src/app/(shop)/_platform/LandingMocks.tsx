import { cn } from "@/components/shop/ui/cn";
import { SearchIcon } from "@/components/shop/layout/icons";
import { platformCopy as t } from "./_copy";
import { Chip, DEMO_PHOTOS, DemoPhoto, DemoTag, type ChipTone } from "./parts";
import { BoxIcon, GavelIcon, GlobeIcon, GridIcon, LockIcon, ReceiptIcon, ShieldIcon, StoreIcon, TableIcon, UsersIcon, WifiOffIcon } from "./icons";

/*
 * Product-UI mockups on the platform landing. They show the product with demo data (marked as such)
 * in the page's own tokens; they are pictures (role="img" + label), not working UI.
 */

const d = t.demo;
const RAIL_ICONS = [GridIcon, BoxIcon, ReceiptIcon, UsersIcon, GavelIcon, TableIcon, ShieldIcon];
const HERO_CHANNELS: { Icon: typeof StoreIcon; tone: ChipTone }[] = [
  { Icon: StoreIcon, tone: "ok" },
  { Icon: GlobeIcon, tone: "ok" },
  { Icon: TableIcon, tone: "info" },
];

const stockNumber = "font-pf-mono text-[12.5px] leading-none font-medium text-pf-muted";

/** Hero: the admin product page of one piece, with the channels it lives in. */
export function AdminWindow() {
  return (
    <div role="img" aria-label={t.hero.windowLabel} className="overflow-hidden rounded-t-xl border border-pf-line bg-pf-paper-2 text-left text-[13.5px] leading-[1.45] text-pf-ink shadow-pf-frame">
      <div className="flex h-[38px] items-center gap-2 border-b border-pf-line bg-pf-panel px-3.5">
        <i className="size-2.5 rounded-full bg-pf-line" />
        <i className="size-2.5 rounded-full bg-pf-line" />
        <i className="size-2.5 rounded-full bg-pf-line" />
        <span className="mx-auto hidden rounded-md border border-pf-line bg-pf-paper-2 px-3.5 py-[5px] text-xs leading-none font-medium text-pf-muted sm:block">{d.adminUrl}</span>
      </div>
      <div className="grid lg:min-h-[470px] lg:grid-cols-[188px_1fr]">
        <div className="hidden flex-col gap-0.5 bg-pf-olive px-2.5 py-4 text-pf-olive-ink lg:flex">
          <div className="px-2.5 pt-1 pb-4 text-[13px] leading-tight font-semibold text-white">
            {d.shop}
            <small className="mt-[3px] block font-normal text-pf-olive-muted">{d.domain}</small>
          </div>
          {d.rail.map((label, i) => {
            const Icon = RAIL_ICONS[i];
            return (
              <span key={label} className={cn("flex items-center gap-2.5 rounded-[5px] px-2.5 py-[7px] text-sm leading-none font-medium", i === 1 && "bg-pf-olive-2 text-white")}>
                <Icon className="size-4 text-pf-olive-muted" />
                {label}
              </span>
            );
          })}
        </div>
        <div className="p-4 sm:px-[26px] sm:py-[22px]">
          <div className="text-[12.5px] text-pf-muted">{d.crumb}</div>
          <div className="mt-1.5 flex items-start justify-between gap-4">
            <div>
              <span className={stockNumber}>{d.piece.stock}</span>
              <div className="mt-0.5 font-pf-display text-[19px] leading-[1.2] font-semibold sm:text-[22px]">
                {d.piece.titleStart}
                <span className="whitespace-nowrap">{d.piece.titleEnd}</span>
              </div>
            </div>
            <DemoTag>{d.tag}</DemoTag>
          </div>
          <div className="mt-[18px] grid gap-[22px] sm:grid-cols-[150px_1fr]">
            <DemoPhoto src={DEMO_PHOTOS.greatcoat} eager className="hidden sm:block" />
            <div>
              <div className="overflow-hidden rounded-md border border-pf-line">
                <div className="flex justify-between border-b border-pf-line bg-pf-panel px-3 py-[9px] text-[12.5px] leading-none font-medium text-pf-muted">
                  <span>{d.where[0]}</span>
                  <span>{d.where[1]}</span>
                </div>
                <div className="divide-y divide-pf-line-soft">
                  {d.heroChannels.map(([name, sub, state], i) => {
                    const { Icon, tone } = HERO_CHANNELS[i];
                    return (
                      <div key={name} className="grid grid-cols-[22px_1fr_auto] items-center gap-2.5 px-3 py-2.5">
                        <Icon className="size-[18px] text-pf-muted" />
                        <div>
                          <b className="font-semibold">{name}</b>
                          <small className="hidden text-[12.5px] text-pf-muted sm:block">{sub}</small>
                        </div>
                        <Chip tone={tone}>{state}</Chip>
                      </div>
                    );
                  })}
                </div>
              </div>
              <dl className="mt-3.5 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-pf-line bg-pf-line">
                {(
                  [
                    [d.facts.price, d.piece.price],
                    [d.facts.stock, d.piece.stockCount],
                    [d.facts.margin, d.piece.margin],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="bg-pf-paper-2 px-3 py-2.5">
                    <dt className="text-[12.5px] leading-none font-medium text-pf-muted">{label}</dt>
                    <dd className="mt-1.5 text-[15px] font-semibold tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Fair mode on a phone. */
export function FairPhone() {
  const p = d.phone;
  return (
    <div role="img" aria-label={t.features.fair.label} className="w-[300px] max-w-full rounded-[40px] bg-pf-device p-3 shadow-pf-frame">
      <div className="overflow-hidden rounded-[30px] bg-pf-paper-2 text-sm leading-[1.4] text-pf-ink">
        <div className="flex items-center justify-between bg-pf-olive px-[18px] pt-4 pb-3 text-[13px] leading-none font-semibold text-white">
          <span>{p.fair}</span>
          <span className="text-pf-olive-muted">{p.mode}</span>
        </div>
        <div className="m-3.5 rounded-[10px] border border-pf-line bg-pf-paper p-3.5">
          <div className="flex items-center gap-3">
            <div className="w-14 flex-none">
              <DemoPhoto src={DEMO_PHOTOS.officerCap} />
            </div>
            <div>
              <span className={stockNumber}>{p.stock}</span>
              <b className="block text-[14.5px] font-semibold">{p.title}</b>
            </div>
          </div>
          <div className="mt-3.5 flex items-baseline justify-between border-t border-pf-line-soft pt-3">
            <strong className="font-pf-display text-[28px] leading-none font-semibold tracking-[-0.01em] tabular-nums">{p.price}</strong>
            <small className="text-[12.5px] text-pf-muted tabular-nums">{p.floor}</small>
          </div>
        </div>
        <div className="mx-3.5 grid grid-cols-2 gap-2 font-semibold">
          <span className="grid h-[46px] place-items-center rounded-lg border border-pf-ink bg-pf-ink text-white">{p.cash}</span>
          <span className="grid h-[46px] place-items-center rounded-lg border border-pf-line bg-pf-paper">{p.card}</span>
        </div>
        <div className="mx-3.5 mt-2.5 grid h-[50px] place-items-center rounded-[10px] bg-pf-brass font-semibold text-white">{p.record}</div>
        <div className="m-3.5 flex items-center gap-2 rounded-lg bg-pf-warn-soft px-3 py-2.5 text-[12.5px] font-semibold text-pf-warn">
          <WifiOffIcon />
          {p.offline}
        </div>
      </div>
    </div>
  );
}

/** A storefront list with one sensitive piece blurred for this visitor. */
export function StoreGrid() {
  const s = d.store;
  return (
    <div role="img" aria-label={t.features.compliance.label} className="w-full max-w-[440px] overflow-hidden rounded-xl border border-pf-line bg-pf-paper text-sm leading-[1.45] text-pf-ink shadow-pf-frame">
      <div className="flex justify-between gap-4 border-b border-pf-line-soft px-4 py-3 text-[12.5px] text-pf-muted">
        <span>{s.path}</span>
        <span>{s.visitor}</span>
      </div>
      <div className="grid grid-cols-2 gap-3.5 p-4">
        {s.cards.map((card, i) => (
          <div key={card.stock}>
            <div className="relative overflow-hidden rounded-lg">
              <DemoPhoto src={i === 0 ? DEMO_PHOTOS.navyGreatcoat : DEMO_PHOTOS.greatcoat} className={cn("rounded-lg", i === 1 && "scale-[1.08] blur-[9px] saturate-[0.6]")} />
              {i === 1 ? (
                <span className="absolute top-1/2 left-1/2 inline-flex -translate-1/2 items-center gap-1.5 rounded-full border border-pf-line bg-pf-paper/95 px-3 py-1.5 text-[12.5px] font-semibold whitespace-nowrap">
                  <LockIcon className="size-3.5" />
                  {s.locked}
                </span>
              ) : null}
            </div>
            <b className="mt-2 block text-[13.5px] font-semibold">{card.title}</b>
            <small className="font-pf-mono text-[11.5px] text-pf-muted">{card.stock}</small>
            <div className="mt-0.5 font-semibold tabular-nums">{card.price}</div>
          </div>
        ))}
      </div>
      <div className="mx-4 mb-4 flex items-center gap-2.5 rounded-lg bg-pf-info-soft px-3 py-2.5 text-[13px] font-medium text-pf-info">
        <ShieldIcon className="size-4" />
        {s.rule}
      </div>
    </div>
  );
}

/** Network search: one query across dealers, your piece among them. */
export function NetworkSearch() {
  const s = d.search;
  const rows = [
    { title: `${d.piece.titleStart}${d.piece.titleEnd}`, where: d.domain, price: d.piece.price, photo: DEMO_PHOTOS.greatcoat, yours: true },
    { ...s.results[0], photo: DEMO_PHOTOS.navyGreatcoat, yours: false },
    { ...s.results[1], photo: DEMO_PHOTOS.sailorCap, yours: false },
  ];
  return (
    <div role="img" aria-label={t.network.label} className="w-full max-w-[460px] overflow-hidden rounded-xl bg-pf-paper-2 text-sm leading-[1.45] text-pf-ink shadow-pf-frame-dark">
      <div className="m-4 flex h-[46px] items-center gap-2.5 rounded-lg border border-pf-line bg-pf-paper px-3.5">
        <SearchIcon className="size-5 text-pf-muted" />
        <span className="flex-1">{s.query}</span>
        <DemoTag>{d.tagShort}</DemoTag>
      </div>
      {rows.map((row) => (
        <div key={row.title} className={cn("grid grid-cols-[52px_1fr_auto] items-center gap-3 border-t border-pf-line-soft px-4 py-3", row.yours && "bg-pf-line-soft")}>
          <DemoPhoto src={row.photo} />
          <div>
            <b className="block text-[13.5px] font-semibold">{row.title}</b>
            <small className={cn("text-[12.5px]", row.yours ? "font-semibold text-pf-ink" : "text-pf-muted")}>{row.where}</small>
          </div>
          <span className="font-semibold tabular-nums">{row.price}</span>
        </div>
      ))}
    </div>
  );
}
