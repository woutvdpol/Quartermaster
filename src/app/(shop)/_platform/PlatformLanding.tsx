import Link from "next/link";
import { cn } from "@/components/shop/ui/cn";
import { MODULES, PLANS, PLAN_IDS, planAddedModules } from "@/server/modules/catalog";
import { getSignupConfig } from "@/server/platform/signup";
import { PLATFORM_FONT_CSS, PLATFORM_FONT_PRELOADS, platformFontVariables } from "@/lib/platform-fonts";
import { platformCopy as t } from "./_copy";
import { CheckoutDemo } from "./CheckoutDemo";
import { LandingNav } from "./LandingNav";
import { AdminWindow, FairPhone, NetworkSearch, StoreGrid } from "./LandingMocks";
import { buttonClass, wordmarkClass, wrapClass } from "./parts";
import { CardIcon, CheckIcon, FileIcon, GlobeIcon, LockIcon, PlusIcon } from "./icons";

/*
 * `/` on the platform host (PLATFORM_HOST): the Quartermaster landing for dealers. Design:
 * docs/design/platform-landing.html, system: DESIGN.md (category-standard commerce landing; the
 * proof is one stock line across channels, see CheckoutDemo). Calls to action follow the sign-up mode
 * (docs/signup-modes.md); package prices and contents come from the module catalog.
 */

const section = "scroll-mt-20 py-[clamp(72px,10vw,128px)]";
const headline = "font-pf-display text-[clamp(32px,4.2vw,52px)] leading-[1.06] font-semibold tracking-[-0.015em] text-balance";
const title = "font-pf-display text-[clamp(28px,3vw,38px)] leading-[1.1] font-semibold tracking-[-0.015em] text-balance";
const lead = "mt-[18px] max-w-[60ch] text-[19px] text-pf-ink-2 text-pretty";

