import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TurnstileSiteKeyProvider } from "@/components/shop/turnstile/TurnstileSiteKey";
import { CURRENT_PLATFORMS, CURRENT_PLATFORM_LABELS, signupCountryOptions } from "@/server/onboarding/rules";
import { getSignupConfig } from "@/server/platform/signup";
import { getRequestScope } from "@/server/tenant";
import { PlatformShell } from "../_platform/PlatformShell";
import { ApplyForm } from "./ApplyForm";
import { applyCopy as t } from "./_copy";

export async function generateMetadata(): Promise<Metadata> {
  const { signupMode } = await getSignupConfig();
  return { title: { absolute: `${t.modes[signupMode].metaTitle} — Quartermaster` } };
}

/**
 * Dealer sign-up on the platform host (docs/design/onboarding/Signup.dc.html). Texts follow the sign-up
 * mode (apply / waitlist / free trial, docs/signup-modes.md); the form is the same. Shops' own hosts 404.
 */
export default async function ApplyPage() {
  if ((await getRequestScope()).kind !== "platform") notFound();
  const { signupMode, trialDays } = await getSignupConfig();
  const m = t.modes[signupMode];
  const title = typeof m.title === "function" ? m.title(trialDays) : m.title;
  return (
    // The (shop) layout returns platform-host pages unwrapped, so the runtime site key is provided here.
    <TurnstileSiteKeyProvider siteKey={process.env.TURNSTILE_SITE_KEY || process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || undefined}>
      <PlatformShell>
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_minmax(0,520px)] lg:py-16">
          <div className="grid content-start gap-6">
            <p className="font-mono text-xs tracking-[0.3em] text-[#7E5416] uppercase">{t.eyebrow}</p>
            <h1 className="text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">{title}</h1>
            <p className="max-w-xl text-lg text-[#44463b]">{m.intro}</p>
            <ol className="grid max-w-xl gap-4">
              {m.steps.map((s) => (
                <li key={s.n} className="flex gap-4">
                  <span className="font-mono text-sm font-semibold text-[#7E5416]">{s.n}</span>
                  <span>
                    <strong className="font-semibold">{s.title}</strong> — {s.body}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <section aria-labelledby="apply-title" className="rounded-lg border border-[#D7D8CC] bg-[#FAFAF6] p-5 shadow-sm sm:p-7">
            <h2 id="apply-title" className="mb-5 text-2xl font-semibold tracking-tight">
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
      </PlatformShell>
    </TurnstileSiteKeyProvider>
  );
}
