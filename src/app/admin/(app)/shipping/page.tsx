import type { Metadata } from "next";
import Link from "next/link";
import { Card, ConfirmDialog, EmptyState, InlineAlert, Money, PageHeader, StatusPill } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { getSettings } from "@/server/settings";
import { countryName, getCoverage, listZones, REST_OF_WORLD, type ShippingZoneWithRates } from "@/server/shipping";
import { requireTenantDisplay } from "@/server/tenant-display";
import { deleteZoneAction } from "./actions";
import { MoveButtons } from "./_components/MoveButtons";
import { QuoteTester } from "./_components/QuoteTester";
import { ZoneDrawer, type ZoneData } from "./_components/ZoneDrawer";
import { tierLabel } from "./_util";

export const metadata: Metadata = { title: "Shipping" };

const MAX_CHIPS = 14;

function toZoneData(z: ShippingZoneWithRates): ZoneData {
  return {
    id: z.id,
    name: z.name,
    countries: z.countries,
    isPickup: z.isPickup,
    isActive: z.isActive,
    rates: z.rates.map((r) => ({ maxWeightGrams: r.maxWeightGrams, price: r.price, insurancePrice: r.insurancePrice, maxInsuredValue: r.maxInsuredValue })),
  };
}

/** Countries of every other delivery zone (for the one-zone-per-country hint in the picker). */
function takenBy(zones: ShippingZoneWithRates[], exceptId?: string) {
  const taken: Record<string, string> = {};
  let rest: string | null = null;
  for (const z of zones) {
    if (z.isPickup || z.id === exceptId) continue;
    for (const c of z.countries) {
      if (c === REST_OF_WORLD) rest ??= z.name;
      else taken[c] ??= z.name;
    }
  }
  return { taken, rest };
}