const euro = new Intl.NumberFormat("en", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

function Points({ items, onOlive = false }: { items: readonly string[]; onOlive?: boolean }) {
  return (
    <ul className="mt-[22px] grid gap-2.5">
      {items.map((item) => (
        <li key={item} className={cn("flex gap-2.5", onOlive ? "text-pf-olive-ink" : "text-pf-ink-2")}>
          <CheckIcon className={cn("mt-1 size-[18px] flex-none", onOlive ? "text-pf-olive-check" : "text-pf-ok")} />
          {item}
        </li>
      ))}
    </ul>
  );
}

function FeatureRow({ heading, body, points, visual, reverse = false, className }: { heading: string; body: string; points: readonly string[]; visual: React.ReactNode; reverse?: boolean; className?: string }) {
  return (
    <div className={cn("grid items-center gap-[clamp(32px,6vw,88px)] lg:grid-cols-2", className)}>
      <div>
        <h3 className={title}>{heading}</h3>
        <p className="mt-4 max-w-[52ch] text-lg text-pf-ink-2">{body}</p>
        <Points items={points} />
      </div>
      <div className={cn("flex justify-center", reverse && "lg:order-first")}>{visual}</div>
    </div>
  );
}

export async function PlatformLanding() {
  const { signupMode: mode, trialDays: days } = await getSignupConfig();
  const ctaLong = t.cta[mode].long(days);
  const ctaShort = t.cta[mode].short();
  const pricingBody = t.pricing.body[mode];
  const [firstQuestion, firstAnswer] = t.faq.first[mode];

  return (
    <div className={cn("qm-platform min-h-dvh bg-pf-paper font-pf-body text-base leading-[1.55] text-pf-ink sm:text-[17px]", platformFontVariables)}>
      {/* Self-hosted fonts (src/lib/platform-fonts.ts); React hoists these into <head>. */}
      {PLATFORM_FONT_PRELOADS.map((href) => (
        <link key={href} rel="preload" href={href} as="font" type="font/woff2" crossOrigin="anonymous" />
      ))}
      <style href="qm-platform-fonts" precedence="default">
        {PLATFORM_FONT_CSS}
      </style>

      <LandingNav cta={ctaShort} />

      <main id="top">
        <section aria-labelledby="hero-title" className="overflow-hidden pt-[clamp(40px,4.5vw,56px)] text-center">
          <div className={wrapClass}>
            <h1 id="hero-title" className="mx-auto max-w-[20ch] font-pf-display text-[clamp(42px,5.8vw,78px)] leading-[1.02] font-semibold tracking-[-0.015em] text-balance">
              {t.hero.title}
            </h1>
            <p className="mx-auto mt-5 max-w-[64ch] text-[clamp(18px,1.7vw,21px)] text-pf-ink-2 text-pretty">{t.hero.body}</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/apply" className={cn(buttonClass.primary, "max-sm:w-full")}>
                {ctaLong}
              </Link>
              <a href="#how" className={cn(buttonClass.secondary, "max-sm:w-full")}>
                {t.hero.secondary}
              </a>
            </div>
            <ul className="mt-[18px] flex flex-wrap justify-center gap-x-5 gap-y-1.5 text-[14.5px] text-pf-muted">
              {t.hero.checks[mode].map((check) => (
                <li key={check} className="inline-flex items-center gap-1.5">
                  <CheckIcon className="size-4 text-pf-ok" />
                  {check}
                </li>
              ))}
            </ul>
          </div>
          {/* The canvas band starts behind the window, so the window reads as lifted off the page. */}
          <div className="relative mt-[clamp(32px,3.5vw,44px)] before:absolute before:inset-x-0 before:top-[140px] before:bottom-0 before:bg-pf-canvas before:content-['']">
            <div className="relative mx-auto max-w-[1080px] px-[clamp(16px,4vw,56px)]">
              <AdminWindow />
            </div>
          </div>
        </section>

        <div className="border-b border-pf-line bg-pf-canvas">
          <ul className={cn(wrapClass, "flex flex-col items-start gap-3 py-7 text-[15px] text-pf-ink-2 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-x-10")}>
            {t.facts.map((fact, i) => {
              const Icon = [CardIcon, GlobeIcon, LockIcon][i];
              return (
                <li key={fact} className="inline-flex items-center gap-2">
                  <Icon className="size-[18px] flex-none" />
                  {fact}
                </li>
              );
            })}
          </ul>
        </div>

        <section id="how" aria-labelledby="how-title" className={section}>
          <div className={wrapClass}>
            <div className="max-w-[720px]">
              <h2 id="how-title" className={headline}>
                {t.how.title}
              </h2>
              <p className={lead}>{t.how.body}</p>
            </div>
            <CheckoutDemo />
          </div>
        </section>

        <section id="features" aria-labelledby="features-title" className={cn(section, "border-y border-pf-line-soft bg-pf-paper-2")}>
          <div className={wrapClass}>
            <div className="max-w-[720px]">
              <h2 id="features-title" className={headline}>
                {t.features.title}
              </h2>
              <p className={lead}>{t.features.body}</p>
            </div>
            <FeatureRow className="mt-16" heading={t.features.fair.title} body={t.features.fair.body} points={t.features.fair.points} visual={<FairPhone />} />
            <FeatureRow className="mt-[clamp(72px,9vw,120px)]" reverse heading={t.features.compliance.title} body={t.features.compliance.body} points={t.features.compliance.points} visual={<StoreGrid />} />
            <div className="mt-[clamp(72px,9vw,120px)] grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
              {t.features.index.map((group) => (
                <div key={group.title}>
                  <h3 className="border-b border-pf-ink pb-3 text-[15px] font-semibold">{group.title}</h3>
                  <dl>
                    {group.items.map(([name, text]) => (
                      <div key={name} className="mt-4">
                        <dt className="font-semibold">{name}</dt>
                        <dd className="mt-0.5 text-[15px] text-pf-muted">{text}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="switch" aria-labelledby="switch-title" className={section}>
          <div className={wrapClass}>
            <div className="max-w-[720px]">
              <h2 id="switch-title" className={headline}>
                {t.switch.title}
              </h2>
              <p className={lead}>{t.switch.body[mode]}</p>
            </div>
            <ol className="mt-14 grid border-pf-line max-lg:ml-1.5 max-lg:border-l lg:grid-cols-3 lg:border-t">
              {t.switch.steps[mode].map((step, i, all) => (
                <li
                  key={step.title}
                  className={cn(
                    "relative pb-8 pl-7 before:absolute before:size-[11px] before:rounded-full before:border-2 before:border-pf-ink before:content-[''] max-lg:before:top-1 max-lg:before:-left-[6.5px] lg:pt-7 lg:pr-8 lg:pb-0 lg:pl-0 lg:before:-top-1.5 lg:before:left-0",
                    i === all.length - 1 ? "before:bg-pf-ink" : "before:bg-pf-paper",
                  )}
                >
                  <h3 className="font-pf-display text-[22px] leading-[1.2] font-semibold tracking-[-0.015em]">{step.title}</h3>
                  <p className="mt-2 text-pf-ink-2">{step.body}</p>
                  <p className="mt-3 text-sm text-pf-muted">{step.meta}</p>
                </li>
              ))}
            </ol>
            <ul aria-label={t.switch.importsLabel} className="mt-11 flex flex-wrap gap-2.5">
              {t.switch.imports.map((name) => (
                <li key={name} className="inline-flex h-10 items-center gap-2 rounded-lg border border-pf-line bg-pf-paper px-3.5 text-[15px] font-medium">
                  <FileIcon className="size-[18px] text-pf-ink-2" />
                  {name}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="network" aria-labelledby="network-title" className={cn(section, "bg-pf-olive text-pf-on-olive")}>
          <div className={cn(wrapClass, "grid items-center gap-[clamp(32px,6vw,88px)] lg:grid-cols-2")}>
            <div>
              <h2 id="network-title" className={headline}>
                {t.network.title}
              </h2>
              <p className="mt-4 max-w-[52ch] text-lg text-pf-olive-ink">{t.network.body}</p>
              <Points items={t.network.points} onOlive />
            </div>
            <div className="flex justify-center">
              <NetworkSearch />
            </div>
          </div>
        </section>

        <section id="pricing" aria-labelledby="pricing-title" className={section}>
          <div className={wrapClass}>
            <div className="mx-auto max-w-[720px] text-center">
              <h2 id="pricing-title" className={headline}>
                {t.pricing.title}
              </h2>
              <p className={cn(lead, "mx-auto")}>{typeof pricingBody === "function" ? pricingBody(days) : pricingBody}</p>
            </div>
            <div className="mt-14 grid items-stretch gap-5 max-lg:mx-auto max-lg:max-w-[520px] lg:grid-cols-3">
              {PLAN_IDS.map((id) => {
                const plan = PLANS[id];
                const copy = t.pricing.plans[id];
                const featured = id === "COMPLETE";
                const lines = id === "START" ? copy.core : planAddedModules(id).map((m) => MODULES[m].name);
                return (
                  <div key={id} className={cn("relative flex flex-col rounded-[14px] border bg-pf-paper p-6 sm:p-7", featured ? "border-pf-ink shadow-pf-frame" : "border-pf-line")}>
                    {featured ? <span className="absolute -top-[13px] left-7 inline-flex h-[26px] items-center rounded-full bg-pf-ink px-3 text-[13px] font-semibold text-white">{t.pricing.featured[mode]}</span> : null}
                    <h3 className="font-pf-display text-2xl leading-[1.2] font-semibold tracking-[-0.015em]">{plan.name}</h3>
                    <p className="mt-1 text-[15.5px] text-pf-muted">{copy.for}</p>
                    <p className="mt-[22px] flex items-baseline gap-1.5">
                      <strong className="font-pf-display text-5xl leading-none font-semibold tracking-[-0.02em] tabular-nums">{euro.format(plan.priceCents / 100)}</strong>
                      <span className="text-[15px] text-pf-muted">{t.pricing.perMonth}</span>
                    </p>
                    <p className="mt-2.5 text-[15px] text-pf-ink-2">{t.pricing.limits(plan.limits.productLimit, plan.limits.photoLimit)}</p>
                    <Link href="/apply" className={cn(featured ? buttonClass.primary : buttonClass.secondary, "mt-6 w-full")}>
                      {ctaShort}
                    </Link>
                    <ul className="mt-6 grid gap-2.5 border-t border-pf-line-soft pt-[22px] text-[15.5px]">
                      {[copy.includes, ...lines].map((line, i) => (
                        <li key={line} className={cn("flex gap-2.5", i === 0 && "font-semibold")}>
                          <CheckIcon className="mt-[3px] size-[18px] flex-none text-pf-ok" />
                          {line}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
            <div className="mt-7 flex flex-wrap justify-between gap-x-8 gap-y-3 text-[15px] text-pf-muted">
              {t.pricing.notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" aria-labelledby="faq-title" className={cn(section, "border-y border-pf-line-soft bg-pf-paper-2")}>
          <div className={wrapClass}>
            <h2 id="faq-title" className={cn(headline, "text-center")}>
              {t.faq.title}
            </h2>
            <div className="mx-auto mt-12 max-w-[820px] border-t border-pf-line">
              {[[firstQuestion, firstAnswer] as const, ...t.faq.items].map(([question, answer], i) => (
                <details key={question} open={i === 0} className="group border-b border-pf-line">
                  <summary className="flex list-none items-center justify-between gap-6 py-[22px] font-pf-display text-[19px] leading-[1.35] font-semibold">
                    {question}
                    <PlusIcon className="size-5 flex-none text-pf-muted transition-transform duration-300 ease-pf-out group-open:rotate-45" />
                  </summary>
                  <p className="max-w-[68ch] pb-6 text-pf-ink-2 sm:pr-12">{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="closing-title" className="border-t border-pf-line bg-pf-canvas">
          <div className={cn(wrapClass, "py-[clamp(72px,9vw,112px)] text-center")}>
            <h2 id="closing-title" className="font-pf-display text-[clamp(34px,4.6vw,58px)] leading-[1.04] font-semibold tracking-[-0.015em] text-balance">
              {t.closing[mode].title(days)}
            </h2>
            <p className="mx-auto mt-[18px] max-w-[52ch] text-[19px] text-pf-ink-2">{t.closing[mode].body}</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/apply" className={cn(buttonClass.primary, "max-sm:w-full")}>
                {ctaLong}
              </Link>
              <Link href="/admin" className={cn(buttonClass.secondary, "max-sm:w-full")}>
                {t.nav.login}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-pf-line bg-pf-paper-2">
        <div className={cn(wrapClass, "flex flex-wrap items-center justify-between gap-x-8 gap-y-4 py-8 text-[14.5px] text-pf-muted")}>
          <span>
            <a href="#top" className={cn(wordmarkClass, "mr-3 text-pf-ink")}>
              {t.name}
            </a>
            {t.tagline}
          </span>
          <nav aria-label={t.footer.label} className="flex flex-wrap gap-6">
            <Link href="/apply" className="no-underline hover:text-pf-ink">
              {t.footer.open}
            </Link>
            <Link href="/network" className="no-underline hover:text-pf-ink">
              {t.footer.network}
            </Link>
            <Link href="/admin" className="no-underline hover:text-pf-ink">
              {t.footer.login}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
