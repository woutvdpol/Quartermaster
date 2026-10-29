import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cn } from "@/components/shop/ui/cn";
import { TurnstileSiteKeyProvider } from "@/components/shop/turnstile/TurnstileSiteKey";
import { CURRENT_PLATFORMS, CURRENT_PLATFORM_LABELS, signupCountryOptions } from "@/server/onboarding/rules";
import { getSignupConfig } from "@/server/platform/signup";
import { getRequestScope } from "@/server/tenant";
import { PlatformShell } from "../_platform/PlatformShell";
import { platformCopy } from "../_platform/_copy";
import { wrapClass } from "../_platform/parts";
import { ApplyForm } from "./ApplyForm";
import { applyCopy as t } from "./_copy";

export async function generateMetadata(): Promise<Metadata> {
  const { signupMode } = await getSignupConfig();
  return { title: { absolute: `${t.modes[signupMode].metaTitle} — Quartermaster` } };
}

/**
 * Dealer sign-up on the platform host (design: docs/design/platform-signup.html, DESIGN.md). Texts follow the
 * sign-up mode (apply / waitlist / free trial, docs/signup-modes.md); the form is the same. Every "start"
 * button on the platform links to `#apply-form`. Shops' own hosts 404.
 */
export default async function ApplyPage() {
  if ((await getRequestScope()).kind !== "platform") notFound();
  const { signupMode, trialDays } = await getSignupConfig();
  const m = t.modes[signupMode];
  const title = typeof m.title === "function" ? m.title(trialDays) : m.title;
  return (
    // The (shop) layout returns platform-host pages unwrapped, so the runtime site key is provided here.
    <TurnstileSiteKeyProvider siteKey={process.env.TURNSTILE_SITE_KEY || process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || undefined}>
      <PlatformShell cta={platformCopy.cta[signupMode].short()} ctaHref="#apply-form">
        <div className="flex-1 bg-pf-paper-2">
          <div className={cn(wrapClass, "grid items-start gap-9 pt-8 pb-14 sm:pt-[clamp(40px,5.5vw,80px)] sm:pb-[clamp(56px,7vw,104px)] lg:grid-cols-[minmax(0,1fr)_520px] lg:gap-[clamp(32px,6vw,88px)]")}>
            <div>
              <h1 className="max-w-[20ch] font-pf-display text-[clamp(32px,4.2vw,52px)] leading-[1.06] font-semibold tracking-[-0.015em] text-balance lg:max-w-[18ch]">
                {title}
              </h1>
              <p className="mt-[18px] max-w-[50ch] text-[17px] text-pf-ink-2 text-pretty sm:text-[19px]">{m.intro}</p>
              <section aria-labelledby="next-title" className="mt-9 lg:mt-12">
                <h2 id="next-title" className="font-pf-display text-[22px] leading-[1.2] font-semibold tracking-[-0.015em]">
                  {t.next}
                </h2>
                <ol className="mt-[22px] ml-1.5 border-l border-pf-line">
                  {m.steps.map((s, i) => (
                    <li
                      key={s.title}
                      className={cn(
                        "relative pb-7 pl-7 last:pb-0.5 before:absolute before:top-1.5 before:-left-[6.5px] before:size-[11px] before:rounded-full before:border-2 before:border-pf-ink before:content-['']",
                        i === m.steps.length - 1 ? "before:bg-pf-ink" : "before:bg-pf-paper-2",
                      )}
                    >
                      <h3 className="font-pf-display text-[19px] leading-[1.35] font-semibold tracking-[-0.015em]">{s.title}</h3>
                      <p className="mt-1 text-pf-ink-2">{s.body}</p>
                      <p className="mt-1.5 text-[14.5px] text-pf-muted">{s.meta}</p>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
            <section id="apply-form" aria-labelledby="apply-title" className="scroll-mt-24 rounded-[14px] border border-pf-line bg-pf-paper px-5 py-6 sm:p-7">
              <h2 id="apply-title" className="font-pf-display text-[22px] leading-[1.2] font-semibold tracking-[-0.015em]">
                {m.formTitle}
              </h2>
              <ApplyForm
                countries={signupCountryOptions()}
                platforms={CURRENT_PLATFORMS.map((p) => ({ value: p, label: CURRENT_PLATFORM_LABELS[p] }))}
                submitLabel={m.submit}
                footnote={m.footnote}
              />
            </section>
          </div>
        </div>
      </PlatformShell>
    </TurnstileSiteKeyProvider>
  );
}