export default async function ShippingPage() {
  const ctx = await requireStaffContext();
  const [zones, coverage, tenant, checkout] = await Promise.all([
    listZones(ctx),
    getCoverage(ctx),
    requireTenantDisplay(ctx.tenantId),
    getSettings(ctx.tenantId, "checkout"),
  ]);
  const currency = tenant.currency;
  const all = takenBy(zones);
  const restZone = zones.find((z) => z.id === coverage.restOfWorldZoneId);

  const addButton = (
    <ZoneDrawer trigger="Add zone" triggerVariant="primary" currency={currency} taken={all.taken} restOfWorldTakenBy={all.rest} />
  );

  return (
    <>
      <PageHeader crumb="System" title="Shipping" actions={addButton} />
      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-labelledby="zones-title" className="grid min-w-0 content-start gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="zones-title" className="type-label text-sm text-ink">
              Shipping zones
            </h2>
            <p className="text-xs text-muted">Price per weight tier, including packaging. Prices in {currency}.</p>
          </div>

          {zones.length === 0 ? (
            <Card>
              <EmptyState
                title="No shipping zones yet"
                body="Customers cannot get a delivery price until you add a zone. Start with your home country or Benelux, then add a rest-of-world zone."
                action={addButton}
              />
            </Card>
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {zones.map((z, i) => (
                <li key={z.id}>
                  <ZoneCard zone={z} index={i} count={zones.length} currency={currency} zones={zones} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="grid content-start gap-4" aria-label="Coverage and quote test">
          <Card title="Coverage">
            {restZone ? (
              <p className="text-[13px] text-ink-2">
                Every country is covered. Countries not listed in another zone use the rest-of-world zone{" "}
                <b className="font-medium text-ink">“{restZone.name}”</b>.
              </p>
            ) : coverage.uncovered.length === 0 ? (
              <p className="text-[13px] text-ink-2">Every country is listed in an active delivery zone.</p>
            ) : (
              <div className="grid gap-2">
                <InlineAlert tone="warn" title={`${coverage.uncovered.length} countries have no delivery`}>
                  No active delivery zone covers them and there is no active rest-of-world zone. Customers there can only use pickup.
                </InlineAlert>
                <details className="text-[13px]">
                  <summary className="cursor-pointer text-accent">Show uncovered countries</summary>
                  <ul className="mt-2 flex max-h-56 flex-wrap gap-1 overflow-y-auto">
                    {coverage.uncovered.map((c) => (
                      <li key={c} title={countryName(c)} className="rounded-control border border-line bg-panel-2 px-1.5 py-px font-mono text-[11.5px] text-ink-2">
                        {c}
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            )}
            <p className="mt-2 text-xs text-muted">
              Free shipping:{" "}
              {checkout.freeShippingThresholdCents > 0 ? (
                <>
                  from <Money amount={checkout.freeShippingThresholdCents} currency={currency} />
                </>
              ) : (
                "off"
              )}{" "}
              · <Link href="/admin/settings/checkout" className="text-accent underline-offset-2 hover:underline">Change in settings</Link>
            </p>
          </Card>

          <Card title="Test a quote" aside="Same calculation as checkout">
            <QuoteTester currency={currency} defaultCountry={zones.find((z) => !z.isPickup)?.countries.find((c) => c !== REST_OF_WORLD) ?? "NL"} freeShippingThreshold={checkout.freeShippingThresholdCents} />
          </Card>
        </aside>
      </div>
    </>
  );
}

function ZoneCard({ zone: z, index, count, currency, zones }: { zone: ShippingZoneWithRates; index: number; count: number; currency: string; zones: ShippingZoneWithRates[] }) {
  const isRest = z.countries.includes(REST_OF_WORLD);
  const others = takenBy(zones, z.id);
  const weights = z.rates.map((r) => r.maxWeightGrams);
  const chips = z.countries.filter((c) => c !== REST_OF_WORLD);

  return (
    <article className={`grid h-full content-start gap-3 rounded-card border border-line bg-panel p-3.5 shadow-card ${z.isActive ? "" : "opacity-75"}`} aria-labelledby={`zone-${z.id}`}>
      <header className="flex items-start justify-between gap-2">
        <div className="grid gap-1">
          <h3 id={`zone-${z.id}`} className="text-[15px] font-semibold text-ink">
            {z.name}
          </h3>
          <div className="flex flex-wrap gap-1">
            {z.isPickup && <StatusPill tone="info">Pickup</StatusPill>}
            {isRest && <StatusPill tone="mute">Rest of world</StatusPill>}
            {!z.isActive && <StatusPill tone="warn">Inactive</StatusPill>}
          </div>
        </div>
        <span className="shrink-0 text-xs text-muted">
          {isRest ? "all other countries" : chips.length === 0 ? (z.isPickup ? "all customers" : "no countries") : `${chips.length} ${chips.length === 1 ? "country" : "countries"}`}
        </span>
      </header>

      {chips.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label="Countries">
          {chips.slice(0, MAX_CHIPS).map((c) => (
            <li key={c} title={countryName(c)} className="rounded-control bg-panel-2 px-1.5 py-px font-mono text-[11.5px] text-ink-2">
              {c}
            </li>
          ))}
          {chips.length > MAX_CHIPS && <li className="px-1 text-[11.5px] text-muted">+{chips.length - MAX_CHIPS} more</li>}
        </ul>
      )}

      {z.rates.length === 0 ? (
        <p className={`text-[13px] ${z.isPickup ? "text-muted" : "text-warn"}`}>
          {z.isPickup ? "No tiers: pickup is free." : "No weight tiers: this zone offers no delivery."}
        </p>
      ) : (
        <table className="w-full text-[13px]">
          <caption className="sr-only">Weight tiers of {z.name}</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Weight</th>
              <th scope="col">Price</th>
            </tr>
          </thead>
          <tbody>
            {z.rates.map((r, i) => (
              <tr key={r.id} className="border-t border-line">
                <td className="py-1.5 text-ink-2">
                  {z.isPickup && i === 0 ? "pickup" : tierLabel(weights, i)}
                  {r.insurancePrice !== null && (
                    <span className="block text-[11.5px] text-muted">
                      insurance <Money amount={r.insurancePrice} currency={currency} />
                      {r.maxInsuredValue !== null && (
                        <>
                          {" "}up to <Money amount={r.maxInsuredValue} currency={currency} />
                        </>
                      )}
                    </span>
                  )}
                </td>
                <td className="py-1.5 text-right">
                  <Money amount={r.price} currency={currency} mono />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5">
        <MoveButtons id={z.id} name={z.name} first={index === 0} last={index === count - 1} />
        <span className="flex flex-wrap gap-1.5">
          <ConfirmDialog
            trigger="Delete"
            triggerSize="sm"
            triggerVariant="ghost"
            title={`Delete zone “${z.name}”?`}
            description="The zone and its weight tiers are removed. Past orders keep the zone name. This cannot be undone."
            confirmLabel="Delete zone"
            action={deleteZoneAction}
            fields={{ id: z.id }}
          />
          <ZoneDrawer trigger="Edit" triggerSize="sm" zone={toZoneData(z)} currency={currency} taken={others.taken} restOfWorldTakenBy={others.rest} />
        </span>
      </footer>
    </article>
  );
}
