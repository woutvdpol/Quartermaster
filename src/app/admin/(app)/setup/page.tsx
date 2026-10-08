import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Card, InlineAlert, PageHeader, StatusPill, SubmitButton, buttonClasses, cx, formatMoney } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import {
  SETUP_STEPS,
  SHIPPING_TEMPLATES,
  completedStepCount,
  firstOpenStep,
  getGoLiveChecklist,
  getLegalPageStatus,
  getPendingSetup,
  isSetupStepKey,
  previousStep,
  shippingTemplateLabel,
  shippingTemplateZones,
  stepIndex,
  stepStatus,
  type ImportChoice,
  type SetupState,
  type SetupStepKey,
} from "@/server/onboarding";
import { listImportJobs } from "@/server/import";
import { getMollieStatus } from "@/server/payments/mollie-config";
import { DISPLAY_CURRENCIES, getSettings } from "@/server/settings";
import { COUNTRIES, countryName, type CountryCode } from "@/server/shipping/countries";
import { db } from "@/server/db";
import { MollieKeyForm } from "../payment-methods/_components/MollieKeyForm";
import { ThemeBuilderSection } from "../theme/_components/ThemeBuilderSection";
import { markStepAction, saveMollieKeyStepAction } from "./actions";
import { BasicsForm, BusinessForm, DomainForm, GoLiveForm, ImportForm, LegalForm, ShippingTemplateForm } from "./_components/forms";

export const metadata: Metadata = { title: "Set up your shop" };

type Tenant = NonNullable<Awaited<ReturnType<typeof getPendingSetup>>>;
type Ctx = Awaited<ReturnType<typeof requireStaffContext>>;

/**
 * Setup wizard for the OWNER of a newly approved shop (docs/design/onboarding/Wizard.dc.html).
 * Everyone else — SUPERADMINs, owners of shops that predate the wizard or have gone live — gets
 * the dashboard (owners) or a 404.
 */
export default async function SetupPage({ searchParams }: PageProps<"/admin/setup">) {
  const sp = await searchParams;
  const ctx = await requireStaffContext();
  const tenant = await getPendingSetup(ctx);
  if (!tenant) {
    if (ctx.actor.role === "OWNER") redirect("/admin/dashboard");
    notFound();
  }
  const requested = typeof sp.step === "string" ? sp.step : undefined;
  const step: SetupStepKey = isSetupStepKey(requested) ? requested : firstOpenStep(tenant.state);
  const def = SETUP_STEPS[stepIndex(step)];
  const done = completedStepCount(tenant.state);

  return (
    <>
      <PageHeader
        crumb={
          <>
            Setup · Step {stepIndex(step) + 1} of {SETUP_STEPS.length} ·{" "}
            <Link href="/admin/dashboard" className="underline-offset-2 hover:text-ink hover:underline">
              Save and finish later
            </Link>
          </>
        }
        title="Set up your shop"
        actions={<StatusPill tone={done === SETUP_STEPS.length ? "ok" : "info"}>{`${done} of ${SETUP_STEPS.length} steps done`}</StatusPill>}
      />
      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <StepList state={tenant.state} current={step} />
        <Card title={def.label} aside={def.skippable ? "Optional" : undefined}>
          <StepBody step={step} ctx={ctx} tenant={tenant} />
        </Card>
      </div>
    </>
  );
}

function StepList({ state, current }: { state: SetupState; current: SetupStepKey }) {
  return (
    <nav aria-label="Setup steps">
      <ol className="grid gap-1">
        {SETUP_STEPS.map((s, i) => {
          const status = stepStatus(state, s.key);
          const isCurrent = s.key === current;
          return (
            <li key={s.key}>
              <Link
                href={`/admin/setup?step=${s.key}`}
                aria-current={isCurrent ? "step" : undefined}
                className={cx(
                  "flex items-center gap-3 rounded-control border px-3 py-2.5",
                  isCurrent ? "border-line bg-panel shadow-card" : "border-transparent hover:bg-panel",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    "grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-semibold",
                    status === "done" && "bg-ok-soft text-ok",
                    status === "skipped" && "border border-line bg-panel-2 text-muted",
                    status === "todo" && (isCurrent ? "bg-accent text-on-accent" : "border border-line bg-panel text-muted"),
                  )}
                >
                  {status === "done" ? "✓" : status === "skipped" ? "–" : i + 1}
                </span>
                <span className="grid min-w-0">
                  <span className={cx("text-[13.5px]", isCurrent && "font-semibold", status === "todo" && !isCurrent && "text-muted")}>
                    {s.label}
                    <span className="sr-only">{status === "done" ? " (done)" : status === "skipped" ? " (skipped)" : ""}</span>
                  </span>
                  <span className="truncate text-xs text-muted">{s.hint}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** "Skip for now" (skippable steps) — a plain form posting to markStepAction. */
function SkipButton({ step }: { step: SetupStepKey }) {
  return (
    <form action={markStepAction}>
      <input type="hidden" name="step" value={step} />
      <input type="hidden" name="status" value="skipped" />
      <SubmitButton variant="ghost" pendingLabel="Skipping…">
        Skip for now
      </SubmitButton>
    </form>
  );
}

function ContinueButton({ step, label = "Continue" }: { step: SetupStepKey; label?: string }) {
  return (
    <form action={markStepAction}>
      <input type="hidden" name="step" value={step} />
      <input type="hidden" name="status" value="done" />
      <SubmitButton pendingLabel="Saving…">{label}</SubmitButton>
    </form>
  );
}

function StepFooter({ step, children }: { step: SetupStepKey; children?: ReactNode }) {
  const prev = previousStep(step);
  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
      {prev ? (
        <Link href={`/admin/setup?step=${prev}`} className={buttonClasses({ variant: "ghost" })}>
          ← Back: {SETUP_STEPS[stepIndex(prev)].label}
        </Link>
      ) : (
        <span />
      )}
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function Intro({ children }: { children: ReactNode }) {
  return <p className="mb-4 max-w-2xl text-[13.5px] text-muted">{children}</p>;
}

async function StepBody({ step, ctx, tenant }: { step: SetupStepKey; ctx: Ctx; tenant: Tenant }) {
  const primaryHost = tenant.domains.find((d) => d.isPrimary)?.host ?? tenant.domains[0]?.host ?? "";
  const skippable = SETUP_STEPS[stepIndex(step)].skippable;
  const skip = skippable ? <SkipButton step={step} /> : null;

  switch (step) {
    case "basics": {
      const general = await getSettings(ctx.tenantId, "general");
      return (
        <>
          <Intro>The essentials of your shop. You can change everything later under Settings.</Intro>
          <BasicsForm
            shopName={general.shopName || tenant.name}
            contactEmail={general.contactEmail || ctx.actor.email}
            host={primaryHost}
            currency={tenant.currency}
            currencies={DISPLAY_CURRENCIES.filter((c) => c !== tenant.currency)}
            displayCurrencies={general.displayCurrencies}
          />
        </>
      );
    }

    case "business": {
      const g = await getSettings(ctx.tenantId, "general");
      const countries = (Object.keys(COUNTRIES) as CountryCode[]).map((c) => ({ value: c, label: COUNTRIES[c] })).sort((a, b) => a.label.localeCompare(b.label));
      return (
        <>
          <Intro>Shown on invoices and in your legal pages. Your Chamber of Commerce number and address are required to go live.</Intro>
          <BusinessForm
            values={{
              cocNumber: g.cocNumber,
              vatNumber: g.vatNumber,
              iban: g.iban,
              phone: g.phone,
              line1: g.address.line1,
              line2: g.address.line2,
              postalCode: g.address.postalCode,
              city: g.address.city,
              country: g.address.country,
            }}
            countries={countries}
          />
          <StepFooter step={step} />
        </>
      );
    }

    case "look":
      return (
        <>
          <Intro>Choose a theme preset (Gallery, Archive, Field Kit or Vault) and tune colours, fonts and your logo, with a live preview.</Intro>
          <ThemeBuilderSection variant="embedded" />
          <p className="mt-3 text-xs text-muted">
            Publish your theme when you are happy with it, then continue. You can always fine-tune it later under{" "}
            <Link href="/admin/theme" className="underline">
              Theme
            </Link>
            .
          </p>
          <StepFooter step={step}>
            {skip}
            <ContinueButton step={step} label="Done, continue" />
          </StepFooter>
        </>
      );

    case "payments": {
      const mollie = await getMollieStatus(ctx);
      return (
        <>
          <Intro>Payments run through Mollie. Connect a test key first to try checkout without real money; switch to your live key before going live.</Intro>
          <div className="grid gap-4">
            {mollie.configured ? (
              <InlineAlert tone={mollie.mode === "live" ? "ok" : "info"} title={`Mollie connected in ${mollie.mode} mode`}>
                Key <span className="font-mono">{mollie.maskedKey}</span>. Choose payment methods and surcharges later on the{" "}
                <Link href="/admin/payment-methods" className="underline">
                  Payment methods
                </Link>{" "}
                page.
              </InlineAlert>
            ) : null}
            <MollieKeyForm replacing={mollie.configured} action={saveMollieKeyStepAction} />
          </div>
          <StepFooter step={step}>
            {skip}
            {mollie.configured ? <ContinueButton step={step} /> : null}
          </StepFooter>
        </>
      );
    }

    case "shipping": {
      const zones = await db.shippingZone.findMany({
        where: { tenantId: ctx.tenantId, isPickup: false },
        orderBy: { sortOrder: "asc" },
        select: { id: true, name: true, countries: true, _count: { select: { rates: true } } },
      });
      if (zones.length) {
        return (
          <>
            <Intro>Your delivery zones. Edit rates, weight tiers, insurance and pickup on the Shipping page.</Intro>
            <ul className="grid gap-1.5 text-[13.5px]">
              {zones.map((z) => (
                <li key={z.id} className="flex flex-wrap justify-between gap-2 rounded-control border border-line px-3 py-2">
                  <span className="font-medium">{z.name}</span>
                  <span className="text-muted">
                    {z.countries.includes("*") ? "Rest of world" : `${z.countries.length} ${z.countries.length === 1 ? "country" : "countries"}`} · {z._count.rates}{" "}
                    {z._count.rates === 1 ? "rate" : "rates"}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3">
              <Link href="/admin/shipping" className="text-[13px] underline-offset-2 hover:underline">
                Edit zones and rates →
              </Link>
            </p>
            <StepFooter step={step}>
              <ContinueButton step={step} />
            </StepFooter>
          </>
        );
      }
      const general = await getSettings(ctx.tenantId, "general");
      const home = general.address.country || "NL";
      const templates = SHIPPING_TEMPLATES.map((t) => {
        const zs = shippingTemplateZones(t, home);
        return {
          value: t,
          label: shippingTemplateLabel(t, home),
          description: zs.map((z) => `${z.name} from ${formatMoney(z.rates[0].price, tenant.currency)}`).join(" · "),
        };
      });
      return (
        <>
          <Intro>
            Pick a starting point for {countryName(home)}. Zones are created with starter rates per weight (up to 2, 10 and 30 kg) in {tenant.currency} that you can
            change any time.
          </Intro>
          <ShippingTemplateForm templates={templates} />
          <StepFooter step={step}>{skip}</StepFooter>
        </>
      );
    }

    case "import": {
      const current = tenant.state.import?.choice ?? null;
      const jobs = await listImportJobs(ctx, 1);
      const labels: Record<ImportChoice, string> = { woocommerce: "WooCommerce", shopify: "Shopify", concept500: "Concept500", empty: "Start empty" };
      return (
        <>
          <Intro>Import your existing catalogue. Nothing is published until you check the preview — imported items start as drafts unless you choose otherwise.</Intro>
          {current ? (
            <div className="mb-4">
              <InlineAlert tone="ok" title={`Done: ${labels[current as ImportChoice] ?? current}`}>
                {current === "concept500"
                  ? "The Quartermaster team has been notified and contacts you to plan the migration."
                  : current === "empty"
                    ? "Add products whenever you are ready under Inventory."
                    : "Your products are imported. Check them under Inventory."}
              </InlineAlert>
            </div>
          ) : null}
          <ImportForm current={current} currency={tenant.currency} initialJob={jobs[0] ?? null} />
          <StepFooter step={step}>
            {skip}
            {current ? <ContinueButton step={step} /> : null}
          </StepFooter>
        </>
      );
    }

    case "legal": {
      const pages = await getLegalPageStatus(ctx.tenantId);
      return (
        <>
          <Intro>Every shop needs terms and conditions and a privacy policy; EU consumers also expect returns and shipping information.</Intro>
          <div className="mb-4">
            <InlineAlert tone="warn" title="Templates — have them checked">
              These English texts are a starting point, filled with your business details. They are not legal advice: have them checked for your country and
              business before relying on them. Edit them any time under Pages.
            </InlineAlert>
          </div>
          <LegalForm pages={pages.map((p) => ({ key: p.key, title: p.title, published: p.published, exists: p.pageId !== null }))} />
          {pages.some((p) => p.pageId) ? (
            <ul className="mt-4 grid gap-1 text-[13px]">
              {pages
                .filter((p) => p.pageId)
                .map((p) => (
                  <li key={p.key} className="flex items-center gap-2">
                    <StatusPill tone={p.published ? "ok" : "mute"}>{p.published ? "Published" : "Draft"}</StatusPill>
                    <Link href={`/admin/pages/${p.pageId}`} className="underline-offset-2 hover:underline">
                      Edit {p.title.toLowerCase()}
                    </Link>
                  </li>
                ))}
            </ul>
          ) : null}
          <StepFooter step={step}>{skip}</StepFooter>
        </>
      );
    }

    case "golive": {
      const items = await getGoLiveChecklist(ctx);
      const ready = items.every((i) => !i.required || i.ok);
      const warnings = items.filter((i) => !i.required && !i.ok).length;
      const cnameTarget = primaryHost.replace(/:\d+$/, "");
      return (
        <>
          <Intro>A last check before you open the doors. Required points must be green; the others are strongly recommended.</Intro>
          <ul className="grid gap-2">
            {items.map((i) => (
              <li key={i.key} className="flex flex-wrap items-start justify-between gap-2 rounded-control border border-line px-3 py-2.5">
                <span className="grid gap-0.5">
                  <span className="flex items-center gap-2 text-[13.5px] font-medium">
                    <StatusPill tone={i.ok ? "ok" : i.required ? "crit" : "warn"}>{i.ok ? "OK" : i.required ? "Required" : "Recommended"}</StatusPill>
                    {i.label}
                  </span>
                  <span className="text-xs text-muted">{i.detail}</span>
                </span>
                {!i.ok && i.href ? (
                  <Link href={i.href} className={buttonClasses({ size: "sm" })}>
                    Fix
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>

          <section aria-labelledby="own-domain" className="mt-5 grid gap-3 rounded-card border border-line bg-panel-2 p-4">
            <h3 id="own-domain" className="type-label text-sm">
              Own domain (optional)
            </h3>
            <p className="text-[13px] text-muted">
              Your shop runs at <span className="font-mono text-ink">{primaryHost}</span>. To use your own domain, create this DNS record at your domain provider and
              request the domain below. We connect it (including the HTTPS certificate) and tell you when it is live.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-[13px]">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="py-1 pr-3 font-normal">Type</th>
                    <th className="py-1 pr-3 font-normal">Name</th>
                    <th className="py-1 font-normal">Value</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  <tr>
                    <td className="py-1 pr-3">CNAME</td>
                    <td className="py-1 pr-3">www</td>
                    <td className="py-1">{cnameTarget}.</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted">Using the bare domain (your-shop.com without www)? Ask us for the A record, or forward it to www at your provider.</p>
            <DomainForm requested={tenant.state.golive?.domainRequest ?? null} />
          </section>

          <div className="mt-5 grid gap-3 border-t border-line pt-4">
            {!ready ? (
              <InlineAlert tone="warn" title="Not ready yet">
                Fix the required points above to go live.
              </InlineAlert>
            ) : null}
            <GoLiveForm ready={ready} warnings={warnings} />
          </div>
          <StepFooter step={step} />
        </>
      );
    }
  }
}
